import type { CourierAdapter, RateQuote, RateRequest } from "./types";

export interface CompareOptions {
  /** Bias: 0 = pure price, 1 = pure speed. Default 0.3 (slight speed bias). */
  speedBias?: number;
  /** Discard rates whose ETA exceeds this many minutes. */
  maxEtaMinutes?: number;
}

export interface ComparedRate extends RateQuote {
  score: number;
}

/**
 * Query every adapter in parallel and return rates sorted by a weighted score.
 * One slow/erroring provider does not block the others.
 */
export async function compareRates(
  adapters: CourierAdapter[],
  req: RateRequest,
  opts: CompareOptions = {},
): Promise<ComparedRate[]> {
  const speedBias = opts.speedBias ?? 0.3;
  const maxEta = opts.maxEtaMinutes ?? 240;

  const results = await Promise.allSettled(
    adapters.map(a => a.getRates(req)),
  );

  const all: RateQuote[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const filtered = all.filter(r =>
    !r.etaMinutes || r.etaMinutes <= maxEta,
  );
  if (filtered.length === 0) return [];

  const prices = filtered.map(r => r.priceIDR);
  const etas = filtered.map(r => r.etaMinutes ?? 999);
  const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
  const minEta = Math.min(...etas), maxEta_ = Math.max(...etas);

  return filtered
    .map<ComparedRate>(r => {
      const pn = norm(r.priceIDR, minPrice, maxPrice);
      const en = norm(r.etaMinutes ?? maxEta_, minEta, maxEta_);
      // Lower is better; weighted sum then inverted into a score.
      const cost = (1 - speedBias) * pn + speedBias * en;
      return { ...r, score: 1 - cost };
    })
    .sort((a, b) => b.score - a.score);
}

function norm(v: number, min: number, max: number) {
  if (max === min) return 0;
  return (v - min) / (max - min);
}
