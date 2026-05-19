type CachedPreview = {
  mimeType: string;
  base64: string;
  expiresAt: number;
};
type FailedPreview = {
  failed: true;
  expiresAt: number;
};

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const FAILED_PREVIEW_TTL_MS = 2 * 60 * 1000;
const MAX_IMAGE_BYTES = 450_000;
const IMAGE_PREVIEW_FETCH_TIMEOUT_MS = 3_000;
const cache = new Map<string, CachedPreview | FailedPreview>();

function isHttpUrl(input?: string): input is string {
  if (!input) return false;
  return input.startsWith("http://") || input.startsWith("https://");
}

export async function ensureImagePreviewDownloaded(src?: string): Promise<void> {
  if (!isHttpUrl(src)) return;
  const sourceUrl = src;
  const existing = cache.get(sourceUrl);
  if (existing && existing.expiresAt > Date.now()) return;
  if (existing && existing.expiresAt <= Date.now()) cache.delete(sourceUrl);

  function cacheFailure() {
    cache.set(sourceUrl, { failed: true, expiresAt: Date.now() + FAILED_PREVIEW_TTL_MS });
  }

  try {
    const res = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(IMAGE_PREVIEW_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "image/*",
        "User-Agent": "GoGet-ImagePreview/1.0",
      },
    });
    if (!res.ok) {
      cacheFailure();
      return;
    }

    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      cacheFailure();
      return;
    }

    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      cacheFailure();
      return;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      cacheFailure();
      return;
    }

    const base64 = Buffer.from(bytes).toString("base64");
    cache.set(sourceUrl, {
      mimeType,
      base64,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
  } catch {
    cacheFailure();
  }
}
export function buildImagePreviewUrl(src?: string): string | undefined {
  if (!isHttpUrl(src)) return src;
  return `/api/images/preview?src=${encodeURIComponent(src)}`;
}

export async function getImagePreviewUrl(src?: string): Promise<string | undefined> {
  if (!isHttpUrl(src)) return src;
  await ensureImagePreviewDownloaded(src);
  const preview = cache.get(src);
  if (!preview || preview.expiresAt <= Date.now() || "failed" in preview) return src;
  return buildImagePreviewUrl(src);
}

export async function getCachedImagePreview(
  src?: string,
): Promise<{ mimeType: string; base64: string } | null> {
  if (!isHttpUrl(src)) return null;
  await ensureImagePreviewDownloaded(src);
  const preview = cache.get(src);
  if (!preview || preview.expiresAt <= Date.now() || "failed" in preview) return null;
  return { mimeType: preview.mimeType, base64: preview.base64 };
}
