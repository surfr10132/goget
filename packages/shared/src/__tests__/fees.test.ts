import { describe, it, expect } from "vitest";
import {
  computeFees,
  computeCheckoutPricing,
  SERVICE_FEE_FLAT_IDR,
  PPN_PCT,
} from "../fees";
import { roundIDR } from "../money";

/**
 * Concierge fee rules (item is paid directly to marketplace, not to GoGet):
 *   service = roundIDR(SERVICE_FEE_FLAT_IDR)
 *   tax     = roundIDR(PPN_PCT * service)
 *   total   = courier + service + tax
 *
 * The flat-fee shape is intentional under the concierge model. If a future
 * pricing change scales the service fee by declared item value, both
 * `FeeInputs` and these tests need to grow together; the "constant regardless
 * of input" assertion below will fail loudly and force the update.
 */

describe("computeFees", () => {
  describe("service fee (flat)", () => {
    it("equals SERVICE_FEE_FLAT_IDR (rounded) regardless of courier fee", () => {
      const expected = roundIDR(SERVICE_FEE_FLAT_IDR);
      const samples = [0, 1, 999, 1_000, 12_345, 50_000, 500_000, 1_000_000];
      for (const courierFeeIDR of samples) {
        expect(computeFees({ courierFeeIDR }).serviceFeeIDR).toBe(expected);
      }
    });

    it("is a multiple of Rp 100 (rounding contract)", () => {
      expect(computeFees({ courierFeeIDR: 0 }).serviceFeeIDR % 100).toBe(0);
    });
  });

  describe("tax (PPN)", () => {
    it("equals PPN_PCT * serviceFee, rounded to nearest Rp 100", () => {
      const r = computeFees({ courierFeeIDR: 0 });
      expect(r.taxIDR).toBe(roundIDR(r.serviceFeeIDR * PPN_PCT));
    });

    it("is a multiple of Rp 100", () => {
      expect(computeFees({ courierFeeIDR: 50_000 }).taxIDR % 100).toBe(0);
    });

    it("matches the documented PPN_PCT constant (11% Indonesian VAT)", () => {
      expect(PPN_PCT).toBe(0.11);
    });
  });

  describe("total math", () => {
    it("total = courier + service + tax", () => {
      const r = computeFees({ courierFeeIDR: 15_000 });
      expect(r.totalIDR).toBe(r.courierFeeIDR + r.serviceFeeIDR + r.taxIDR);
    });

    it("passes through the courier amount unchanged", () => {
      const r = computeFees({ courierFeeIDR: 7_890 });
      expect(r.courierFeeIDR).toBe(7_890);
    });

    it("handles zero courier fee", () => {
      const r = computeFees({ courierFeeIDR: 0 });
      expect(r.totalIDR).toBe(r.serviceFeeIDR + r.taxIDR);
    });

    it("scales linearly with courier fee (the only variable input)", () => {
      const a = computeFees({ courierFeeIDR: 10_000 });
      const b = computeFees({ courierFeeIDR: 20_000 });
      expect(b.totalIDR - a.totalIDR).toBe(10_000);
    });
  });

  describe("integers only", () => {
    it("all returned amounts are integers across a wide sweep of courier fees", () => {
      const samples = [
        0, 1, 999, 1_000, 12_345, 50_000, 100_000, 250_000, 999_999, 1_000_000,
      ];
      for (const courierFeeIDR of samples) {
        const r = computeFees({ courierFeeIDR });
        expect(Number.isInteger(r.serviceFeeIDR)).toBe(true);
        expect(Number.isInteger(r.taxIDR)).toBe(true);
        expect(Number.isInteger(r.totalIDR)).toBe(true);
        expect(Number.isInteger(r.courierFeeIDR)).toBe(true);
      }
    });
  });
});

describe("computeCheckoutPricing", () => {
  it("includes item subtotal plus delivery/service/tax breakdown fields", () => {
    const r = computeCheckoutPricing({
      itemSubtotalIDR: 450_000,
      deliveryFeeIDR: 21_000,
    });

    expect(r.itemSubtotalIDR).toBe(450_000);
    expect(r.deliveryFeeIDR).toBe(21_000);
    expect(r.courierFeeIDR).toBe(21_000);
    expect(r.serviceFeeIDR).toBe(roundIDR(SERVICE_FEE_FLAT_IDR));
    expect(r.taxIDR).toBe(roundIDR(r.serviceFeeIDR * PPN_PCT));
    expect(r.totalIDR).toBe(r.deliveryFeeIDR + r.serviceFeeIDR + r.taxIDR);
  });

  it("preserves integer rupiah outputs for all fields", () => {
    const r = computeCheckoutPricing({
      itemSubtotalIDR: 99_999,
      deliveryFeeIDR: 12_345,
    });
    expect(Number.isInteger(r.itemSubtotalIDR)).toBe(true);
    expect(Number.isInteger(r.deliveryFeeIDR)).toBe(true);
    expect(Number.isInteger(r.courierFeeIDR)).toBe(true);
    expect(Number.isInteger(r.serviceFeeIDR)).toBe(true);
    expect(Number.isInteger(r.taxIDR)).toBe(true);
    expect(Number.isInteger(r.totalIDR)).toBe(true);
  });
});
