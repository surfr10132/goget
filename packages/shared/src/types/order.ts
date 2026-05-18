import { z } from "zod";
import { CourierProvider, CourierTier, Geo, SourceChannel, type IDR } from "../types";

/**
 * Concierge model: GoGet does not resell the item. The user buys it themselves
 * on Tokopedia/Shopee/Bukalapak via an in-app WebView, then GoGet picks it up
 * from the seller and delivers it.
 *
 * `item_picked_up` replaces the old `item_purchased`; the latter is kept in
 * `OrderStatus` for backwards-compat with any rows already in the wild.
 */
export const ConciergeOrderStatus = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "awaiting_pickup",
  "runner_assigned",
  "item_picked_up",
  "in_transit",
  "delivered",
  "refunded",
  "failed",
  "canceled",
]);
export type ConciergeOrderStatus = z.infer<typeof ConciergeOrderStatus>;

/** Search-result card. The URL is the WebView destination. */
export const ProductListing = z.object({
  source: SourceChannel,
  externalId: z.string().optional(),
  title: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
  priceIDRDisplay: z.number().int().nonnegative().optional(),
  url: z.string().url(),
  sellerName: z.string().optional(),
  sellerCity: z.string().optional(),
});
export type ProductListing = z.infer<typeof ProductListing>;

/** Captured after the user confirms they bought the item on the marketplace. */
export const MarketplacePurchase = z.object({
  source: SourceChannel,
  sourceUrl: z.string().url(),
  title: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
  /** User-declared item value — used for insurance + receipt-matching at pickup. */
  priceIDRDeclared: z.number().int().nonnegative(),
  /** Marketplace order reference (e.g. "TKP-2024-..."). Optional at MVP. */
  marketplaceOrderRef: z.string().optional(),
});
export type MarketplacePurchase = z.infer<typeof MarketplacePurchase>;

const PickupAddress = z.object({
  address: z.string().min(1),
  geo: Geo,
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
});

const DropoffAddress = z.object({
  address: z.string().min(1),
  geo: Geo,
  city: z.string().default("Jakarta"),
  province: z.string().default("DKI Jakarta"),
});

const Recipient = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
});

const CourierSelection = z.object({
  provider: CourierProvider,
  tier: CourierTier,
  priceIDR: z.number().int().nonnegative(),
  etaMinutes: z.number().int().nonnegative().optional(),
  distanceKm: z.number().nonnegative().optional(),
  rateToken: z.string().optional(),
  useLinkedAccount: z.boolean().optional(),
  linkedAccountRef: z.string().min(1).optional(),
});

/** Body of POST /api/orders/concierge. */
export const ConciergeOrderInput = z.object({
  product: MarketplacePurchase,
  pickup: PickupAddress,
  dropoff: DropoffAddress,
  recipient: Recipient,
  courier: CourierSelection,
  notes: z.string().max(500).optional(),
});
export type ConciergeOrderInput = z.infer<typeof ConciergeOrderInput>;

export interface ConciergeOrderResult {
  order: {
    id: string;
    shortCode: string;
    status: ConciergeOrderStatus;
    totalIDR: IDR;
    breakdown: {
      itemSubtotalIDR: IDR;
      deliveryFeeIDR: IDR;
      courierFeeIDR: IDR;
      serviceFeeIDR: IDR;
      taxIDR: IDR;
      totalIDR: IDR;
    };
  };
  payment: {
    amountIDR?: IDR;
    snapToken: string | null;
    redirectUrl: string | null;
  };
}
