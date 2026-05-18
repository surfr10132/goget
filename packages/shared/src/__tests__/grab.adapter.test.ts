import { describe, expect, it, vi } from "vitest";
import { GrabAdapter, GrabProviderError } from "../couriers/grab";
import type { BookRequest, RateRequest } from "../couriers/types";

const rateRequest: RateRequest = {
  pickup: { lat: -6.2, lng: 106.8 },
  pickupAddress: "Pickup street",
  pickupContact: { name: "Pickup", phone: "+62000000000" },
  dropoff: { lat: -6.21, lng: 106.81 },
  dropoffAddress: "Dropoff street",
  dropoffContact: { name: "Dropoff", phone: "+62000000001" },
  itemValueIDR: 100_000,
  itemDescription: "Item",
};

const bookRequest: BookRequest = {
  ...rateRequest,
  tier: "instant",
  clientReference: "GG-TEST-1",
  rateToken: "quote-123",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GrabAdapter hardening", () => {
  it("retries transient quote failures and returns rates", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse({
        quotes: [{ service: "INSTANT", amount: 12000, quoteId: "q1", etaInMinutes: 20 }],
      }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 1,
      timeoutMs: 1000,
    });

    const rates = await adapter.getRates(rateRequest);
    expect(rates).toHaveLength(1);
    expect(rates[0].rateToken).toBe("q1");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refreshes token once on 401 and retries authenticated call", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: "expired token" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-b", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        quotes: [{ service: "INSTANT", amount: 15000, quoteId: "q2", etaInMinutes: 24 }],
      }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    const rates = await adapter.getRates(rateRequest);
    expect(rates).toHaveLength(1);
    expect(rates[0].rateToken).toBe("q2");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails booking when delivery id is missing", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ trackingURL: "https://track" }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(adapter.bookDelivery(bookRequest)).rejects.toMatchObject({
      name: "GrabProviderError",
      operation: "book",
    } satisfies Partial<GrabProviderError>);
  });

  it("fails when token payload is malformed", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "", expires_in: "nope" }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    await expect(adapter.getRates(rateRequest)).rejects.toMatchObject({
      name: "GrabProviderError",
      operation: "token",
    } satisfies Partial<GrabProviderError>);
  });

  it("fails when quote payload contains malformed numeric fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        quotes: [
          { service: "INSTANT", quoteId: "valid-1", amount: 19000, etaInMinutes: 20 },
          { service: "INSTANT", quoteId: "invalid-1", amount: "NaN" },
        ],
      }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    await expect(adapter.getRates(rateRequest)).rejects.toMatchObject({
      name: "GrabProviderError",
      operation: "quote",
    } satisfies Partial<GrabProviderError>);
  });

  it("drops quote rows that have no usable fare fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        quotes: [
          { service: "INSTANT", quoteId: "valid-1", amount: 19000, etaInMinutes: 20 },
          { service: "INSTANT", quoteId: "skip-1" },
        ],
      }));

    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    const rates = await adapter.getRates(rateRequest);
    expect(rates).toHaveLength(1);
    expect(rates[0].rateToken).toBe("valid-1");
  });

  it("fails webhook parsing when payload has no booking identifier", async () => {
    const adapter = new GrabAdapter({
      clientId: "cid",
      clientSecret: "secret",
      baseUrl: "https://example.grab",
    });
    const body = JSON.stringify({ status: "ALLOCATED" });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = await import("node:crypto").then(({ createHmac }) =>
      createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex"));

    expect(() => adapter.parseWebhook(
      { "x-grab-signature": signature, "x-grab-timestamp": timestamp },
      body,
    )).toThrow("Grab webhook missing booking identifier");
  });
});
