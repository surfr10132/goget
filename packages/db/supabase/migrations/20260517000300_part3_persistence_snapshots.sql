-- =====================================================================
-- Part 3 persistence model:
-- - Selected listing snapshot
-- - Checkout fee snapshot
-- - Courier preference/account snapshot
-- - Courier-booking retry visibility snapshot
-- - Harden RLS on internal reliability tables
-- =====================================================================

alter table orders
  add column if not exists selected_listing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists checkout_fee_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists courier_preference_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists booking_retry_state text not null default 'idle',
  add column if not exists booking_retry_attempt_count integer not null default 0,
  add column if not exists booking_retry_max_attempts integer not null default 0,
  add column if not exists booking_retry_last_error text,
  add column if not exists booking_retry_next_retry_at timestamptz,
  add column if not exists booking_retry_updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_booking_retry_state_check'
  ) then
    alter table orders
      add constraint orders_booking_retry_state_check
      check (
        booking_retry_state in (
          'idle',
          'pending',
          'processing',
          'retrying',
          'succeeded',
          'failed'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_booking_retry_attempt_count_check'
  ) then
    alter table orders
      add constraint orders_booking_retry_attempt_count_check
      check (booking_retry_attempt_count >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_booking_retry_max_attempts_check'
  ) then
    alter table orders
      add constraint orders_booking_retry_max_attempts_check
      check (booking_retry_max_attempts >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_selected_listing_snapshot_is_object_check'
  ) then
    alter table orders
      add constraint orders_selected_listing_snapshot_is_object_check
      check (jsonb_typeof(selected_listing_snapshot) = 'object');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_checkout_fee_snapshot_is_object_check'
  ) then
    alter table orders
      add constraint orders_checkout_fee_snapshot_is_object_check
      check (jsonb_typeof(checkout_fee_snapshot) = 'object');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_courier_preference_snapshot_is_object_check'
  ) then
    alter table orders
      add constraint orders_courier_preference_snapshot_is_object_check
      check (jsonb_typeof(courier_preference_snapshot) = 'object');
  end if;
end $$;

create index if not exists orders_booking_retry_state_idx
  on orders(booking_retry_state, created_at desc);

update orders o
set
  selected_listing_snapshot = jsonb_strip_nulls(
    jsonb_build_object(
      'source', q.source,
      'title', q.title,
      'externalUrl', q.external_url,
      'imageUrl', q.image_url,
      'sellerName', m.name,
      'pickupAddress', q.pickup_address,
      'itemSubtotalIDR', o.item_price_idr
    )
  ),
  checkout_fee_snapshot = jsonb_build_object(
    'itemSubtotalIDR', o.item_price_idr,
    'deliveryFeeIDR', o.courier_fee_idr,
    'courierFeeIDR', o.courier_fee_idr,
    'serviceFeeIDR', o.service_fee_idr,
    'taxIDR', o.tax_idr,
    'totalIDR', o.total_idr
  ),
  courier_preference_snapshot = jsonb_strip_nulls(
    jsonb_build_object(
      'provider', (
        select cr.provider
        from courier_rates cr
        where cr.id = o.selected_rate_id
      ),
      'tier', (
        select cr.tier
        from courier_rates cr
        where cr.id = o.selected_rate_id
      ),
      'useLinkedAccount', false
    )
  )
from quotes q
left join merchants m on m.id = q.merchant_id
where q.id = o.quote_id
  and (
    o.selected_listing_snapshot = '{}'::jsonb
    or o.checkout_fee_snapshot = '{}'::jsonb
    or o.courier_preference_snapshot = '{}'::jsonb
  );

with latest_booking_job as (
  select distinct on (oj.order_id)
    oj.order_id,
    oj.status,
    oj.attempt_count,
    oj.max_attempts,
    oj.last_error,
    oj.run_at,
    oj.updated_at
  from order_jobs oj
  where oj.job_type = 'book_courier'
  order by oj.order_id, oj.updated_at desc, oj.created_at desc
)
update orders o
set
  booking_retry_state = case latest.status
    when 'pending' then case
      when coalesce(latest.attempt_count, 0) = 0 then 'pending'
      else 'retrying'
    end
    when 'processing' then 'processing'
    when 'succeeded' then 'succeeded'
    when 'failed' then 'failed'
    else 'idle'
  end,
  booking_retry_attempt_count = coalesce(latest.attempt_count, 0),
  booking_retry_max_attempts = coalesce(latest.max_attempts, 0),
  booking_retry_last_error = latest.last_error,
  booking_retry_next_retry_at = case
    when latest.status = 'pending' then latest.run_at
    else null
  end,
  booking_retry_updated_at = coalesce(latest.updated_at, now())
from latest_booking_job latest
where latest.order_id = o.id;

-- Reliability internals should not be directly readable by clients.
-- Service-role access remains available (service role bypasses RLS).
alter table order_jobs enable row level security;
alter table idempotency_keys enable row level security;
