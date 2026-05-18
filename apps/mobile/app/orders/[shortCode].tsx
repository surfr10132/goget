import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { formatIDR } from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

// `item_purchased` is legacy (old rows). New rows use `item_picked_up`.
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

const TERMINAL: readonly OrderStatus[] = ["delivered", "refunded", "failed", "canceled"];

const STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: "paid",            label: "Payment confirmed",        icon: "✅" },
  { status: "awaiting_pickup", label: "Booking courier",          icon: "📦" },
  { status: "runner_assigned", label: "Runner heading to seller", icon: "🏃" },
  { status: "item_picked_up",  label: "Item picked up",           icon: "🛍️" },
  { status: "in_transit",      label: "On the way to you",        icon: "🛵" },
  { status: "delivered",       label: "Delivered",                icon: "🎉" },
];

const ORDER_INDEX: Partial<Record<OrderStatus, number>> = {
  paid: 0,
  awaiting_pickup: 1,
  runner_assigned: 2,
  item_picked_up: 3,
  item_purchased: 3,
  in_transit: 4,
  delivered: 5,
};

export default function OrderDetailScreen() {
  const router = useRouter();
  const { shortCode } = useLocalSearchParams<{ shortCode?: string | string[] }>();
  const shortCodeValue = useMemo(
    () => (Array.isArray(shortCode) ? shortCode[0] : shortCode) ?? "",
    [shortCode],
  );

  const [order, setOrder] = useState<TrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!shortCodeValue) return;
    try {
      const data = await api<TrackingResponse>(`/api/tracking/${encodeURIComponent(shortCodeValue)}`);
      setOrder(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [shortCodeValue]);

  useEffect(() => {
    let active = true;
    if (!shortCodeValue) {
      setError("Missing order code");
      setLoading(false);
      return;
    }
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace({
          pathname: "/account",
          params: { next: `/orders/${encodeURIComponent(shortCodeValue)}` },
        });
        return;
      }
      fetchOrder().finally(() => active && setLoading(false));
    });
    return () => { active = false; };
  }, [fetchOrder, router, shortCodeValue]);

  // Poll every 15s while the order is active.
  useEffect(() => {
    if (!order || TERMINAL.includes(order.status)) return;
    const id = setInterval(() => fetchOrder(), 15_000);
    return () => clearInterval(id);
  }, [order, fetchOrder]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={s.wrapCenter}>
        <Text style={s.icon}>🔍</Text>
        <Text style={s.notFoundTitle}>Order not found</Text>
        {!!error && <Text style={s.notFoundSub}>{error}</Text>}
        <Pressable onPress={() => router.push("/orders")}>
          <Text style={s.link}>Back to orders</Text>
        </Pressable>
      </View>
    );
  }

  const currentStep = ORDER_INDEX[order.status] ?? -1;
  const isPendingPayment = order.status === "pending_payment";
  const isCancelled = order.status === "canceled" || order.status === "failed";
  const activeDelivery = order.delivery?.find(d => d.is_active) ?? order.delivery?.[0] ?? null;
  const retry = order.fulfillment_retry;
  const retryState = retry?.state;
  const retryInProgress =
    retryState === "pending" || retryState === "processing" || retryState === "retrying";
  const retryFailed = retryState === "failed";
  const sortedEvents = (order.events ?? [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }} contentContainerStyle={s.wrap}>
      <Pressable onPress={() => router.push("/orders")}>
        <Text style={s.back}>← All orders</Text>
      </Pressable>

      <View style={s.headerCard}>
        <View style={s.headerTop}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.orderTitle} numberOfLines={2}>{order.quote?.title ?? "Order"}</Text>
            <Text style={s.shortCode}>{order.short_code}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.total}>{formatIDR(order.total_idr)}</Text>
            <Text style={s.dateText}>
              {new Date(order.created_at).toLocaleDateString("id-ID", {
                day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </Text>
          </View>
        </View>

        {!!activeDelivery && (
          <View style={s.deliveryBox}>
            <Text style={s.deliveryLine}>🚀 {activeDelivery.provider} {activeDelivery.tier}</Text>
            {!!activeDelivery.driver_name && (
              <Text style={s.deliveryLine}>
                🧑‍✈️ {activeDelivery.driver_name}
                {!!activeDelivery.driver_phone && ` · ${activeDelivery.driver_phone}`}
                {!!activeDelivery.driver_plate && ` · ${activeDelivery.driver_plate}`}
              </Text>
            )}
            {!!activeDelivery.tracking_url && (
              <Pressable onPress={() => Linking.openURL(activeDelivery.tracking_url!)}>
                <Text style={s.trackingLink}>Open live tracking →</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {isPendingPayment && (
        <View style={s.warnBox}>
          <Text style={s.warnText}>
            Payment is pending. If your Midtrans window was closed, complete payment and refresh.
          </Text>
        </View>
      )}
      {retryInProgress && retry && (
        <View style={s.retryInfoBox}>
          <Text style={s.retryInfoTitle}>Courier booking retry in progress</Text>
          <Text style={s.retryInfoText}>
            Attempt {retry.attemptCount} / {Math.max(retry.maxAttempts, retry.attemptCount)}
            {retry.nextRetryAt
              ? ` · next retry ${new Date(retry.nextRetryAt).toLocaleString("id-ID")}`
              : ""}
          </Text>
          {!!retry.lastError && <Text style={s.retryInfoText}>Last error: {retry.lastError}</Text>}
        </View>
      )}
      {retryFailed && retry && !isCancelled && (
        <View style={s.retryErrorBox}>
          <Text style={s.retryErrorTitle}>Courier booking retries exhausted</Text>
          <Text style={s.retryErrorText}>
            Attempts: {retry.attemptCount}
            {retry.maxAttempts ? ` / ${retry.maxAttempts}` : ""}
          </Text>
          {!!retry.lastError && <Text style={s.retryErrorText}>Last error: {retry.lastError}</Text>}
        </View>
      )}

      {isCancelled ? (
        <View style={s.failedBox}>
          <Text style={s.failedText}>This order was {order.status}.</Text>
        </View>
      ) : (
        <View style={s.timelineCard}>
          <Text style={s.sectionTitle}>Delivery status</Text>
          <View style={{ gap: 10 }}>
            {STEPS.map((step, i) => {
              const done = i <= currentStep;
              const current = i === currentStep;
              return (
                <View key={step.status} style={s.stepRow}>
                  <View style={[s.stepDot, done ? s.stepDone : s.stepPending]}>
                    <Text style={s.stepDotText}>{done ? (current ? step.icon : "✓") : ""}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.stepLabel, !done && { color: "#9ca3af" }]}>{step.label}</Text>
                    {current && !TERMINAL.includes(order.status) && (
                      <Text style={s.stepSub}>In progress…</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {sortedEvents.length > 0 && (
        <View style={s.activityCard}>
          <Text style={s.sectionTitle}>Activity</Text>
          {sortedEvents.map((event, i) => (
            <View key={`${event.created_at}-${i}`} style={s.eventRow}>
              <Text style={s.eventTime}>
                {new Date(event.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </Text>
              <Text style={s.eventText}>
                <Text style={s.eventStatus}>{event.status}</Text>
                {event.note ? ` · ${event.note}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.footnote}>Status updates arrive from the courier in real time.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  wrapCenter: {
    flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#fff", gap: 8,
  },
  icon: { fontSize: 32 },
  notFoundTitle: { fontSize: 18, fontWeight: "600", color: "#111827" },
  notFoundSub: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  back: { color: "#6b7280", fontSize: 13, marginBottom: 2 },
  link: { color: "#0f8a4d", fontSize: 13 },
  headerCard: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 16, padding: 16, gap: 10, backgroundColor: "#fff",
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orderTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  shortCode: { fontSize: 11, color: "#9ca3af", marginTop: 4 },
  total: { color: "#0c6a3d", fontWeight: "700" },
  dateText: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
  deliveryBox: {
    borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingTop: 10, gap: 4,
  },
  deliveryLine: { fontSize: 12, color: "#4b5563" },
  trackingLink: { color: "#0f8a4d", fontSize: 12, textDecorationLine: "underline" },
  warnBox: {
    borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb",
    borderRadius: 14, padding: 12,
  },
  warnText: { color: "#92400e", fontSize: 12 },
  retryInfoBox: {
    borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb",
    borderRadius: 14, padding: 12, gap: 4,
  },
  retryInfoTitle: { color: "#92400e", fontSize: 12, fontWeight: "700" },
  retryInfoText: { color: "#92400e", fontSize: 12 },
  retryErrorBox: {
    borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2",
    borderRadius: 14, padding: 12, gap: 4,
  },
  retryErrorTitle: { color: "#b91c1c", fontSize: 12, fontWeight: "700" },
  retryErrorText: { color: "#b91c1c", fontSize: 12 },
  failedBox: {
    borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2",
    borderRadius: 14, padding: 14, alignItems: "center",
  },
  failedText: { color: "#b91c1c", fontWeight: "600" },
  timelineCard: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 16, padding: 16, gap: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#111827" },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  stepDot: {
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 2,
  },
  stepDone: { backgroundColor: "#16a45f", borderColor: "#16a45f" },
  stepPending: { backgroundColor: "#fff", borderColor: "#e5e7eb" },
  stepDotText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  stepLabel: { fontSize: 13, color: "#111827", fontWeight: "500" },
  stepSub: { fontSize: 11, color: "#16a45f", marginTop: 2 },
  activityCard: {
    borderWidth: 1, borderColor: "#f3f4f6", borderRadius: 16, padding: 16, gap: 8,
  },
  eventRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  eventTime: { color: "#9ca3af", fontSize: 11, minWidth: 42 },
  eventText: { color: "#6b7280", fontSize: 12, flex: 1 },
  eventStatus: { color: "#374151", fontWeight: "600" },
  footnote: { textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 2, marginBottom: 4 },
});
