import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getImageUrl } from "@goget/shared/sourcing";
import { getClientIp, rateLimitHeaders, takeRateLimitToken } from "@/lib/server-rate-limit";
import { parseJsonBody } from "@/app/api/_lib/validation";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const SOURCING_WEB_WINDOW_MS = 60 * 1000;
const SOURCING_WEB_MAX_PER_IP = 12;
const SourcingWebRequestSchema = z.object({
  query: z.string().trim().min(1),
  near: z
    .object({
      lat: z.coerce.number().finite(),
      lng: z.coerce.number().finite(),
    })
    .optional(),
  city: z.string().trim().optional(),
});

interface GeocodeLookupResult {
  lat: string;
  lon: string;
}

interface LlmWebItem {
  title?: string;
  description?: string;
  priceIDR?: number;
  merchantName?: string;
  pickupAddress?: string;
  pickupCity?: string;
  imageUrl?: string | null;
  externalUrl?: string;
}

interface LlmWebResponse {
  items?: LlmWebItem[];
}

const BLOCKED_DOMAINS = [
  "tokopedia", "shopee", "lazada", "bukalapak", "blibli",
  "zalora", "jd.id", "orami", "sociolla",
];

// ── Open Graph image extraction ────────────────────────────────────────────
// Module-level cache so repeated searches for the same store page don't
// re-fetch. Keyed by URL, value is the og:image URL or null if not found.
const ogCache = new Map<string, string | null>();

async function fetchOgImage(url: string): Promise<string | null> {
  if (!url || url.startsWith("https://www.google.com/maps")) return null;
  if (ogCache.has(url)) return ogCache.get(url)!;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoGet-Bot/1.0; +https://goget.id)",
        "Accept": "text/html",
      },
    });
    if (!res.ok) { ogCache.set(url, null); return null; }

    // Only read the first 8 KB — the <head> with meta tags is always near the top
    const reader = res.body?.getReader();
    if (!reader) { ogCache.set(url, null); return null; }
    let html = "";
    while (html.length < 8_192) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();

    // Match either attribute order for og:image
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    const imageUrl = m?.[1] ?? null;
    ogCache.set(url, imageUrl);
    return imageUrl;
  } catch {
    ogCache.set(url, null);
    return null;
  }
}

const SYSTEM = `You are a sourcing agent for GoGet — an Indonesian same-day delivery service that finds items at local physical stores.

Your job: use web search to find PHYSICAL brick-and-mortar stores in Indonesia that currently stock the requested item near the user's location.

RULES:
- NEVER return results from online marketplaces: Tokopedia, Shopee, Lazada, Bukalapak, Blibli, or similar
- ONLY return stores with a real street address where items can be picked up today
- Search in Indonesian AND English (e.g. "makanan kucing Royal Canin toko Bali")
- Try to find the actual product image URL from the store or brand's page
- If price is not found, estimate based on typical Indonesian retail prices
- Return up to 5 results

After searching, respond ONLY with valid JSON — no markdown, no explanation:
{
  "items": [
    {
      "title": "exact brand + model name only — e.g. 'Dyson V11 Absolute 500W' or 'Royal Canin Indoor Adult 4kg'. NO price, date, or availability in the title.",
      "description": "1-2 sentence description",
      "priceIDR": 150000,
      "merchantName": "Store name",
      "pickupAddress": "Full street address, district, city",
      "pickupCity": "City name",
      "imageUrl": "direct URL to product image, or null",
      "externalUrl": "store page URL"
    }
  ]
}

If no physical stores are found, return: {"items":[]}`;

async function geocodeAddress(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${city}, Indonesia`);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=id`,
      { headers: { "User-Agent": "GoGet-App/1.0", "Accept-Language": "id,en" } },
    );
    const data = (await r.json()) as GeocodeLookupResult[];
    if (!data.length) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const rate = takeRateLimitToken({
    scope: "sourcing-web-ip",
    identifier: getClientIp(req),
    max: SOURCING_WEB_MAX_PER_IP,
    windowMs: SOURCING_WEB_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many web sourcing requests. Please retry shortly." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }
  const body = await parseJsonBody(req, SourcingWebRequestSchema);
  if (!body.success) return body.response;
  const { query, near, city } = body.data;

  if (!client) {
    return NextResponse.json({ items: [], source: "web", error: "no_api_key" });
  }

  const locationHint = city
    ? city.replace("(demo)", "").trim()
    : near
    ? `near coordinates ${near.lat.toFixed(2)}, ${near.lng.toFixed(2)}`
    : "Indonesia";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      tools: [
        { type: "web_search_20250305", name: "web_search" } as unknown as Anthropic.Messages.Tool,
      ],
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Find physical stores selling: "${query}" near ${locationHint}, Indonesia. I need stores I can visit or get same-day delivery from today.`,
        },
      ],
    });

    const finalText = response.content.find((c) => c.type === "text");
    if (!finalText || finalText.type !== "text") {
      return NextResponse.json({ items: [], source: "web" });
    }

    let parsed: LlmWebResponse;
    try {
      parsed = JSON.parse(finalText.text);
    } catch {
      const match = finalText.text.match(/\{[\s\S]*\}/);
      if (!match) return NextResponse.json({ items: [], source: "web" });
      parsed = JSON.parse(match[0]);
    }

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    // Filter out marketplace domains and geocode in parallel
    const filtered = rawItems.filter((item) => {
      const url = (item.externalUrl ?? "").toLowerCase();
      return !BLOCKED_DOMAINS.some((d) => url.includes(d));
    });

    const geocoded = await Promise.all(
      filtered.map(async (item) => {
        // Geocoding and OG image extraction run in parallel — neither waits for the other
        const [geo, ogImage] = await Promise.all([
          item.pickupAddress
            ? geocodeAddress(item.pickupAddress, item.pickupCity ?? locationHint)
            : Promise.resolve(null),
          // Only try OG extraction when Claude didn't already return an image URL
          !item.imageUrl && item.externalUrl
            ? fetchOgImage(item.externalUrl)
            : Promise.resolve(null),
        ]);

        const distanceKm =
          geo && near
            ? (() => {
                const R = 6371;
                const r = (d: number) => (d * Math.PI) / 180;
                const dLat = r(geo.lat - near.lat);
                const dLng = r(geo.lng - near.lng);
                const h =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos(r(near.lat)) * Math.cos(r(geo.lat)) * Math.sin(dLng / 2) ** 2;
                return parseFloat((2 * R * Math.asin(Math.sqrt(h))).toFixed(1));
              })()
            : undefined;

        // Priority: Claude's imageUrl → og:image from the store page → category fallback
        const categoryFallback = getImageUrl(query);

        return {
          source: "web",
          externalUrl: item.externalUrl ?? "",
          title: item.title,
          description: item.description ?? "",
          imageUrl: item.imageUrl || ogImage || categoryFallback,
          priceIDR: item.priceIDR ?? 0,
          merchantName: item.merchantName,
          pickupAddress: item.pickupAddress ?? "",
          pickupCity: item.pickupCity ?? locationHint,
          pickupGeo: geo,
          availableQty: undefined,
          distanceKm,
        };
      }),
    );

    // If near coords given, filter to 35km; otherwise return all
    const results = near
      ? geocoded.filter((i) => i.distanceKm === undefined || i.distanceKm <= 35)
      : geocoded;

    return NextResponse.json({ items: results, source: "web" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "web_sourcing_failed";
    return NextResponse.json({ items: [], source: "web", error: message });
  }
}
