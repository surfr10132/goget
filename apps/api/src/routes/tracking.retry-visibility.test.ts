import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single,
          })),
        })),
      })),
    })),
  };

  return { single, supabase };
});

vi.mock("../clients", () => ({
  supabase: mocks.supabase,
}));

import { tracking } from "./tracking";

function createApp() {
  const app = new Hono();
  app.use("/api/tracking/*", async (c, next) => {
    c.set("auth", { userId: "user-1" });
    await next();
  });
  app.route("/api/tracking", tracking);
  return app;
}

describe("tracking retry visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps booking_retry_* fields into fulfillment_retry payload", async () => {
    mocks.single.mockResolvedValueOnce({
      data: {
        short_code: "GG1234",
        status: "paid",
        total_idr: 28900,
        created_at: "2026-05-17T00:00:00.000Z",
        quote: null,
        delivery: [],
        events: [],
        booking_retry_state: "retrying",
        booking_retry_attempt_count: 2,
        booking_retry_max_attempts: 6,
        booking_retry_last_error: "provider timeout",
        booking_retry_next_retry_at: "2026-05-17T00:10:00.000Z",
        booking_retry_updated_at: "2026-05-17T00:05:00.000Z",
      },
      error: null,
    });

    const app = createApp();
    const response = await app.request("/api/tracking/gg1234");

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.fulfillment_retry).toEqual({
      state: "retrying",
      attemptCount: 2,
      maxAttempts: 6,
      lastError: "provider timeout",
      nextRetryAt: "2026-05-17T00:10:00.000Z",
      updatedAt: "2026-05-17T00:05:00.000Z",
    });
  });

  it("returns 404 when tracking lookup does not find an order", async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: null });

    const app = createApp();
    const response = await app.request("/api/tracking/unknown");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });
});
