import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type SupabaseError = { code?: string; message?: string } | null;

  const state = {
    verifyResult: {
      valid: true,
      status: "paid",
      method: "qris",
      orderId: "GG-TEST-1",
    },
    webhookInsertResult: {
      data: { id: "evt-1" },
      error: null as SupabaseError,
    },
    paymentUpdateResult: {
      data: { id: "pay-1", order_id: "order-1" },
      error: null as SupabaseError,
    },
    webhookUpdateResult: {
      error: null as SupabaseError,
    },
    processResult: {
      claimed: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    },
  };

  const webhookEventsTable = {
    insert: vi.fn((_payload: unknown) => ({
      select: vi.fn((_columns: string) => ({
        returns: vi.fn(() => ({
          single: vi.fn(async () => state.webhookInsertResult),
        })),
      })),
    })),
    update: vi.fn((_payload: unknown) => ({
      eq: vi.fn(async (_column: string, _value: unknown) => state.webhookUpdateResult),
    })),
  };

  const paymentsTable = {
    update: vi.fn((_payload: unknown) => ({
      eq: vi.fn((_column: string, _value: unknown) => ({
        select: vi.fn((_columns: string) => ({
          returns: vi.fn(() => ({
            single: vi.fn(async () => state.paymentUpdateResult),
          })),
        })),
      })),
    })),
  };

  const deliveriesTable = {
    select: vi.fn((_columns: string) => ({
      eq: vi.fn((_columnA: string, _valueA: unknown) => ({
        eq: vi.fn((_columnB: string, _valueB: unknown) => ({
          single: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    update: vi.fn((_payload: unknown) => ({
      eq: vi.fn(async (_column: string, _value: unknown) => ({ error: null })),
    })),
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "webhook_events") return webhookEventsTable;
      if (table === "payments") return paymentsTable;
      if (table === "deliveries") return deliveriesTable;
      return {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn(),
      };
    }),
  };

  const midtrans = {
    verifyWebhook: vi.fn((_body: unknown) => state.verifyResult),
  };

  const mockTransitionOrderStatus = vi.fn(async () => ({ changed: true, status: "paid" as const }));
  const mockEnqueueBookCourierJob = vi.fn(async () => undefined);
  const mockProcessOrderJobs = vi.fn(async (_limit: number) => state.processResult);

  return {
    state,
    supabase,
    midtrans,
    mockTransitionOrderStatus,
    mockEnqueueBookCourierJob,
    mockProcessOrderJobs,
    webhookEventsTable,
    paymentsTable,
  };
});

vi.mock("../clients", () => ({
  gosend: null,
  grab: null,
  midtrans: mocks.midtrans,
  supabase: mocks.supabase,
}));

vi.mock("../env", () => ({
  env: {
    ORDER_JOBS_PROCESS_TOKEN: "process-token",
  },
}));

vi.mock("../services/order-state-machine", () => ({
  transitionOrderStatus: mocks.mockTransitionOrderStatus,
}));

vi.mock("../services/order-jobs", () => ({
  enqueueBookCourierJob: mocks.mockEnqueueBookCourierJob,
  processOrderJobs: mocks.mockProcessOrderJobs,
}));

import { webhooks } from "./webhooks";

function createApp() {
  const app = new Hono();
  app.route("/webhooks", webhooks);
  return app;
}

describe("webhook reliability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.verifyResult = {
      valid: true,
      status: "paid",
      method: "qris",
      orderId: "GG-TEST-1",
    };
    mocks.state.webhookInsertResult = {
      data: { id: "evt-1" },
      error: null,
    };
    mocks.state.paymentUpdateResult = {
      data: { id: "pay-1", order_id: "order-1" },
      error: null,
    };
    mocks.state.webhookUpdateResult = {
      error: null,
    };
    mocks.state.processResult = {
      claimed: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    };
  });

  it("transitions paid orders and enqueues durable booking jobs", async () => {
    const app = createApp();

    const response = await app.request("/webhooks/midtrans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transaction_id: "tx-1",
        order_id: "GG-TEST-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        nextStatus: "paid",
      }),
    );
    expect(mocks.mockEnqueueBookCourierJob).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({
        source: "midtrans_webhook",
        provider_order_id: "GG-TEST-1",
      }),
    );
  });

  it("marks failed payment notifications as failed transitions without enqueueing booking", async () => {
    mocks.state.verifyResult = {
      valid: true,
      status: "failed",
      method: "bank_transfer",
      orderId: "GG-TEST-1",
    };
    const app = createApp();

    const response = await app.request("/webhooks/midtrans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transaction_id: "tx-2",
        order_id: "GG-TEST-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        nextStatus: "failed",
      }),
    );
    expect(mocks.mockEnqueueBookCourierJob).not.toHaveBeenCalled();
  });

  it("requires a valid process token for /webhooks/order-jobs/process", async () => {
    const app = createApp();

    const unauthorized = await app.request("/webhooks/order-jobs/process", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await app.request("/webhooks/order-jobs/process?limit=7", {
      method: "POST",
      headers: {
        "x-order-jobs-token": "process-token",
      },
    });
    expect(authorized.status).toBe(200);
    expect(mocks.mockProcessOrderJobs).toHaveBeenCalledWith(7);
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      claimed: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    });
  });
});
