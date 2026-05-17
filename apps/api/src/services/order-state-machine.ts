import { supabase } from "../clients";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "awaiting_pickup"
  | "runner_assigned"
  | "item_picked_up"
  | "item_purchased"
  | "in_transit"
  | "delivered"
  | "refunded"
  | "failed"
  | "canceled";

type TransitionRow = {
  changed: boolean;
  status: OrderStatus;
};

type TransitionOrderStatusInput = {
  orderId: string;
  nextStatus: OrderStatus;
  statusReason?: string | null;
  note?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Centralized status transition entrypoint.
 * Delegates transition validation + event insertion to DB function
 * `transition_order_status`.
 */
export async function transitionOrderStatus(
  input: TransitionOrderStatusInput,
): Promise<TransitionRow> {
  const { data, error } = await supabase
    .rpc("transition_order_status", {
      p_order_id: input.orderId,
      p_next_status: input.nextStatus,
      p_status_reason: input.statusReason ?? null,
      p_note: input.note ?? null,
      p_meta: input.meta ?? null,
    })
    .returns<TransitionRow[]>()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? `failed to transition order ${input.orderId}`);
  }
  return data;
}
