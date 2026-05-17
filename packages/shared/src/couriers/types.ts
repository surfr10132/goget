import type { CourierProvider, CourierTier, Geo, IDR } from "../types";

export interface RateRequest {
  pickup: Geo;
  pickupAddress: string;
  pickupContact: { name: string; phone: string };
  dropoff: Geo;
  dropoffAddress: string;
  dropoffContact: { name: string; phone: string };
  /** Approximate item value — providers use this for insurance/COD limits. */
  itemValueIDR: IDR;
  /** Item description, kg, dimensions if known. */
  itemDescription: string;
  weightKg?: number;
}

export interface RateQuote {
  provider: CourierProvider;
  tier: CourierTier;
  priceIDR: IDR;
  etaMinutes?: number;
  distanceKm?: number;
  /** Provider-specific token to pass back into bookDelivery. */
  rateToken?: string;
  /** Raw provider payload for audit. */
  raw?: unknown;
  expiresAt?: string;
}

export interface BookRequest extends RateRequest {
  tier: CourierTier;
  rateToken?: string;
  /** GoGet's internal order id, used as the provider's reference. */
  clientReference: string;
}

export interface BookResult {
  provider: CourierProvider;
  externalBookingId: string;
  trackingUrl?: string;
  driverName?: string;
  driverPhone?: string;
  driverPlate?: string;
  raw?: unknown;
}

export interface CourierAdapter {
  readonly provider: CourierProvider;
  getRates(req: RateRequest): Promise<RateQuote[]>;
  bookDelivery(req: BookRequest): Promise<BookResult>;
  cancelDelivery(externalBookingId: string, reason?: string): Promise<void>;
  /** Parse and verify a webhook payload from this provider. */
  parseWebhook(headers: Record<string, string>, body: string): {
    externalBookingId: string;
    status: string;
    raw: unknown;
  };
}
