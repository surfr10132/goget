import { roundIDR } from "./money";
import type { IDR } from "./types";

export interface FeeInputs {
  courierFeeIDR: IDR;
}

export interface FeeBreakdown {
  courierFeeIDR: IDR;
  serviceFeeIDR: IDR;
  taxIDR: IDR;
  totalIDR: IDR;
}

export interface CheckoutPricingInput {
  itemSubtotalIDR: IDR;
  deliveryFeeIDR: IDR;
}

export interface CheckoutPricingBreakdown {
  itemSubtotalIDR: IDR;
  serviceFeeIDR: IDR;
  deliveryFeeIDR: IDR;
  /** Backward-compatible alias used by existing order row mappings. */
  courierFeeIDR: IDR;
  taxIDR: IDR;
  /**
   * Amount charged in the concierge flow (delivery + service + tax).
   * Item subtotal is informational because the user pays the seller directly.
   */
  totalIDR: IDR;
}

// Concierge model: the user pays the seller directly on the marketplace, so
// GoGet's service fee is a flat amount per delivery (not a function of item
// value). Finance can tune the constant without touching client code.
export const SERVICE_FEE_FLAT_IDR = 8_000;
export const PPN_PCT = 0.11;

export function computeFees(input: FeeInputs): FeeBreakdown {
  const service = roundIDR(SERVICE_FEE_FLAT_IDR);
  const tax = roundIDR(service * PPN_PCT);
  const total = input.courierFeeIDR + service + tax;
  return {
    courierFeeIDR: input.courierFeeIDR,
    serviceFeeIDR: service,
    taxIDR: tax,
    totalIDR: total,
  };
}

export function computeCheckoutPricing(input: CheckoutPricingInput): CheckoutPricingBreakdown {
  const fees = computeFees({ courierFeeIDR: input.deliveryFeeIDR });
  return {
    itemSubtotalIDR: input.itemSubtotalIDR,
    serviceFeeIDR: fees.serviceFeeIDR,
    deliveryFeeIDR: input.deliveryFeeIDR,
    courierFeeIDR: input.deliveryFeeIDR,
    taxIDR: fees.taxIDR,
    totalIDR: fees.totalIDR,
  };
}
