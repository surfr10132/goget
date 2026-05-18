const sourceSiteImageCache = new Map<string, string | null>();

export function normalizeHttpUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const normalized = new URL(value.trim()).toString();
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return null;
    return normalized;
  } catch {
    return null;
  }
}

function isGoogleMapsUrl(url: string): boolean {
  return url.startsWith("https://www.google.com/maps");
}

export async function fetchSourceSiteImage(url: string | undefined): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl || isGoogleMapsUrl(normalizedUrl)) return null;
  if (sourceSiteImageCache.has(normalizedUrl)) return sourceSiteImageCache.get(normalizedUrl)!;

  try {
    const res = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(4_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoGet-Bot/1.0; +https://goget.id)",
        "Accept": "text/html",
      },
    });
    if (!res.ok) {
      sourceSiteImageCache.set(normalizedUrl, null);
      return null;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      sourceSiteImageCache.set(normalizedUrl, null);
      return null;
    }
    let html = "";
    while (html.length < 8_192) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();

    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
      /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      const candidate = match?.[1];
      if (!candidate) continue;
      try {
        const absolute = normalizeHttpUrl(new URL(candidate.trim().replaceAll("&amp;", "&"), normalizedUrl).toString());
        if (absolute) {
          sourceSiteImageCache.set(normalizedUrl, absolute);
          return absolute;
        }
      } catch {
        // Skip invalid candidate URL and continue.
      }
    }

    sourceSiteImageCache.set(normalizedUrl, null);
    return null;
  } catch {
    sourceSiteImageCache.set(normalizedUrl, null);
    return null;
  }
}
