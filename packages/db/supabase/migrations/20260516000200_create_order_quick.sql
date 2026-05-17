-- =====================================================================
-- create_order_quick RPC
-- Atomic checkout for POST /api/orders/quick.
--
-- Replaces 5 sequential inline INSERTs in Node (item_requests, addresses,
-- quotes, courier_rates, orders) with a single PL/pgSQL function so that
-- a partial failure rolls back cleanly instead of leaving orphan rows.
--
-- Fees are still computed in Node (packages/shared/src/fees.ts) and passed
-- in — we do NOT reimplement fee math in SQL. Midtrans is also still called
-- from Node (Postgres can't make outbound HTTP), so the `payments` row is
-- inserted AFTER this RPC returns successfully, in a separate INSERT from
-- Node, before the Midtrans Snap call.
-- =====================================================================

create or replace function create_order_quick(
  p_user_id uuid,
  -- item / quote
  p_item_title text,
  p_item_source source_channel,
  p_item_external_url text,
  p_item_image_url text,
  p_item_price_idr bigint,
  -- pickup
  p_pickup_address text,
  p_pickup_lng double precision,
  p_pickup_lat double precision,
  -- dropoff / address snapshot
  p_dropoff_address text,
  p_dropoff_city text,
  p_dropoff_province text,
  p_dropoff_lng double precision,
  p_dropoff_lat double precision,
  -- recipient (stored on the address snapshot)
  p_recipient_name text,
  p_recipient_phone text,
  -- chosen courier rate
  p_courier_provider courier_provider,
  p_courier_tier courier_tier,
  p_courier_price_idr bigint,
  p_courier_eta_minutes integer,
  p_courier_distance_km numeric,
  p_courier_raw_response jsonb,
  -- fees (computed by Node via computeFees)
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
  -- Ownership gate. The caller (Node, via service role) passes the userId
  -- it resolved from the bearer token. We refuse if the profile doesn't
  -- exist — RLS would otherwise be silently bypassed here.
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'profile % not found', p_user_id using errcode = 'P0002';
  end if;

  -- 1. item_requests
  insert into item_requests (user_id, query, reference_url, status)
  values (p_user_id, p_item_title, p_item_external_url, 'quoted')
  returning id into v_request_id;

  -- 2. addresses (snapshot of the recipient's delivery address)
  insert into addresses (
    user_id, kind, recipient_name, recipient_phone,
    line1, city, province, geo
  ) values (
    p_user_id, 'other', p_recipient_name, p_recipient_phone,
    p_dropoff_address, p_dropoff_city, p_dropoff_province,
    st_setsrid(st_makepoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography
  )
  returning id into v_address_id;

  -- 3. quotes
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

  -- 4. courier_rates
  insert into courier_rates (
    quote_id, provider, tier, price_idr, eta_minutes,
    distance_km, raw_response
  ) values (
    v_quote_id, p_courier_provider, p_courier_tier, p_courier_price_idr,
    p_courier_eta_minutes, p_courier_distance_km, p_courier_raw_response
  )
  returning id into v_courier_rate_id;

  -- 5. orders (short_code set by the existing BEFORE INSERT trigger)
  insert into orders (
    user_id, request_id, quote_id, delivery_address_id,
    item_price_idr, service_fee_idr, courier_fee_idr,
    tax_idr, total_idr, status
  ) values (
    p_user_id, v_request_id, v_quote_id, v_address_id,
    p_item_price_idr, p_service_fee_idr, p_courier_price_idr,
    p_tax_idr, p_total_idr, 'pending_payment'
  )
  returning id, short_code into v_order_id, v_order_short_code;

  -- 6. order_events seed (records the rate the user chose; webhook reads
  --    this to know which courier_rate to book).
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

-- Only the service role (Node API) should call this. Clients hit the API,
-- not the RPC directly. Revoke from public/anon/authenticated to be explicit.
revoke all on function create_order_quick(
  uuid, text, source_channel, text, text, bigint,
  text, double precision, double precision,
  text, text, text, double precision, double precision,
  text, text,
  courier_provider, courier_tier, bigint, integer, numeric, jsonb,
  bigint, bigint, bigint
) from public;

grant execute on function create_order_quick(
  uuid, text, source_channel, text, text, bigint,
  text, double precision, double precision,
  text, text, text, double precision, double precision,
  text, text,
  courier_provider, courier_tier, bigint, integer, numeric, jsonb,
  bigint, bigint, bigint
) to service_role;
