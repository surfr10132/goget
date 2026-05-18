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

import { buildOrderSnapshotPayload } from "./orders";

describe("buildOrderSnapshotPayload", () => {
  it("builds selected listing + fee + courier preference snapshots with retry defaults", () => {
    const payload = buildOrderSnapshotPayload({
      selectedListing: {
        source: "tokopedia",
        title: "Nintendo Switch OLED",
        externalUrl: "https://www.tokopedia.com/example/switch-oled",
        imageUrl: "https://img.example/switch.jpg",
        sellerName: "GameStore",
        pickupAddress: "Jakarta Barat",
        itemSubtotalIDR: 4_500_000,
      },
      breakdown: {
        itemSubtotalIDR: 4_500_000,
        deliveryFeeIDR: 20_000,
        courierFeeIDR: 20_000,
        serviceFeeIDR: 8_000,
        taxIDR: 900,
        totalIDR: 28_900,
      },
      courierPreference: {
        provider: "gosend",
        tier: "instant",
        useLinkedAccount: true,
        linkedAccountRef: "user-gosend-1",
      },
    });

    expect(payload.selected_listing_snapshot).toMatchObject({
      source: "tokopedia",
      title: "Nintendo Switch OLED",
      itemSubtotalIDR: 4_500_000,
    });
    expect(payload.checkout_fee_snapshot.totalIDR).toBe(28_900);
    expect(payload.courier_preference_snapshot).toMatchObject({
      provider: "gosend",
      tier: "instant",
      useLinkedAccount: true,
      linkedAccountRef: "user-gosend-1",
    });
    expect(payload.booking_retry_state).toBe("idle");
    expect(payload.booking_retry_attempt_count).toBe(0);
    expect(payload.booking_retry_max_attempts).toBe(0);
    expect(payload.booking_retry_last_error).toBeNull();
    expect(payload.booking_retry_next_retry_at).toBeNull();
  });
});
