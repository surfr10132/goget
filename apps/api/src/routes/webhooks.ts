import { Hono } from "hono";
import { gosend, grab, midtrans, supabase } from "../clients";
import { env } from "../env";
import { enqueueBookCourierJob, processOrderJobs } from "../services/order-jobs";
import { transitionOrderStatus } from "../services/order-state-machine";

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
    .select("id, processed_at")
    .returns<{ id: string; processed_at: string | null }[]>()
    .single();
  let eventId: string;
  if (dedupe.error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("webhook_events")
      .select("id, processed_at")
      .eq("provider", "midtrans")
      .eq("external_id", externalId)
      .returns<{ id: string; processed_at: string | null }[]>()
      .single();
    if (existingError || !existing) {
      return c.json({ error: existingError?.message ?? "failed to load webhook event" }, 500);
    }
    if (existing.processed_at) {
      return c.json({ ok: true, dedup: true });
    }
    eventId = existing.id;
  } else if (dedupe.error || !dedupe.data) {
    return c.json({ error: dedupe.error?.message ?? "failed to persist webhook event" }, 500);
  } else {
    eventId = dedupe.data.id;
  }
  const processedAt = new Date().toISOString();

  try {
    const paymentUpdate: Record<string, unknown> = {
      status: verified.status,
      method: verified.method,
      raw_meta: body,
    };
    if (verified.status === "paid") paymentUpdate.paid_at = processedAt;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update(paymentUpdate)
      .eq("provider_order_id", verified.orderId)
      .select("id, order_id")
      .returns<{ id: string; order_id: string }[]>()
      .single();
    if (paymentError || !payment) {
      throw new Error(paymentError?.message ?? `payment not found for provider_order_id ${verified.orderId}`);
    }

    if (verified.status === "paid") {
      await transitionOrderStatus({
        orderId: payment.order_id,
        nextStatus: "paid",
        note: `paid via ${verified.method}`,
        meta: {
          provider: "midtrans",
          provider_order_id: verified.orderId,
          transaction_id: body.transaction_id ?? null,
        },
      });
      await enqueueBookCourierJob(payment.order_id, {
        source: "midtrans_webhook",
        provider_order_id: verified.orderId,
        transaction_id: body.transaction_id ?? null,
      });
    } else if (verified.status === "failed" || verified.status === "expired") {
      await transitionOrderStatus({
        orderId: payment.order_id,
        nextStatus: "failed",
        statusReason: `payment ${verified.status}`,
        note: `payment ${verified.status}`,
        meta: {
          provider: "midtrans",
          provider_order_id: verified.orderId,
          transaction_id: body.transaction_id ?? null,
        },
      });
    }

    await supabase
      .from("webhook_events")
      .update({ processed_at: processedAt, error: null })
      .eq("id", eventId);
    return c.json({ ok: true });
  } catch (error) {
    const message = toErrorMessage(error);
    await supabase
      .from("webhook_events")
      .update({ processed_at: null, error: message })
      .eq("id", eventId);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /webhooks/order-jobs/process
 * Internal job runner entrypoint for scheduled retries.
 */
webhooks.post("/order-jobs/process", async c => {
  if (!env.ORDER_JOBS_PROCESS_TOKEN) {
    return c.json({ error: "ORDER_JOBS_PROCESS_TOKEN is not configured" }, 503);
  }
  const providedToken = readProcessToken(
    c.req.header("authorization"),
    c.req.header("x-order-jobs-token"),
  );
  if (providedToken !== env.ORDER_JOBS_PROCESS_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const limit = parseClaimLimit(c.req.query("limit"));
    const result = await processOrderJobs(limit);
    return c.json({ ok: true, ...result });
  } catch (error) {
    return c.json({ error: toErrorMessage(error) }, 500);
  }
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
    await transitionOrderStatus({
      orderId: delivery.order_id,
      nextStatus: mapped,
      statusReason: mapped === "failed" ? `courier ${provider}: ${rawStatus}` : undefined,
      note: `courier ${provider}: ${rawStatus}`,
      meta: {
        provider,
        external_booking_id: externalBookingId,
        raw_status: rawStatus,
      },
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

function parseClaimLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "10", 10);
  if (!Number.isFinite(parsed)) return 10;
  return parsed;
}

function readProcessToken(
  authorizationHeader: string | undefined,
  customHeader: string | undefined,
): string | null {
  if (customHeader) return customHeader;
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unexpected error";
}
