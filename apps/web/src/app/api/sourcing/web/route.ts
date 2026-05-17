import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getImagePreviewUrl } from "@/lib/image-preview";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
    const data: any[] = await r.json();
    if (!data.length) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { query, near, city } = await req.json();

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
      tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
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

    let parsed: any;
    try {
      parsed = JSON.parse(finalText.text);
    } catch {
      const match = finalText.text.match(/\{[\s\S]*\}/);
      if (!match) return NextResponse.json({ items: [], source: "web" });
      parsed = JSON.parse(match[0]);
    }

    const rawItems: any[] = parsed.items ?? [];

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
        const categoryFallback = (() => {
          const q = query.toLowerCase();
          const map: Record<string, string> = {
            smartphone: "photo-1511707171634-5f897ff02aa9", laptop: "photo-1496181133206-80ce9b88a853",
            camera: "photo-1516035069371-29a1b244cc32", headphones: "photo-1505740420928-5e560c06d30e",
            tv: "photo-1593359677879-a4bb92f4834c", electronics: "photo-1498049794561-7780e7231661",
            coffee: "photo-1461023058943-07fcbe16d735", matcha: "photo-1536256263959-770b48d82b0a",
            shoes: "photo-1542291026-7eec264c27ff", clothing: "photo-1489987707025-afc232f7ea0f",
            sports: "photo-1517649763962-0c623066013b", books: "photo-1481627834876-b7833e8f5570",
            vitamins: "photo-1584308666744-24d5c474f2ae", toys: "photo-1558618666-fcd25c85cd64",
            pet: "photo-1583337130417-3346a1be7dee", baby: "photo-1515488042361-ee00e0ddd4e4",
            skincare: "photo-1556228720-195a672e8a03", groceries: "photo-1542838132-92c53300491e",
          };
          const key = q.match(/iphone|samsung|xiaomi|smartphone/) ? "smartphone"
            : q.match(/laptop|macbook|notebook/) ? "laptop"
            : q.match(/camera|dslr|mirrorless/) ? "camera"
            : q.match(/headphone|earphone|earbuds/) ? "headphones"
            : q.match(/tv|televisi/) ? "tv"
            : q.match(/coffee|kopi/) ? "coffee"
            : q.match(/matcha/) ? "matcha"
            : q.match(/shoes|sepatu|sneaker/) ? "shoes"
            : q.match(/baju|fashion|clothing/) ? "clothing"
            : q.match(/sport|badminton|raket/) ? "sports"
            : q.match(/buku|book|novel/) ? "books"
            : q.match(/vitamin|suplemen/) ? "vitamins"
            : q.match(/mainan|toy|lego/) ? "toys"
            : q.match(/pet|kucing|anjing/) ? "pet"
            : q.match(/baby|bayi|pampers/) ? "baby"
            : q.match(/skincare|serum|sunscreen/) ? "skincare"
            : q.match(/groceries|sembako|bahan makanan/) ? "groceries"
            : "electronics";
          return `https://images.unsplash.com/${map[key] ?? "photo-1472851294608-062f824d29cc"}?w=400&q=70&auto=format&fit=crop`;
        })();

        const rawImageUrl = item.imageUrl || ogImage || categoryFallback;
        const previewImageUrl = await getImagePreviewUrl(rawImageUrl);

        return {
          source: "web",
          externalUrl: item.externalUrl ?? "",
          title: item.title,
          description: item.description ?? "",
          imageUrl: previewImageUrl ?? rawImageUrl,
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
  } catch (e: any) {
    return NextResponse.json({ items: [], source: "web", error: e.message });
  }
}
