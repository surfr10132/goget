import { z } from "zod";
import { CourierProvider, CourierTier, Geo, SourceChannel } from "../types";

export const SearchInputMode = z.enum(["url", "keyword"]);
export type SearchInputMode = z.infer<typeof SearchInputMode>;

export const ZipCode = z.string().trim().regex(/^\d{5}$/, "invalid zip code");
export type ZipCode = z.infer<typeof ZipCode>;
const MAX_SEARCH_RADIUS_MILES = 35;
const MAX_SEARCH_DISTANCE_KM = Number((MAX_SEARCH_RADIUS_MILES * 1.60934).toFixed(2));

export const SearchLocation = z.object({
  near: Geo.optional(),
  zipcode: ZipCode.optional(),
  maxDistanceKm: z.number().positive().max(MAX_SEARCH_DISTANCE_KM).default(MAX_SEARCH_DISTANCE_KM),
}).superRefine((value, ctx) => {
  if (value.near || value.zipcode) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["near"],
    message: "Provide either near coordinates or zipcode",
  });
});
export type SearchLocation = z.infer<typeof SearchLocation>;

/**
 * Canonical search input used by sourcing endpoints.
 * - mode=url: provide a URL and optional text query override.
 * - mode=keyword: provide keyword query text.
 */
export const SourcingSearchInput = z.object({
  mode: SearchInputMode.default("keyword"),
  query: z.string().trim().optional(),
  referenceUrl: z.string().url().optional(),
  location: SearchLocation,
  maxPriceIDR: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(12),
}).superRefine((value, ctx) => {
  if (value.mode === "url" && !value.referenceUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["referenceUrl"],
      message: "referenceUrl is required when mode is 'url'",
    });
  }
  if (value.mode === "keyword" && !value.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["query"],
      message: "query is required when mode is 'keyword'",
    });
  }
});
export type SourcingSearchInput = z.infer<typeof SourcingSearchInput>;

/**
 * UI-facing normalized card from a sourcing response.
 */
export const NormalizedSourcingItem = z.object({
  source: SourceChannel,
  externalId: z.string().optional(),
  externalUrl: z.string().url().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  sellerName: z.string().optional(),
  sellerLocation: z.string().optional(),
  condition: z.enum(["new", "used", "refurbished"]).optional(),
  itemSubtotalIDR: z.number().int().nonnegative(),
  estimatedDeliveryMinutes: z.number().int().positive().optional(),
  distanceKm: z.number().nonnegative().optional(),
  rankingScore: z.number().min(0).max(1).optional(),
});
export type NormalizedSourcingItem = z.infer<typeof NormalizedSourcingItem>;

export const SourcingSearchResponse = z.object({
  mode: SearchInputMode,
  location: SearchLocation,
  items: z.array(NormalizedSourcingItem),
});
export type SourcingSearchResponse = z.infer<typeof SourcingSearchResponse>;

export const SelectedItemPayload = z.object({
  source: SourceChannel,
  title: z.string().min(1),
  externalUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  sellerName: z.string().optional(),
  pickupAddress: z.string().min(1),
  pickupGeo: Geo,
  itemSubtotalIDR: z.number().int().nonnegative(),
});
export type SelectedItemPayload = z.infer<typeof SelectedItemPayload>;

export const CourierPreference = z.object({
  provider: CourierProvider.optional(),
  tier: CourierTier.optional(),
  useLinkedAccount: z.boolean().default(false),
  linkedAccountRef: z.string().min(1).optional(),
});
export type CourierPreference = z.infer<typeof CourierPreference>;

export const CheckoutQuoteBreakdown = z.object({
  itemSubtotalIDR: z.number().int().nonnegative(),
  serviceFeeIDR: z.number().int().nonnegative(),
  deliveryFeeIDR: z.number().int().nonnegative(),
  courierFeeIDR: z.number().int().nonnegative(),
  taxIDR: z.number().int().nonnegative(),
  totalIDR: z.number().int().nonnegative(),
});
export type CheckoutQuoteBreakdown = z.infer<typeof CheckoutQuoteBreakdown>;

export const CheckoutQuoteResponse = z.object({
  selectedItem: SelectedItemPayload,
  courierPreference: CourierPreference.optional(),
  courier: z.object({
    provider: CourierProvider,
    tier: CourierTier,
    etaMinutes: z.number().int().positive().optional(),
  }),
  breakdown: CheckoutQuoteBreakdown,
});
export type CheckoutQuoteResponse = z.infer<typeof CheckoutQuoteResponse>;
