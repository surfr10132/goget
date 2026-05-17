import { Hono } from "hono";
import { supabase } from "../clients";

export const tracking = new Hono();

/**
 * GET /api/tracking/:shortCode
 *
 * Public-ish tracking endpoint (still auth required so only the owner sees it).
 * Returns the latest delivery + driver info + status timeline.
 */
tracking.get("/:shortCode", async c => {
  const { userId } = c.get("auth");
  const shortCode = c.req.param("shortCode").toUpperCase();

  const { data: order } = await supabase
    .from("orders")
    .select(`
      short_code, status, total_idr, created_at,
      quote:quote_id(title, image_url, external_url, source),
      delivery:deliveries(provider, tier, status, tracking_url, driver_name, driver_phone, driver_plate, last_known_geo, is_active),
      events:order_events(status, note, created_at)
    `)
    .eq("short_code", shortCode)
    .eq("user_id", userId)
    .single();
  if (!order) return c.json({ error: "not found" }, 404);
  return c.json(order);
});
