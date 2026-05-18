"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { formatIDR } from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

// `item_purchased` is the legacy enum value (kept for old rows). New webhook
// transitions write `item_picked_up`; both are surfaced as the same UI step.
type OrderStatus =
  | "pending_payment"
  | "paid"
  | "awaiting_pickup"
  | "runner_assigned"
  | "item_picked_up"
  | "item_purchased"
  | "in_transit"
  | "delivered"
  | "refunded"
  | "failed"
  | "canceled";
type FulfillmentRetryState = "idle" | "pending" | "processing" | "retrying" | "succeeded" | "failed";

interface TrackingResponse {
  short_code: string;
  status: OrderStatus;
  total_idr: number;
  created_at: string;
  quote: {
    title: string;
    image_url?: string | null;
    external_url?: string | null;
    source?: string | null;
  } | null;
  delivery: {
    provider: string;
    tier: string;
    status?: string | null;
    tracking_url?: string | null;
    driver_name?: string | null;
    driver_phone?: string | null;
    driver_plate?: string | null;
    is_active: boolean;
  }[] | null;
  events: { status: OrderStatus; note?: string | null; created_at: string }[] | null;
  fulfillment_retry?: {
    state: FulfillmentRetryState;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    nextRetryAt: string | null;
    updatedAt: string;
  } | null;
}

const STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: "paid",             label: "Payment confirmed",       icon: "✅" },
  { status: "awaiting_pickup",  label: "Booking courier",         icon: "📦" },
  { status: "runner_assigned",  label: "Runner heading to seller", icon: "🏃" },
  { status: "item_picked_up",   label: "Item picked up",          icon: "🛍️" },
  { status: "in_transit",       label: "On the way to you",       icon: "🛵" },
  { status: "delivered",        label: "Delivered",               icon: "🎉" },
];

// Both `item_picked_up` (new) and `item_purchased` (legacy) map to the same step.
const ORDER_INDEX: Partial<Record<OrderStatus, number>> = {
  paid:            0,
  awaiting_pickup: 1,
  runner_assigned: 2,
  item_picked_up:  3,
  item_purchased:  3,
  in_transit:      4,
  delivered:       5,
};

const TERMINAL: readonly OrderStatus[] = ["delivered", "refunded", "failed", "canceled"];

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

export default function OrderDetailPage() {
  const router = useRouter();
  const { shortCode } = useParams<{ shortCode: string }>();
  const [order, setOrder] = useState<TrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const data = await api<TrackingResponse>(`/api/tracking/${shortCode}`);
      setOrder(data);
      setError(null);
    } catch (error: unknown) {
      setError(toErrorMessage(error));
    }
  }, [shortCode]);

  // Gate on auth, then load.
  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace("/account?next=" + encodeURIComponent(`/orders/${shortCode}`));
        return;
      }
      fetchOrder().finally(() => active && setLoading(false));
    });
    return () => { active = false; };
  }, [fetchOrder, router, shortCode]);

  // Poll while not terminal
  useEffect(() => {
    if (!order || TERMINAL.includes(order.status)) return;
    const id = setInterval(() => fetchOrder(), 15_000);
    return () => clearInterval(id);
  }, [order, fetchOrder]);

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-6 bg-gray-100 rounded w-1/3" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
        <div className="h-32 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-4 py-16">
        <p className="text-2xl">🔍</p>
        <p className="font-medium">Order not found</p>
        {error && <p className="text-xs text-gray-500">{error}</p>}
        <button onClick={() => router.push("/orders")} className="text-sm text-brand-600 underline">
          Back to orders
        </button>
      </div>
    );
  }

  const currentStep = ORDER_INDEX[order.status] ?? -1;
  const isCancelled = order.status === "canceled" || order.status === "failed";
  const isPendingPayment = order.status === "pending_payment";
  const activeDelivery = order.delivery?.find(d => d.is_active) ?? order.delivery?.[0] ?? null;
  const retry = order.fulfillment_retry;
  const retryState = retry?.state;
  const retryInProgress =
    retryState === "pending" || retryState === "processing" || retryState === "retrying";
  const retryFailed = retryState === "failed";

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <button onClick={() => router.push("/orders")} className="text-sm text-gray-500 hover:text-gray-800">
        ← All orders
      </button>

      <div className="rounded-2xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-base line-clamp-2">{order.quote?.title ?? "Order"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{order.short_code}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-brand-700">{formatIDR(order.total_idr)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(order.created_at).toLocaleDateString("id-ID", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </div>
        </div>

        {activeDelivery && (
          <div className="text-xs text-gray-500 space-y-1 border-t border-gray-100 pt-3">
            <p>🚀 {activeDelivery.provider} {activeDelivery.tier}</p>
            {activeDelivery.driver_name && (
              <p>🧑‍✈️ {activeDelivery.driver_name}
                {activeDelivery.driver_phone && <> · {activeDelivery.driver_phone}</>}
                {activeDelivery.driver_plate && <> · {activeDelivery.driver_plate}</>}
              </p>
            )}
            {activeDelivery.tracking_url && (
              <a
                href={activeDelivery.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline"
              >
                Open live tracking →
              </a>
            )}
          </div>
        )}
      </div>

      {/* Pending payment banner */}
      {isPendingPayment && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-yellow-800 text-sm">
          Payment is pending. If your Midtrans window was closed, refresh after completing payment.
        </div>
      )}
      {retryInProgress && retry && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800 text-sm space-y-1">
          <p className="font-medium">Courier booking retry in progress</p>
          <p>
            Attempt {retry.attemptCount} / {Math.max(retry.maxAttempts, retry.attemptCount)}
            {retry.nextRetryAt ? ` · next retry ${new Date(retry.nextRetryAt).toLocaleString("id-ID")}` : ""}
          </p>
          {retry.lastError && <p>Last error: {retry.lastError}</p>}
        </div>
      )}
      {retryFailed && retry && !isCancelled && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 text-sm space-y-1">
          <p className="font-medium">Courier booking retries exhausted</p>
          <p>
            Attempts: {retry.attemptCount}
            {retry.maxAttempts ? ` / ${retry.maxAttempts}` : ""}
          </p>
          {retry.lastError && <p>Last error: {retry.lastError}</p>}
        </div>
      )}

      {/* Status timeline */}
      {isCancelled ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-700 font-medium">
          This order was {order.status}.
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 p-5 space-y-1">
          <p className="text-sm font-semibold mb-3">Delivery status</p>
          <ol className="relative space-y-5">
            {STEPS.map((s, i) => {
              const done = i <= currentStep;
              const current = i === currentStep;
              return (
                <li key={s.status} className="flex items-start gap-3 relative pl-8">
                  {i < STEPS.length - 1 && (
                    <span className={`absolute left-3 top-5 w-0.5 h-full -translate-x-1/2 ${done ? "bg-brand-400" : "bg-gray-200"}`} />
                  )}
                  <span className={`absolute left-0 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 transition ${
                    done
                      ? current
                        ? "border-brand-500 bg-brand-500 text-white shadow-md shadow-brand-200"
                        : "border-brand-400 bg-brand-400 text-white"
                      : "border-gray-200 bg-white text-gray-400"
                  }`}>
                    {done ? (current ? s.icon : "✓") : ""}
                  </span>
                  <div>
                    <p className={`text-sm font-medium ${done ? "text-gray-900" : "text-gray-400"}`}>{s.label}</p>
                    {current && !TERMINAL.includes(order.status) && (
                      <p className="text-xs text-brand-500 mt-0.5 animate-pulse">In progress…</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Event timeline (from courier webhooks) */}
      {order.events && order.events.length > 0 && (
        <div className="rounded-2xl border border-gray-100 p-5 space-y-2">
          <p className="text-sm font-semibold mb-1">Activity</p>
          <ul className="space-y-1.5 text-xs text-gray-500">
            {order.events
              .slice()
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .slice(0, 8)
              .map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-400 shrink-0">
                    {new Date(e.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span>
                    <span className="font-medium text-gray-700">{e.status}</span>
                    {e.note && <span className="text-gray-500"> · {e.note}</span>}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Status updates arrive from the courier in real time.
      </p>
    </div>
  );
}
