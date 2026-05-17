import { Hono } from "hono";
import { z } from "zod";
import { computeFees, ConciergeOrderInput } from "@goget/shared/server";
import { gosend, grab, midtrans, supabase } from "../clients";
import { env } from "../env";
import {
  decryptPII,
  encryptPII,
  tokenizeAddress,
  tokenizePhone,
} from "../security/pii";

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
  }),
});

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
  const input = CreateOrderInput.parse(await c.req.json());
  const { userId } = c.get("auth");

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, request_id, title, item_price_idr, item_requests(user_id)")
    .eq("id", input.quoteId)
    .returns<{
      id: string;
      request_id: string;
      title: string;
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

  // Each Snap session gets a unique provider_order_id of
  // `${short_code}-${attempt}`. The webhook parses the suffix to find the
  // exact payments row when the user pays after one or more cancels.
  // The unique index (order_id, attempt) prevents two rows sharing an
  // attempt number, and (provider, provider_order_id) keeps the Midtrans
  // facing id globally unique.
  const attempt = await nextPaymentAttempt(order.id);
  const midtransOrderId = `${order.short_code}-${attempt}`;

  // Insert payments row in `pending` FIRST so we always have a DB record
  // of the attempt even if Midtrans never returns / returns and we crash.
  // The webhook reconciles by `provider_order_id`, so it MUST exist before
  // the Snap session is created. We update it with the token after the call.
  type PaymentInsert = {
    order_id: string;
    provider: "midtrans";
    provider_order_id: string;
    amount_idr: number;
    status: "pending";
    attempt: number;
  };
  const paymentInsert: PaymentInsert = {
    order_id: order.id,
    provider: "midtrans",
    provider_order_id: midtransOrderId,
    amount_idr: fees.totalIDR,
    status: "pending",
    attempt,
  };
  const { data: paymentRow, error: pErr } = await supabase
    .from("payments")
    .insert(paymentInsert)
    .select("id")
    .single();
  if (pErr || !paymentRow) return c.json({ error: pErr?.message ?? "payment create failed" }, 500);

  const snap = await midtrans.createTransaction({
    orderId: midtransOrderId,
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
    .eq("id", paymentRow.id);

  return c.json({
    order: { id: order.id, shortCode: order.short_code, totalIDR: fees.totalIDR, breakdown: fees },
    payment: { snapToken: snap.token, redirectUrl: snap.redirectUrl },
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
  const input = QuickOrderInput.parse(await c.req.json());
  const { userId } = c.get("auth");

  // Concierge model: fees exclude the item price (paid directly on marketplace).
  const fees = computeFees({ courierFeeIDR: input.courier.priceIDR });

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone_e164")
    .eq("id", userId)
    .single();

  // Retry-safe provider_order_id: `${short_code}-${attempt}`. The first
  // Snap session for a freshly-created order will always be attempt=1;
  // if the user cancels and clicks pay again we hit POST /api/orders
  // again with a fresh attempt number rather than reusing `-1`.
  const attempt = await nextPaymentAttempt(rpcRow.order_id);
  const midtransOrderId = `${rpcRow.order_short_code}-${attempt}`;

  // Insert payments row in `pending` BEFORE creating the Snap session.
  // If Midtrans never returns (timeout, network error, our process crashes),
  // we still have a DB record the webhook handler can later reconcile.
  // Previously this insert happened AFTER createTransaction, so a failure
  // there left a live Snap URL with no matching payments row.
  type PaymentInsert = {
    order_id: string;
    provider: "midtrans";
    provider_order_id: string;
    amount_idr: number;
    status: "pending";
    attempt: number;
  };
  const paymentInsert: PaymentInsert = {
    order_id: rpcRow.order_id,
    provider: "midtrans",
    provider_order_id: midtransOrderId,
    amount_idr: fees.totalIDR,
    status: "pending",
    attempt,
  };
  const { data: paymentRow, error: pErr } = await supabase
    .from("payments")
    .insert(paymentInsert)
    .select("id")
    .single();
  if (pErr || !paymentRow) return c.json({ error: pErr?.message ?? "payment create failed" }, 500);

  const snap = await midtrans.createTransaction({
    orderId: midtransOrderId,
    grossAmount: fees.totalIDR,
    customer: {
      name: profile?.full_name ?? input.recipient.name,
      phone: profile?.phone_e164 ?? input.recipient.phone,
    },
    items: [
      { id: "courier", name: `Courier (${input.courier.provider})`, price: fees.courierFeeIDR, quantity: 1 },
      { id: "service", name: "GoGet service", price: fees.serviceFeeIDR, quantity: 1 },
      { id: "tax", name: "PPN", price: fees.taxIDR, quantity: 1 },
    ],
    callbackUrl: `${env.API_PUBLIC_URL}/orders/${rpcRow.order_short_code}`,
  });

  // Stamp the snap token onto the existing pending row.
  await supabase
    .from("payments")
    .update({ raw_meta: { snapToken: snap.token, redirectUrl: snap.redirectUrl } })
    .eq("id", paymentRow.id);

  return c.json({
    order: {
      id: rpcRow.order_id,
      shortCode: rpcRow.order_short_code,
      totalIDR: fees.totalIDR,
      breakdown: fees,
    },
    payment: { snapToken: snap.token, redirectUrl: snap.redirectUrl },
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
  const input = ConciergeOrderInput.parse(await c.req.json());
  const { userId } = c.get("auth");

  const fees = computeFees({ courierFeeIDR: input.courier.priceIDR });

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
  await supabase.from("orders").update(meta as never).eq("id", rpcRow.order_id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone_e164")
    .eq("id", userId)
    .single();

  const attempt = await nextPaymentAttempt(rpcRow.order_id);
  const midtransOrderId = `${rpcRow.order_short_code}-${attempt}`;

  // Insert payments row in `pending` BEFORE creating the Snap session so the
  // webhook always has a row to reconcile against, even if Midtrans times out.
  type PaymentInsert = {
    order_id: string;
    provider: "midtrans";
    provider_order_id: string;
    amount_idr: number;
    status: "pending";
    attempt: number;
  };
  const paymentInsert: PaymentInsert = {
    order_id: rpcRow.order_id,
    provider: "midtrans",
    provider_order_id: midtransOrderId,
    amount_idr: fees.totalIDR,
    status: "pending",
    attempt,
  };
  const { data: paymentRow, error: pErr } = await supabase
    .from("payments")
    .insert(paymentInsert)
    .select("id")
    .single();
  if (pErr || !paymentRow) return c.json({ error: pErr?.message ?? "payment create failed" }, 500);

  const snap = await midtrans.createTransaction({
    orderId: midtransOrderId,
    grossAmount: fees.totalIDR,
    customer: {
      name: profile?.full_name ?? input.recipient.name,
      phone: profile?.phone_e164 ?? input.recipient.phone,
    },
    // No item line — the user already paid the seller on the marketplace.
    items: [
      { id: "courier", name: `Courier (${input.courier.provider})`, price: fees.courierFeeIDR, quantity: 1 },
      { id: "service", name: "GoGet service", price: fees.serviceFeeIDR, quantity: 1 },
      { id: "tax", name: "PPN", price: fees.taxIDR, quantity: 1 },
    ],
    callbackUrl: `${env.API_PUBLIC_URL}/orders/${rpcRow.order_short_code}`,
  });

  await supabase
    .from("payments")
    .update({ raw_meta: { snapToken: snap.token, redirectUrl: snap.redirectUrl } })
    .eq("id", paymentRow.id);

  return c.json({
    order: {
      id: rpcRow.order_id,
      shortCode: rpcRow.order_short_code,
      status: "pending_payment" as const,
      totalIDR: fees.totalIDR,
      breakdown: fees,
    },
    payment: { snapToken: snap.token, redirectUrl: snap.redirectUrl },
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
  if (order.status === "delivered" || order.status === "in_transit") {
    return respond({ ok: true, note: "already in flight" });
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
    rateToken: (rate.raw_response as any)?.rateToken,
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
  await supabase.from("orders").update({ status: "awaiting_pickup" }).eq("id", orderId);
  await supabase.from("order_events").insert({
    order_id: orderId,
    status: "awaiting_pickup",
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

/**
 * Returns the next `attempt` number for a given order's payments.
 *
 * Combined with the unique index (order_id, attempt) added in migration
 * 20260517000000, this guarantees each Snap session for an order gets a
 * fresh `${short_code}-${attempt}` provider_order_id even if the user
 * cancels and retries. The webhook in routes/webhooks.ts looks up the
 * matching payments row by provider_order_id, so uniqueness here is what
 * keeps that lookup unambiguous.
 *
 * Uses HEAD-count to avoid pulling row bodies. If a concurrent insert
 * races to the same attempt number, the unique index will throw 23505
 * at the caller, which is the desired failure mode (better than silent
 * collision).
 */
async function nextPaymentAttempt(orderId: string): Promise<number> {
  const { count } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  return (count ?? 0) + 1;
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
