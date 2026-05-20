import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPT_LANGUAGE_ID,
  DESKTOP_CHROME_UA,
  __resetBucketsForTests,
  createTokenBucket,
  safeFetch,
} from "../sourcing";
import { TokopediaAdapter } from "../sourcing/tokopedia";
import { ShopeeAdapter } from "../sourcing/shopee";
import { BukalapakAdapter } from "../sourcing/bukalapak";
import { GitHubCodeSearchAdapter } from "../sourcing/github";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  __resetBucketsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createTokenBucket", () => {
  it("blocks the 3rd request within 1 second when burst=2 @ 1 rps", async () => {
    let t = 1_000_000;
    const sleeps: number[] = [];
    const bucket = createTokenBucket({
      ratePerSec: 1,
      burst: 2,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    });

    await bucket.waitForToken();
    await bucket.waitForToken();
    await bucket.waitForToken();

    // First two should have been instant; the third must have slept ~1s.
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(900);
    expect(sleeps[0]).toBeLessThanOrEqual(1100);
  });
});

describe("GitHubCodeSearchAdapter", () => {
  it("returns [] on schema failure", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ nope: true }));
    vi.stubGlobal("fetch", fakeFetch);
    await expect(new GitHubCodeSearchAdapter().search({ text: "oauth flow" })).resolves.toEqual([]);
  });

  it("attaches bearer auth and maps valid results", async () => {
    const captured: { headers?: HeadersInit } = {};
    const fakeFetch = vi.fn(async (_url: any, init: any) => {
      captured.headers = init.headers;
      return jsonResponse({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            name: "auth.ts",
            path: "src/auth.ts",
            html_url: "https://github.com/acme/app/blob/main/src/auth.ts",
            repository: {
              id: 42,
              full_name: "acme/app",
              html_url: "https://github.com/acme/app",
              description: "Main app",
              owner: {
                login: "acme",
                avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
              },
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fakeFetch);

    const out = await new GitHubCodeSearchAdapter({ token: "token-123" }).search({ text: "oauth flow" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "github",
      externalId: "acme/app:src/auth.ts",
      externalUrl: "https://github.com/acme/app/blob/main/src/auth.ts",
      title: "acme/app/src/auth.ts",
      merchantName: "acme",
      merchantExternalId: "42",
      pickupAddress: "acme/app",
      priceIDR: 0,
    });

    const h = captured.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer token-123");
    expect(h.Accept).toBe("application/vnd.github+json");
  });

  it("adds repo qualifier when referenceUrl is a GitHub repo URL", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({
        total_count: 0,
        incomplete_results: false,
        items: [],
      }),
    );
    vi.stubGlobal("fetch", fakeFetch);

    await new GitHubCodeSearchAdapter().search({
      text: "rate limiter",
      referenceUrl: "https://github.com/acme/platform",
    });

    const calledUrl = String((fakeFetch as any).mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("repo%3Aacme%2Fplatform");
    expect(calledUrl).toContain("in%3Afile");
  });
});

describe("safeFetch", () => {
  it("sets desktop-Chrome UA and id-ID Accept-Language headers", async () => {
    const captured: { headers?: HeadersInit } = {};
    const fakeFetch = vi.fn(async (_url: any, init: any) => {
      captured.headers = init.headers;
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fakeFetch);

    await safeFetch("https://example.test/x", { skipRateLimit: true });

    const h = captured.headers as Record<string, string>;
    expect(h["User-Agent"]).toBe(DESKTOP_CHROME_UA);
    expect(h["Accept-Language"]).toBe(ACCEPT_LANGUAGE_ID);
  });

  it("retries once on a 503 and returns the eventual 200", async () => {
    const calls: number[] = [];
    let n = 0;
    const fakeFetch = vi.fn(async () => {
      n++;
      calls.push(n);
      if (n === 1) return new Response("nope", { status: 503 });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fakeFetch);

    const r = await safeFetch("https://example.test/y", {
      skipRateLimit: true,
      sleep: async () => {},
    });

    expect(r.status).toBe(200);
    expect(calls).toEqual([1, 2]);
  });

  it("respects an explicit User-Agent override from the caller", async () => {
    const captured: { headers?: HeadersInit } = {};
    const fakeFetch = vi.fn(async (_url: any, init: any) => {
      captured.headers = init.headers;
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fakeFetch);

    await safeFetch("https://example.test/z", {
      skipRateLimit: true,
      headers: { "User-Agent": "custom/1.0" },
    });

    const h = captured.headers as Record<string, string>;
    expect(h["User-Agent"]).toBe("custom/1.0");
    expect(h["Accept-Language"]).toBe(ACCEPT_LANGUAGE_ID);
  });
});

describe("TokopediaAdapter", () => {
  it("returns [] on totally bad JSON instead of throwing", async () => {
    const fakeFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fakeFetch);

    const adapter = new TokopediaAdapter();
    await expect(adapter.search({ text: "ps5" })).resolves.toEqual([]);
  });

  it("returns [] when the response shape totally fails the schema", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({ unexpected: "shape" }),
    );
    vi.stubGlobal("fetch", fakeFetch);

    const adapter = new TokopediaAdapter();
    await expect(adapter.search({ text: "ps5" })).resolves.toEqual([]);
  });

  it("sends UA + Accept-Language headers via safeFetch", async () => {
    const captured: { headers?: HeadersInit } = {};
    const fakeFetch = vi.fn(async (_url: any, init: any) => {
      captured.headers = init.headers;
      return jsonResponse([
        { data: { ace_search_product_v4: { data: { products: [] } } } },
      ]);
    });
    vi.stubGlobal("fetch", fakeFetch);

    await new TokopediaAdapter().search({ text: "ps5" });
    const h = captured.headers as Record<string, string>;
    expect(h["User-Agent"]).toBe(DESKTOP_CHROME_UA);
    expect(h["Accept-Language"]).toBe(ACCEPT_LANGUAGE_ID);
  });

  it("tolerates one malformed item and keeps the well-formed ones", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse([
        {
          data: {
            ace_search_product_v4: {
              data: {
                products: [
                  {
                    id: 1,
                    name: "Good Item",
                    url: "https://tokopedia.com/p/1",
                    priceInt: 150000,
                    shop: { id: 9, name: "Shop A", city: "Jakarta" },
                  },
                  // Missing required fields:
                  { foo: "bar" },
                  {
                    id: 2,
                    name: "Also Good",
                    url: "https://tokopedia.com/p/2",
                    priceInt: 200000,
                  },
                ],
              },
            },
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fakeFetch);

    const out = await new TokopediaAdapter().search({ text: "x" });
    expect(out.map(i => i.title)).toEqual(["Good Item", "Also Good"]);
    expect(out[0].priceIDR).toBe(150000);
    expect(out[0].merchantName).toBe("Shop A");
  });
});

describe("ShopeeAdapter", () => {
  it("returns [] on schema failure", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ wrong: true }));
    vi.stubGlobal("fetch", fakeFetch);
    await expect(new ShopeeAdapter().search({ text: "x" })).resolves.toEqual([]);
  });

  it("tolerates one malformed item and keeps the rest", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            item_basic: {
              itemid: 100,
              shopid: 7,
              name: "Shopee Good",
              price: 25_000 * 100000,
            },
          },
          { item_basic: { missing: "fields" } },
          {
            item_basic: {
              itemid: 101,
              shopid: 7,
              name: "Another Good",
              price: 30_000 * 100000,
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fakeFetch);

    const out = await new ShopeeAdapter().search({ text: "x" });
    expect(out.map(i => i.title)).toEqual(["Shopee Good", "Another Good"]);
    expect(out[0].priceIDR).toBe(25_000);
  });
});

describe("BukalapakAdapter", () => {
  it("returns [] on schema failure", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ totally: "off" }));
    vi.stubGlobal("fetch", fakeFetch);
    await expect(new BukalapakAdapter().search({ text: "x" })).resolves.toEqual(
      [],
    );
  });

  it("tolerates one malformed item and keeps the rest", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: 1,
            name: "Buka A",
            price: 50_000,
            url: "https://www.bukalapak.com/p/1",
          },
          { junk: true },
          {
            id: 2,
            name: "Buka B",
            price: 60_000,
            url: "https://www.bukalapak.com/p/2",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fakeFetch);

    const out = await new BukalapakAdapter().search({ text: "x" });
    expect(out.map(i => i.title)).toEqual(["Buka A", "Buka B"]);
    expect(out[1].priceIDR).toBe(60_000);
  });
});
