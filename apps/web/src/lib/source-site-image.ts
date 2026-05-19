import { load } from "cheerio";

type CachedSourceSiteImage = {
  value: string | null;
  expiresAt: number;
};
type ImageCandidateSource =
  | "jsonld-product"
  | "jsonld"
  | "meta-og-secure"
  | "meta-og"
  | "meta-twitter"
  | "link-image-src"
  | "img-src"
  | "img-data-src"
  | "img-srcset"
  | "img-data-srcset"
  | "regex";
type ImageCandidate = {
  source: ImageCandidateSource;
  url: string;
};
type FetchSourceSiteImageOptions = {
  query?: string;
};
type ApifyConfig = {
  token: string;
  actorId: string;
  baseUrl: string;
};

const SOURCE_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const SOURCE_IMAGE_FAILURE_TTL_MS = 10 * 60 * 1000;
const SOURCE_IMAGE_FETCH_TIMEOUT_MS = 3_000;
const SOURCE_IMAGE_APIFY_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 250_000;
const MAX_IMAGE_CANDIDATES = 40;
const MIN_IMAGE_SCORE = 35;
const MAX_APIFY_IMAGE_CANDIDATES = 30;
const MIN_APIFY_IMAGE_SCORE = 18;
const DEFAULT_APIFY_API_BASE_URL = "https://api.apify.com/v2";
const DEFAULT_APIFY_IMAGE_ACTOR_ID = "skipper_lume/ecommerce-product-scraper";
const sourceSiteImageCache = new Map<string, CachedSourceSiteImage>();

export function normalizeHttpUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const normalized = new URL(value.trim()).toString();
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return null;
    return normalized;
  } catch {
    return null;
  }
}

function isGoogleMapsUrl(url: string): boolean {
  return url.startsWith("https://www.google.com/maps");
}

function normalizeQuery(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

function buildCacheKey(url: string, query: string): string {
  if (!query) return url;
  return `${url}::q=${query}`;
}

function normalizeCandidateUrl(candidate: string | undefined, pageUrl: string): string | null {
  if (!candidate) return null;
  const cleaned = candidate
    .trim()
    .replaceAll("&amp;", "&")
    .replaceAll("\\u002F", "/");
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) return null;
  try {
    return normalizeHttpUrl(new URL(cleaned, pageUrl).toString());
  } catch {
    return null;
  }
}

function parseBestSrcSetCandidate(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; score: number } | null = null;
  for (const rawEntry of srcset.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const [url, descriptor] = entry.split(/\s+/, 2);
    if (!url) continue;
    const score =
      descriptor?.endsWith("w") ? Number(descriptor.slice(0, -1)) || 0
      : descriptor?.endsWith("x") ? (Number(descriptor.slice(0, -1)) || 0) * 1_000
      : 1;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url;
}

function tokenizeQuery(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function extractImageUrlsFromJsonLdValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractImageUrlsFromJsonLdValue(entry));
  }
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const candidates: string[] = [];
  if (typeof obj.url === "string") candidates.push(obj.url);
  if (typeof obj.contentUrl === "string") candidates.push(obj.contentUrl);
  if (obj.thumbnailUrl) candidates.push(...extractImageUrlsFromJsonLdValue(obj.thumbnailUrl));
  if (obj.image) candidates.push(...extractImageUrlsFromJsonLdValue(obj.image));
  return candidates;
}

function flattenJsonLdNodes(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.mainEntity) visit(obj.mainEntity);
    if (obj.itemListElement) visit(obj.itemListElement);
  };
  visit(value);
  return out;
}

function hasSchemaType(node: Record<string, unknown>, expectedType: string): boolean {
  const typeValue = node["@type"];
  if (typeof typeValue === "string") {
    return typeValue.toLowerCase() === expectedType.toLowerCase();
  }
  if (Array.isArray(typeValue)) {
    return typeValue.some((entry) => typeof entry === "string" && entry.toLowerCase() === expectedType.toLowerCase());
  }
  return false;
}

function pushImageCandidate(
  candidates: ImageCandidate[],
  dedupe: Set<string>,
  source: ImageCandidateSource,
  rawUrl: string | undefined,
  pageUrl: string,
): void {
  const normalized = normalizeCandidateUrl(rawUrl, pageUrl);
  if (!normalized) return;
  if (dedupe.has(normalized)) return;
  dedupe.add(normalized);
  candidates.push({ source, url: normalized });
}

function looksLikeLogoOrIcon(url: string): boolean {
  return /(logo|favicon|icon|sprite|avatar|brandmark|placeholder|blank|default[-_]?image)/i.test(url);
}

function looksLikeGenericBanner(url: string): boolean {
  return /(banner|hero|cover|header|homepage|landing)/i.test(url);
}

function scoreImageCandidate(candidate: ImageCandidate, queryTerms: string[]): number {
  const baseScoreBySource: Record<ImageCandidateSource, number> = {
    "jsonld-product": 120,
    "meta-og-secure": 110,
    "meta-og": 105,
    "meta-twitter": 95,
    "link-image-src": 90,
    "jsonld": 85,
    "img-srcset": 72,
    "img-data-srcset": 70,
    "img-data-src": 65,
    "img-src": 60,
    "regex": 55,
  };

  let score = baseScoreBySource[candidate.source];
  const lowerUrl = candidate.url.toLowerCase();

  if (looksLikeLogoOrIcon(lowerUrl)) score -= 90;
  if (looksLikeGenericBanner(lowerUrl)) score -= 20;
  if (/\.svg(?:[?#]|$)/i.test(lowerUrl)) score -= 12;
  if (/\/products?\//i.test(lowerUrl)) score += 10;
  if (/\/images?\//i.test(lowerUrl)) score += 4;

  for (const term of queryTerms) {
    if (lowerUrl.includes(term)) score += 6;
  }

  return score;
}

function chooseBestImageCandidate(candidates: ImageCandidate[], query: string | undefined): string | null {
  if (!candidates.length) return null;
  const queryTerms = tokenizeQuery(query);
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreImageCandidate(candidate, queryTerms) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < MIN_IMAGE_SCORE) return null;
  return ranked[0].candidate.url;
}

function getApifyConfig(): ApifyConfig | null {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;
  const actorId = (
    process.env.APIFY_IMAGE_ACTOR_ID
    ?? process.env.APIFY_ACTOR_ID
    ?? DEFAULT_APIFY_IMAGE_ACTOR_ID
  ).trim();
  if (!actorId) return null;
  const baseUrl = (process.env.APIFY_API_BASE_URL ?? DEFAULT_APIFY_API_BASE_URL).trim().replace(/\/+$/, "");
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return null;
  return { token, actorId, baseUrl };
}

function collectApifyImageCandidatesFromValue(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= MAX_APIFY_IMAGE_CANDIDATES) return;
  if (!value) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectApifyImageCandidatesFromValue(entry, out, depth + 1);
      if (out.length >= MAX_APIFY_IMAGE_CANDIDATES) break;
    }
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const directKeys = [
    "image",
    "imageUrl",
    "image_url",
    "mainImage",
    "thumbnail",
    "thumb",
    "ogImage",
    "url",
    "src",
  ];
  for (const key of directKeys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) out.push(direct.trim());
    if (out.length >= MAX_APIFY_IMAGE_CANDIDATES) return;
  }
  const collectionKeys = ["images", "imageUrls", "gallery", "thumbnails", "photos", "media", "product"];
  for (const key of collectionKeys) {
    collectApifyImageCandidatesFromValue(record[key], out, depth + 1);
    if (out.length >= MAX_APIFY_IMAGE_CANDIDATES) return;
  }
  for (const nested of Object.values(record)) {
    if (typeof nested === "object" && nested) {
      collectApifyImageCandidatesFromValue(nested, out, depth + 1);
      if (out.length >= MAX_APIFY_IMAGE_CANDIDATES) return;
    }
  }
}

function scoreApifyImageCandidate(url: string, queryTerms: string[]): number {
  let score = 20;
  const lowerUrl = url.toLowerCase();
  if (looksLikeLogoOrIcon(lowerUrl)) score -= 90;
  if (looksLikeGenericBanner(lowerUrl)) score -= 20;
  if (/\.svg(?:[?#]|$)/i.test(lowerUrl)) score -= 12;
  if (/\/products?\//i.test(lowerUrl) || /\/item\//i.test(lowerUrl) || /\/sku\//i.test(lowerUrl)) score += 10;
  if (/\/images?\//i.test(lowerUrl) || /cdn/i.test(lowerUrl)) score += 4;
  for (const term of queryTerms) {
    if (lowerUrl.includes(term)) score += 6;
  }
  return score;
}

function chooseBestApifyImageCandidate(rawCandidates: string[], pageUrl: string, query: string | undefined): string | null {
  if (!rawCandidates.length) return null;
  const dedupe = new Set<string>();
  const queryTerms = tokenizeQuery(query);
  const scored = rawCandidates
    .map((candidate) => normalizeCandidateUrl(candidate, pageUrl))
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate) => {
      if (dedupe.has(candidate)) return false;
      dedupe.add(candidate);
      return true;
    })
    .map((candidate) => ({ candidate, score: scoreApifyImageCandidate(candidate, queryTerms) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < MIN_APIFY_IMAGE_SCORE) return null;
  return scored[0].candidate;
}

async function fetchImageFromApify(pageUrl: string, query: string | undefined): Promise<string | null> {
  const config = getApifyConfig();
  if (!config) return null;
  try {
    const runSyncDatasetUrl = `${config.baseUrl}/acts/${encodeURIComponent(config.actorId)}/run-sync-get-dataset-items`;
    const res = await fetch(runSyncDatasetUrl, {
      method: "POST",
      signal: AbortSignal.timeout(SOURCE_IMAGE_APIFY_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${config.token}`,
        "User-Agent": "GoGet-ImageFallback/1.0 (+https://goget.id)",
      },
      body: JSON.stringify({
        urls: [pageUrl],
        maxConcurrency: 1,
        maxRequestsPerCrawl: 1,
        maxItems: 1,
        forcePlaywright: false,
      }),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) return null;
    const payload = await res.json();
    const rawCandidates: string[] = [];
    collectApifyImageCandidatesFromValue(payload, rawCandidates);
    return chooseBestApifyImageCandidate(rawCandidates, pageUrl, query);
  } catch {
    return null;
  }
}

function extractImageFromHtml(html: string, pageUrl: string, query: string | undefined): string | null {
  const $ = load(html);
  const dedupe = new Set<string>();
  const candidates: ImageCandidate[] = [];

  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (const script of jsonLdScripts.toArray()) {
    const raw = $(script).html();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = flattenJsonLdNodes(parsed);
      for (const node of nodes) {
        if (hasSchemaType(node, "Product")) {
          const productImageCandidates = extractImageUrlsFromJsonLdValue(node.image);
          for (const candidate of productImageCandidates) {
            pushImageCandidate(candidates, dedupe, "jsonld-product", candidate, pageUrl);
          }
        }

        const genericImageCandidates = [
          ...extractImageUrlsFromJsonLdValue(node.image),
          ...extractImageUrlsFromJsonLdValue(node.primaryImageOfPage),
        ];
        for (const candidate of genericImageCandidates) {
          pushImageCandidate(candidates, dedupe, "jsonld", candidate, pageUrl);
        }
      }
    } catch {
      // Skip malformed JSON-LD and continue.
    }
  }

  pushImageCandidate(candidates, dedupe, "meta-og-secure", $('meta[property="og:image:secure_url"]').attr("content"), pageUrl);
  pushImageCandidate(candidates, dedupe, "meta-og", $('meta[property="og:image"]').attr("content"), pageUrl);
  pushImageCandidate(candidates, dedupe, "meta-og", $('meta[property="product:image"]').attr("content"), pageUrl);
  pushImageCandidate(candidates, dedupe, "meta-twitter", $('meta[name="twitter:image:src"]').attr("content"), pageUrl);
  pushImageCandidate(candidates, dedupe, "meta-twitter", $('meta[name="twitter:image"]').attr("content"), pageUrl);
  pushImageCandidate(candidates, dedupe, "link-image-src", $('link[rel="image_src"]').attr("href"), pageUrl);

  const imageElements = $("img").toArray().slice(0, 20);
  for (const element of imageElements) {
    const node = $(element);
    pushImageCandidate(candidates, dedupe, "img-src", node.attr("src"), pageUrl);
    pushImageCandidate(candidates, dedupe, "img-data-src", node.attr("data-src"), pageUrl);
    pushImageCandidate(candidates, dedupe, "img-data-src", node.attr("data-original"), pageUrl);
    pushImageCandidate(candidates, dedupe, "img-data-src", node.attr("data-lazy-src"), pageUrl);
    pushImageCandidate(candidates, dedupe, "img-srcset", parseBestSrcSetCandidate(node.attr("srcset")), pageUrl);
    pushImageCandidate(candidates, dedupe, "img-data-srcset", parseBestSrcSetCandidate(node.attr("data-srcset")), pageUrl);
    if (candidates.length >= MAX_IMAGE_CANDIDATES) break;
  }

  const regexPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of regexPatterns) {
    const match = html.match(pattern);
    pushImageCandidate(candidates, dedupe, "regex", match?.[1], pageUrl);
  }

  return chooseBestImageCandidate(candidates, query);
}

export async function fetchSourceSiteImage(
  url: string | undefined,
  options?: FetchSourceSiteImageOptions,
): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl || isGoogleMapsUrl(normalizedUrl)) return null;
  const query = normalizeQuery(options?.query);
  const cacheKey = buildCacheKey(normalizedUrl, query);
  const cached = sourceSiteImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.expiresAt <= Date.now()) sourceSiteImageCache.delete(cacheKey);

  const setCache = (value: string | null, ttlMs: number) => {
    sourceSiteImageCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  };

  try {
    const res = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(SOURCE_IMAGE_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoGet-Bot/1.0; +https://goget.id)",
        "Accept": "text/html",
      },
    });
    if (!res.ok) {
      setCache(null, SOURCE_IMAGE_FAILURE_TTL_MS);
      return null;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setCache(null, SOURCE_IMAGE_FAILURE_TTL_MS);
      return null;
    }
    let html = "";
    while (html.length < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();

    const extracted = extractImageFromHtml(html, normalizedUrl, query);
    if (extracted) {
      setCache(extracted, SOURCE_IMAGE_CACHE_TTL_MS);
      return extracted;
    }

    const apifyExtracted = await fetchImageFromApify(normalizedUrl, query);
    if (apifyExtracted) {
      setCache(apifyExtracted, SOURCE_IMAGE_CACHE_TTL_MS);
      return apifyExtracted;
    }

    setCache(null, SOURCE_IMAGE_FAILURE_TTL_MS);
    return null;
  } catch {
    setCache(null, SOURCE_IMAGE_FAILURE_TTL_MS);
    return null;
  }
}
