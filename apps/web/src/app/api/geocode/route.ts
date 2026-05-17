import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseSearchParams } from "@/app/api/_lib/validation";

// Server-side proxy to Nominatim so we control the User-Agent header
// (their ToS requires a contactable UA) and so we can apply a small in-memory
// cache to soften repeat queries below their 1 req/sec policy.

interface NominatimSearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
}

interface SearchHit {
  lat: number;
  lng: number;
  label: string;
  placeId: number;
}

interface ReverseHit {
  lat: number;
  lng: number;
  label: string;
}

const GeocodeQuerySchema = z.union([
  z.object({
    mode: z.literal("search"),
    q: z.string().optional().default(""),
  }),
  z.object({
    mode: z.literal("reverse"),
    lat: z.coerce.number().finite(),
    lng: z.coerce.number().finite(),
  }),
]);

const UA = "GoGet/1.0 (https://goget.id; contact: ops@goget.id)";
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

interface CacheEntry { value: unknown; expires: number }
const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// Serialize Nominatim calls per-process so we never breach 1 req/sec, even
// when several clients debounce around the same moment.
let lastCallAt = 0;
const MIN_INTERVAL_MS = 1100;
let chain: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  chain = next.catch(() => undefined);
  return next as Promise<T>;
}

async function nominatim(path: string, params: Record<string, string>) {
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("accept-language", "id");

  const r = await fetch(url.toString(), {
    headers: { "User-Agent": UA, "Accept-Language": "id,en" },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const params = parseSearchParams(req, GeocodeQuerySchema);
  if (!params.success) return params.response;
  const query = params.data;

  try {
    if (query.mode === "search") {
      const q = query.q.trim();
      if (q.length < 3) return NextResponse.json({ results: [] });

      const key = `s:${q.toLowerCase()}`;
      const cached = cacheGet<SearchHit[]>(key);
      if (cached) return NextResponse.json({ results: cached });

      const data = (await throttled(() =>
        nominatim("search", {
          q,
          countrycodes: "id",
          limit: "6",
          addressdetails: "1",
        }),
      )) as NominatimSearchResult[];

      const results: SearchHit[] = data.map(d => ({
        lat: Number(d.lat),
        lng: Number(d.lon),
        label: d.display_name,
        placeId: d.place_id,
      }));
      cacheSet(key, results);
      return NextResponse.json({ results });
    }

    if (query.mode === "reverse") {
      const { lat, lng } = query;

      // Round to ~10m so jitter doesn't bust the cache
      const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
      const cached = cacheGet<ReverseHit>(key);
      if (cached) return NextResponse.json(cached);

      const data = (await throttled(() =>
        nominatim("reverse", {
          lat: String(lat),
          lon: String(lng),
          zoom: "18",
          addressdetails: "1",
        }),
      )) as NominatimSearchResult & { error?: string };

      if (!data || (data as { error?: string }).error) {
        return NextResponse.json({ error: "No address found" }, { status: 404 });
      }
      const result: ReverseHit = {
        lat,
        lng,
        label: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      };
      cacheSet(key, result);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Geocode failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
