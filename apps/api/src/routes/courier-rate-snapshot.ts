import type { ComparedRate } from "@goget/shared/server";

export function buildRateSnapshotForStorage(rate: ComparedRate) {
  const raw = asObject(rate.raw);
  const providerQuoteId = extractProviderQuoteId(raw);
  return {
    rateToken: rate.rateToken ?? providerQuoteId ?? null,
    providerQuoteId: providerQuoteId ?? null,
    expiresAt: rate.expiresAt ?? null,
    raw: raw ?? rate.raw ?? null,
  };
}

export function resolveRateTokenForBooking(rawResponse: unknown): string | undefined {
  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) return undefined;
  const raw = rawResponse as Record<string, unknown>;
  const canonical = asString(raw.rateToken) ?? asString(raw.providerQuoteId);
  if (canonical) return canonical;

  // Backwards-compatible fallback for historical rows that stored provider raw
  // payload directly before canonical snapshotting was added.
  return asString(raw.quoteId)
    ?? asString(raw.quoteID)
    ?? asString(raw.serviceType)
    ?? asString(raw.service);
}

function extractProviderQuoteId(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const direct = raw.quoteId ?? raw.quoteID ?? raw.serviceType ?? raw.service;
  if (direct === undefined || direct === null) return null;
  return String(direct);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
