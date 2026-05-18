import { afterEach, describe, expect, it, vi } from "vitest";

describe("image preview failure cache TTL", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries failed preview fetches after failure TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const src = "https://cdn.example.com/item.png";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "3",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getImagePreviewUrl } = await import("./image-preview");

    const firstAttemptUrl = await getImagePreviewUrl(src);
    expect(firstAttemptUrl).toBe(src);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondAttemptBeforeExpiry = await getImagePreviewUrl(src);
    expect(secondAttemptBeforeExpiry).toBe(src);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime((2 * 60 * 1000) + 1);

    const afterTtlAttemptUrl = await getImagePreviewUrl(src);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(afterTtlAttemptUrl).toBe(`/api/images/preview?src=${encodeURIComponent(src)}`);
  });
});
