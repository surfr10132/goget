import { describe, expect, it } from "vitest";
import {
  buildRateSnapshotForStorage,
  resolveRateTokenForBooking,
} from "./courier-rate-snapshot";

describe("courier rate snapshot helpers", () => {
  it("stores canonical fields with raw payload for persisted rates", () => {
    const snapshot = buildRateSnapshotForStorage({
      provider: "grab",
      tier: "instant",
      priceIDR: 18_000,
      etaMinutes: 24,
      rateToken: "quote-abc",
      expiresAt: "2026-05-17T07:00:00.000Z",
      raw: { quoteId: "quote-abc", service: "INSTANT", amount: 18000 },
      score: 0.9,
    });

    expect(snapshot).toEqual({
      rateToken: "quote-abc",
      providerQuoteId: "quote-abc",
      expiresAt: "2026-05-17T07:00:00.000Z",
      raw: { quoteId: "quote-abc", service: "INSTANT", amount: 18000 },
    });
  });

  it("resolves canonical token first when booking", () => {
    const token = resolveRateTokenForBooking({
      rateToken: "canonical-token",
      providerQuoteId: "provider-quote-id",
      raw: { quoteId: "legacy-quote-id" },
    });
    expect(token).toBe("canonical-token");
  });

  it("falls back to historical provider fields for legacy rows", () => {
    expect(resolveRateTokenForBooking({ quoteId: "legacy-quote-id" })).toBe("legacy-quote-id");
    expect(resolveRateTokenForBooking({ quoteID: "legacy-quote-id-2" })).toBe("legacy-quote-id-2");
    expect(resolveRateTokenForBooking({ serviceType: "INSTANT" })).toBe("INSTANT");
  });

  it("returns undefined when no token fields exist", () => {
    expect(resolveRateTokenForBooking({ raw: { foo: "bar" } })).toBeUndefined();
    expect(resolveRateTokenForBooking(null)).toBeUndefined();
  });
});
