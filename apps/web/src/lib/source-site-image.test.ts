import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchSourceSiteImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_IMAGE_ACTOR_ID;
    delete process.env.APIFY_ACTOR_ID;
    delete process.env.APIFY_API_BASE_URL;
  });

  it("returns image from source page extractor before attempting Apify fallback", async () => {
    process.env.APIFY_TOKEN = "test-token";
    process.env.APIFY_IMAGE_ACTOR_ID = "skipper_lume/ecommerce-product-scraper";
    const fetchMock = vi.fn(async () => new Response(
      "<html><head><meta property=\"og:image\" content=\"https://store.example/images/local.jpg\" /></head></html>",
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchSourceSiteImage } = await import("./source-site-image");
    const imageUrl = await fetchSourceSiteImage("https://store.example/products/sku-1", {
      query: "sku 1",
    });

    expect(imageUrl).toBe("https://store.example/images/local.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Apify when source page extraction has no image", async () => {
    process.env.APIFY_TOKEN = "test-token";
    process.env.APIFY_IMAGE_ACTOR_ID = "skipper_lume/ecommerce-product-scraper";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html><head><title>No image tags</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { image: "https://cdn.example.com/product/apify-image.jpg" },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchSourceSiteImage } = await import("./source-site-image");
    const imageUrl = await fetchSourceSiteImage("https://store.example/products/sku-2", {
      query: "sku 2",
    });

    expect(imageUrl).toBe("https://cdn.example.com/product/apify-image.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("api.apify.com");
  });

  it("returns null when source extraction fails and Apify is not configured", async () => {
    const fetchMock = vi.fn(async () => new Response("<html><head><title>No image tags</title></head></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchSourceSiteImage } = await import("./source-site-image");
    const imageUrl = await fetchSourceSiteImage("https://store.example/products/sku-3", {
      query: "sku 3",
    });

    expect(imageUrl).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
