import { Hono } from "hono";
import { gosend, grab, midtrans, supabase } from "../clients";
import { bookCourierForOrder } from "./orders";

export const webhooks = new Hono();

/**
 * POST /webhooks/midtrans
 * Signature is sha512(order_id + status_code + gross_amount + serverKey).
 */
webhooks.post("/midtrans", async c => {
  const body = await c.req.json();
  const verified = midtrans.verifyWebhook(body);
  if (!verified.valid) return c.json({ error: "bad signature" }, 400);

  // Idempotency: dedupe by (provider, transaction_id).
  const externalId = String(body.transaction_id ?? body.order_id);
  const dedupe = await supabase
    .from("webhook_events")
    .insert({
      provider: "midtrans",
      external_id: externalId,
      payload: body,
    })
    .select("id")
    .single();
  if (dedupe.error?.code === "23505") return c.json({ ok: true, dedup: true });

  await supabase
    .from("payments")
    .update({
      status: verified.status,
      method: verified.method,
      paid_at: verified.status === "paid" ? new Date().toISOString() : null,
      raw_meta: body,
    })
    .eq("provider_order_id", verified.orderId);

  // Update parent order, and if paid -> book the courier.
  const { data: payment } = await supabase
    .from("payments")
    .select("order_id")
    .eq("provider_order_id", verified.orderId)
    .single();

  if (payment?.order_id) {
    if (verified.status === "paid") {
      await supabase.from("orders").update({ status: "paid" }).eq("id", payment.order_id);
      await supabase.from("order_events").insert({
        order_id: payment.order_id,
        status: "paid",
        note: `paid via ${verified.method}`,
      });
      // Kick off courier booking — fire-and-forget; failures retried by a cron.
      bookCourierForOrder(payment.order_id, (b, s) => new Response(JSON.stringify(b), { status: s ?? 200 }))
        .catch(e => console.error("courier book failed", e));
    } else if (verified.status === "failed" || verified.status === "expired") {
      await supabase.from("orders").update({
        status: "failed",
        status_reason: `payment ${verified.status}`,
      }).eq("id", payment.order_id);
      await supabase.from("order_events").insert({
        order_id: payment.order_id,
        status: "failed",
        note: `payment ${verified.status}`,
      });
    }
  }

  await supabase.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("external_id", externalId);
  return c.json({ ok: true });
});

/**
 * POST /webhooks/gosend
 */
webhooks.post("/gosend", async c => {
  if (!gosend) return c.json({ error: "gosend not configured" }, 503);
  const body = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
  let parsed: ReturnType<typeof gosend.parseWebhook>;
  try {
    parsed = gosend.parseWebhook(headers, body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid webhook";
    const status = msg.toLowerCase().includes("not configured") ? 503 : 401;
    return c.json({ error: msg }, status);
  }
  await applyCourierUpdate("gosend", parsed.externalBookingId, parsed.status, parsed.raw);
  return c.json({ ok: true });
});

/**
 * POST /webhooks/grab
 */
webhooks.post("/grab", async c => {
  if (!grab) return c.json({ error: "grab not configured" }, 503);
  const body = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
  let parsed: ReturnType<typeof grab.parseWebhook>;
  try {
    parsed = grab.parseWebhook(headers, body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid webhook";
    const status = msg.toLowerCase().includes("not configured") ? 503 : 401;
    return c.json({ error: msg }, status);
  }
  await applyCourierUpdate("grab", parsed.externalBookingId, parsed.status, parsed.raw);
  return c.json({ ok: true });
});

async function applyCourierUpdate(
  provider: "gosend" | "grab",
  externalBookingId: string,
  rawStatus: string,
  raw: unknown,
) {
  const { data: delivery } = await supabase
    .from("deliveries")
    .select("id, order_id")
    .eq("provider", provider)
    .eq("external_booking_id", externalBookingId)
    .single();
  if (!delivery) return;

  const mapped = mapCourierStatus(rawStatus);
  await supabase.from("deliveries")
    .update({
      status: rawStatus,
      raw_meta: raw as any,
      delivered_at: mapped === "delivered" ? new Date().toISOString() : undefined,
    })
    .eq("id", delivery.id);

  if (mapped) {
    await supabase.from("orders").update({ status: mapped }).eq("id", delivery.order_id);
    await supabase.from("order_events").insert({
      order_id: delivery.order_id,
      status: mapped,
      note: `courier ${provider}: ${rawStatus}`,
    });
  }
}

function mapCourierStatus(s: string) {
  const lower = s.toLowerCase();
  if (lower.includes("assigned") || lower.includes("allocated")) return "runner_assigned" as const;
  if (lower.includes("picked") || lower.includes("collected")) return "item_picked_up" as const;
  if (lower.includes("transit") || lower.includes("ongoing")) return "in_transit" as const;
  if (lower.includes("delivered") || lower.includes("completed")) return "delivered" as const;
  if (lower.includes("cancel") || lower.includes("fail")) return "failed" as const;
  return null;
}
