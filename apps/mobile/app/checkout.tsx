import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, Image,
} from "react-native";
import {
  computeFees,
  formatIDR,
  type ConciergeOrderInput,
  type ConciergeOrderResult,
  type MarketplacePurchase,
  type ProductListing,
} from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

interface Rate {
  provider: "gosend" | "grab";
  tier: "instant" | "sameday" | "car_instant" | "car_sameday";
  label: string;
  priceIDR: number;
  etaMinutes: number;
  distanceKm: number;
  rateToken: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

type Step = "confirm" | "address" | "courier" | "review" | "done";
type OrderCreateIdempotencyContext = { fingerprint: string; key: string };

const SOURCE_MAP: Record<string, ProductListing["source"]> = {
  tokopedia: "tokopedia",
  shopee: "shopee",
  bukalapak: "bukalapak",
  directory: "directory",
  web: "manual",
  manual: "manual",
  nearby: "manual",
};

function createIdempotencyKey() {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function Checkout() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string; title?: string; price?: string; merchant?: string;
    sourceUrl?: string; thumbnail?: string; placed?: string;
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
    dropLat?: string; dropLng?: string;
  }>();

  const productSource = SOURCE_MAP[params.source ?? "manual"] ?? "manual";
  const title = params.title ?? "Item";
  const priceDisplay = Number(params.price ?? 0);
  const thumbnail = params.thumbnail ?? "";
  const merchant = params.merchant ?? "";
  const sourceUrl = params.sourceUrl ?? "";
  const pickupAddress = params.pickupAddress ?? "";
  const pickupLat = Number(params.pickupLat);
  const pickupLng = Number(params.pickupLng);
  const dropLat = Number(params.dropLat);
  const dropLng = Number(params.dropLng);
  const hasGeo = !!(pickupLat && pickupLng && dropLat && dropLng);
  const requiresHandoff = Boolean(sourceUrl) && params.placed !== "1";

  // Auth gate.
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace({ pathname: "/account", params: { next: "/checkout" } });
        return;
      }
      // If a marketplace URL is present and the user hasn't been through the
      // WebView handoff yet, redirect them there first. autoOpen=1 makes the
      // product-webview screen fire openBrowserAsync once on mount.
      if (requiresHandoff) {
        router.replace({ pathname: "/product-webview", params: { ...params, autoOpen: "1" } });
        return;
      }
      setAuthChecked(true);
    });
    return () => { active = false; };
  }, [router, requiresHandoff, params]);

  const [step, setStep] = useState<Step>("confirm");
  const [orderRef, setOrderRef] = useState("");
  const [declared, setDeclared] = useState(priceDisplay > 0 ? String(priceDisplay) : "");
  const declaredNum = parseInt(declared.replace(/\D/g, ""), 10);
  const declaredValid = Number.isFinite(declaredNum) && declaredNum > 0;

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [notes, setNotes] = useState("");

  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<ConciergeOrderResult | null>(null);
  const idempotencyContextRef = useRef<OrderCreateIdempotencyContext | null>(null);

  useEffect(() => {
    if (step !== "courier" || !hasGeo) return;
    setRatesLoading(true);
    setRatesError(null);
    api<{ rates: Rate[]; distanceKm: number }>("/api/quotes/preview-rates", {
      method: "POST",
      body: JSON.stringify({
        pickup: { lat: pickupLat, lng: pickupLng },
        dropoff: { lat: dropLat, lng: dropLng },
        itemValueIDR: declaredValid ? declaredNum : 0,
      }),
    })
      .then(data => setRates(data.rates ?? []))
      .catch(e => setRatesError(e.message))
      .finally(() => setRatesLoading(false));
  }, [step, hasGeo, pickupLat, pickupLng, dropLat, dropLng, declaredNum, declaredValid]);

  const fees = useMemo(
    () => (selectedRate ? computeFees({ courierFeeIDR: selectedRate.priceIDR }) : null),
    [selectedRate],
  );

  async function placeOrder() {
    if (!selectedRate || !fees || !declaredValid) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const purchase: MarketplacePurchase = {
        source: productSource,
        sourceUrl: sourceUrl || `https://goget.id/manual/${encodeURIComponent(title)}`,
        title,
        thumbnailUrl: params.thumbnail || undefined,
        priceIDRDeclared: declaredNum,
        marketplaceOrderRef: orderRef.trim() || undefined,
      };
      const body: ConciergeOrderInput = {
        product: purchase,
        pickup: {
          address: pickupAddress || merchant || "Pickup",
          geo: { lat: pickupLat, lng: pickupLng },
        },
        dropoff: {
          address: dropoffAddress,
          geo: { lat: dropLat, lng: dropLng },
          city: "Jakarta",
          province: "DKI Jakarta",
        },
        recipient: { name: recipientName, phone: recipientPhone },
        courier: {
          provider: selectedRate.provider,
          tier: selectedRate.tier,
          priceIDR: selectedRate.priceIDR,
          etaMinutes: selectedRate.etaMinutes,
          distanceKm: selectedRate.distanceKm,
          rateToken: selectedRate.rateToken,
        },
        notes: notes.trim() || undefined,
      };
      const requestFingerprint = JSON.stringify(body);
      const existingContext = idempotencyContextRef.current;
      const idempotencyKey =
        existingContext && existingContext.fingerprint === requestFingerprint
          ? existingContext.key
          : createIdempotencyKey();
      idempotencyContextRef.current = { fingerprint: requestFingerprint, key: idempotencyKey };
      const data = await api<ConciergeOrderResult>("/api/orders/concierge", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });
      setOrderResult(data);
      setStep("done");
      if (data.payment.redirectUrl) {
        try {
          await WebBrowser.openBrowserAsync(data.payment.redirectUrl, {
            toolbarColor: "#16a45f",
            controlsColor: "#ffffff",
          });
        } catch {
          // Ignore browser handoff failures; user can still track/retry from orders.
        }
      }
    } catch (error: unknown) {
      setPlaceError(toErrorMessage(error));
    } finally {
      setPlacing(false);
    }
  }

  if (!authChecked) {
    return (
      <View style={[s.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (step === "done" && orderResult) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#fff" }} contentContainerStyle={s.container}>
        <Text style={{ fontSize: 48, textAlign: "center" }}>🎉</Text>
        <Text style={s.h1}>Pickup scheduled!</Text>
        <View style={s.summary}>
          <Row label="Order" value={orderResult.order.shortCode} />
          <Row label="Item" value={title} />
          <Row label="Total to GoGet" value={formatIDR(orderResult.order.totalIDR)} bold />
        </View>
        <Pressable
          onPress={() => router.push({ pathname: "/orders/[shortCode]", params: { shortCode: orderResult.order.shortCode } })}
          style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={s.primaryBtnText}>Track my order</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/")}>
          <Text style={s.link}>Find something else</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }} contentContainerStyle={s.container}>
      {!!thumbnail && (
        <Image
          source={{ uri: thumbnail }}
          style={s.photo}
          resizeMode="cover"
        />
      )}
      <View>
        <Text style={s.h1} numberOfLines={2}>{title}</Text>
        {merchant ? <Text style={s.meta}>🏪 {merchant}</Text> : null}
      </View>

      {step === "confirm" && (
        <View style={{ gap: 12 }}>
          <Text style={s.stepHeading}>1 · Confirm your purchase</Text>
          <Field
            label="Marketplace order/invoice (optional)"
            value={orderRef}
            onChangeText={setOrderRef}
            placeholder="e.g. INV/20260517/XXX/123"
          />
          <Field
            label="Declared item value (Rp) *"
            value={declared}
            onChangeText={v => setDeclared(v.replace(/\D/g, "").slice(0, 12))}
            keyboardType="numeric"
            placeholder="250000"
          />
          <Pressable
            disabled={!declaredValid}
            onPress={() => setStep("address")}
            style={({ pressed }) => [s.primaryBtn, !declaredValid && s.disabled, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      )}

      {step === "address" && (
        <View style={{ gap: 12 }}>
          <Text style={s.stepHeading}>2 · Pickup &amp; delivery</Text>
          <View style={s.muted}>
            <Text style={s.mutedText}>📦 Pickup: {pickupAddress || merchant || "Seller location"}</Text>
          </View>
          <Field label="Recipient name" value={recipientName} onChangeText={setRecipientName} placeholder="Budi Santoso" />
          <Field label="WhatsApp / phone" value={recipientPhone} onChangeText={setRecipientPhone} placeholder="+62 812 3456 7890" keyboardType="phone-pad" />
          <Field label="Delivery address" value={dropoffAddress} onChangeText={setDropoffAddress} placeholder="Jl. Sudirman No. 1" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Receipt under my name" />
          <Pressable
            disabled={!(recipientName && recipientPhone && dropoffAddress)}
            onPress={() => setStep("courier")}
            style={({ pressed }) => [
              s.primaryBtn,
              !(recipientName && recipientPhone && dropoffAddress) && s.disabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      )}

      {step === "courier" && (
        <View style={{ gap: 12 }}>
          <Text style={s.stepHeading}>3 · Choose courier</Text>
          {!hasGeo && (
            <View style={s.warn}>
              <Text style={s.warnText}>
                Pickup / delivery coordinates missing — go back to search and pick a store with a location.
              </Text>
            </View>
          )}
          {ratesLoading && <ActivityIndicator />}
          {ratesError && (
            <View style={s.err}><Text style={s.errText}>{ratesError}</Text></View>
          )}
          {rates.map(r => {
            const sel = selectedRate?.rateToken === r.rateToken;
            return (
              <Pressable
                key={r.rateToken}
                onPress={() => setSelectedRate(r)}
                style={[s.rate, sel && s.rateSelected]}
              >
                <View>
                  <Text style={s.rateLabel}>{r.label}</Text>
                  <Text style={s.eta}>
                    ~{r.etaMinutes < 60 ? `${r.etaMinutes} min` : `${Math.floor(r.etaMinutes / 60)}h ${r.etaMinutes % 60}min`}
                    {" · "}{r.distanceKm.toFixed(1)} km
                  </Text>
                </View>
                <Text style={s.ratePrice}>{formatIDR(r.priceIDR)}</Text>
              </Pressable>
            );
          })}
          {selectedRate && (
            <Pressable
              onPress={() => setStep("review")}
              style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </Pressable>
          )}
        </View>
      )}

      {step === "review" && fees && selectedRate && declaredValid && (
        <View style={{ gap: 12 }}>
          <Text style={s.stepHeading}>4 · Review &amp; pay</Text>
          <View style={s.summary}>
            <Text style={s.mutedText}>📦 {recipientName} · {recipientPhone}</Text>
            <Text style={s.mutedText}>📍 {dropoffAddress}</Text>
            <Text style={s.mutedText}>🚀 {selectedRate.label}</Text>
            <Text style={s.mutedText}>💳 Paid on marketplace: {formatIDR(declaredNum)}</Text>
          </View>
          <View style={s.feeBox}>
            <Row label="Courier fee" value={formatIDR(fees.courierFeeIDR)} />
            <Row label="GoGet service fee" value={formatIDR(fees.serviceFeeIDR)} />
            <Row label="PPN" value={formatIDR(fees.taxIDR)} />
            <View style={s.divider} />
            <Row label="Total to GoGet" value={formatIDR(fees.totalIDR)} bold />
          </View>
          {placeError && <View style={s.err}><Text style={s.errText}>{placeError}</Text></View>}
          <Pressable
            disabled={placing}
            onPress={placeOrder}
            style={({ pressed }) => [s.primaryBtn, placing && s.disabled, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.primaryBtnText}>{placing ? "Placing order…" : `Pay ${formatIDR(fees.totalIDR)}`}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: "default" | "numeric" | "phone-pad";
}) {
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType}
        style={s.input}
      />
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, bold && s.rowBold]}>{label}</Text>
      <Text style={[s.rowValue, bold && s.rowBold]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  h1: { fontSize: 20, fontWeight: "700", color: "#111827" },
  meta: { fontSize: 14, color: "#6b7280", marginTop: 2 },
  stepHeading: { fontSize: 14, fontWeight: "700", color: "#111827" },
  fieldLabel: { fontSize: 12, fontWeight: "500", color: "#4b5563", marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
  },
  photo: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
  },
  muted: { backgroundColor: "#f9fafb", borderRadius: 12, padding: 12 },
  mutedText: { fontSize: 13, color: "#4b5563" },
  rate: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#fff",
  },
  rateSelected: { borderColor: "#16a45f", backgroundColor: "#eef9f3" },
  rateLabel: { fontWeight: "500", fontSize: 14 },
  ratePrice: { fontWeight: "700" },
  eta: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  feeBox: { backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, gap: 6 },
  divider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 4 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { color: "#4b5563", fontSize: 14 },
  rowValue: { fontSize: 14 },
  rowBold: { fontWeight: "700", fontSize: 15, color: "#000" },
  summary: { borderRadius: 16, borderWidth: 1, borderColor: "#f3f4f6", padding: 16, gap: 6 },
  primaryBtn: {
    backgroundColor: "#16a45f", borderRadius: 14, paddingVertical: 14, alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  link: { color: "#0f8a4d", textAlign: "center", marginTop: 4 },
  warn: { backgroundColor: "#fffbeb", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#fde68a" },
  warnText: { color: "#92400e", fontSize: 13 },
  err: { backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errText: { color: "#b91c1c", fontSize: 13 },
});
