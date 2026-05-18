import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  env: {
    API_PUBLIC_URL: "http://localhost:4000",
  },
}));

vi.mock("../clients", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
    })),
    rpc: vi.fn(),
  },
  midtrans: {
    createTransaction: vi.fn(),
  },
  gosend: null,
  grab: null,
}));

vi.mock("../services/order-state-machine", () => ({
  transitionOrderStatus: vi.fn(),
}));

import { buildOrderCheckoutBreakdown } from "./orders";

describe("buildOrderCheckoutBreakdown", () => {
  it("returns item subtotal and delivery/service/tax totals in one contract", () => {
    const breakdown = buildOrderCheckoutBreakdown({
      itemSubtotalIDR: 320_000,
      deliveryFeeIDR: 19_000,
    });

    expect(breakdown.itemSubtotalIDR).toBe(320_000);
    expect(breakdown.deliveryFeeIDR).toBe(19_000);
    expect(breakdown.courierFeeIDR).toBe(19_000);
    expect(breakdown.serviceFeeIDR).toBeGreaterThan(0);
    expect(breakdown.taxIDR).toBeGreaterThanOrEqual(0);
    expect(breakdown.totalIDR).toBe(
      breakdown.deliveryFeeIDR + breakdown.serviceFeeIDR + breakdown.taxIDR,
    );
  });
});
