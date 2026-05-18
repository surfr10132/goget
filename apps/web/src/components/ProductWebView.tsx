"use client";

import { formatIDR, type ProductListing } from "@goget/shared";

interface Props {
  product: Pick<ProductListing, "source" | "title" | "url" | "thumbnailUrl" | "priceIDRDisplay" | "sellerName" | "sellerCity">;
  /** Called when the user taps "I've placed my order" — advances the concierge flow. */
  onPlaced: () => void;
  /** Optional re-open label, defaults to "Open on …". */
  reopenLabel?: string;
}

const SOURCE_LABEL: Record<ProductListing["source"], string> = {
  tokopedia: "Tokopedia",
  shopee:    "Shopee",
  bukalapak: "Bukalapak",
  directory: "GoGet store",
  manual:    "marketplace",
};

// Hosts we're willing to deep-link to. Prevents a crafted URL param from
// pointing the user at an arbitrary phishing site through the GoGet UI.
const ALLOWED_HOSTS = [
  "tokopedia.com", "www.tokopedia.com",
  "shopee.co.id", "www.shopee.co.id",
  "bukalapak.com", "www.bukalapak.com",
  "goget.id", "www.goget.id",
];

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

// Marketplaces send X-Frame-Options: DENY, so embedding via <iframe> is unreliable.
// The web client opens the URL in a new tab and waits for the user to come back.
export function ProductWebView({ product, onPlaced, reopenLabel }: Props) {
  const label = SOURCE_LABEL[product.source];
  const safe = isAllowedHost(product.url);
  function open() {
    if (!safe) return;
    window.open(product.url, "_blank", "noopener,noreferrer");
  }
  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex gap-4 p-5">
        {product.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnailUrl}
            alt=""
            className="w-20 h-20 rounded-xl object-cover bg-gray-100 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
          <p className="font-semibold text-sm line-clamp-2">{product.title}</p>
          {product.sellerName && (
            <p className="text-xs text-gray-500 mt-0.5">
              🏪 {product.sellerName}{product.sellerCity ? ` · ${product.sellerCity}` : ""}
            </p>
          )}
          {typeof product.priceIDRDisplay === "number" && (
            <p className="text-sm font-bold text-brand-700 mt-1">
              {formatIDR(product.priceIDRDisplay)} <span className="text-xs font-normal text-gray-400">as listed</span>
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-2">
        <button
          onClick={open}
          disabled={!safe}
          className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {reopenLabel ?? `Open on ${label}`}
        </button>
        {!safe && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 text-center">
            This product link isn&apos;t from a supported marketplace. Skip the handoff and schedule pickup directly.
          </p>
        )}
        <p className="text-xs text-gray-500 text-center">
          Opens in a new tab. Pay the seller directly, then come back to schedule pickup.
        </p>
        <button
          onClick={onPlaced}
          className="w-full py-3 rounded-xl border border-brand-500 text-brand-600 text-sm font-semibold hover:bg-brand-50"
        >
          ✓ I&apos;ve placed my order
        </button>
      </div>
    </div>
  );
}
