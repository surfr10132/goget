import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getClientIp, rateLimitHeaders, takeRateLimitToken } from "@/lib/server-rate-limit";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { getImagePreviewUrl } from "@/lib/image-preview";
import { fetchSourceSiteImage, normalizeHttpUrl } from "@/lib/source-site-image";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const SOURCING_WEB_WINDOW_MS = 60 * 1000;
const SOURCING_WEB_MAX_PER_IP = 12;
const MAX_SEARCH_RADIUS_MILES = 35;
const MAX_SEARCH_DISTANCE_KM = Number((MAX_SEARCH_RADIUS_MILES * 1.60934).toFixed(2));
const SourcingWebRequestSchema = z.object({
  query: z.string().trim().min(1),
  near: z
    .object({
      lat: z.coerce.number().finite(),
      lng: z.coerce.number().finite(),
    })
    .optional(),
  maxDistanceKm: z.coerce.number().positive().max(MAX_SEARCH_DISTANCE_KM).optional().default(MAX_SEARCH_DISTANCE_KM),
  city: z.string().trim().optional(),
});

interface GeocodeLookupResult {
  lat: string;
  lon: string;
}
const BLOCKED_DOMAINS = [
  "tokopedia", "shopee", "lazada", "bukalapak", "blibli",
  "zalora", "jd.id", "orami", "sociolla", "amazon", "aliexpress", "ebay",
];

function isBlockedDomain(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_DOMAINS.some((domain) => lower.includes(domain));
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
  const { query, near, city, maxDistanceKm } = body.data;

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
    // Keep only candidates that look like real local stores before geocoding.
    const filtered = rawItems
      .map((item) => {
        const externalUrl = normalizeHttpUrl(item.externalUrl);
        const title = item.title?.trim();
        const merchantName = item.merchantName?.trim();
        const pickupAddress = item.pickupAddress?.trim();
        if (!externalUrl || isBlockedDomain(externalUrl)) return null;
        if (!title || !merchantName || !pickupAddress) return null;
        return {
          ...item,
          externalUrl,
          title,
          merchantName,
          pickupAddress,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const geocoded = await Promise.all(
      filtered.map(async (item) => {
        // Geocoding and source image extraction run in parallel — neither waits for the other.
        const [geo, sourceSiteImage] = await Promise.all([
          item.pickupAddress
            ? geocodeAddress(item.pickupAddress, item.pickupCity ?? locationHint)
            : Promise.resolve(null),
          fetchSourceSiteImage(item.externalUrl),
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

        // Source image policy: only use real source-page images, then serve a proxied preview when possible.
        const sourceImageUrl = sourceSiteImage ?? normalizeHttpUrl(item.imageUrl) ?? undefined;
        const imageUrl = await getImagePreviewUrl(sourceImageUrl);

        return {
          source: "web",
          externalUrl: item.externalUrl,
          title: item.title,
          description: item.description ?? "",
          imageUrl,
          priceIDR: item.priceIDR ?? 0,
          merchantName: item.merchantName,
          pickupAddress: item.pickupAddress,
          pickupCity: item.pickupCity ?? locationHint,
          pickupGeo: geo,
          availableQty: undefined,
          distanceKm,
        };
      }),
    );
    // Keep only geocoded local stores and enforce search radius when a location is supplied.
    const results = geocoded.filter((item) => {
      if (!item.pickupGeo) return false;
      if (!near) return true;
      return item.distanceKm !== undefined && item.distanceKm <= maxDistanceKm;
    });

    return NextResponse.json({ items: results, source: "web" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "web_sourcing_failed";
    return NextResponse.json({ items: [], source: "web", error: message });
  }
}
