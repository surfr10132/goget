-- =====================================================================
-- Add `selected_rate_id` to orders, and `attempt` to payments.
--
-- Why:
-- 1. bookCourierForOrder() in apps/api was reading the chosen
--    courier_rate_id from the FIRST `order_events` row's `meta` jsonb.
--    That coupling is fragile — any new "first" event silently breaks
--    courier booking. Promote it to a real FK column on `orders`.
-- 2. Both POST /api/orders and POST /api/orders/quick hardcoded
--    `${short_code}-1` as the Midtrans provider_order_id, so a
--    cancel-and-retry payment reused the same id. Add an `attempt`
--    counter on `payments` so each Snap session is unique
--    (`${short_code}-${attempt}`) and the existing
--    (provider, provider_order_id) unique constraint still holds.
-- =====================================================================

-- ---------- orders.selected_rate_id ----------

alter table orders
  add column selected_rate_id uuid references courier_rates(id);

-- Backfill from the seed `order_events` row that create_order_quick
-- (and the inline POST / handler) wrote: meta->>'courier_rate_id'.
-- Pick the EARLIEST event per order so we get the "order created" seed,
-- not any later booking event that might also stash a rate id.
update orders o
set selected_rate_id = sub.rate_id
from (
  select distinct on (oe.order_id)
    oe.order_id,
    (oe.meta->>'courier_rate_id')::uuid as rate_id
  from order_events oe
  where oe.meta ? 'courier_rate_id'
  order by oe.order_id, oe.created_at asc
) sub
where o.id = sub.order_id
  and o.selected_rate_id is null
  and sub.rate_id is not null
  -- Guard against a stale meta value pointing at a deleted rate.
  and exists (select 1 from courier_rates cr where cr.id = sub.rate_id);

create index if not exists orders_selected_rate_id_idx
  on orders(selected_rate_id);

-- ---------- payments.attempt ----------

alter table payments
  add column attempt integer not null default 1;

-- (order_id, attempt) is the natural key for retried Snap sessions.
-- The existing (provider, provider_order_id) unique constraint still
-- enforces global uniqueness of the Midtrans-facing id; this one
-- enforces "no two payment rows for the same order share an attempt
-- number", which is what makes `${short_code}-${attempt}` safe.
create unique index if not exists payments_order_attempt_idx
  on payments(order_id, attempt);

-- ---------- create_order_quick v2 ----------
-- Same signature as before; body now sets orders.selected_rate_id
-- directly instead of relying on the order_events seed row.

create or replace function create_order_quick(
  p_user_id uuid,
  p_item_title text,
  p_item_source source_channel,
  p_item_external_url text,
  p_item_image_url text,
  p_item_price_idr bigint,
  p_pickup_address text,
  p_pickup_lng double precision,
  p_pickup_lat double precision,
  p_dropoff_address text,
  p_dropoff_city text,
  p_dropoff_province text,
  p_dropoff_lng double precision,
  p_dropoff_lat double precision,
  p_recipient_name text,
  p_recipient_phone text,
  p_courier_provider courier_provider,
  p_courier_tier courier_tier,
  p_courier_price_idr bigint,
  p_courier_eta_minutes integer,
  p_courier_distance_km numeric,
  p_courier_raw_response jsonb,
  p_service_fee_idr bigint,
  p_tax_idr bigint,
  p_total_idr bigint
)
returns table (
  order_id uuid,
  order_short_code text,
  request_id uuid,
  quote_id uuid,
  courier_rate_id uuid,
  address_id uuid,
  item_price_idr bigint,
  service_fee_idr bigint,
  courier_fee_idr bigint,
  tax_idr bigint,
  total_idr bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_address_id uuid;
  v_quote_id uuid;
  v_courier_rate_id uuid;
  v_order_id uuid;
  v_order_short_code text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'profile % not found', p_user_id using errcode = 'P0002';
  end if;

  insert into item_requests (user_id, query, reference_url, status)
  values (p_user_id, p_item_title, p_item_external_url, 'quoted')
  returning id into v_request_id;

  insert into addresses (
    user_id, kind, recipient_name, recipient_phone,
    line1, city, province, geo
  ) values (
    p_user_id, 'other', p_recipient_name, p_recipient_phone,
    p_dropoff_address, p_dropoff_city, p_dropoff_province,
    st_setsrid(st_makepoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography
  )
  returning id into v_address_id;

  insert into quotes (
    request_id, source, external_url, title, image_url,
    item_price_idr, pickup_address, pickup_geo, is_chosen
  ) values (
    v_request_id, p_item_source, p_item_external_url, p_item_title,
    p_item_image_url, p_item_price_idr, p_pickup_address,
    st_setsrid(st_makepoint(p_pickup_lng, p_pickup_lat), 4326)::geography,
    true
  )
  returning id into v_quote_id;

  insert into courier_rates (
    quote_id, provider, tier, price_idr, eta_minutes,
    distance_km, raw_response
  ) values (
    v_quote_id, p_courier_provider, p_courier_tier, p_courier_price_idr,
    p_courier_eta_minutes, p_courier_distance_km, p_courier_raw_response
  )
  returning id into v_courier_rate_id;

  -- New column: selected_rate_id is set inline so bookCourierForOrder
  -- never has to dig through order_events meta to find the chosen rate.
  insert into orders (
    user_id, request_id, quote_id, delivery_address_id,
    item_price_idr, service_fee_idr, courier_fee_idr,
    tax_idr, total_idr, status, selected_rate_id
  ) values (
    p_user_id, v_request_id, v_quote_id, v_address_id,
    p_item_price_idr, p_service_fee_idr, p_courier_price_idr,
    p_tax_idr, p_total_idr, 'pending_payment', v_courier_rate_id
  )
  returning id, short_code into v_order_id, v_order_short_code;

  -- Seed event kept for audit-trail symmetry with manual POST /api/orders.
  -- Booking code no longer reads from it.
  insert into order_events (order_id, status, note, meta)
  values (
    v_order_id,
    'pending_payment',
    'order created',
    jsonb_build_object('courier_rate_id', v_courier_rate_id)
  );

  return query select
    v_order_id,
    v_order_short_code,
    v_request_id,
    v_quote_id,
    v_courier_rate_id,
    v_address_id,
    p_item_price_idr,
    p_service_fee_idr,
    p_courier_price_idr,
    p_tax_idr,
    p_total_idr;
end;
$$;
