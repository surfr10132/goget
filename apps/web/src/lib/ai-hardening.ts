type PromptCacheTTL = "5m" | "1h";

export type AnthropicRouteId = "sourcing_test" | "sourcing_web" | "search_refine";

interface AnthropicRouteDefaults {
  budgetUsd: number;
  timeoutMs: number;
  resultCacheTtlMs: number;
  promptCacheTtl: PromptCacheTTL;
  expensiveSourcingPath: boolean;
}

const DEFAULT_ROUTE_SETTINGS: Record<AnthropicRouteId, AnthropicRouteDefaults> = {
  sourcing_test: {
    budgetUsd: 0.02,
    timeoutMs: 6_500,
    resultCacheTtlMs: 3 * 60_000,
    promptCacheTtl: "1h",
    expensiveSourcingPath: true,
  },
  sourcing_web: {
    budgetUsd: 0.03,
    timeoutMs: 12_000,
    resultCacheTtlMs: 2 * 60_000,
    promptCacheTtl: "5m",
    expensiveSourcingPath: true,
  },
  search_refine: {
    budgetUsd: 0.005,
    timeoutMs: 3_500,
    resultCacheTtlMs: 15 * 60_000,
    promptCacheTtl: "1h",
    expensiveSourcingPath: false,
  },
};

export interface AnthropicRoutePolicy {
  routeId: AnthropicRouteId;
  enabled: boolean;
  budgetUsd: number;
  timeoutMs: number;
  resultCacheTtlMs: number;
  promptCacheTtl: PromptCacheTTL;
}

interface ResultCacheEntry {
  expiresAt: number;
  value: unknown;
}

const RESULT_CACHE_MAX_ENTRIES = 300;
const resultCache = new Map<string, ResultCacheEntry>();

function parseBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function parseNumberEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(",")}}`;
}

function cacheMapKey(routeId: AnthropicRouteId, cacheKey: string): string {
  return `${routeId}:${cacheKey}`;
}

function pruneExpiredCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of resultCache.entries()) {
    if (entry.expiresAt <= now) resultCache.delete(key);
  }
}

function trimCacheToSizeLimit() {
  if (resultCache.size <= RESULT_CACHE_MAX_ENTRIES) return;

  const overflow = resultCache.size - RESULT_CACHE_MAX_ENTRIES;
  const sortedEntries = [...resultCache.entries()].sort(
    (a, b) => a[1].expiresAt - b[1].expiresAt,
  );

  for (let i = 0; i < overflow; i += 1) {
    const key = sortedEntries[i]?.[0];
    if (key) resultCache.delete(key);
  }
}

export function makeStableCacheKey(value: unknown): string {
  return stableStringify(value);
}

export function getCachedRouteResult<T>(routeId: AnthropicRouteId, cacheKey: string): T | null {
  const key = cacheMapKey(routeId, cacheKey);
  const cached = resultCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return null;
  }

  return cached.value as T;
}

export function setCachedRouteResult<T>(
  routeId: AnthropicRouteId,
  cacheKey: string,
  value: T,
  ttlMs: number,
) {
  if (ttlMs <= 0) return;

  pruneExpiredCacheEntries();
  resultCache.set(cacheMapKey(routeId, cacheKey), {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  trimCacheToSizeLimit();
}

export function getAnthropicRoutePolicy(routeId: AnthropicRouteId): AnthropicRoutePolicy {
  const defaults = DEFAULT_ROUTE_SETTINGS[routeId];
  const envPrefix = `AI_ROUTE_${routeId.toUpperCase()}`;

  const expensiveSourcingEnabled =
    parseBooleanEnv("AI_EXPENSIVE_SOURCING_ENABLED") ?? process.env.NODE_ENV !== "production";
  const defaultEnabled = defaults.expensiveSourcingPath ? expensiveSourcingEnabled : true;

  return {
    routeId,
    enabled: parseBooleanEnv(`${envPrefix}_ENABLED`) ?? defaultEnabled,
    budgetUsd: parseNumberEnv(`${envPrefix}_BUDGET_USD`, defaults.budgetUsd, 0),
    timeoutMs: parseNumberEnv(`${envPrefix}_TIMEOUT_MS`, defaults.timeoutMs, 100),
    resultCacheTtlMs: parseNumberEnv(
      `${envPrefix}_RESULT_CACHE_TTL_MS`,
      defaults.resultCacheTtlMs,
      0,
    ),
    promptCacheTtl:
      (process.env[`${envPrefix}_PROMPT_CACHE_TTL`] as PromptCacheTTL | undefined) ??
      defaults.promptCacheTtl,
  };
}

const MODEL_PRICING_USD_PER_MILLION = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
} as const;

function normalizeModelId(model: string): keyof typeof MODEL_PRICING_USD_PER_MILLION | null {
  if (model.startsWith("claude-haiku-4-5")) return "claude-haiku-4-5";
  if (model.startsWith("claude-sonnet-4-6")) return "claude-sonnet-4-6";
  if (model.startsWith("claude-opus-4-6")) return "claude-opus-4-6";
  if (model.startsWith("claude-opus-4-7")) return "claude-opus-4-7";
  return null;
}

export interface TokenUsageEstimate {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

export function estimateAnthropicCostUSD(model: string, usage: TokenUsageEstimate): number {
  const normalizedModel = normalizeModelId(model);
  if (!normalizedModel) return 0;

  const rates = MODEL_PRICING_USD_PER_MILLION[normalizedModel];
  const inputTokens =
    Math.max(0, usage.inputTokens) +
    Math.max(0, usage.cacheCreationInputTokens ?? 0) +
    Math.max(0, usage.cacheReadInputTokens ?? 0);
  const outputTokens = Math.max(0, usage.outputTokens);

  return Number(
    ((inputTokens * rates.input + outputTokens * rates.output) / 1_000_000).toFixed(6),
  );
}

export function estimateInputTokensFromText(...parts: Array<string | null | undefined>): number {
  const fullPrompt = parts.filter((part): part is string => Boolean(part)).join("\n");
  if (!fullPrompt) return 1;
  return Math.max(1, Math.ceil(fullPrompt.length / 4));
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted")
  );
}

type AiRouteEventStatus = "success" | "fallback" | "skipped" | "cache_hit";

export interface AiRouteMetricEvent {
  routeId: AnthropicRouteId;
  provider: string;
  source: string;
  status: AiRouteEventStatus;
  latencyMs: number;
  costUsd: number;
  budgetUsd?: number;
  reason?: string;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

interface ProviderSourceMetricAggregate {
  calls: number;
  failures: number;
  totalLatencyMs: number;
  totalCostUsd: number;
}

const providerSourceMetrics = new Map<string, ProviderSourceMetricAggregate>();

export function trackAiRouteEvent(event: AiRouteMetricEvent) {
  const aggregateKey = `${event.provider}:${event.source}`;
  const existing = providerSourceMetrics.get(aggregateKey) ?? {
    calls: 0,
    failures: 0,
    totalLatencyMs: 0,
    totalCostUsd: 0,
  };

  const isFailure = event.status === "fallback";
  const updated: ProviderSourceMetricAggregate = {
    calls: existing.calls + 1,
    failures: existing.failures + (isFailure ? 1 : 0),
    totalLatencyMs: existing.totalLatencyMs + Math.max(0, event.latencyMs),
    totalCostUsd: existing.totalCostUsd + Math.max(0, event.costUsd),
  };
  providerSourceMetrics.set(aggregateKey, updated);

  console.info(
    "[ai-route-metrics]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
      avgLatencyMs: Number((updated.totalLatencyMs / updated.calls).toFixed(1)),
      avgCostUsd: Number((updated.totalCostUsd / updated.calls).toFixed(6)),
      calls: updated.calls,
      failures: updated.failures,
    }),
  );
}
