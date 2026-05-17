import type { SourcingAdapter, SourcingQuery, SourcedItem } from "./types";

/**
 * Run every sourcing adapter in parallel. One slow / failing source must
 * NOT block the others — Promise.allSettled handles that.
 *
 * Returned items are deduped by `${source}:${externalId}` and sorted by
 * relevance (currently a cheap heuristic: token-overlap, ties broken by price).
 */
export async function sourceItems(
  adapters: SourcingAdapter[],
  query: SourcingQuery,
): Promise<SourcedItem[]> {
  const results = await Promise.allSettled(
    adapters.map(a => a.search(query)),
  );

  const seen = new Set<string>();
  const out: SourcedItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const k = `${item.source}:${item.externalId ?? item.externalUrl}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
  }

  const queryTokens = tokenize(query.text);
  return out
    .map(i => ({ i, score: relevance(i, queryTokens) }))
    .sort((a, b) => b.score - a.score || a.i.priceIDR - b.i.priceIDR)
    .map(x => x.i);
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\s+/).filter(t => t.length > 1));
}

function relevance(item: SourcedItem, tokens: Set<string>): number {
  const titleTokens = tokenize(item.title);
  let hits = 0;
  for (const t of tokens) if (titleTokens.has(t)) hits++;
  return hits / Math.max(1, tokens.size);
}
