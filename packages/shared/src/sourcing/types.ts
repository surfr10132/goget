import { z } from "zod";
import type { Geo, IDR, SourceChannel } from "../types";

export interface SourcingQuery {
  text: string;
  referenceUrl?: string;
  /** User's drop-off location — used to filter by store distance / shipping zone. */
  near?: Geo;
  /** Cap on item price to filter aggressively. */
  maxPriceIDR?: IDR;
  /** How many results to return per source. */
  limit?: number;
}

export interface SourcedItem {
  source: SourceChannel;
  externalId?: string;
  externalUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;
  priceIDR: IDR;
  availableQty?: number;
  merchantName?: string;
  merchantExternalId?: string;
  pickupGeo?: Geo;
  pickupAddress?: string;
  estReadyMinutes?: number;
}

export interface SourcingAdapter {
  readonly source: SourceChannel;
  search(q: SourcingQuery): Promise<SourcedItem[]>;
}

// ---------------------------------------------------------------------------
// Upstream response schemas — lightweight, lenient, strip unknown fields.
// WHY: storefront APIs add/remove fields freely; we only validate what we use.
// ---------------------------------------------------------------------------

/** Coerce numeric-ish values; missing -> 0 (filtered out downstream). */
const NumLike = z.union([z.number(), z.string()]).transform(v => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
});

export const TokopediaProduct = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    url: z.string(),
    imageUrl: z.string().optional(),
    price: z.string().optional(),
    priceInt: NumLike.optional(),
    shop: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        name: z.string().optional(),
        city: z.string().optional(),
      })
      .optional(),
  })
  .strip();

export const TokopediaResponse = z
  .array(
    z
      .object({
        data: z
          .object({
            ace_search_product_v4: z
              .object({
                data: z
                  .object({ products: z.array(z.unknown()).default([]) })
                  .strip(),
              })
              .strip(),
          })
          .strip(),
      })
      .strip(),
  )
  .min(1);

export const ShopeeItemBasic = z
  .object({
    itemid: z.union([z.string(), z.number()]),
    shopid: z.union([z.string(), z.number()]),
    name: z.string(),
    image: z.string().optional(),
    price: NumLike.optional(),
    price_min: NumLike.optional(),
    stock: z.number().int().optional(),
    shop_location: z.string().optional(),
  })
  .strip();

export const ShopeeResponse = z
  .object({ items: z.array(z.unknown()).default([]) })
  .strip();

export const BukalapakProduct = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    url: z.string().optional(),
    images: z
      .array(z.object({ full_size: z.string().optional() }).strip())
      .optional(),
    price: NumLike.optional(),
    stock: z.number().int().optional(),
    store: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        name: z.string().optional(),
        address: z.object({ city: z.string().optional() }).strip().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export const BukalapakResponse = z
  .object({ data: z.array(z.unknown()).default([]) })
  .strip();
