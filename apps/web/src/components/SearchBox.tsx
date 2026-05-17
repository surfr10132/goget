"use client";

import { useRouter } from "next/navigation";
import { useState, useRef } from "react";

const HINTS = [
  { icon: "🍵", label: "Japanese matcha powder" },
  { icon: "🏸", label: "Yonex badminton racket" },
  { icon: "💊", label: "Vitamin C 1000mg supplements" },
  { icon: "🎸", label: "Yamaha acoustic guitar" },
];

/**
 * Detect if a string looks like a URL.
 */
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Given a product page URL, extract a human-readable product name from the
 * path slug. Works for Tokopedia, Shopee, Ruparupa, Blibli, etc.
 *
 * e.g. ".../otto-klasse-jump-starter-12v-powerbank-12000mah-hitam.html"
 *   → "Otto Klasse Jump Starter 12V Powerbank 12000Mah Hitam"
 */
function extractProductFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;

    // Pick the longest segment — usually the product slug
    const slug = segments.reduce((a, b) => (a.length >= b.length ? a : b), "");
    if (slug.length < 5) return null;

    const name = slug
      .replace(/\.(html?|php|aspx?)$/i, "")    // strip extensions
      .replace(/[-_+]/g, " ")                   // hyphens → spaces
      .replace(/\s{2,}/g, " ")
      .trim();

    // Must have at least two words to be meaningful
    return name.split(" ").length >= 2 ? name : null;
  } catch {
    return null;
  }
}

export function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [extractedFrom, setExtractedFrom] = useState<string | null>(null); // original URL
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = !value.trim();

  function handleChange(raw: string) {
    // Auto-extract product name when user pastes a URL
    if (looksLikeUrl(raw)) {
      const product = extractProductFromUrl(raw);
      if (product) {
        setValue(product);
        setExtractedFrom(raw.trim());
        return;
      }
    }
    setValue(raw);
    setExtractedFrom(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isEmpty) return;
    setBusy(true);
    router.push(`/search?${new URLSearchParams({ q: value.trim() }).toString()}`);
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-3">
      {/* Main input */}
      <div className="relative rounded-2xl border shadow-sm transition-all border-gray-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e as any); }
          }}
          placeholder={
            "What are you looking for?\n" +
            "Describe it in plain words — or paste a product link."
          }
          rows={3}
          autoFocus
          className="w-full resize-none bg-transparent px-5 pt-4 pb-12 text-base outline-none placeholder:text-gray-400 rounded-2xl"
        />

        {/* Submit button pinned to bottom-right */}
        <button
          disabled={isEmpty || busy}
          className="absolute bottom-3 right-3 px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 transition"
        >
          {busy ? "Searching…" : "Find it →"}
        </button>
      </div>

      {/* URL extracted chip */}
      {extractedFrom && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <span>🔗</span>
          <span className="flex-1 truncate">
            Product name extracted from <span className="font-medium text-gray-700">{new URL(extractedFrom).hostname}</span>
          </span>
          <button
            type="button"
            onClick={() => { setValue(extractedFrom); setExtractedFrom(null); inputRef.current?.focus(); }}
            className="shrink-0 text-gray-400 hover:text-gray-700"
            title="Clear extraction and search by URL instead"
          >
            ✕
          </button>
        </div>
      )}

      {/* Hint pills — only show when empty */}
      {isEmpty && (
        <div className="flex flex-wrap gap-2 pt-1">
          {HINTS.map(h => (
            <button
              key={h.label}
              type="button"
              onClick={() => { setValue(h.label); setExtractedFrom(null); inputRef.current?.focus(); }}
              className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-3 py-1.5 transition"
            >
              <span>{h.icon}</span>
              <span>{h.label}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
