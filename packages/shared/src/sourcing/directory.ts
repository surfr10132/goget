import type { SourcingAdapter, SourcingQuery, SourcedItem } from "./types";

/**
 * Directory adapter — searches GoGet's own curated merchant database.
 * Useful for hard-to-find items where we have a known specialty store
 * (vinyl shops, importers, hobby shops, pharmacies, etc.).
 *
 * Implementation lives in /apps/api where it has DB access; this is a
 * thin pass-through so client code can treat all sources uniformly.
 */
export class DirectoryAdapter implements SourcingAdapter {
  readonly source = "directory" as const;
  private fetch: typeof fetch;

  constructor(
    private opts: { apiBaseUrl: string; fetchImpl?: typeof fetch },
  ) {
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async search(q: SourcingQuery): Promise<SourcedItem[]> {
    const url = new URL(`${this.opts.apiBaseUrl}/api/sourcing/directory`);
    url.searchParams.set("q", q.text);
    if (q.near) {
      url.searchParams.set("lat", String(q.near.lat));
      url.searchParams.set("lng", String(q.near.lng));
    }
    if (q.limit) url.searchParams.set("limit", String(q.limit));
    if (q.maxPriceIDR) url.searchParams.set("max", String(q.maxPriceIDR));

    const r = await this.fetch(url.toString());
    if (!r.ok) return [];
    return (await r.json()) as SourcedItem[];
  }
}
