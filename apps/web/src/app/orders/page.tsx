"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatIDR } from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

// Mirrors the Hono `order_status` enum. `item_purchased` is legacy; new rows
// use `item_picked_up` after the concierge pivot.
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

interface OrderRow {
  id: string;
  short_code: string;
  status: OrderStatus;
  total_idr: number;
  created_at: string;
  quote: {
    title: string;
    image_url?: string | null;
    pickup_address?: string | null;
  } | null;
  delivery: { provider: string; tier: string; is_active: boolean }[] | null;
  address: { line1: string; city: string } | null;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment:  "Awaiting payment",
  paid:             "Paid",
  awaiting_pickup:  "Awaiting pickup",
  runner_assigned:  "Runner assigned",
  item_picked_up:   "Runner has item",
  item_purchased:   "Runner has item",
  in_transit:       "On the way",
  delivered:        "Delivered",
  refunded:         "Refunded",
  failed:           "Failed",
  canceled:         "Canceled",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending_payment:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  paid:             "bg-blue-50 text-blue-700 border-blue-200",
  awaiting_pickup:  "bg-blue-50 text-blue-700 border-blue-200",
  runner_assigned:  "bg-brand-50 text-brand-700 border-brand-200",
  item_picked_up:   "bg-brand-50 text-brand-700 border-brand-200",
  item_purchased:   "bg-brand-50 text-brand-700 border-brand-200",
  in_transit:       "bg-brand-50 text-brand-700 border-brand-200",
  delivered:        "bg-green-50 text-green-700 border-green-200",
  refunded:         "bg-gray-50 text-gray-700 border-gray-200",
  failed:           "bg-red-50 text-red-700 border-red-200",
  canceled:         "bg-red-50 text-red-700 border-red-200",
};

const TERMINAL: readonly OrderStatus[] = ["delivered", "refunded", "failed", "canceled"];

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const data = await api<{ orders: OrderRow[] }>("/api/orders");
      setOrders(data.orders ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Gate on auth, then load.
  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace("/account?next=" + encodeURIComponent("/orders"));
        return;
      }
      fetchOrders().finally(() => active && setLoading(false));
    });
    return () => { active = false; };
  }, [fetchOrders, router]);

  // Poll every 30 seconds while any active orders exist
  useEffect(() => {
    const hasActive = orders.some(o => !TERMINAL.includes(o.status));
    if (!hasActive) return;
    const id = setInterval(() => fetchOrders(), 30_000);
    return () => clearInterval(id);
  }, [orders, fetchOrders]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold">Your orders</h1>
        {[1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-gray-100 p-5 space-y-2 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Your orders</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Failed to load orders: {error}
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Your orders</h1>
        <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center space-y-3">
          <div className="text-4xl">📦</div>
          <p className="font-medium text-gray-700">No orders yet</p>
          <p className="text-sm text-gray-500">Place your first order to see it tracked here.</p>
          <button
            onClick={() => router.push("/")}
            className="mt-2 inline-block px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold"
          >
            Find something
          </button>
        </div>
      </div>
    );
  }

  const hasActive = orders.some(o => !TERMINAL.includes(o.status));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your orders</h1>
        {hasActive && (
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            Live updates
          </span>
        )}
      </div>

      <ul className="space-y-3">
        {orders.map(order => {
          const courier = order.delivery?.find(d => d.is_active) ?? order.delivery?.[0];
          return (
            <li key={order.id}>
              <Link
                href={`/orders/${order.short_code}`}
                className="block rounded-2xl border border-gray-100 hover:border-brand-300 transition p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm line-clamp-2">{order.quote?.title ?? "Order"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.short_code} · {new Date(order.created_at).toLocaleDateString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLOR[order.status]}`}>
                    {STATUS_LABEL[order.status]}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    {courier ? `${courier.provider} ${courier.tier}` : "No courier yet"}
                  </span>
                  <span className="font-bold text-brand-700">{formatIDR(order.total_idr)}</span>
                </div>

                <div className="text-xs text-gray-400 space-y-0.5">
                  {order.quote?.pickup_address && (
                    <p>📍 Pickup: <span className="text-gray-600">{order.quote.pickup_address}</span></p>
                  )}
                  {order.address && (
                    <p>🏠 Deliver to: <span className="text-gray-600">{order.address.line1}, {order.address.city}</span></p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => router.push("/")}
        className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:text-gray-800 hover:border-gray-300 transition"
      >
        + Find something else
      </button>
    </div>
  );
}
