import { z } from "zod";

/** All money in IDR minor units (rupiah, integer — IDR has no cents). */
export type IDR = number;

export const Geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Geo = z.infer<typeof Geo>;

export const Address = z.object({
  id: z.string().uuid().optional(),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(8),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  province: z.string().min(1),
  postalCode: z.string().optional(),
  geo: Geo,
  notes: z.string().optional(),
});
export type Address = z.infer<typeof Address>;

export const CourierProvider = z.enum(["gosend", "grab", "manual"]);
export type CourierProvider = z.infer<typeof CourierProvider>;

export const CourierTier = z.enum(["instant", "sameday", "car_instant", "car_sameday"]);
export type CourierTier = z.infer<typeof CourierTier>;

export const SourceChannel = z.enum(["tokopedia", "shopee", "bukalapak", "directory", "manual"]);
export type SourceChannel = z.infer<typeof SourceChannel>;

export const OrderStatus = z.enum([
  "pending_payment",
  "paid",
  "awaiting_pickup",
  "runner_assigned",
  "item_purchased",
  "in_transit",
  "delivered",
  "refunded",
  "failed",
  "canceled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const RequestStatus = z.enum([
  "draft", "submitted", "sourcing", "quoted", "expired", "canceled",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const PaymentStatus = z.enum([
  "pending", "authorized", "paid", "failed", "refunded", "expired",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** A candidate item the sourcing engine has found for a request. */
export const Quote = z.object({
  id: z.string().uuid().optional(),
  requestId: z.string().uuid(),
  source: SourceChannel,
  externalUrl: z.string().url().optional(),
  title: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  itemPriceIDR: z.number().int().nonnegative(),
  availableQty: z.number().int().optional(),
  pickupGeo: Geo.optional(),
  pickupAddress: z.string().optional(),
  estPickupReadyMinutes: z.number().int().optional(),
  notes: z.string().optional(),
});
export type Quote = z.infer<typeof Quote>;

/** A courier price quote for moving one specific item from store -> user. */
export const CourierRate = z.object({
  id: z.string().uuid().optional(),
  quoteId: z.string().uuid(),
  provider: CourierProvider,
  tier: CourierTier,
  priceIDR: z.number().int().nonnegative(),
  etaMinutes: z.number().int().optional(),
  distanceKm: z.number().optional(),
  expiresAt: z.string().datetime().optional(),
});
export type CourierRate = z.infer<typeof CourierRate>;

/** Intake mode: either a product URL or free-text description from the user. */
export const IntakeInputType = z.enum(["url", "text"]);
export type IntakeInputType = z.infer<typeof IntakeInputType>;

/**
 * Canonical user-intent object produced by intake.
 * This is what downstream matching uses to find candidate products.
 */
export const RequestedItem = z.object({
  title: z.string().min(1).max(300),
  normalizedQuery: z.string().min(1).max(300),
  brand: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(120).optional(),
  attributes: z.record(z.string().min(1), z.string().min(1)).default({}),
  sourceInputType: IntakeInputType,
  sourceUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  referencePriceIDR: z.number().int().nonnegative().optional(),
  currency: z.literal("IDR").default("IDR"),
});
export type RequestedItem = z.infer<typeof RequestedItem>;

/** POST /api/intake/requests input payload. */
export const IntakeCreateRequestInput = z
  .object({
    inputType: IntakeInputType,
    inputValue: z.string().trim().min(2).max(2000),
    zipCode: z.string().trim().regex(/^[a-z0-9 -]{3,12}$/i, "invalid zip code"),
    radiusKm: z.number().positive().max(50).default(35),
    quantity: z.number().int().min(1).max(20).default(1),
  })
  .superRefine((value, ctx) => {
    if (value.inputType !== "url") return;
    try {
      // eslint-disable-next-line no-new
      new URL(value.inputValue);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputValue"],
        message: "inputValue must be a valid URL when inputType is 'url'",
      });
    }
  });
export type IntakeCreateRequestInput = z.infer<typeof IntakeCreateRequestInput>;

export const IntakeClarificationQuestion = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6).optional(),
});
export type IntakeClarificationQuestion = z.infer<typeof IntakeClarificationQuestion>;

/** POST /api/intake/requests response payload. */
export const IntakeCreateRequestResponse = z.object({
  requestId: z.string().uuid(),
  normalizedItem: RequestedItem,
  parseConfidence: z.number().int().min(0).max(100),
  clarificationQuestions: z.array(IntakeClarificationQuestion).default([]),
  nextAction: z.enum(["SELECT_ITEM", "NEED_CLARIFICATION"]),
  zipCode: z.string(),
  radiusKm: z.number().positive(),
  quantity: z.number().int().positive(),
});
export type IntakeCreateRequestResponse = z.infer<typeof IntakeCreateRequestResponse>;
