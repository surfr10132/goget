"use client";

import { useState } from "react";
import type { MarketplacePurchase } from "@goget/shared";

interface Props {
  initial: {
    source: MarketplacePurchase["source"];
    sourceUrl: string;
    title: string;
    thumbnailUrl?: string;
    priceIDRDisplay?: number;
  };
  onConfirm: (purchase: MarketplacePurchase) => void;
}

/**
 * Step the user lands on after they tap "I've placed my order" on the
 * ProductWebView handoff. Captures the marketplace order reference and a
 * declared item value (used for insurance + receipt match on pickup).
 */
export function OrderConfirmation({ initial, onConfirm }: Props) {
  const [orderRef, setOrderRef] = useState("");
  const [declared, setDeclared] = useState<string>(
    initial.priceIDRDisplay ? String(initial.priceIDRDisplay) : "",
  );
  const [confirmedMerchantPayment, setConfirmedMerchantPayment] = useState(false);
  const [touched, setTouched] = useState(false);

  const declaredNum = parseInt(declared.replace(/\D/g, ""), 10);
  const declaredValid = Number.isFinite(declaredNum) && declaredNum > 0;

  function submit() {
    setTouched(true);
    if (!declaredValid || !confirmedMerchantPayment) return;
    onConfirm({
      source: initial.source,
      sourceUrl: initial.sourceUrl,
      title: initial.title,
      thumbnailUrl: initial.thumbnailUrl,
      priceIDRDeclared: declaredNum,
      marketplaceOrderRef: orderRef.trim() || undefined,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Merchant order/invoice number <span className="text-gray-400">(optional)</span>
        </label>
        <input
          value={orderRef}
          onChange={e => setOrderRef(e.target.value)}
          placeholder="e.g. INV/20260517/XXX/123"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
        <p className="text-xs text-gray-500 mt-1">
          Helps the runner match the package at pickup.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Declared item value (Rp) <span className="text-red-500">*</span>
        </label>
        <input
          value={declared}
          onChange={e => setDeclared(e.target.value.replace(/\D/g, "").slice(0, 12))}
          placeholder="250000"
          inputMode="numeric"
          className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-4 ${
            touched && !declaredValid
              ? "border-red-300 focus:border-red-500 focus:ring-red-100"
              : "border-gray-200 focus:border-brand-500 focus:ring-brand-100"
          }`}
        />
        <p className="text-xs text-gray-500 mt-1">
          Used for delivery insurance and to match the receipt at pickup.
        </p>
        {touched && !declaredValid && (
          <p className="text-xs text-red-600 mt-1">Enter the amount you paid the local merchant.</p>
        )}
      </div>
      <label className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={confirmedMerchantPayment}
          onChange={e => setConfirmedMerchantPayment(e.target.checked)}
          className="mt-0.5 accent-brand-500"
        />
        <span>I confirm I already paid the local merchant directly.</span>
      </label>
      {touched && !confirmedMerchantPayment && (
        <p className="text-xs text-red-600 -mt-2">Please confirm merchant payment before continuing.</p>
      )}

      <button
        disabled={!declaredValid || !confirmedMerchantPayment}
        onClick={submit}
        className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-50"
      >
        Continue to pickup &amp; delivery
      </button>
    </div>
  );
}
