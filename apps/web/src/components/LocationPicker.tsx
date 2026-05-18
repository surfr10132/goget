"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getBrowserLocation, postalCodeToLatLng, type LatLng } from "@/lib/geo";

const MapPicker = dynamic(() => import("./MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full animate-pulse rounded-xl border border-gray-200 bg-gray-100" />
  ),
});

interface Props {
  onLocation: (loc: LatLng, label: string) => void;
}

interface Suggestion {
  lat: number;
  lng: number;
  label: string;
  placeId: number;
}

// Central Jakarta — first-load map view before the user does anything.
const FALLBACK_CENTER: LatLng = { lat: -6.2088, lng: 106.8456 };

export function LocationPicker({ onLocation }: Props) {
  const [postal, setPostal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [pinLabel, setPinLabel] = useState<string>("");
  const [mapCenter, setMapCenter] = useState<LatLng>(FALLBACK_CENTER);
  const [reverseBusy, setReverseBusy] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseSeq = useRef(0);
  const suppressSearchRef = useRef(false);

  async function requestGPSLocation() {
    setBusy(true);
    setErr(null);
    try {
      const loc = await getBrowserLocation();
      onLocation(loc, "Your location");
    } catch {
      setShowFallback(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { requestGPSLocation(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false;
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    // Debounce ~400ms so we stay well under Nominatim's 1 req/sec policy.
    debounceTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?mode=search&q=${encodeURIComponent(q)}`);
        const json = (await r.json()) as { results?: Suggestion[]; error?: string };
        setSuggestions(json.results ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  function pickSuggestion(s: Suggestion) {
    const loc = { lat: s.lat, lng: s.lng };
    suppressSearchRef.current = true;
    setQuery(s.label);
    setSuggestions([]);
    setPin(loc);
    setPinLabel(s.label);
    setMapCenter(loc);
    setShowFallback(true);
  }

  async function reverseLookup(loc: LatLng) {
    const seq = ++reverseSeq.current;
    setReverseBusy(true);
    try {
      const r = await fetch(`/api/geocode?mode=reverse&lat=${loc.lat}&lng=${loc.lng}`);
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as { label?: string };
      if (seq === reverseSeq.current) {
        setPinLabel(json.label ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
      }
    } catch {
      if (seq === reverseSeq.current) {
        setPinLabel(`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
      }
    } finally {
      if (seq === reverseSeq.current) setReverseBusy(false);
    }
  }

  function handlePinChange(loc: LatLng) {
    setPin(loc);
    setPinLabel("");
    reverseLookup(loc);
  }

  function confirmPin() {
    if (!pin) return;
    onLocation(pin, pinLabel || "Pinned location");
  }

  async function submitPostal(e: React.FormEvent) {
    e.preventDefault();
    const code = postal.trim();
    if (!/^\d{5}$/.test(code)) {
      setErr("Enter a 5-digit Indonesian postal code");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const loc = await postalCodeToLatLng(code);
      onLocation(loc, `Kode pos ${code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Postal code not found");
    } finally {
      setBusy(false);
    }
  }

  function useDemo() {
    onLocation(FALLBACK_CENTER, "Central Jakarta (demo)");
  }

  return (
    <div className="rounded-2xl border border-gray-200 p-5 space-y-4 bg-gray-50">
      <div>
        <p className="font-medium text-sm">Where should we deliver?</p>
        <p className="text-xs text-gray-500 mt-0.5">
          We only show stores within 35&nbsp;km of you.
        </p>
      </div>

      <button
        onClick={requestGPSLocation}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-brand-500 text-brand-600 font-medium text-sm hover:bg-brand-50 disabled:opacity-60"
      >
        <PinIcon />
        {busy ? "Getting location…" : "Use my current location"}
      </button>

      {showFallback && (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="flex-1 h-px bg-gray-200" />
            or search an address
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <div className="relative">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Jl. Sudirman, Jakarta…"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              autoComplete="off"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                searching…
              </span>
            )}
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                {suggestions.map(s => (
                  <li key={s.placeId}>
                    <button
                      type="button"
                      onClick={() => pickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 hover:text-brand-700 border-b border-gray-100 last:border-b-0"
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Tap the map to drop a pin, or drag it to fine-tune.
            </p>
            <MapPicker
              center={mapCenter}
              pin={pin}
              onPin={handlePinChange}
            />
            {pin && (
              <div className="rounded-xl bg-white border border-gray-200 p-3 text-sm space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Selected location
                </div>
                <div className="text-gray-800 break-words">
                  {reverseBusy
                    ? "Finding address…"
                    : pinLabel || `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`}
                </div>
                <div className="text-xs text-gray-400">
                  {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </div>
                <button
                  onClick={confirmPin}
                  disabled={reverseBusy}
                  className="w-full py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                >
                  Deliver here
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="flex-1 h-px bg-gray-200" />
        or enter postal code
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <form onSubmit={submitPostal} className="flex gap-2">
        <input
          value={postal}
          onChange={e => setPostal(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="12345"
          inputMode="numeric"
          maxLength={5}
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
        <button
          type="submit"
          disabled={busy || postal.length !== 5}
          className="px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          Go
        </button>
      </form>

      {err && <p className="text-amber-600 text-xs">{err}</p>}

      <button
        type="button"
        onClick={useDemo}
        className="w-full text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
      >
        Just browsing? Use demo location (Jakarta)
      </button>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
