"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  computeFees,
  formatIDR,
  type ConciergeOrderInput,
  type ConciergeOrderResult,
  type MarketplacePurchase,
  type ProductListing,
} from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";
import { loadSession } from "@/lib/auth-session";
import { OrderConfirmation } from "@/components/OrderConfirmation";
type Step = "confirm" | "address" | "courier" | "review" | "done";
type OrderCreateIdempotencyContext = { fingerprint: string; key: string };

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

const SOURCE_PARAM_TO_PRODUCT: Record<string, ProductListing["source"]> = {
  tokopedia: "tokopedia",
  shopee:    "shopee",
  bukalapak: "bukalapak",
  directory: "directory",
  web:       "manual",
  manual:    "manual",
  nearby:    "manual",
};

function createIdempotencyKey() {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function CheckoutInner() {
  const params = useSearchParams();
  const router = useRouter();

  const productSource = SOURCE_PARAM_TO_PRODUCT[params.get("source") ?? "manual"] ?? "manual";
  const title = params.get("title") ?? "Item";
  const priceDisplay = Number(params.get("price") ?? 0);
  const merchant = params.get("merchant") ?? "";
  const pickupAddress = params.get("pickupAddress") ?? "";
  const sourceUrl = params.get("sourceUrl") ?? "";
  const thumbnail = params.get("thumbnail") ?? "";
  const pickupLat = Number(params.get("pickupLat"));
  const pickupLng = Number(params.get("pickupLng"));
  const dropLat = Number(params.get("dropLat"));
  const dropLng = Number(params.get("dropLng"));
  const hasGeo = !!(pickupLat && pickupLng && dropLat && dropLng);

  // Auth gate.
  const [authChecked, setAuthChecked] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        const demo = loadSession();
        if (demo?.demo) { setIsDemo(true); setAuthChecked(true); return; }
        router.replace(`/account?next=${encodeURIComponent(`/checkout?${params.toString()}`)}`);
        return;
      }
      setAuthChecked(true);
    });
    return () => { active = false; };
  }, [params, router]);

  // Concierge flow state.
  const [step, setStep] = useState<Step>("confirm");
  const [purchase, setPurchase] = useState<MarketplacePurchase | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  // Rates.
  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  // Order placement.
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<ConciergeOrderResult | null>(null);
  const [notes, setNotes] = useState("");
  const idempotencyContextRef = useRef<OrderCreateIdempotencyContext | null>(null);

  useEffect(() => {
    if (step !== "courier") return;
    if (!hasGeo) return;
    setRatesLoading(true);
    setRatesError(null);
    api<{ rates: Rate[]; distanceKm: number }>("/api/quotes/preview-rates", {
      method: "POST",
      body: JSON.stringify({
        pickup: { lat: pickupLat, lng: pickupLng },
        dropoff: { lat: dropLat, lng: dropLng },
        // declared value is used for insurance bias; safe to pass 0 if unknown
        itemValueIDR: purchase?.priceIDRDeclared ?? 0,
      }),
    })
      .then(data => { setRates(data.rates ?? []); setDistanceKm(data.distanceKm ?? null); })
      .catch(e => setRatesError(e.message))
      .finally(() => setRatesLoading(false));
  }, [step, hasGeo, pickupLat, pickupLng, dropLat, dropLng, purchase?.priceIDRDeclared]);

  const fees = useMemo(
    () => (selectedRate ? computeFees({ courierFeeIDR: selectedRate.priceIDR }) : null),
    [selectedRate],
  );

  async function placeOrder() {
    if (!selectedRate || !fees || !purchase) return;
    setPlacing(true);
    setPlaceError(null);
    try {
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
      if (data.payment.redirectUrl) window.location.href = data.payment.redirectUrl;
    } catch (error: unknown) {
      setPlaceError(toErrorMessage(error));
    } finally {
      setPlacing(false);
    }
  }

  if (!authChecked) {
    return <div className="max-w-lg mx-auto text-center py-16 text-sm text-gray-500">Checking your session…</div>;
  }

  if (step === "done" && orderResult) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-5 py-10">
        <div className="text-5xl">🎉</div>
        <h1 className="text-2xl font-bold">Pickup scheduled!</h1>
        <div className="rounded-2xl border border-gray-100 p-5 text-left space-y-2 text-sm">
          <Row label="Order" value={orderResult.order.shortCode} />
          <Row label="Item" value={title} />
          <Row label="Total to GoGet" value={formatIDR(orderResult.order.totalIDR)} bold />
        </div>
        {!orderResult.payment.redirectUrl && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
            Payment link was not returned. Open the order detail to retry.
          </div>
        )}
        <button
          onClick={() => router.push(`/orders/${orderResult.order.shortCode}`)}
          className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold"
        >
          Track my order
        </button>
        <button onClick={() => router.push("/")} className="w-full py-2 text-sm text-gray-500 hover:text-gray-800">
          Find something else
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {isDemo && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          Demo mode: placing an order will fail with 401. Sign in for a real session.
        </div>
      )}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        GoGet supports local businesses only. Pay the merchant directly first, then pay GoGet for delivery.
      </div>

      <div className="flex items-start gap-3">
        {thumbnail && (
          <Image
            src={thumbnail}
            alt={title}
            width={80}
            height={80}
            className="w-20 h-20 rounded-xl object-cover bg-gray-100 border border-gray-200 shrink-0"
            unoptimized
          />
        )}
        <div className="flex-1 flex items-start justify-between gap-3">
          <div>
          <h1 className="text-xl font-bold line-clamp-2">{title}</h1>
          {merchant && <p className="text-sm text-gray-500 mt-0.5">🏪 {merchant}</p>}
          {distanceKm !== null && (
            <p className="text-sm text-gray-500">📍 {distanceKm.toFixed(1)} km from you</p>
          )}
          </div>
          {priceDisplay > 0 && (
            <div className="text-right shrink-0">
              <div className="text-gray-500 text-xs">as listed</div>
              <div className="text-brand-700 font-bold text-lg">{formatIDR(priceDisplay)}</div>
            </div>
          )}
          </div>
      </div>


      {step === "confirm" && (
        <section className="space-y-4">
          <h2 className="font-semibold">1 · Confirm merchant payment</h2>
          <OrderConfirmation
            initial={{
              source: productSource,
              sourceUrl: sourceUrl || `https://goget.id/manual/${encodeURIComponent(title)}`,
              title,
              thumbnailUrl: thumbnail || undefined,
              priceIDRDisplay: priceDisplay || undefined,
            }}
            onConfirm={p => { setPurchase(p); setStep("address"); }}
          />
        </section>
      )}

      {step === "address" && purchase && (
        <section className="space-y-4">
          <h2 className="font-semibold">2 · Pickup &amp; delivery</h2>
          <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
            <p>📦 Pickup: <span className="text-gray-900">{pickupAddress || merchant || "Seller location"}</span></p>
          </div>
          <Field label="Recipient name" value={recipientName} onChange={setRecipientName} placeholder="Budi Santoso" />
          <Field label="WhatsApp / phone" value={recipientPhone} onChange={setRecipientPhone} placeholder="+62 812 3456 7890" inputMode="tel" />
          <Field label="Delivery address" value={dropoffAddress} onChange={setDropoffAddress} placeholder="Jl. Sudirman No. 1, Jakarta Pusat" />
          <Field label="Notes for the runner (optional)" value={notes} onChange={setNotes} placeholder="Receipt is under my name" />
          <button
            disabled={!(recipientName && recipientPhone && dropoffAddress)}
            onClick={() => setStep("courier")}
            className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold disabled:opacity-50"
          >
            Continue
          </button>
        </section>
      )}

      {step === "courier" && purchase && (
        <section className="space-y-4">
          <h2 className="font-semibold">3 · Choose courier</h2>
          {!hasGeo && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
              Pickup / delivery coordinates missing — go back to search and pick a store with a location.
            </p>
          )}
          {ratesLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          )}
          {ratesError && <div className="text-red-600 text-sm bg-red-50 rounded-xl p-3">{ratesError}</div>}
          {rates.map(r => {
            const sel = selectedRate?.rateToken === r.rateToken;
            return (
              <label
                key={r.rateToken}
                className={`flex items-center justify-between gap-3 p-4 rounded-xl border cursor-pointer transition ${
                  sel ? "border-brand-500 bg-brand-50 ring-4 ring-brand-100" : "border-gray-200 hover:border-brand-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input type="radio" name="courier" checked={sel} onChange={() => setSelectedRate(r)} className="accent-brand-500" />
                  <div>
                    <div className="font-medium text-sm">{r.label}</div>
                    <div className="text-xs text-gray-500">
                      ~{r.etaMinutes < 60 ? `${r.etaMinutes} min` : `${Math.floor(r.etaMinutes / 60)}h ${r.etaMinutes % 60}min`}
                      {" · "}{r.distanceKm.toFixed(1)} km
                    </div>
                  </div>
                </div>
                <div className="font-bold text-sm">{formatIDR(r.priceIDR)}</div>
              </label>
            );
          })}
          {selectedRate && (
            <button onClick={() => setStep("review")} className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold">
              Continue
            </button>
          )}
        </section>
      )}

      {step === "review" && fees && selectedRate && purchase && (
        <section className="space-y-4">
          <h2 className="font-semibold">4 · Review &amp; pay</h2>
          <div className="text-sm space-y-1 text-gray-600">
            <div>📦 <span className="text-gray-900">{recipientName}</span> · {recipientPhone}</div>
            <div>📍 {dropoffAddress}</div>
            <div>🚀 {selectedRate.label} · ~{selectedRate.etaMinutes} min</div>
            <div>💳 Item paid to merchant: {formatIDR(purchase.priceIDRDeclared)}</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 space-y-2 text-sm">
            <Row label="Courier fee" value={formatIDR(fees.courierFeeIDR)} />
            <Row label="GoGet service fee" value={formatIDR(fees.serviceFeeIDR)} />
            <Row label="PPN" value={formatIDR(fees.taxIDR)} />
            <div className="border-t border-gray-200 pt-2 mt-1">
              <Row label="Total to GoGet" value={formatIDR(fees.totalIDR)} bold />
            </div>
            <p className="text-[11px] text-gray-500 pt-1">
              You already paid {formatIDR(purchase.priceIDRDeclared)} to the local merchant.
            </p>
          </div>
          {placeError && <div className="text-red-600 text-sm bg-red-50 rounded-xl p-3">{placeError}</div>}
          <button
            onClick={placeOrder}
            disabled={placing}
            className="w-full py-3.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-base disabled:opacity-60"
          >
            {placing ? "Placing order…" : `Pay ${formatIDR(fees.totalIDR)} for delivery`}
          </button>
        </section>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, inputMode }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
      />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold text-base" : ""}`}>
      <span className={bold ? "" : "text-gray-600"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function CheckoutPage() {
  return <Suspense><CheckoutInner /></Suspense>;
}
