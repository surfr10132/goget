export * from "./types";
export * from "./tokopedia";
export * from "./shopee";
export * from "./bukalapak";
export * from "./directory";
export * from "./orchestrator";

// scraper-hardening exports
export {
  safeFetch,
  DESKTOP_CHROME_UA,
  ACCEPT_LANGUAGE_ID,
} from "./http";
export {
  createTokenBucket,
  getHostBucket,
  __resetBucketsForTests,
  type TokenBucket,
  type TokenBucketOptions,
} from "./rate-limit";

// ── added by route-refactor (reconcile with parallel edits) ────────────────
export {
  getImageUrl,
  estimatePrice,
  categorizeQuery,
  getShopTypes,
  includesPharmacy,
  type QueryCategory,
} from "./intelligence";
export { makeFallbackItems } from "./test-fallback";
export type { TestFallbackItem } from "./test-fallback";
