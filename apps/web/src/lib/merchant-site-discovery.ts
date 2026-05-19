import { load } from "cheerio";
import { normalizeHttpUrl } from "@/lib/source-site-image";

type CachedMerchantWebsite = {
  value: string | null;
  expiresAt: number;
};

interface DiscoverMerchantWebsiteInput {
  merchantName: string;
  city?: string;
  productQuery?: string;
}

const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_FAILURE_TTL_MS = 2 * 60 * 60 * 1000;
const DISCOVERY_FETCH_TIMEOUT_MS = 4_000;
const merchantWebsiteCache = new Map<string, CachedMerchantWebsite>();

const BLOCKED_HOST_SNIPPETS = [
  "google.com/maps",
  "maps.google.",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "wikipedia.org",
  "linkedin.com",
  "tokopedia",
  "shopee",
  "lazada",
  "bukalapak",
  "blibli",
  "amazon.",
  "aliexpress",
  "ebay.",
];

function normalizeText(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 140);
}

function toTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildCacheKey(input: DiscoverMerchantWebsiteInput): string {
  const merchant = normalizeText(input.merchantName);
  const city = normalizeText(input.city);
  const product = normalizeText(input.productQuery);
  return `${merchant}::${city}::${product}`;
}

function isBlockedCandidate(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_HOST_SNIPPETS.some((snippet) => lower.includes(snippet));
}

function decodeSearchResultUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname === "/l/") {
      return normalizeHttpUrl(parsed.searchParams.get("uddg"));
    }
    return normalizeHttpUrl(parsed.toString());
  } catch {
    return null;
  }
}

function scoreWebsiteCandidate(url: string, merchantTokens: string[], cityTokens: string[]): number {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    let score = 0;

    if (host.endsWith(".id")) score += 6;
    if (path === "/" || path.length <= 1) score += 3;
    if (/(official|store|shop|retail|outlet)/i.test(`${host}${path}`)) score += 2;

    for (const token of merchantTokens) {
      if (host.includes(token)) score += 14;
      if (path.includes(token)) score += 5;
    }
    for (const token of cityTokens) {
      if (host.includes(token)) score += 1;
      if (path.includes(token)) score += 1;
    }

    return score;
  } catch {
    return -1_000;
  }
}

function pickBestCandidate(urls: string[], merchantTokens: string[], cityTokens: string[]): string | null {
  const deduped = Array.from(new Set(urls));
  const filtered = deduped.filter((url) => !isBlockedCandidate(url));
  if (!filtered.length) return null;

  const ranked = filtered
    .map((url) => ({ url, score: scoreWebsiteCandidate(url, merchantTokens, cityTokens) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url ?? null;
}

function extractDuckDuckGoCandidates(html: string): string[] {
  const $ = load(html);
  const primary = $("a.result__a, a[data-testid='result-title-a'], a.result-link")
    .toArray()
    .map((node) => decodeSearchResultUrl($(node).attr("href")))
    .filter((url): url is string => Boolean(url));
  if (primary.length) return primary;

  return $("a[href*='duckduckgo.com/l/?'], a[href*='/l/?uddg=']")
    .toArray()
    .map((node) => decodeSearchResultUrl($(node).attr("href")))
    .filter((url): url is string => Boolean(url));
}

function extractBingCandidates(html: string): string[] {
  const $ = load(html);
  return $("li.b_algo h2 a, .b_algo h2 a")
    .toArray()
    .map((node) => normalizeHttpUrl($(node).attr("href")))
    .filter((url): url is string => Boolean(url));
}

async function searchDuckDuckGo(query: string, merchantTokens: string[], cityTokens: string[]): Promise<string | null> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=id-id`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DISCOVERY_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GoGet-Bot/1.0; +https://goget.id)",
      "Accept": "text/html",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const candidates = extractDuckDuckGoCandidates(html);
  return pickBestCandidate(candidates, merchantTokens, cityTokens);
}

async function searchBing(query: string, merchantTokens: string[], cityTokens: string[]): Promise<string | null> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DISCOVERY_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GoGet-Bot/1.0; +https://goget.id)",
      "Accept": "text/html",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const candidates = extractBingCandidates(html);
  return pickBestCandidate(candidates, merchantTokens, cityTokens);
}

export async function discoverMerchantWebsite(input: DiscoverMerchantWebsiteInput): Promise<string | null> {
  const cacheKey = buildCacheKey(input);
  const cached = merchantWebsiteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.expiresAt <= Date.now()) merchantWebsiteCache.delete(cacheKey);

  const setCache = (value: string | null, ttlMs: number) => {
    merchantWebsiteCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  };

  const merchantTokens = toTokens(input.merchantName);
  const cityTokens = toTokens(input.city);
  const searchQueries = [
    [input.merchantName, input.productQuery, input.city, "Indonesia"].filter(Boolean).join(" "),
    [input.merchantName, input.city, "official site Indonesia"].filter(Boolean).join(" "),
  ].filter(Boolean);

  if (!searchQueries.length) {
    setCache(null, DISCOVERY_FAILURE_TTL_MS);
    return null;
  }

  for (const searchQuery of searchQueries) {
    try {
      const fromDuckDuckGo = await searchDuckDuckGo(searchQuery, merchantTokens, cityTokens);
      if (fromDuckDuckGo) {
        setCache(fromDuckDuckGo, DISCOVERY_CACHE_TTL_MS);
        return fromDuckDuckGo;
      }

      const fromBing = await searchBing(searchQuery, merchantTokens, cityTokens);
      if (fromBing) {
        setCache(fromBing, DISCOVERY_CACHE_TTL_MS);
        return fromBing;
      }
    } catch {
      // Try next query / provider.
    }
  }

  setCache(null, DISCOVERY_FAILURE_TTL_MS);
  return null;
}
