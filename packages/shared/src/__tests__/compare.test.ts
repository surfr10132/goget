import { describe, it, expect } from "vitest";
import { compareRates } from "../couriers/compare";
import type {
  CourierAdapter,
  RateQuote,
  RateRequest,
  BookRequest,
  BookResult,
} from "../couriers/types";
import type { CourierProvider } from "../types";

function makeAdapter(
  provider: CourierProvider,
  quotes: RateQuote[] | Error,
): CourierAdapter {
  return {
    provider,
    async getRates(_req: RateRequest) {
      if (quotes instanceof Error) throw quotes;
      return quotes;
    },
    async bookDelivery(_req: BookRequest): Promise<BookResult> {
      throw new Error("not used");
    },
    async cancelDelivery() {
      /* no-op */
    },
    parseWebhook() {
      return { externalBookingId: "x", status: "ok", raw: null };
    },
  };
}

const req: RateRequest = {
  pickup: { lat: -6.2, lng: 106.8 },
  pickupAddress: "A",
  pickupContact: { name: "S", phone: "0800" },
  dropoff: { lat: -6.21, lng: 106.81 },
  dropoffAddress: "B",
  dropoffContact: { name: "R", phone: "0801" },
  itemValueIDR: 100_000,
  itemDescription: "thing",
};

describe("compareRates", () => {
  it("returns rates from all providers, sorted by weighted score (best first)", async () => {
    const gosend = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 20_000, etaMinutes: 30 },
    ]);
    const grab = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 25_000, etaMinutes: 25 },
    ]);

    const result = await compareRates([gosend, grab], req);
    expect(result).toHaveLength(2);
    // Score is sorted descending; first must have the highest score.
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
  });

  it("with pure-price bias (speedBias=0), the cheapest wins", async () => {
    const a = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 15_000, etaMinutes: 60 },
    ]);
    const b = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 30_000, etaMinutes: 20 },
    ]);
    const result = await compareRates([a, b], req, { speedBias: 0 });
    expect(result[0].provider).toBe("gosend");
    expect(result[0].priceIDR).toBe(15_000);
  });

  it("with pure-speed bias (speedBias=1), the fastest wins", async () => {
    const a = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 15_000, etaMinutes: 60 },
    ]);
    const b = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 30_000, etaMinutes: 20 },
    ]);
    const result = await compareRates([a, b], req, { speedBias: 1 });
    expect(result[0].provider).toBe("grab");
    expect(result[0].etaMinutes).toBe(20);
  });

  it("returns results from the working provider when another throws", async () => {
    const ok = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 18_000, etaMinutes: 30 },
    ]);
    const broken = makeAdapter("grab", new Error("network down"));
    const result = await compareRates([ok, broken], req);
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("gosend");
  });

  it("returns results from the working provider when another returns empty", async () => {
    const ok = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 18_000, etaMinutes: 30 },
    ]);
    const empty = makeAdapter("grab", []);
    const result = await compareRates([ok, empty], req);
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("gosend");
  });

  it("returns an empty array (no throw) when every provider fails", async () => {
    const a = makeAdapter("gosend", new Error("boom"));
    const b = makeAdapter("grab", new Error("boom"));
    await expect(compareRates([a, b], req)).resolves.toEqual([]);
  });

  it("returns an empty array when every provider returns empty", async () => {
    const a = makeAdapter("gosend", []);
    const b = makeAdapter("grab", []);
    const result = await compareRates([a, b], req);
    expect(result).toEqual([]);
  });

  it("returns an empty array when called with no adapters", async () => {
    expect(await compareRates([], req)).toEqual([]);
  });

  it("filters rates that exceed maxEtaMinutes", async () => {
    const slow = makeAdapter("gosend", [
      { provider: "gosend", tier: "sameday", priceIDR: 10_000, etaMinutes: 500 },
    ]);
    const fast = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 25_000, etaMinutes: 30 },
    ]);
    const result = await compareRates([slow, fast], req, { maxEtaMinutes: 120 });
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("grab");
  });

  it("flattens multiple rate quotes from a single provider", async () => {
    const multi = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 20_000, etaMinutes: 30 },
      { provider: "gosend", tier: "sameday", priceIDR: 12_000, etaMinutes: 180 },
    ]);
    const result = await compareRates([multi], req);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.tier).sort()).toEqual(["instant", "sameday"]);
  });

  it("every returned rate has a score in [0, 1]", async () => {
    const a = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 15_000, etaMinutes: 60 },
      { provider: "gosend", tier: "sameday", priceIDR: 9_000, etaMinutes: 180 },
    ]);
    const b = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 30_000, etaMinutes: 20 },
    ]);
    const result = await compareRates([a, b], req);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("ordering is stable-descending by score", async () => {
    const a = makeAdapter("gosend", [
      { provider: "gosend", tier: "instant", priceIDR: 10_000, etaMinutes: 30 },
      { provider: "gosend", tier: "sameday", priceIDR: 30_000, etaMinutes: 200 },
    ]);
    const b = makeAdapter("grab", [
      { provider: "grab", tier: "instant", priceIDR: 20_000, etaMinutes: 25 },
    ]);
    const result = await compareRates([a, b], req);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
