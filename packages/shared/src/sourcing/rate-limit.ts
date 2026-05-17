/**
 * Token-bucket rate limiter, per host.
 *
 * WHY a custom mini-bucket instead of a dep: scrapers must remain swappable
 * and dep-free per /Users/jason/Desktop/GoGet/CLAUDE.md.
 */

export interface TokenBucket {
  /** Resolves once a token is available, then consumes one. */
  waitForToken(): Promise<void>;
}

export interface TokenBucketOptions {
  /** Steady-state requests per second. */
  ratePerSec: number;
  /** Max burst tokens (bucket capacity). */
  burst: number;
  /** Injectable for tests; defaults to Date.now(). */
  now?: () => number;
  /** Injectable for tests; defaults to setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
}

export function createTokenBucket(opts: TokenBucketOptions): TokenBucket {
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const refillPerMs = opts.ratePerSec / 1000;
  let tokens = opts.burst;
  let last = now();
  let chain: Promise<void> = Promise.resolve();

  function refill(): void {
    const t = now();
    tokens = Math.min(opts.burst, tokens + (t - last) * refillPerMs);
    last = t;
  }

  async function acquire(): Promise<void> {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - tokens) / refillPerMs);
    await sleep(waitMs);
    refill();
    tokens = Math.max(0, tokens - 1);
  }

  // WHY chain: serialize acquires so concurrent callers can't all see the same token.
  return {
    waitForToken(): Promise<void> {
      const next = chain.then(acquire);
      chain = next.catch(() => {});
      return next;
    },
  };
}

const buckets = new Map<string, TokenBucket>();

/** Default: 2 req/sec, burst 4 — gentle enough for public storefront APIs. */
export function getHostBucket(
  host: string,
  opts: TokenBucketOptions = { ratePerSec: 2, burst: 4 },
): TokenBucket {
  let b = buckets.get(host);
  if (!b) {
    b = createTokenBucket(opts);
    buckets.set(host, b);
  }
  return b;
}

/** Test-only: reset the per-host singleton cache. */
export function __resetBucketsForTests(): void {
  buckets.clear();
}
