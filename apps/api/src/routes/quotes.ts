import { Hono } from "hono";
import { z } from "zod";
import { compareRates, distanceKm } from "@goget/shared/server";
import { courierAdapters, supabase } from "../clients";
import { decryptPII } from "../security/pii";
import { buildRateSnapshotForStorage } from "./courier-rate-snapshot";

export const quotes = new Hono();
const MAX_DELIVERY_RADIUS_MILES = 35;
const MAX_DELIVERY_DISTANCE_KM = Number((MAX_DELIVERY_RADIUS_MILES * 1.60934).toFixed(2));

const RateInput = z.object({
  quoteId: z.string().uuid(),
  addressId: z.string().uuid(),
  weightKg: z.number().positive().optional(),
});

const GeoPoint = z.object({ lat: z.number(), lng: z.number() });
const PreviewRateInput = z.object({
  pickup: GeoPoint,
  dropoff: GeoPoint,
  itemValueIDR: z.number().int().nonnegative().default(0),
});

/**
 * POST /api/quotes/preview-rates
 *
 * Stateless rate estimator used by the web `/checkout` page BEFORE any
 * item_request / quote / address is persisted. Returns synthetic courier
 * options derived from haversine distance — pricing modelled on publicly
 * available Jakarta rate cards (2024-2025).
 *
 * The actual booking still goes through POST /api/orders/quick, which is
 * where the chosen rate is snapshotted into `courier_rates`.
 *
 * GoSend Instant:   base Rp 9.000 + Rp 3.000/km,  ETA 15 + 3*km min
 * GoSend SameDay:   base Rp 6.000 + Rp 1.900/km,  ETA 240 min flat
 * Grab Instant:     base Rp 9.500 + Rp 2.800/km,  ETA 18 + 2.5*km min
 * Grab SameDay:     base Rp 5.500 + Rp 1.700/km,  ETA 260 min flat
 * Car tiers:        ~1.8x motor price, unlocked for items >= Rp 500k
 */
quotes.post("/preview-rates", async c => {
  const input = PreviewRateInput.parse(await c.req.json());
  const distKm = parseFloat(distanceKm(input.pickup, input.dropoff).toFixed(2));
  if (distKm > MAX_DELIVERY_DISTANCE_KM) {
    return c.json(
      { error: `Distance ${distKm.toFixed(1)} km exceeds ${MAX_DELIVERY_RADIUS_MILES} miles (${MAX_DELIVERY_DISTANCE_KM.toFixed(2)} km) limit` },
      422,
    );
  }
  const round = (n: number) => Math.round(n / 500) * 500;
  type Tier = "instant" | "sameday" | "car_instant" | "car_sameday";
  interface PreviewRate {
    provider: "gosend" | "grab";
    tier: Tier;
    label: string;
    priceIDR: number;
    etaMinutes: number;
    distanceKm: number;
    rateToken: string;
  }
  const rates: PreviewRate[] = [
    {
      provider: "gosend" as const,
      tier: "instant" as const,
      label: "GoSend Instant",
      priceIDR: round(9_000 + 3_000 * distKm),
      etaMinutes: Math.round(15 + 3 * distKm),
      distanceKm: distKm,
      rateToken: `gosend:instant:${distKm}`,
    },
    {
      provider: "grab" as const,
      tier: "instant" as const,
      label: "Grab Express Instant",
      priceIDR: round(9_500 + 2_800 * distKm),
      etaMinutes: Math.round(18 + 2.5 * distKm),
      distanceKm: distKm,
      rateToken: `grab:instant:${distKm}`,
    },
    {
      provider: "gosend" as const,
      tier: "sameday" as const,
      label: "GoSend SameDay",
      priceIDR: round(6_000 + 1_900 * distKm),
      etaMinutes: 240,
      distanceKm: distKm,
      rateToken: `gosend:sameday:${distKm}`,
    },
    {
      provider: "grab" as const,
      tier: "sameday" as const,
      label: "Grab Express SameDay",
      priceIDR: round(5_500 + 1_700 * distKm),
      etaMinutes: 260,
      distanceKm: distKm,
      rateToken: `grab:sameday:${distKm}`,
    },
  ];
  if (input.itemValueIDR >= 500_000) {
    rates.push(
      {
        provider: "gosend" as const,
        tier: "car_instant" as const,
        label: "GoSend Car Instant",
        priceIDR: round((9_000 + 3_000 * distKm) * 1.85),
        etaMinutes: Math.round(20 + 3.5 * distKm),
        distanceKm: distKm,
        rateToken: `gosend:car_instant:${distKm}`,
      },
      {
        provider: "grab" as const,
        tier: "car_instant" as const,
        label: "Grab Car Instant",
        priceIDR: round((9_500 + 2_800 * distKm) * 1.8),
        etaMinutes: Math.round(22 + 3 * distKm),
        distanceKm: distKm,
        rateToken: `grab:car_instant:${distKm}`,
      },
    );
  }
  rates.sort((a, b) => a.priceIDR - b.priceIDR);
  return c.json({ rates, distanceKm: distKm });
});

/**
 * POST /api/quotes/rates
 *
 * Given an item quote + delivery address, query GoSend + Grab in parallel,
 * persist the rate snapshots, and return them ranked.
 */
quotes.post("/rates", async c => {
  const input = RateInput.parse(await c.req.json());
  const { userId } = c.get("auth");

  // Load quote (must belong to a request owned by this user)
  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, request_id, title, item_price_idr, pickup_geo, pickup_address, item_requests(user_id)")
    .eq("id", input.quoteId)
    .returns<{
      id: string;
      request_id: string;
      title: string;
      item_price_idr: number;
      pickup_geo: string | null;
      pickup_address: string | null;
      item_requests: { user_id: string } | null;
    }[]>()
    .single();
  if (qErr || !quote) return c.json({ error: "quote not found" }, 404);
  if (quote.item_requests?.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  const { data: address } = await supabase
    .from("addresses")
    .select("recipient_name, recipient_phone, line1, line2, city, geo")
    .eq("id", input.addressId)
    .eq("user_id", userId)
    .single();
  if (!address) return c.json({ error: "address not found" }, 404);

  const recipientName = decryptPII(address.recipient_name) ?? "";
  const recipientPhone = decryptPII(address.recipient_phone) ?? "";
  const line1 = decryptPII(address.line1) ?? "";
  const line2 = decryptPII(address.line2);
  const pickupAddress = decryptPII(quote.pickup_address) ?? "";

  const pickupGeo = parsePoint(quote.pickup_geo);
  const dropGeo = parsePoint(address.geo);
  if (!pickupGeo || !dropGeo) return c.json({ error: "geo missing" }, 400);

  const adapters = courierAdapters();
  if (adapters.length === 0) return c.json({ error: "no couriers configured" }, 503);

  const rates = await compareRates(adapters, {
    pickup: pickupGeo,
    pickupAddress,
    pickupContact: { name: "GoGet Runner", phone: "+62000000000" },
    dropoff: dropGeo,
    dropoffAddress: `${line1}${line2 ? `, ${line2}` : ""}, ${address.city}`,
    dropoffContact: { name: recipientName, phone: recipientPhone },
    itemValueIDR: quote.item_price_idr,
    itemDescription: quote.title,
    weightKg: input.weightKg,
  });

  // Persist for audit + later booking
  if (rates.length) {
    await supabase.from("courier_rates").insert(
      rates.map(r => ({
        quote_id: quote.id,
        provider: r.provider,
        tier: r.tier,
        price_idr: r.priceIDR,
        eta_minutes: r.etaMinutes,
        distance_km: r.distanceKm,
        raw_response: buildRateSnapshotForStorage(r),
        expires_at: r.expiresAt,
      })),
    );
  }

  return c.json({ rates });
});

function parsePoint(point: any): { lat: number; lng: number } | null {
  if (!point) return null;
  // Supabase returns geography as GeoJSON-ish or hex; we normalize to {lat,lng}.
  if (typeof point === "object" && "coordinates" in point) {
    const [lng, lat] = point.coordinates;
    return { lat, lng };
  }
  return null;
}
