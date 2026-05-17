type CachedPreview = {
  mimeType: string;
  base64: string;
  expiresAt: number;
};

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 450_000;
const cache = new Map<string, CachedPreview | null>();

function isHttpUrl(input?: string): input is string {
  if (!input) return false;
  return input.startsWith("http://") || input.startsWith("https://");
}

export async function ensureImagePreviewDownloaded(src?: string): Promise<void> {
  if (!isHttpUrl(src)) return;
  const existing = cache.get(src);
  if (existing && existing.expiresAt > Date.now()) return;
  if (existing === null) return;

  try {
    const res = await fetch(src, {
      signal: AbortSignal.timeout(6_000),
      headers: {
        Accept: "image/*",
        "User-Agent": "GoGet-ImagePreview/1.0",
      },
    });
    if (!res.ok) {
      cache.set(src, null);
      return;
    }

    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      cache.set(src, null);
      return;
    }

    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      cache.set(src, null);
      return;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      cache.set(src, null);
      return;
    }

    const base64 = Buffer.from(bytes).toString("base64");
    cache.set(src, {
      mimeType,
      base64,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
  } catch {
    cache.set(src, null);
  }
}

export async function getImagePreviewUrl(src?: string): Promise<string | undefined> {
  if (!isHttpUrl(src)) return src;
  await ensureImagePreviewDownloaded(src);
  const preview = cache.get(src);
  if (!preview || preview.expiresAt <= Date.now()) return src;
  return `/api/images/preview?src=${encodeURIComponent(src)}`;
}

export async function getCachedImagePreview(
  src?: string,
): Promise<{ mimeType: string; base64: string } | null> {
  if (!isHttpUrl(src)) return null;
  await ensureImagePreviewDownloaded(src);
  const preview = cache.get(src);
  if (!preview || preview.expiresAt <= Date.now()) return null;
  return { mimeType: preview.mimeType, base64: preview.base64 };
}
