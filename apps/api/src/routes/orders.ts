import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { computeCheckoutPricing, computeFees, ConciergeOrderInput } from "@goget/shared/server";
import { gosend, grab, midtrans, supabase } from "../clients";
import { env } from "../env";
import { transitionOrderStatus } from "../services/order-state-machine";
import {
  decryptPII,
  encryptPII,
  tokenizeAddress,
  tokenizePhone,
} from "../security/pii";
import { resolveRateTokenForBooking } from "./courier-rate-snapshot";

export const orders = new Hono();

const CreateOrderInput = z.object({
  quoteId: z.string().uuid(),
  courierRateId: z.string().uuid(),
  addressId: z.string().uuid(),
});

const Geo = z.object({ lat: z.number(), lng: z.number() });

/**
 * Input for POST /api/orders/quick — used by the web `/checkout` page, which
 * discovers items in real time from sourcing (no persisted quote yet) and
 * needs an atomic "create item_request + quote + address + rate + order"
 * pipeline. Same pre-payment invariants as POST /api/orders apply: the
 * courier is NOT booked here, only after the Midtrans `settlement` webhook.
 */
const QuickOrderInput = z.object({
  item: z.object({
    title: z.string().min(1).max(300),
    itemPriceIDR: z.number().int().nonnegative(),
    source: z.enum(["tokopedia", "shopee", "bukalapak", "directory", "manual"]).default("manual"),
    externalUrl: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
    merchantName: z.string().optional(),
  }),
  pickup: z.object({
    address: z.string().min(1),
    geo: Geo,
  }),
  dropoff: z.object({
    address: z.string().min(1),
    geo: Geo,
    city: z.string().default("Jakarta"),
    province: z.string().default("DKI Jakarta"),
  }),
  recipient: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
  }),
  courier: z.object({
    provider: z.enum(["gosend", "grab", "manual"]),
    tier: z.enum(["instant", "sameday", "car_instant", "car_sameday"]),
    priceIDR: z.number().int().nonnegative(),
    etaMinutes: z.number().int().nonnegative().optional(),
    distanceKm: z.number().nonnegative().optional(),
    rateToken: z.string().optional(),
    useLinkedAccount: z.boolean().default(false),
    linkedAccountRef: z.string().min(1).optional(),
  }),
});

const IDEMPOTENCY_HEADER = "Idempotency-Key";

type IdempotencyKeyRow = {
  id: string;
  request_hash: string;
  status: "in_progress" | "completed";
  response_status: number | null;
  response_body: unknown;
};

type MidtransPaymentAttempt = {
  payment_id: string;
  attempt: number;
  provider_order_id: string;
};

type OrderCreateIdempotencyInput = {
  userId: string;
  endpoint: string;
  requestBody: unknown;
  handler: () => Promise<Response>;
};

async function withOrderCreateIdempotency(
  c: Context,
  input: OrderCreateIdempotencyInput,
): Promise<Response> {
  const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER)?.trim();
  if (!idempotencyKey) {
    return c.json({ error: `${IDEMPOTENCY_HEADER} header is required` }, 400);
  }

  const requestHash = hashRequestBody(input.requestBody);
  const acquired = await acquireIdempotencyKey({
    userId: input.userId,
    endpoint: input.endpoint,
    idempotencyKey,
    requestHash,
  });
  if (acquired.kind === "error") return c.json({ error: acquired.message }, 500);
  if (acquired.kind === "conflict") return c.json({ error: acquired.message }, 409);
  if (acquired.kind === "replay") {
    return new Response(JSON.stringify(normalizeReplayBody(acquired.row.response_body)), {
      status: acquired.row.response_status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const response = await input.handler();
    await completeIdempotencyKey(
      acquired.row.id,
      response.status,
      await parseResponseBody(response),
    );
    return response;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("order create failed", error);
    const body = { error: "order create failed" };
    await completeIdempotencyKey(acquired.row.id, 500, body);
    return c.json(body, 500);
  }
}


async function createMidtransPaymentAttempt(
  orderId: string,
  amountIdr: number,
): Promise<MidtransPaymentAttempt> {
  const { data, error } = await supabase
    .rpc("create_midtrans_payment_attempt", {
      p_order_id: orderId,
      p_amount_idr: amountIdr,
    })
    .returns<MidtransPaymentAttempt[]>()
    .single();
  if (error || !data) throw new Error(error?.message ?? "payment create failed");
  return data;
}

async function acquireIdempotencyKey(input: {
  userId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<
  | { kind: "acquired"; row: IdempotencyKeyRow }
  | { kind: "replay"; row: IdempotencyKeyRow }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string }
> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .insert({
      user_id: input.userId,
      endpoint: input.endpoint,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      status: "in_progress",
    })
    .select("id, request_hash, status, response_status, response_body")
    .returns<IdempotencyKeyRow[]>()
    .single();
  if (!error && data) return { kind: "acquired", row: data };
  if (error?.code !== "23505") {
    return { kind: "error", message: error?.message ?? "failed to create idempotency key" };
  }

  const { data: existing, error: existingError } = await supabase
    .from("idempotency_keys")
    .select("id, request_hash, status, response_status, response_body")
    .eq("user_id", input.userId)
    .eq("endpoint", input.endpoint)
    .eq("idempotency_key", input.idempotencyKey)
    .returns<IdempotencyKeyRow[]>()
    .single();
  if (existingError || !existing) {
    return { kind: "error", message: existingError?.message ?? "failed to load idempotency key" };
  }
  if (existing.request_hash !== input.requestHash) {
    return { kind: "conflict", message: "idempotency key was reused with a different request payload" };
  }
  if (existing.status === "completed" && existing.response_status !== null) {
    return { kind: "replay", row: existing };
  }
  return { kind: "conflict", message: "duplicate request is already in progress" };
}

async function completeIdempotencyKey(
  idempotencyId: string,
  statusCode: number,
  responseBody: unknown,
) {
  const { error } = await supabase
    .from("idempotency_keys")
    .update({
      status: "completed",
      response_status: statusCode,
      response_body: responseBody,
      completed_at: new Date().toISOString(),
    })
    .eq("id", idempotencyId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("failed to finalize idempotency key", {
      idempotencyId,
      error: error.message,
    });
  }
}

function hashRequestBody(body: unknown): string {
  const canonical = JSON.stringify(body, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = (value as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return value;
  });
  return createHash("sha256").update(canonical ?? "").digest("hex");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.clone().json();
    } catch {
      return {};
    }
  }
  try {
    const text = await response.clone().text();
    return text ? { message: text } : {};
  } catch {
    return {};
  }
}

function normalizeReplayBody(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function buildOrderCheckoutBreakdown(input: {
  itemSubtotalIDR: number;
  deliveryFeeIDR: number;
}) {
  return computeCheckoutPricing({
    itemSubtotalIDR: input.itemSubtotalIDR,
    deliveryFeeIDR: input.deliveryFeeIDR,
  });
}

type OrderSnapshotInput = {
  selectedListing: {
    source: string;
    title: string;
    externalUrl?: string | null;
    imageUrl?: string | null;
    sellerName?: string | null;
    pickupAddress?: string | null;
    itemSubtotalIDR: number;
  };
  breakdown: ReturnType<typeof buildOrderCheckoutBreakdown>;
  courierPreference: {
    provider: string;
    tier: string;
    useLinkedAccount?: boolean;
    linkedAccountRef?: string | null;
  };
};

type OrderSnapshotPayload = {
  selected_listing_snapshot: Record<string, unknown>;
  checkout_fee_snapshot: ReturnType<typeof buildOrderCheckoutBreakdown>;
  courier_preference_snapshot: Record<string, unknown>;
  booking_retry_state: "idle";
  booking_retry_attempt_count: number;
  booking_retry_max_attempts: number;
  booking_retry_last_error: null;
  booking_retry_next_retry_at: null;
  booking_retry_updated_at: string;
};

export function buildOrderSnapshotPayload(input: OrderSnapshotInput): OrderSnapshotPayload {
  return {
    selected_listing_snapshot: compactSnapshot({
      source: input.selectedListing.source,
      title: input.selectedListing.title,
      externalUrl: input.selectedListing.externalUrl ?? undefined,
      imageUrl: input.selectedListing.imageUrl ?? undefined,
      sellerName: input.selectedListing.sellerName ?? undefined,
      pickupAddress: input.selectedListing.pickupAddress ?? undefined,
      itemSubtotalIDR: input.selectedListing.itemSubtotalIDR,
    }),
    checkout_fee_snapshot: {
      ...input.breakdown,
    },
    courier_preference_snapshot: compactSnapshot({
      provider: input.courierPreference.provider,
      tier: input.courierPreference.tier,
      useLinkedAccount: Boolean(input.courierPreference.useLinkedAccount),
      linkedAccountRef: input.courierPreference.linkedAccountRef ?? undefined,
    }),
    booking_retry_state: "idle",
    booking_retry_attempt_count: 0,
    booking_retry_max_attempts: 0,
    booking_retry_last_error: null,
    booking_retry_next_retry_at: null,
    booking_retry_updated_at: new Date().toISOString(),
  };
}

async function persistOrderSnapshotPayload(orderId: string, payload: OrderSnapshotPayload): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update(payload as never)
    .eq("id", orderId);
  if (error) throw new Error(error.message);
}

function compactSnapshot(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

/**
 * POST /api/orders
 * Confirm a chosen quote + courier and create:
 *   1. orders row (status = pending_payment)
 *   2. payments row + Midtrans Snap token
 *
 * The courier is NOT booked here — we wait for payment confirmation, then
 * book in the webhook handler. This avoids paying a driver who never gets paid.
 */
orders.post("/", async c => {
  const requestBody = await c.req.json();
  const input = CreateOrderInput.parse(requestBody);
  const { userId } = c.get("auth");
  return withOrderCreateIdempotency(c, {
    userId,
    endpoint: "POST /api/orders",
    requestBody,
    handler: async () => {
      const { data: quote } = await supabase
        .from("quotes")
        .select("id, request_id, source, title, external_url, image_url, pickup_address, item_price_idr, item_requests(user_id)")
        .eq("id", input.quoteId)
        .returns<{
          id: string;
          request_id: string;
          source: string;
          title: string;
          external_url: string | null;
          image_url: string | null;
          pickup_address: string | null;
          item_price_idr: number;
          item_requests: { user_id: string } | null;
        }[]>()
        .single();
      if (!quote) return c.json({ error: "quote not found" }, 404);
      if (quote.item_requests?.user_id !== userId) return c.json({ error: "forbidden" }, 403);

      const { data: rate } = await supabase
        .from("courier_rates")
        .select("*")
        .eq("id", input.courierRateId)
        .eq("quote_id", input.quoteId)
        .single();
      if (!rate) return c.json({ error: "rate not found" }, 404);

      const { data: address } = await supabase
        .from("addresses")
        .select("id")
        .eq("id", input.addressId)
        .eq("user_id", userId)
        .single();
      if (!address) return c.json({ error: "address not found" }, 404);

      // Concierge model: fees no longer include the item price (paid on marketplace).
      const fees = computeFees({ courierFeeIDR: rate.price_idr });
      const breakdown = buildOrderCheckoutBreakdown({
        itemSubtotalIDR: quote.item_price_idr,
        deliveryFeeIDR: rate.price_idr,
      });
      const snapshotPayload = buildOrderSnapshotPayload({
        selectedListing: {
          source: quote.source,
          title: quote.title,
          externalUrl: quote.external_url,
          imageUrl: quote.image_url,
          pickupAddress: quote.pickup_address,
          itemSubtotalIDR: quote.item_price_idr,
        },
        breakdown,
        courierPreference: {
          provider: rate.provider,
          tier: rate.tier,
          useLinkedAccount: false,
        },
      });

      // selected_rate_id is set inline on the orders row so bookCourierForOrder
      // can read it directly — no more digging through order_events meta.
      // The Supabase JS typings haven't been regenerated for the new column yet,
      // so cast the insert payload through `OrderInsert` (matches the migration
      // 20260517000000_order_rate_and_retry.sql).
      type OrderInsert = {
        user_id: string;
        request_id: string;
        quote_id: string;
        delivery_address_id: string;
        item_price_idr: number;
        service_fee_idr: number;
        courier_fee_idr: number;
        tax_idr: number;
        total_idr: number;
        status: "pending_payment";
        selected_rate_id: string;
        selected_listing_snapshot: Record<string, unknown>;
        checkout_fee_snapshot: ReturnType<typeof buildOrderCheckoutBreakdown>;
        courier_preference_snapshot: Record<string, unknown>;
        booking_retry_state: "idle";
        booking_retry_attempt_count: number;
        booking_retry_max_attempts: number;
        booking_retry_last_error: null;
        booking_retry_next_retry_at: null;
        booking_retry_updated_at: string;
      };
      const orderInsert: OrderInsert = {
        user_id: userId,
        request_id: quote.request_id,
        quote_id: quote.id,
        delivery_address_id: address.id,
        // Legacy item_price_idr column persists the quoted item value for reporting,
        // but the user pays this amount directly to the marketplace, not to GoGet.
        item_price_idr: quote.item_price_idr,
        service_fee_idr: fees.serviceFeeIDR,
        courier_fee_idr: fees.courierFeeIDR,
        tax_idr: fees.taxIDR,
        total_idr: fees.totalIDR,
        status: "pending_payment",
        selected_rate_id: input.courierRateId,
        selected_listing_snapshot: snapshotPayload.selected_listing_snapshot,
        checkout_fee_snapshot: snapshotPayload.checkout_fee_snapshot,
        courier_preference_snapshot: snapshotPayload.courier_preference_snapshot,
        booking_retry_state: snapshotPayload.booking_retry_state,
        booking_retry_attempt_count: snapshotPayload.booking_retry_attempt_count,
        booking_retry_max_attempts: snapshotPayload.booking_retry_max_attempts,
        booking_retry_last_error: snapshotPayload.booking_retry_last_error,
        booking_retry_next_retry_at: snapshotPayload.booking_retry_next_retry_at,
        booking_retry_updated_at: snapshotPayload.booking_retry_updated_at,
      };
      const { data: order, error: oErr } = await supabase
        .from("orders")
        .insert(orderInsert)
        .select("*")
        .returns<{ id: string; short_code: string; selected_rate_id: string }[]>()
        .single();
      if (oErr || !order) return c.json({ error: oErr?.message ?? "order create failed" }, 500);

      // Audit-trail event. Booking no longer reads from this; selected_rate_id
      // on the orders row is the source of truth.
      await supabase.from("order_events").insert({
        order_id: order.id,
        status: "pending_payment",
        note: "order created",
        meta: { courier_rate_id: input.courierRateId },
      });

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone_e164")
        .eq("id", userId)
        .single();

      let paymentAttempt: MidtransPaymentAttempt;
      try {
        paymentAttempt = await createMidtransPaymentAttempt(order.id, fees.totalIDR);
      } catch (error) {
        return c.json({ error: toErrorMessage(error) }, 500);
      }

      const snap = await midtrans.createTransaction({
        orderId: paymentAttempt.provider_order_id,
        grossAmount: fees.totalIDR,
        customer: {
          name: profile?.full_name ?? "GoGet User",
          phone: profile?.phone_e164 ?? "+62000000000",
        },
        items: [
          { id: "courier", name: `Courier (${rate.provider})`, price: fees.courierFeeIDR, quantity: 1 },
          { id: "service", name: "GoGet service", price: fees.serviceFeeIDR, quantity: 1 },
          { id: "tax", name: "PPN", price: fees.taxIDR, quantity: 1 },
        ],
        callbackUrl: `${env.API_PUBLIC_URL}/orders/${order.short_code}`,
      });

      // Stamp the snap token onto the existing row. If THIS update fails we
      // still have a recoverable `pending` payments row — the webhook can
      // settle it once Midtrans notifies, and ops can re-fetch the token.
      await supabase
        .from("payments")
        .update({ raw_meta: { snapToken: snap.token, redirectUrl: snap.redirectUrl } })
        .eq("id", paymentAttempt.payment_id);

      return c.json({
        order: { id: order.id, shortCode: order.short_code, totalIDR: fees.totalIDR, breakdown },
        payment: { amountIDR: fees.totalIDR, snapToken: snap.token, redirectUrl: snap.redirectUrl },
      });
    },
  });
});

/**
 * POST /api/orders/quick
 *
 * Convenience entry point for the web `/checkout` page. The web flow sources
 * items in real time from search results (no persisted quote yet), so we do
 * everything atomically in one round trip:
 *   1. item_requests row  (status = quoted)
 *   2. addresses row      (snapshot of the recipient's delivery address)
 *   3. quotes row         (snapshot of the item the user clicked "Get this" on)
 *   4. courier_rates row  (snapshot of the chosen courier rate)
 *   5. orders row + payments row + Midtrans Snap token
 *
 * The courier is NOT booked here — same invariant as POST /. We wait for the
 * Midtrans `settlement` webhook before booking.
 */
orders.post("/quick", async c => {
  const requestBody = await c.req.json();
  const input = QuickOrderInput.parse(requestBody);
  const { userId } = c.get("auth");
  return withOrderCreateIdempotency(c, {
    userId,
    endpoint: "POST /api/orders/quick",
    requestBody,
    handler: async () => {
      // Concierge model: fees exclude the item price (paid directly on marketplace).
      const fees = computeFees({ courierFeeIDR: input.courier.priceIDR });
      const breakdown = buildOrderCheckoutBreakdown({
        itemSubtotalIDR: input.item.itemPriceIDR,
        deliveryFeeIDR: input.courier.priceIDR,
      });
      const snapshotPayload = buildOrderSnapshotPayload({
        selectedListing: {
          source: input.item.source,
          title: input.item.title,
          externalUrl: input.item.externalUrl,
          imageUrl: input.item.imageUrl,
          sellerName: input.item.merchantName,
          pickupAddress: input.pickup.address,
          itemSubtotalIDR: input.item.itemPriceIDR,
        },
        breakdown,
        courierPreference: {
          provider: input.courier.provider,
          tier: input.courier.tier,
          useLinkedAccount: input.courier.useLinkedAccount,
          linkedAccountRef: input.courier.linkedAccountRef,
        },
      });

      // All five table inserts (item_requests → addresses → quotes →
      // courier_rates → orders + order_events) run inside a single Postgres
      // transaction via this RPC. Either every row commits or none of them do.
      // Fees are computed in Node (one source of truth in fees.ts) and passed in.
      const { data: rpcRow, error: rpcErr } = await supabase
        .rpc("create_order_quick", {
          p_user_id: userId,
          p_item_title: input.item.title,
          p_item_source: input.item.source,
          p_item_external_url: input.item.externalUrl ?? null,
          p_item_image_url: input.item.imageUrl ?? null,
          p_item_price_idr: input.item.itemPriceIDR,
          p_pickup_address: encryptPII(input.pickup.address),
          p_pickup_lng: input.pickup.geo.lng,
          p_pickup_lat: input.pickup.geo.lat,
          p_dropoff_address: encryptPII(input.dropoff.address),
          p_dropoff_city: input.dropoff.city,
          p_dropoff_province: input.dropoff.province,
          p_dropoff_lng: input.dropoff.geo.lng,
          p_dropoff_lat: input.dropoff.geo.lat,
          p_recipient_name: encryptPII(input.recipient.name),
          p_recipient_phone: encryptPII(input.recipient.phone),
          p_courier_provider: input.courier.provider,
          p_courier_tier: input.courier.tier,
          p_courier_price_idr: input.courier.priceIDR,
          p_courier_eta_minutes: input.courier.etaMinutes ?? null,
          p_courier_distance_km: input.courier.distanceKm ?? null,
          p_courier_raw_response: input.courier.rateToken ? { rateToken: input.courier.rateToken } : null,
          p_service_fee_idr: fees.serviceFeeIDR,
          p_tax_idr: fees.taxIDR,
          p_total_idr: fees.totalIDR,
        })
        .returns<{
          order_id: string;
          order_short_code: string;
          request_id: string;
          quote_id: string;
          courier_rate_id: string;
          address_id: string;
          item_price_idr: number;
          service_fee_idr: number;
          courier_fee_idr: number;
          tax_idr: number;
          total_idr: number;
        }[]>()
        .single();
      if (rpcErr || !rpcRow) return c.json({ error: rpcErr?.message ?? "order create failed" }, 500);
      await persistPiiTokens({
        addressId: rpcRow.address_id,
        quoteId: rpcRow.quote_id,
        dropoffAddress: input.dropoff.address,
        recipientPhone: input.recipient.phone,
        pickupAddress: input.pickup.address,
      });
      await persistOrderSnapshotPayload(rpcRow.order_id, snapshotPayload);

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone_e164")
        .eq("id", userId)
        .single();

      let paymentAttempt: MidtransPaymentAttempt;
      try {
        paymentAttempt = await createMidtransPaymentAttempt(rpcRow.order_id, fees.totalIDR);
      } catch (error) {
        return c.json({ error: toErrorMessage(error) }, 500);
      }

      const snap = await midtrans.createTransaction({
        orderId: paymentAttempt.provider_order_id,
        grossAmount: fees.totalIDR,
        customer: {
          name: profile?.full_name ?? input.recipient.name,
          phone: profile?.phone_e164 ?? input.recipient.phone,
        },
        items: [
          {
            id: "courier",
            name: `Courier (${input.courier.provider})`,
            price: fees.courierFeeIDR,
            quantity: 1,
          },
          { id: "service", name: "GoGet service", price: fees.serviceFeeIDR, quantity: 1 },
          { id: "tax", name: "PPN", price: fees.taxIDR, quantity: 1 },
        ],
        callbackUrl: `${env.API_PUBLIC_URL}/orders/${rpcRow.order_short_code}`,
      });

      // Stamp the snap token onto the existing pending row.
      await supabase
        .from("payments")
        .update({ raw_meta: { snapToken: snap.token, redirectUrl: snap.redirectUrl } })
        .eq("id", paymentAttempt.payment_id);

      return c.json({
        order: {
          id: rpcRow.order_id,
          shortCode: rpcRow.order_short_code,
          totalIDR: fees.totalIDR,
          breakdown,
        },
        payment: { amountIDR: fees.totalIDR, snapToken: snap.token, redirectUrl: snap.redirectUrl },
      });
    },
  });
});

/**
 * POST /api/orders/concierge
 *
 * Concierge flow: the user has already paid the seller on Tokopedia/Shopee/
 * Bukalapak via the in-app WebView handoff. We only charge for delivery
 * (courier fee + GoGet service fee + PPN) and book the runner once Midtrans
 * confirms payment.
 *
 * Internally we reuse create_order_quick so we don't fork the atomic insert
 * pipeline. The user-declared item value is stored in `item_price_idr` for
 * legacy compatibility, and we follow up with an UPDATE to stamp the new
 * marketplace metadata onto the order row.
 */
orders.post("/concierge", async c => {
  const requestBody = await c.req.json();
  const input = ConciergeOrderInput.parse(requestBody);
  const { userId } = c.get("auth");
  return withOrderCreateIdempotency(c, {
    userId,
    endpoint: "POST /api/orders/concierge",
    requestBody,
    handler: async () => {
      const fees = computeFees({ courierFeeIDR: input.courier.priceIDR });
      const breakdown = buildOrderCheckoutBreakdown({
        itemSubtotalIDR: input.product.priceIDRDeclared,
        deliveryFeeIDR: input.courier.priceIDR,
      });
      const snapshotPayload = buildOrderSnapshotPayload({
        selectedListing: {
          source: input.product.source,
          title: input.product.title,
          externalUrl: input.product.sourceUrl,
          imageUrl: input.product.thumbnailUrl,
          pickupAddress: input.pickup.address,
          itemSubtotalIDR: input.product.priceIDRDeclared,
        },
        breakdown,
        courierPreference: {
          provider: input.courier.provider,
          tier: input.courier.tier,
          useLinkedAccount: input.courier.useLinkedAccount,
          linkedAccountRef: input.courier.linkedAccountRef,
        },
      });

      const { data: rpcRow, error: rpcErr } = await supabase
        .rpc("create_order_quick", {
          p_user_id: userId,
          p_item_title: input.product.title,
          p_item_source: input.product.source,
          p_item_external_url: input.product.sourceUrl,
          p_item_image_url: input.product.thumbnailUrl ?? null,
          p_item_price_idr: input.product.priceIDRDeclared,
          p_pickup_address: encryptPII(input.pickup.address),
          p_pickup_lng: input.pickup.geo.lng,
          p_pickup_lat: input.pickup.geo.lat,
          p_dropoff_address: encryptPII(input.dropoff.address),
          p_dropoff_city: input.dropoff.city,
          p_dropoff_province: input.dropoff.province,
          p_dropoff_lng: input.dropoff.geo.lng,
          p_dropoff_lat: input.dropoff.geo.lat,
          p_recipient_name: encryptPII(input.recipient.name),
          p_recipient_phone: encryptPII(input.recipient.phone),
          p_courier_provider: input.courier.provider,
          p_courier_tier: input.courier.tier,
          p_courier_price_idr: input.courier.priceIDR,
          p_courier_eta_minutes: input.courier.etaMinutes ?? null,
          p_courier_distance_km: input.courier.distanceKm ?? null,
          p_courier_raw_response: input.courier.rateToken ? { rateToken: input.courier.rateToken } : null,
          p_service_fee_idr: fees.serviceFeeIDR,
          p_tax_idr: fees.taxIDR,
          p_total_idr: fees.totalIDR,
        })
        .returns<{
          order_id: string;
          order_short_code: string;
          request_id: string;
          quote_id: string;
          courier_rate_id: string;
          address_id: string;
          item_price_idr: number;
          service_fee_idr: number;
          courier_fee_idr: number;
          tax_idr: number;
          total_idr: number;
        }[]>()
        .single();
      if (rpcErr || !rpcRow) return c.json({ error: rpcErr?.message ?? "order create failed" }, 500);
      await persistPiiTokens({
        addressId: rpcRow.address_id,
        quoteId: rpcRow.quote_id,
        dropoffAddress: input.dropoff.address,
        recipientPhone: input.recipient.phone,
        pickupAddress: input.pickup.address,
      });

      // Stamp the WebView handoff metadata onto the order row.
      // Migration 20260517000100 adds these columns nullable; the Supabase JS
      // typings haven't been regenerated yet, so the update payload is cast.
      type ConciergeMeta = {
        marketplace_order_ref: string | null;
        product_source_url: string;
        product_thumbnail_url: string | null;
        item_declared_value_idr: number;
      };
      const meta: ConciergeMeta = {
        marketplace_order_ref: input.product.marketplaceOrderRef ?? null,
        product_source_url: input.product.sourceUrl,
        product_thumbnail_url: input.product.thumbnailUrl ?? null,
        item_declared_value_idr: input.product.priceIDRDeclared,
      };
      await supabase
        .from("orders")
        .update({ ...(meta as Record<string, unknown>), ...snapshotPayload } as never)
        .eq("id", rpcRow.order_id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone_e164")
        .eq("id", userId)
        .single();

      let paymentAttempt: MidtransPaymentAttempt;
      try {
        paymentAttempt = await createMidtransPaymentAttempt(rpcRow.order_id, fees.totalIDR);
      } catch (error) {
        return c.json({ error: toErrorMessage(error) }, 500);
      }

      const snap = await midtrans.createTransaction({
        orderId: paymentAttempt.provider_order_id,
        grossAmount: fees.totalIDR,
        customer: {
          name: profile?.full_name ?? input.recipient.name,
          phone: profile?.phone_e164 ?? input.recipient.phone,
        },
        // No item line — the user already paid the seller on the marketplace.
        items: [
          {
            id: "courier",
            name: `Courier (${input.courier.provider})`,
            price: fees.courierFeeIDR,
            quantity: 1,
          },
          { id: "service", name: "GoGet service", price: fees.serviceFeeIDR, quantity: 1 },
          { id: "tax", name: "PPN", price: fees.taxIDR, quantity: 1 },
        ],
        callbackUrl: `${env.API_PUBLIC_URL}/orders/${rpcRow.order_short_code}`,
      });

      await supabase
        .from("payments")
        .update({ raw_meta: { snapToken: snap.token, redirectUrl: snap.redirectUrl } })
        .eq("id", paymentAttempt.payment_id);

      return c.json({
        order: {
          id: rpcRow.order_id,
          shortCode: rpcRow.order_short_code,
          status: "pending_payment" as const,
          totalIDR: fees.totalIDR,
          breakdown,
        },
        payment: { amountIDR: fees.totalIDR, snapToken: snap.token, redirectUrl: snap.redirectUrl },
      });
    },
  });
});

/**
 * GET /api/orders
 * List the authenticated user's orders, newest first. Used by the web
 * `/orders` page and the mobile app's orders list.
 */
orders.get("/", async c => {
  const { userId } = c.get("auth");
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id, short_code, status, total_idr, item_price_idr, service_fee_idr,
      courier_fee_idr, tax_idr, created_at,
      selected_listing_snapshot, checkout_fee_snapshot, courier_preference_snapshot,
      booking_retry_state, booking_retry_attempt_count, booking_retry_max_attempts,
      booking_retry_last_error, booking_retry_next_retry_at, booking_retry_updated_at,
      quote:quote_id(title, image_url, pickup_address, external_url, source),
      delivery:deliveries(provider, tier, status, tracking_url, is_active),
      address:delivery_address_id(line1, city, recipient_name, recipient_phone)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({
    orders: (data ?? []).map((o: any) => ({
      ...o,
      quote: o.quote
        ? { ...o.quote, pickup_address: decryptPII(o.quote.pickup_address) ?? o.quote.pickup_address }
        : o.quote,
      address: o.address
        ? {
            ...o.address,
            line1: decryptPII(o.address.line1) ?? o.address.line1,
            recipient_name: decryptPII(o.address.recipient_name) ?? o.address.recipient_name,
            recipient_phone: decryptPII(o.address.recipient_phone) ?? o.address.recipient_phone,
          }
        : o.address,
      fulfillment_retry: {
        state: o.booking_retry_state,
        attemptCount: o.booking_retry_attempt_count,
        maxAttempts: o.booking_retry_max_attempts,
        lastError: o.booking_retry_last_error,
        nextRetryAt: o.booking_retry_next_retry_at,
        updatedAt: o.booking_retry_updated_at,
      },
    })),
  });
});

/**
 * GET /api/orders/:id — order detail with payment + delivery status.
 */
orders.get("/:id", async c => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("orders")
    .select("*, payments(*), deliveries(*), order_events(*), quote_id(title, image_url, source, external_url)")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !data) return c.json({ error: "not found" }, 404);
  return c.json(data);
});

/**
 * POST /api/orders/:id/book-courier
 * Internal: invoked by the payment webhook after `paid`. Exposed for ops too.
 * Books the cheapest live rate (or re-quotes if expired).
 */
orders.post("/:id/book-courier", async c => {
  const id = c.req.param("id");
  return await bookCourierForOrder(id, c.json.bind(c));
});

/**
 * Shared helper: book the courier for an order. Used by the route above
 * AND by the Midtrans webhook in routes/webhooks.ts.
 */
export async function bookCourierForOrder(
  orderId: string,
  respond: (b: any, s?: number) => Response,
) {
  const { data: order } = await supabase
    .from("orders")
    .select("*, quote:quote_id(title, item_price_idr, pickup_address, pickup_geo), addr:delivery_address_id(*)")
    .eq("id", orderId)
    .returns<(OrderWithJoins & { selected_rate_id: string | null })[]>()
    .single();
  if (!order) return respond({ error: "order not found" }, 404);
  if (
    order.status === "awaiting_pickup"
    || order.status === "runner_assigned"
    || order.status === "item_picked_up"
    || order.status === "item_purchased"
    || order.status === "in_transit"
    || order.status === "delivered"
  ) {
    return respond({ ok: true, note: "already in flight" });
  }
  if (order.status !== "paid") {
    return respond({ error: `cannot book courier while order status is ${order.status}` }, 409);
  }

  // The chosen rate id lives on `orders.selected_rate_id` (added in
  // migration 20260517000000). Previously we read it from the FIRST
  // order_events row's meta jsonb — fragile, since any new "first" event
  // would silently break booking.
  if (!order.selected_rate_id) return respond({ error: "rate missing" }, 400);
  const { data: rate } = await supabase
    .from("courier_rates")
    .select("*")
    .eq("id", order.selected_rate_id)
    .single();
  if (!rate) return respond({ error: "rate missing" }, 400);

  const adapter = rate.provider === "gosend" ? gosend : grab;
  if (!adapter) return respond({ error: `adapter ${rate.provider} not configured` }, 503);

  const pickup = parsePoint(order.quote.pickup_geo);
  const drop = parsePoint(order.addr.geo);
  if (!pickup || !drop) return respond({ error: "geo missing" }, 400);

  const recipientName = decryptPII(order.addr.recipient_name) ?? order.addr.recipient_name;
  const recipientPhone = decryptPII(order.addr.recipient_phone) ?? order.addr.recipient_phone;
  const dropoffLine1 = decryptPII(order.addr.line1) ?? order.addr.line1;
  const pickupAddress = decryptPII(order.quote.pickup_address) ?? order.quote.pickup_address ?? "";

  const booking = await adapter.bookDelivery({
    pickup,
    pickupAddress,
    pickupContact: { name: "GoGet Runner", phone: "+62000000000" },
    dropoff: drop,
    dropoffAddress: `${dropoffLine1}, ${order.addr.city}`,
    dropoffContact: { name: recipientName, phone: recipientPhone },
    itemValueIDR: order.quote.item_price_idr,
    itemDescription: order.quote.title,
    tier: rate.tier as any,
    rateToken: resolveRateTokenForBooking(rate.raw_response),
    clientReference: order.short_code,
  });

  await supabase.from("deliveries").insert({
    order_id: orderId,
    provider: rate.provider,
    tier: rate.tier,
    external_booking_id: booking.externalBookingId,
    tracking_url: booking.trackingUrl,
    driver_name: booking.driverName,
    driver_phone: booking.driverPhone,
    driver_plate: booking.driverPlate,
    raw_meta: booking.raw as any,
    is_active: true,
  });
  await transitionOrderStatus({
    orderId,
    nextStatus: "awaiting_pickup",
    note: `courier booked (${rate.provider})`,
    meta: { external_booking_id: booking.externalBookingId },
  });

  return respond({ ok: true, deliveryId: booking.externalBookingId });
}

function parsePoint(point: any): { lat: number; lng: number } | null {
  if (!point) return null;
  if (typeof point === "object" && "coordinates" in point) {
    const [lng, lat] = point.coordinates;
    return { lat, lng };
  }
  return null;
}

// Shape of the orders row returned by bookCourierForOrder's joined select.
// Kept narrow on purpose — only the fields the booking flow actually reads.
type OrderWithJoins = {
  id: string;
  short_code: string;
  status: string;
  quote: {
    title: string;
    item_price_idr: number;
    pickup_address: string | null;
    pickup_geo: unknown;
  };
  addr: {
    line1: string;
    city: string;
    recipient_name: string;
    recipient_phone: string;
    geo: unknown;
  };
};
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unexpected error";
}

async function persistPiiTokens(input: {
  addressId: string;
  quoteId: string;
  dropoffAddress: string;
  recipientPhone: string;
  pickupAddress: string;
}) {
  const addressTokens = {
    line1_token: tokenizeAddress(input.dropoffAddress),
    recipient_phone_token: tokenizePhone(input.recipientPhone),
  };
  const quoteTokens = {
    pickup_address_token: tokenizeAddress(input.pickupAddress),
  };

  const [{ error: addressErr }, { error: quoteErr }] = await Promise.all([
    supabase.from("addresses").update(addressTokens as never).eq("id", input.addressId),
    supabase.from("quotes").update(quoteTokens as never).eq("id", input.quoteId),
  ]);

  if (addressErr) {
    console.warn("failed to persist address pii tokens", {
      addressId: input.addressId,
      error: addressErr.message,
    });
  }
  if (quoteErr) {
    console.warn("failed to persist quote pii tokens", {
      quoteId: input.quoteId,
      error: quoteErr.message,
    });
  }
}
