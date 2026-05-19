import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => {
  const adapterSearch = vi.fn();
  const supabaseFrom = vi.fn(() => ({
    insert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
    select: vi.fn(() => ({
      textSearch: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [] })),
        })),
      })),
    })),
    eq: vi.fn(),
    limit: vi.fn(),
  }));

  return {
    adapterSearch,
    supabaseFrom,
  };
});

vi.mock("../clients", () => ({
  sourcingAdapters: [
    {
      source: "manual",
      search: mocks.adapterSearch,
    },
  ],
  supabase: {
    from: mocks.supabaseFrom,
  },
}));

vi.mock("../security/pii", () => ({
  encryptPII: (value: string | null | undefined) => value ?? null,
  tokenizeAddress: (value: string | null | undefined) => value ?? null,
}));

import { sourcing } from "./sourcing";

function createApp() {
  const app = new Hono();
  app.route("/api/sourcing", sourcing);
  return app;
}
const MAX_SEARCH_DISTANCE_KM = Number((35 * 1.60934).toFixed(2));

describe("sourcing route input modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><head><title>noop</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts URL mode and derives query text from referenceUrl when query is omitted", async () => {
    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://example.com/items/super-mixer-3000",
        title: "Super Mixer 3000",
        imageUrl: "https://cdn.example.com/super-mixer-3000.jpg",
        priceIDR: 325_000,
        pickupAddress: "Jl. Sudirman 1",
        pickupGeo: { lat: -6.2088, lng: 106.8456 },
      },
    ]);

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "url",
        referenceUrl: "https://shop.example.com/product/super-mixer-3000.html",
        location: {
          near: { lat: -6.2088, lng: 106.8456 },
          maxDistanceKm: MAX_SEARCH_DISTANCE_KM,
        },
        limit: 12,
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.mode).toBe("url");
    expect(json.items).toHaveLength(1);
    expect(json.items[0].itemSubtotalIDR).toBe(325_000);
    expect(json.items[0].rankingScore).toBeGreaterThan(0);
    expect(mocks.adapterSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("super"),
        referenceUrl: "https://shop.example.com/product/super-mixer-3000.html",
      }),
    );
  });

  it("filters out results beyond 35 miles (~56km) when near coordinates are supplied", async () => {
    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://example.com/items/near",
        title: "Near Item",
        imageUrl: "https://cdn.example.com/near-item.jpg",
        priceIDR: 50_000,
        pickupAddress: "Near address",
        pickupGeo: { lat: -6.209, lng: 106.846 },
      },
      {
        source: "manual",
        externalUrl: "https://example.com/items/far",
        title: "Far Item",
        imageUrl: "https://cdn.example.com/far-item.jpg",
        priceIDR: 60_000,
        pickupAddress: "Far address",
        pickupGeo: { lat: -7.0, lng: 107.6 },
      },
    ]);

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "keyword",
        query: "wireless mouse",
        location: {
          near: { lat: -6.2088, lng: 106.8456 },
          maxDistanceKm: MAX_SEARCH_DISTANCE_KM,
        },
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.items).toHaveLength(1);
    expect(json.items[0].title).toBe("Near Item");
    expect(json.location.maxDistanceKm).toBe(MAX_SEARCH_DISTANCE_KM);
  });

  it("caps legacy maxDistanceKm to 35 miles (~56km)", async () => {
    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://example.com/items/near-legacy",
        title: "Near Legacy Item",
        imageUrl: "https://cdn.example.com/near-legacy-item.jpg",
        priceIDR: 70_000,
        pickupAddress: "Near legacy address",
        pickupGeo: { lat: -6.209, lng: 106.846 },
      },
      {
        source: "manual",
        externalUrl: "https://example.com/items/far-legacy",
        title: "Far Legacy Item",
        imageUrl: "https://cdn.example.com/far-legacy-item.jpg",
        priceIDR: 80_000,
        pickupAddress: "Far legacy address",
        pickupGeo: { lat: -7.0, lng: 107.6 },
      },
    ]);

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "wireless keyboard",
        near: { lat: -6.2088, lng: 106.8456 },
        maxDistanceKm: 80,
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.location.maxDistanceKm).toBe(MAX_SEARCH_DISTANCE_KM);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].title).toBe("Near Legacy Item");
  });

  it("resolves zipcode fallback into coordinates for search location", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { lat: "-6.1754", lon: "106.8272" },
    ]), { status: 200 })));

    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://example.com/items/zip",
        title: "Zip Item",
        imageUrl: "https://cdn.example.com/zip-item.jpg",
        priceIDR: 99_000,
        pickupAddress: "Zip address",
        pickupGeo: { lat: -6.176, lng: 106.827 },
      },
    ]);

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "keyword",
        query: "cat food",
        location: {
          zipcode: "10110",
          maxDistanceKm: MAX_SEARCH_DISTANCE_KM,
        },
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.location.zipcode).toBe("10110");
    expect(json.location.near).toEqual({ lat: -6.1754, lng: 106.8272 });
    expect(mocks.adapterSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        near: { lat: -6.1754, lng: 106.8272 },
      }),
    );
  });

  it("prefers retailer website image over adapter image when source page has og:image", async () => {
    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://retailer.example/product/abc",
        title: "Retailer Item",
        imageUrl: "https://cdn.example.com/adapter-image.jpg",
        priceIDR: 110_000,
        pickupAddress: "Jl. Sudirman 10",
        pickupGeo: { lat: -6.2088, lng: 106.8456 },
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        "<html><head><meta property=\"og:image\" content=\"https://retailer.example/images/from-site.jpg\" /></head></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      )),
    );

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "keyword",
        query: "retailer item",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.items).toHaveLength(1);
    expect(json.items[0].imageUrl).toBe("https://retailer.example/images/from-site.jpg");
  });

  it("falls back to adapter image when retailer website image is unavailable", async () => {
    mocks.adapterSearch.mockResolvedValueOnce([
      {
        source: "manual",
        externalUrl: "https://retailer.example/product/no-image",
        title: "Fallback Item",
        imageUrl: "https://cdn.example.com/fallback-image.jpg",
        priceIDR: 95_000,
        pickupAddress: "Jl. Thamrin 5",
        pickupGeo: { lat: -6.2, lng: 106.81 },
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><head><title>No image</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    );

    const app = createApp();
    const response = await app.request("/api/sourcing/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "keyword",
        query: "fallback item",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.items).toHaveLength(1);
    expect(json.items[0].imageUrl).toBe("https://cdn.example.com/fallback-image.jpg");
  });
});
