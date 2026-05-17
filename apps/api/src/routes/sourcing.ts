import { Hono } from "hono";
import { z } from "zod";
import { sourceItems } from "@goget/shared/server";
import { sourcingAdapters, supabase } from "../clients";
import { searchTestMerchants } from "../data/test-merchants";
import { encryptPII, tokenizeAddress } from "../security/pii";

export const sourcing = new Hono();

const GeoInput = z.object({ lat: z.number(), lng: z.number() });

const SearchInput = z.object({
  query: z.string().min(2),
  referenceUrl: z.string().url().optional(),
  near: GeoInput.optional(),
  maxDistanceKm: z.number().positive().default(35),
  maxPriceIDR: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(12),
  requestId: z.string().uuid().optional(),
});

/**
 * POST /api/sourcing/search
 * Run all sourcing adapters in parallel, distance-filter, and persist quotes.
 */
sourcing.post("/search", async c => {
  const body = SearchInput.parse(await c.req.json());
  let items = await sourceItems(sourcingAdapters, {
    text: body.query,
    referenceUrl: body.referenceUrl,
    near: body.near,
    maxPriceIDR: body.maxPriceIDR,
    limit: body.limit,
  });

  // Distance filter + sort when user location is known.
  if (body.near) {
    items = applyDistanceFilter(items, body.near, body.maxDistanceKm);
  }

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

  return c.json({ items });
});

/**
 * POST /api/sourcing/test
 * Search the curated test-merchant seed data — no live credentials needed.
 * Accepts the same shape as /search plus optional `near` for distance filtering.
 */
sourcing.post("/test", async c => {
  const body = SearchInput.parse(await c.req.json());

  let items = searchTestMerchants(body.query, body.limit);

  if (body.near) {
    items = applyDistanceFilter(items as any, body.near, body.maxDistanceKm) as any;
  }

  return c.json({ items, source: "test" });
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
