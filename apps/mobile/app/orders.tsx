import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { formatIDR } from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

// Mirrors the Hono `order_status` enum. `item_purchased` is the legacy value
// kept for old rows; new orders use `item_picked_up` after the concierge pivot.
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
  fulfillment_retry?: {
    state: FulfillmentRetryState;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    nextRetryAt: string | null;
    updatedAt: string;
  } | null;
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

const STATUS_COLOR: Record<OrderStatus, { bg: string; fg: string; border: string }> = {
  pending_payment:  { bg: "#fefce8", fg: "#a16207", border: "#fde68a" },
  paid:             { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
  awaiting_pickup:  { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
  runner_assigned:  { bg: "#eef9f3", fg: "#0c6a3d", border: "#bbf7d0" },
  item_picked_up:   { bg: "#eef9f3", fg: "#0c6a3d", border: "#bbf7d0" },
  item_purchased:   { bg: "#eef9f3", fg: "#0c6a3d", border: "#bbf7d0" },
  in_transit:       { bg: "#eef9f3", fg: "#0c6a3d", border: "#bbf7d0" },
  delivered:        { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
  refunded:         { bg: "#f9fafb", fg: "#374151", border: "#e5e7eb" },
  failed:           { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
  canceled:         { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
};

const TERMINAL: OrderStatus[] = ["delivered", "refunded", "failed", "canceled"];

export default function Orders() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace({ pathname: "/account", params: { next: "/orders" } });
        return;
      }
      fetchOrders().finally(() => active && setLoading(false));
    });
    return () => { active = false; };
  }, [fetchOrders, router]);

  // Poll every 30s while any active orders exist.
  useEffect(() => {
    const hasActive = orders.some(o => !TERMINAL.includes(o.status));
    if (!hasActive) return;
    const id = setInterval(() => fetchOrders(), 30_000);
    return () => clearInterval(id);
  }, [orders, fetchOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.wrap}>
        <Text style={s.h1}>Your orders</Text>
        <View style={s.err}>
          <Text style={s.errText}>Failed to load orders: {error}</Text>
        </View>
      </View>
    );
  }

  if (orders.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.h1}>Your orders</Text>
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No orders yet</Text>
          <Text style={s.emptySub}>Place your first order to see it tracked here.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.push("/")}>
            <Text style={s.primaryBtnText}>Find something</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const hasActive = orders.some(o => !TERMINAL.includes(o.status));

  return (
    <FlatList
      data={orders}
      keyExtractor={o => o.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={s.headerRow}>
          <Text style={s.h1}>Your orders</Text>
          {hasActive && <Text style={s.live}>● Live updates</Text>}
        </View>
      }
      renderItem={({ item }) => {
        const courier = item.delivery?.find(d => d.is_active) ?? item.delivery?.[0];
        const color = STATUS_COLOR[item.status];
        const retry = item.fulfillment_retry;
        const retryState = retry?.state;
        const showRetry =
          retryState === "pending" || retryState === "processing" || retryState === "retrying";
        const showRetryFailed = retryState === "failed" && item.status !== "failed";
        return (
          <Pressable
            style={({ pressed }) => [s.card, pressed && { opacity: 0.86 }]}
            onPress={() => router.push({ pathname: "/orders/[shortCode]", params: { shortCode: item.short_code } })}
          >
            <View style={s.cardTop}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={s.cardTitle} numberOfLines={2}>
                  {item.quote?.title ?? "Order"}
                </Text>
                <Text style={s.cardMeta}>
                  {item.short_code} ·{" "}
                  {new Date(item.created_at).toLocaleDateString("id-ID", {
                    day: "numeric", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </Text>
              </View>
              <View
                style={[
                  s.badge,
                  { backgroundColor: color.bg, borderColor: color.border },
                ]}
              >
                <Text style={[s.badgeText, { color: color.fg }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
            </View>

            <View style={s.cardMid}>
              <Text style={s.cardCourier}>
                {courier ? `${courier.provider} ${courier.tier}` : "No courier yet"}
              </Text>
              <Text style={s.cardTotal}>{formatIDR(item.total_idr)}</Text>
            </View>
            {showRetry && retry && (
              <View style={s.retryInfo}>
                <Text style={s.retryInfoText}>
                  Booking retry in progress · attempt {retry.attemptCount} / {Math.max(retry.maxAttempts, retry.attemptCount)}
                </Text>
              </View>
            )}
            {showRetryFailed && retry?.lastError && (
              <View style={s.retryError}>
                <Text style={s.retryErrorText}>Booking retry failed: {retry.lastError}</Text>
              </View>
            )}

            {item.quote?.pickup_address && (
              <Text style={s.cardAddr}>📍 Pickup: {item.quote.pickup_address}</Text>
            )}
            {item.address && (
              <Text style={s.cardAddr}>🏠 Deliver to: {item.address.line1}, {item.address.city}</Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 4,
  },
  h1: { fontSize: 22, fontWeight: "700" },
  live: { color: "#16a45f", fontSize: 11 },
  card: {
    borderWidth: 1, borderColor: "#f3f4f6", borderRadius: 16,
    padding: 16, backgroundColor: "#fff", gap: 10,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { fontWeight: "600", fontSize: 14 },
  cardMeta: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
  badge: {
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  cardMid: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardCourier: { color: "#6b7280", fontSize: 13, textTransform: "capitalize" },
  cardTotal: { color: "#0c6a3d", fontWeight: "700" },
  cardAddr: { color: "#9ca3af", fontSize: 11 },
  empty: {
    marginTop: 18, padding: 28, alignItems: "center", gap: 10,
    borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "#e5e7eb",
  },
  emptyTitle: { fontWeight: "600", color: "#374151" },
  emptySub: { color: "#6b7280", fontSize: 13, textAlign: "center" },
  primaryBtn: {
    backgroundColor: "#16a45f", borderRadius: 14, paddingVertical: 12,
    paddingHorizontal: 24, marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  err: {
    marginTop: 18, padding: 16, borderRadius: 16,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
  },
  errText: { color: "#b91c1c" },
  retryInfo: {
    borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb",
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  retryInfoText: { color: "#92400e", fontSize: 11, fontWeight: "500" },
  retryError: {
    borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2",
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  retryErrorText: { color: "#b91c1c", fontSize: 11, fontWeight: "500" },
});
