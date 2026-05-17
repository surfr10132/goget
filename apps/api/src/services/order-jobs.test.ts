import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type SupabaseError = { code?: string; message?: string } | null;

  const state = {
    enqueueRpcResult: { error: null as SupabaseError },
    claimRpcResult: { data: [] as Array<Record<string, unknown>>, error: null as SupabaseError },
    orderJobUpdates: [] as Array<Record<string, unknown>>,
    updateResult: { error: null as SupabaseError },
    bookResponses: [] as Response[],
  };

  const mockBookCourierForOrder = vi.fn(async () => {
    if (state.bookResponses.length > 0) return state.bookResponses.shift() as Response;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const mockTransitionOrderStatus = vi.fn(async () => ({ changed: true, status: "failed" as const }));

  const mockSupabase = {
    rpc: vi.fn((fnName: string, _args: unknown) => {
      if (fnName === "enqueue_order_job") return Promise.resolve(state.enqueueRpcResult);
      if (fnName === "claim_order_jobs") {
        return {
          returns: vi.fn(async () => state.claimRpcResult),
        };
      }
      return Promise.resolve({ error: { message: `unexpected rpc: ${fnName}` } });
    }),
    from: vi.fn((_table: string) => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        state.orderJobUpdates.push(payload);
        let builder: {
          eq: (column: string, value: unknown) => typeof builder;
          then: (
            resolve: (value: { error: SupabaseError }) => unknown,
            reject: (reason?: unknown) => unknown,
          ) => Promise<unknown>;
        };
        builder = {
          eq: vi.fn((_column: string, _value: unknown) => builder),
          then: (
            resolve: (value: { error: SupabaseError }) => unknown,
            reject: (reason?: unknown) => unknown,
          ) => Promise.resolve(state.updateResult).then(resolve, reject),
        };
        return builder;
      }),
    })),
  };

  return {
    state,
    mockSupabase,
    mockBookCourierForOrder,
    mockTransitionOrderStatus,
  };
});

vi.mock("../clients", () => ({
  supabase: mocks.mockSupabase,
}));

vi.mock("../routes/orders", () => ({
  bookCourierForOrder: mocks.mockBookCourierForOrder,
}));

vi.mock("./order-state-machine", () => ({
  transitionOrderStatus: mocks.mockTransitionOrderStatus,
}));

import { enqueueBookCourierJob, processOrderJobs } from "./order-jobs";

describe("order-jobs reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.enqueueRpcResult = { error: null };
    mocks.state.claimRpcResult = { data: [], error: null };
    mocks.state.orderJobUpdates = [];
    mocks.state.updateResult = { error: null };
    mocks.state.bookResponses = [];
  });

  it("enqueueBookCourierJob sends durable enqueue RPC with deterministic dedupe key", async () => {
    await enqueueBookCourierJob("order-1", { source: "test" });

    expect(mocks.mockSupabase.rpc).toHaveBeenCalledWith(
      "enqueue_order_job",
      expect.objectContaining({
        p_order_id: "order-1",
        p_job_type: "book_courier",
        p_dedupe_key: "book_courier:order-1",
        p_payload: { source: "test" },
      }),
    );
  });

  it("processOrderJobs marks a successful booking job as succeeded", async () => {
    mocks.state.claimRpcResult = {
      data: [
        {
          id: "job-1",
          order_id: "order-1",
          job_type: "book_courier",
          payload: {},
          attempt_count: 0,
          max_attempts: 6,
        },
      ],
      error: null,
    };
    mocks.state.bookResponses = [new Response(JSON.stringify({ ok: true }), { status: 200 })];

    const result = await processOrderJobs(5);

    expect(result).toEqual({ claimed: 1, succeeded: 1, retried: 0, failed: 0 });
    expect(mocks.state.orderJobUpdates[0]).toMatchObject({
      status: "succeeded",
      attempt_count: 1,
      last_error: null,
    });
  });

  it("processOrderJobs schedules retry with backoff for non-terminal failure", async () => {
    mocks.state.claimRpcResult = {
      data: [
        {
          id: "job-2",
          order_id: "order-2",
          job_type: "book_courier",
          payload: {},
          attempt_count: 0,
          max_attempts: 3,
        },
      ],
      error: null,
    };
    mocks.state.bookResponses = [
      new Response(JSON.stringify({ error: "provider timeout" }), { status: 503 }),
    ];

    const result = await processOrderJobs(5);

    expect(result).toEqual({ claimed: 1, succeeded: 0, retried: 1, failed: 0 });
    expect(mocks.state.orderJobUpdates[0].status).toBe("pending");
    expect(mocks.state.orderJobUpdates[0].attempt_count).toBe(1);
    expect(typeof mocks.state.orderJobUpdates[0].run_at).toBe("string");
    expect(mocks.mockTransitionOrderStatus).not.toHaveBeenCalled();
  });

  it("processOrderJobs marks terminal failure and transitions order to failed", async () => {
    mocks.state.claimRpcResult = {
      data: [
        {
          id: "job-3",
          order_id: "order-3",
          job_type: "book_courier",
          payload: {},
          attempt_count: 2,
          max_attempts: 3,
        },
      ],
      error: null,
    };
    mocks.state.bookResponses = [
      new Response(JSON.stringify({ error: "permanent provider failure" }), { status: 500 }),
    ];

    const result = await processOrderJobs(5);

    expect(result).toEqual({ claimed: 1, succeeded: 0, retried: 0, failed: 1 });
    expect(mocks.state.orderJobUpdates[0]).toMatchObject({
      status: "failed",
      attempt_count: 3,
    });
    expect(mocks.mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-3",
        nextStatus: "failed",
      }),
    );
  });
});
