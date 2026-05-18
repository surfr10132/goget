import { Hono } from "hono";
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

import { orders } from "./orders";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function createApp() {
  const app = new Hono();
  app.use("/api/orders/*", async (c, next) => {
    c.set("auth", { userId: TEST_USER_ID });
    await next();
  });
  app.route("/api/orders", orders);
  return app;
}

describe("orders idempotency enforcement", () => {
  it("rejects POST /api/orders without Idempotency-Key", async () => {
    const app = createApp();
    const response = await app.request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteId: "11111111-1111-1111-1111-111111111111",
        courierRateId: "22222222-2222-2222-2222-222222222222",
        addressId: "33333333-3333-3333-3333-333333333333",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency-Key header is required",
    });
  });

  it("rejects POST /api/orders/quick without Idempotency-Key", async () => {
    const app = createApp();
    const response = await app.request("/api/orders/quick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item: {
          title: "Example item",
          itemPriceIDR: 100000,
          source: "manual",
        },
        pickup: {
          address: "Jl. Pickup",
          geo: { lat: -6.2, lng: 106.8 },
        },
        dropoff: {
          address: "Jl. Dropoff",
          geo: { lat: -6.21, lng: 106.82 },
          city: "Jakarta",
          province: "DKI Jakarta",
        },
        recipient: {
          name: "Alex",
          phone: "+628123456789",
        },
        courier: {
          provider: "gosend",
          tier: "instant",
          priceIDR: 20000,
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency-Key header is required",
    });
  });
});
