"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { LocationPicker } from "@/components/LocationPicker";
import { formatDistance, distanceKm, type LatLng } from "@/lib/geo";
import { formatIDR } from "@goget/shared";

interface SourcedItem {
  source: string;
  externalUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;
  priceIDR: number;
  availableQty?: number;
  merchantName?: string;
  pickupAddress?: string;
  pickupCity?: string;
  pickupGeo?: { lat: number; lng: number } | null;
  distanceKm?: number;
}
const MAX_RADIUS_MILES = 35;
const MAX_DISTANCE_KM = Number((MAX_RADIUS_MILES * 1.60934).toFixed(2));
const MAX_RADIUS_LABEL = `${MAX_RADIUS_MILES} miles (${Math.round(MAX_DISTANCE_KM)} km)`;


// ── Main search inner ──────────────────────────────────────────────────────

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const referenceUrl = params.get("referenceUrl") ?? "";

  const [step, setStep] = useState<"locate" | "results">("locate");
  const [location, setLocation] = useState<{ loc: LatLng; label: string } | null>(null);
  const [items, setItems] = useState<SourcedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location) return;
    runSearch(location.loc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  async function runSearch(near: LatLng) {
    setStep("results");
    setLoading(true);
    setWebLoading(true);
    setError(null);
    setItems([]);

    const cityLabel = location?.label ?? "";
    const payload = {
      query: q,
      referenceUrl: referenceUrl || undefined,
      near,
      maxDistanceKm: MAX_DISTANCE_KM,
      city: cityLabel,
    };

    const requests = [
      fetch("/api/sourcing/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(r => r.json())
        .then(data => setItems(prev => mergeItems(prev, data.items ?? []))),
      fetch("/api/sourcing/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(r => r.json())
        .then(data => {
          if (data?.error && data.error !== "no_api_key") {
            setError("Could not fetch website results right now. Please retry.");
          }
          setItems(prev => mergeItems(prev, data.items ?? []));
        }),
    ];

    Promise.allSettled(requests)
      .then((results) => {
        if (results.every((r) => r.status === "rejected")) {
          setError("Could not fetch local store results right now. Please retry.");
        }
      })
      .finally(() => {
        setWebLoading(false);
        setLoading(false);
      });
  }

  function getSourcePreviewUrl(item: SourcedItem): string | undefined {
    if (item.imageUrl) return item.imageUrl;
    if (!item.externalUrl) return undefined;
    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(item.externalUrl)}?w=800`;
  }

  function mergeItems(existing: SourcedItem[], incoming: SourcedItem[]): SourcedItem[] {
    // Dedupe by store name + source so the same merchant isn't listed twice,
    // but items from different stores with the same product title are kept.
    const seen = new Set(
      existing.map(i => `${(i.merchantName ?? "").toLowerCase()}|${i.source}`)
    );
    const fresh = incoming.filter(i => {
      const key = `${(i.merchantName ?? "").toLowerCase()}|${i.source}`;
      return !seen.has(key);
    });
    return [...existing, ...fresh].sort((a, b) => {
      const da = a.distanceKm ?? 9999;
      const db = b.distanceKm ?? 9999;
      return da - db;
    });
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">&ldquo;{q}&rdquo;</h1>
          {location && step === "results" && (
            <p className="text-sm text-gray-500 mt-0.5">
              Showing stores within {MAX_RADIUS_LABEL} of <span className="font-medium">{location.label}</span>
              {" "}·{" "}
              <button className="text-brand-600 underline" onClick={() => { setLocation(null); setItems([]); setStep("locate"); }}>
                start over
              </button>
            </p>
          )}
        </div>
        <button onClick={() => router.push("/")} className="text-sm text-gray-500 hover:text-gray-900">
          ← New search
        </button>
      </div>


      {/* Step: Location picker */}
      {step === "locate" && (
        <LocationPicker onLocation={(loc, label) => setLocation({ loc, label })} />
      )}

      {/* Loading skeletons */}
      {loading && <SkeletonGrid />}

      {/* In-progress banners */}
      {!loading && webLoading && step === "results" && (
        <div className="flex items-center gap-2 text-sm text-gray-500 animate-pulse">
          <span className="inline-block w-3 h-3 rounded-full bg-brand-400 animate-ping" />
          Searching local stores and websites…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={() => location && runSearch(location.loc)}
            className="shrink-0 text-xs font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* No results */}
      {!loading && !webLoading && !error && step === "results" && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center space-y-2">
          <p className="font-medium">No stores found within {MAX_RADIUS_LABEL}</p>
          <p className="text-sm text-gray-500">Try a different search term, or change your location.</p>
        </div>
      )}

      {/* Results grid */}
      {items.length > 0 && (
        <>
          <p className="text-sm text-gray-500">
            {items.length} result{items.length !== 1 ? "s" : ""} found within {MAX_RADIUS_LABEL}
            {webLoading && (
              <span className="ml-2 text-brand-500 animate-pulse">· finding more…</span>
            )}
          </p>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((it, i) => {
              const dist = it.distanceKm ?? (
                it.pickupGeo && location ? distanceKm(location.loc, it.pickupGeo) : null
              );
              const previewImageUrl = getSourcePreviewUrl(it);
              return (
                <li
                  key={`${it.source}-${i}`}
                  className="rounded-2xl border border-gray-100 hover:border-brand-400 transition overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-square bg-gray-50">
                    {previewImageUrl ? (
                      it.externalUrl ? (
                        <a
                          href={it.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute inset-0 block group"
                          aria-label={`Open ${it.title} on source site`}
                        >
                          <Image
                            src={previewImageUrl}
                            alt={it.title}
                            fill
                            priority={i < 3}
                            className="object-cover group-hover:scale-[1.02] transition-transform"
                            sizes="(max-width: 640px) 100vw, 33vw"
                            unoptimized
                          />
                          <span className="absolute left-2 bottom-2 text-[11px] font-semibold text-white bg-black/55 px-2 py-1 rounded-full">
                            View source listing
                          </span>
                        </a>
                      ) : (
                        <Image
                          src={previewImageUrl}
                          alt={it.title}
                          fill
                          priority={i < 3}
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, 33vw"
                          unoptimized
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-4xl">📦</div>
                    )}
                    {dist !== null && (
                      <span className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-200 shadow-sm">
                        {formatDistance(dist)}
                      </span>
                    )}
                  </div>

                  <div className="p-4 flex flex-col flex-1 gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] uppercase tracking-wider font-medium ${
                        it.source === "web" ? "text-blue-400"
                        : it.source === "nearby" ? "text-green-500"
                        : it.source === "directory" ? "text-purple-400"
                        : "text-gray-400"
                      }`}>
                        {it.source === "web" ? "🌐 web"
                         : it.source === "nearby" ? "📍 nearby"
                         : it.source === "directory" ? "🗂 directory"
                         : it.source}
                      </span>
                      {it.availableQty !== undefined && it.availableQty <= 3 && (
                        <span className="text-[10px] text-orange-600 font-medium bg-orange-50 px-1.5 py-0.5 rounded-full">
                          {it.availableQty} left
                        </span>
                      )}
                      {it.externalUrl && it.source !== "directory" && (
                        <a
                          href={it.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-gray-400 hover:text-blue-500 underline ml-auto"
                          onClick={e => e.stopPropagation()}
                        >
                          {it.source === "nearby" ? "maps" : "view store"}
                        </a>
                      )}
                    </div>
                    <p className="font-medium text-sm line-clamp-2 flex-1">{it.title}</p>
                    <p className="text-brand-700 font-bold text-base">{formatIDR(it.priceIDR)}</p>
                    {it.merchantName && (
                      <div className="text-xs text-gray-500 line-clamp-1">
                        🏪 {it.merchantName}
                        {(it.pickupCity || it.pickupAddress) && (
                          <span className="ml-1">
                            · {it.pickupCity ?? it.pickupAddress?.split(",").pop()?.trim()}
                          </span>
                        )}
                      </div>
                    )}
                    {(() => {
                      const marketplaceSource =
                        it.source === "tokopedia" || it.source === "shopee" || it.source === "bukalapak";
                      const sourceLabel =
                        it.source === "tokopedia" ? "Tokopedia"
                        : it.source === "shopee"  ? "Shopee"
                        : it.source === "bukalapak" ? "Bukalapak"
                        : it.source === "web"     ? "the store"
                        : "the store";
                      function goCheckout() {
                        const p = new URLSearchParams({
                          source: marketplaceSource ? it.source : "manual",
                          title: it.title,
                          price: String(it.priceIDR),
                          merchant: it.merchantName ?? "",
                          pickupAddress: it.pickupAddress ?? "",
                        });
                        if (it.externalUrl) p.set("sourceUrl", it.externalUrl);
                        if (it.imageUrl) p.set("thumbnail", it.imageUrl);
                        if (it.pickupGeo) {
                          p.set("pickupLat", String(it.pickupGeo.lat));
                          p.set("pickupLng", String(it.pickupGeo.lng));
                        }
                        if (location) {
                          p.set("dropLat", String(location.loc.lat));
                          p.set("dropLng", String(location.loc.lng));
                        }
                        router.push(`/checkout?${p.toString()}`);
                      }
                      // Single side effect per click: navigate to /checkout,
                      // which renders ProductWebView and lets the user open
                      // the marketplace tab from there. Popup blockers and
                      // duplicate code paths were the issue with opening here.
                      return (
                        <button
                          onClick={goCheckout}
                          className="mt-2 w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold"
                        >
                          {marketplaceSource && it.externalUrl ? `Order on ${sourceLabel}` : "Schedule pickup"}
                        </button>
                      );
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
          <div className="aspect-square bg-gray-100" />
          <div className="p-4 space-y-2">
            <div className="h-2.5 bg-gray-100 rounded w-1/4" />
            <div className="h-4 bg-gray-100 rounded w-5/6" />
            <div className="h-4 bg-gray-100 rounded w-3/6" />
            <div className="h-3 bg-gray-100 rounded w-2/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function SearchPage() {
  return <Suspense><SearchInner /></Suspense>;
}
