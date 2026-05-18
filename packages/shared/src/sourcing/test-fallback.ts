import { getImageUrl } from "./image-map";
import { categorizeQuery, estimatePrice } from "./intelligence";
import {
  CHAINS,
  MODEL_NAMES,
  STREET_PREFIXES,
  VARIANT_HINTS,
} from "./test-fallback-data";

export interface TestFallbackItem {
  source: "directory";
  externalUrl: string;
  title: string;
  description: string;
  imageUrl: string;
  priceIDR: number;
  merchantName: string;
  pickupAddress: string;
  pickupCity: string;
  pickupGeo: null;
  distanceKm: undefined;
}

function lookupModelNames(query: string): string[] | null {
  const q = query.toLowerCase();
  for (const entry of MODEL_NAMES) {
    if (entry.pattern.test(q)) return entry.models;
  }
  return null;
}

function toTitle(query: string): string {
  return query.charAt(0).toUpperCase() + query.slice(1);
}

export function makeFallbackItems(query: string, city: string, limit: number): TestFallbackItem[] {
  const category = categorizeQuery(query);
  const chains = (CHAINS[category] ?? CHAINS.general).slice(0, limit);
  const basePrice = estimatePrice(query);
  const variants = VARIANT_HINTS[category] ?? VARIANT_HINTS.general;
  const knownModels = lookupModelNames(query);

  return chains.map((chain, i) => {
    const street = STREET_PREFIXES[i % STREET_PREFIXES.length];
    const num = 10 + i * 17;
    const price = Math.round((basePrice * (0.9 + Math.random() * 0.2)) / 1_000) * 1_000;

    const title = (() => {
      if (knownModels && knownModels[i % knownModels.length]) {
        return knownModels[i % knownModels.length];
      }
      const variantHint = variants[i % variants.length] ?? "";
      return variantHint ? `${toTitle(query)} ${variantHint}` : toTitle(query);
    })();

    return {
      source: "directory",
      externalUrl: chain.url,
      title,
      description: "Ask in-store for availability",
      imageUrl: getImageUrl(query),
      priceIDR: price,
      merchantName: chain.name,
      pickupAddress: `${street} No. ${num}, ${city}`,
      pickupCity: city,
      pickupGeo: null,
      distanceKm: undefined,
    };
  });
}