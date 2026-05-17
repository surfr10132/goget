import { getHostBucket } from "./rate-limit";

/** Desktop Chrome on macOS — broad coverage, low likelihood of being blocked. */
export const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

export const ACCEPT_LANGUAGE_ID = "id-ID,id;q=0.9,en;q=0.8";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;

export interface SafeFetchOptions extends RequestInit {
  /** Override the default 8s timeout. */
  timeoutMs?: number;
  /** Override the default 2 retries. */
  retries?: number;
  /** Override the global fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Skip the per-host token bucket (tests). */
  skipRateLimit?: boolean;
  /** Override backoff base (ms). */
  backoffBaseMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function isTransientStatus(s: number): boolean {
  // 5xx and 429 are worth retrying; 4xx is the caller's fault.
  return s === 429 || (s >= 500 && s <= 599);
}

/**
 * Shared fetch wrapper for all sourcing adapters.
 *
 * Applies: UA + Accept-Language + 8s timeout + per-host token bucket +
 * exponential-backoff retries (2 by default) on 5xx/429/network errors.
 */
export async function safeFetch(
  input: string,
  init: SafeFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    fetchImpl = fetch,
    skipRateLimit = false,
    backoffBaseMs = 250,
    sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
    headers,
    ...rest
  } = init;

  const url = new URL(input);
  if (!skipRateLimit) {
    await getHostBucket(url.host).waitForToken();
  }

  const mergedHeaders: Record<string, string> = {
    "User-Agent": DESKTOP_CHROME_UA,
    "Accept-Language": ACCEPT_LANGUAGE_ID,
    ...flattenHeaders(headers),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(input, {
        ...rest,
        headers: mergedHeaders,
        signal: ctrl.signal,
      });
      if (isTransientStatus(r.status) && attempt < retries) {
        await sleep(backoffBaseMs * 2 ** attempt);
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      await sleep(backoffBaseMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("safeFetch: exhausted retries");
}

// Accepts whatever `RequestInit.headers` resolves to under the consumer's
// tsconfig (lib.dom on web; @types/node's variant on the api). We discriminate
// at runtime rather than against a specific compile-time alias to stay
// portable across both.
function flattenHeaders(h: unknown): Record<string, string> {
  if (!h) return {};
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h as ReadonlyArray<readonly [string, string]>);
  }
  return { ...(h as Record<string, string>) };
}
