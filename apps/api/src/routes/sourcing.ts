import { Hono } from "hono";
import { SearchInputMode, SourcingSearchInput, sourceItems } from "@goget/shared/server";
import { z } from "zod";
import { sourcingAdapters, supabase } from "../clients";
import { searchTestMerchants } from "../data/test-merchants";
import { encryptPII, tokenizeAddress } from "../security/pii";

export const sourcing = new Hono();
const MAX_SEARCH_RADIUS_MILES = 35;
const MAX_SEARCH_DISTANCE_KM = Number((MAX_SEARCH_RADIUS_MILES * 1.60934).toFixed(2));
const MAX_SAME_DAY_READY_MINUTES = 12 * 60;
const LOCAL_SAME_DAY_SOURCES = new Set(["directory", "manual"]);
const SOURCE_IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_IMAGE_CACHE_MAX_ENTRIES = 500;
const sourceImageCache = new Map<string, { value: string | null; expiresAt: number }>();

const GeoInput = z.object({ lat: z.number(), lng: z.number() });
const ZipCodeInput = z.string().trim().regex(/^\d{5}$/);
const LegacySearchInput = z.object({
  query: z.string().trim().min(1),
  referenceUrl: z.string().url().optional(),
  near: GeoInput.optional(),
  zipcode: ZipCodeInput.optional(),
  mode: SearchInputMode.optional(),
  maxDistanceKm: z.number().positive().default(MAX_SEARCH_DISTANCE_KM),
  maxPriceIDR: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(12),
  requestId: z.string().uuid().optional(),
});
const RequestIdInput = z.string().uuid().optional();

type CanonicalSearch = {
  mode: z.infer<typeof SearchInputMode>;
  query: string;
  referenceUrl?: string;
  near?: { lat: number; lng: number };
  zipcode?: string;
  maxDistanceKm: number;
  maxPriceIDR?: number;
  limit: number;
  requestId?: string;
};

type SourceImageCandidate = {
  externalUrl: string;
  imageUrl?: string;
};

/**
 * POST /api/sourcing/search
 * Run all sourcing adapters in parallel, distance-filter, and persist quotes.
 */
sourcing.post("/search", async c => {
  const bodyResult = parseSearchInput(await c.req.json());
  if (!bodyResult.ok) {
    return c.json({ error: "invalid search input", issues: bodyResult.issues }, 422);
  }

  const body = bodyResult.data;
  if (!body.query) return c.json({ error: "invalid query" }, 422);

  const near = body.near ?? (body.zipcode ? await geocodeIndonesiaZipcode(body.zipcode) : undefined);
  if (body.zipcode && !near) {
    return c.json({ error: "invalid location: zipcode not found", zipcode: body.zipcode }, 422);
  }

  let items = await sourceItems(sourcingAdapters, {
    text: body.query,
    referenceUrl: body.referenceUrl,
    near,
    maxPriceIDR: body.maxPriceIDR,
    limit: body.limit,
  });

  // Distance filter + sort when user location is known.
  if (near) {
    items = applyDistanceFilter(items, near, body.maxDistanceKm);
  }
  items = applyLocalSameDayPolicy(items);

  items = await enrichSourceImages(items);

  if (body.requestId && items.length) {
    await supabase.from("quotes").insert(
      items.map(i => ({
        request_id: body.requestId,
        source: i.source,
        external_url: i.externalUrl,
        title: i.title,
        description: i.description,
        image_url: i.imageUrl,
        item_price_idr: i.priceIDR,
        available_qty: i.availableQty,
        pickup_address: encryptPII(i.pickupAddress),
        pickup_address_token: tokenizeAddress(i.pickupAddress),
        pickup_geo: i.pickupGeo
          ? `SRID=4326;POINT(${i.pickupGeo.lng} ${i.pickupGeo.lat})`
          : null,
        est_pickup_ready_minutes: i.estReadyMinutes,
      })),
    );
    await supabase
      .from("item_requests")
      .update({ status: "quoted" })
      .eq("id", body.requestId);
  }

  return c.json({
    mode: body.mode,
    location: {
      near: near ?? null,
      zipcode: body.zipcode ?? null,
      maxDistanceKm: body.maxDistanceKm,
    },
    items: withNormalizedMetadata(items),
  });
});

/**
 * POST /api/sourcing/test
 * Search the curated test-merchant seed data — no live credentials needed.
 * Accepts the same shape as /search plus optional `near` for distance filtering.
 */
sourcing.post("/test", async c => {
  const bodyResult = parseSearchInput(await c.req.json());
  if (!bodyResult.ok) {
    return c.json({ error: "invalid search input", issues: bodyResult.issues }, 422);
  }

  const body = bodyResult.data;
  if (!body.query) return c.json({ error: "invalid query" }, 422);
  const near = body.near ?? (body.zipcode ? await geocodeIndonesiaZipcode(body.zipcode) : undefined);

  let items = searchTestMerchants(body.query, body.limit);
  if (near) {
    items = applyDistanceFilter(items as any, near, body.maxDistanceKm) as any;
  }
  items = applyLocalSameDayPolicy(items);

  return c.json({
    mode: body.mode,
    location: {
      near: near ?? null,
      zipcode: body.zipcode ?? null,
      maxDistanceKm: body.maxDistanceKm,
    },
    items: withNormalizedMetadata(items as any[]),
    source: "test",
  });
});

/**
 * GET /api/sourcing/directory
 * (Used by DirectoryAdapter on the client side.)
 */
sourcing.get("/directory", async c => {
  const q = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 12);
  const { data } = await supabase
    .from("merchants")
    .select("id, name, address_line, city, geo, meta")
    .textSearch("name", q, { type: "websearch" })
    .eq("is_active", true)
    .limit(limit);
  return c.json(data ?? []);
});

// ── helpers ────────────────────────────────────────────────────────────────

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function applyDistanceFilter<T extends { pickupGeo?: { lat: number; lng: number } | null }>(
  items: T[],
  near: { lat: number; lng: number },
  maxKm: number,
): (T & { distanceKm: number })[] {
  return items
    .map(i => ({
      ...i,
      distanceKm: i.pickupGeo ? haversineKm(near, i.pickupGeo) : Infinity,
    }))
    .filter(i => i.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function withNormalizedMetadata<T extends {
  priceIDR: number;
  merchantName?: string;
  pickupAddress?: string;
  estReadyMinutes?: number;
}>(
  items: T[],
) {
  return items.map((item, index) => ({
    ...item,
    sellerName: item.merchantName,
    sellerLocation: item.pickupAddress,
    itemSubtotalIDR: item.priceIDR,
    estimatedDeliveryMinutes: item.estReadyMinutes,
    rankingScore: Number((1 - index / Math.max(items.length, 1)).toFixed(4)),
  }));
}

function applyLocalSameDayPolicy<T extends {
  source: string;
  pickupAddress?: string;
  pickupGeo?: { lat: number; lng: number } | null;
  estReadyMinutes?: number;
}>(
  items: T[],
): T[] {
  return items.filter((item) => {
    if (!LOCAL_SAME_DAY_SOURCES.has(item.source)) return false;
    if (!item.pickupAddress || !item.pickupGeo) return false;
    if (item.estReadyMinutes === undefined) return true;
    return item.estReadyMinutes <= MAX_SAME_DAY_READY_MINUTES;
  });
}

async function enrichSourceImages<T extends SourceImageCandidate>(items: T[]): Promise<T[]> {
  const enriched = await Promise.all(items.map(async (item) => {
    const normalizedExisting = normalizeAbsoluteUrl(item.imageUrl, item.externalUrl);
    if (normalizedExisting) return { ...item, imageUrl: normalizedExisting };
    const sourceImage = await fetchImageFromSourcePage(item.externalUrl);
    if (!sourceImage) return item;
    return { ...item, imageUrl: sourceImage };
  }));
  return enriched;
}


async function fetchImageFromSourcePage(externalUrl: string): Promise<string | null> {
  if (!looksLikeUrl(externalUrl)) return null;
  const cached = readSourceImageCache(externalUrl);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(externalUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "GoGet-API/1.0 (+https://goget.id)",
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      writeSourceImageCache(externalUrl, null);
      return null;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html")) {
      writeSourceImageCache(externalUrl, null);
      return null;
    }

    const html = (await response.text()).slice(0, 200_000);
    const imageUrl = extractSourceImage(html, externalUrl);
    writeSourceImageCache(externalUrl, imageUrl);
    return imageUrl;
  } catch {
    writeSourceImageCache(externalUrl, null);
    return null;
  }
}

function extractSourceImage(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const candidate = match?.[1];
    const normalized = normalizeAbsoluteUrl(candidate, pageUrl);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeAbsoluteUrl(value: string | undefined, pageUrl: string): string | null {
  if (!value) return null;
  const decoded = value
    .trim()
    .replaceAll("&amp;", "&")
    .replaceAll("\\u002F", "/");
  if (!decoded || decoded.startsWith("data:") || decoded.startsWith("blob:")) return null;
  try {
    const absolute = new URL(decoded, pageUrl).toString();
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) return null;
    return absolute;
  } catch {
    return null;
  }
}

function readSourceImageCache(url: string): string | null | undefined {
  const cached = sourceImageCache.get(url);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    sourceImageCache.delete(url);
    return undefined;
  }
  return cached.value;
}

function writeSourceImageCache(url: string, value: string | null) {
  if (sourceImageCache.size >= SOURCE_IMAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = sourceImageCache.keys().next().value as string | undefined;
    if (oldestKey) sourceImageCache.delete(oldestKey);
  }
  sourceImageCache.set(url, {
    value,
    expiresAt: Date.now() + SOURCE_IMAGE_CACHE_TTL_MS,
  });
}

function parseSearchInput(raw: unknown):
  | { ok: true; data: CanonicalSearch }
  | { ok: false; issues: z.ZodIssue[] } {
  const modern = SourcingSearchInput.safeParse(raw);
  if (modern.success) {
    const parsedRequestId = RequestIdInput.safeParse((raw as any)?.requestId);
    if (!parsedRequestId.success) {
      return { ok: false, issues: parsedRequestId.error.issues };
    }
    const query =
      modern.data.query
      ?? inferQueryFromReferenceUrl(modern.data.referenceUrl)
      ?? modern.data.referenceUrl
      ?? "";
    return {
      ok: true,
      data: {
        mode: modern.data.mode,
        query,
        referenceUrl: modern.data.referenceUrl,
        near: modern.data.location.near,
        zipcode: modern.data.location.zipcode,
        maxDistanceKm: normalizeMaxDistanceKm(modern.data.location.maxDistanceKm),
        maxPriceIDR: modern.data.maxPriceIDR,
        limit: modern.data.limit,
        requestId: parsedRequestId.data,
      },
    };
  }

  const legacy = LegacySearchInput.safeParse(raw);
  if (!legacy.success) {
    return { ok: false, issues: modern.error.issues.concat(legacy.error.issues) };
  }

  const queryLooksLikeUrl = looksLikeUrl(legacy.data.query);
  const referenceUrl = legacy.data.referenceUrl ?? (queryLooksLikeUrl ? legacy.data.query : undefined);
  const query = queryLooksLikeUrl
    ? inferQueryFromReferenceUrl(referenceUrl) ?? legacy.data.query
    : legacy.data.query;

  return {
    ok: true,
    data: {
      mode: legacy.data.mode ?? (referenceUrl ? "url" : "keyword"),
      query,
      referenceUrl,
      near: legacy.data.near,
      zipcode: legacy.data.zipcode,
      maxDistanceKm: normalizeMaxDistanceKm(legacy.data.maxDistanceKm),
      maxPriceIDR: legacy.data.maxPriceIDR,
      limit: legacy.data.limit,
      requestId: legacy.data.requestId,
    },
  };
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeMaxDistanceKm(maxDistanceKm: number) {
  return Math.min(maxDistanceKm, MAX_SEARCH_DISTANCE_KM);
}

function inferQueryFromReferenceUrl(referenceUrl: string | undefined): string | null {
  if (!referenceUrl) return null;
  try {
    const url = new URL(referenceUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;
    const slug = segments.reduce((a, b) => (a.length >= b.length ? a : b), "");
    if (!slug) return null;
    return slug
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  } catch {
    return null;
  }
}

async function geocodeIndonesiaZipcode(zipcode: string): Promise<{ lat: number; lng: number } | undefined> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("postalcode", zipcode);
  url.searchParams.set("country", "Indonesia");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Accept-Language": "id,en",
        "User-Agent": "GoGet-API/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const lat = Number(rows[0].lat);
    const lng = Number(rows[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return { lat, lng };
  } catch {
    return undefined;
  }
}
