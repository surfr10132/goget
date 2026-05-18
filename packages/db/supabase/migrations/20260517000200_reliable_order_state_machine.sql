-- =====================================================================
-- Reliable order command primitives
-- - Durable order job queue for booking + retries
-- - Idempotency keys for order-creation endpoints
-- - Concurrency-safe payment attempt allocation
-- - Centralized order status transitions
-- =====================================================================

-- ---------- orders.payment_attempt_seq ----------

alter table orders
  add column if not exists payment_attempt_seq integer not null default 0;

update orders o
set payment_attempt_seq = coalesce(p.max_attempt, 0)
from (
  select order_id, max(attempt) as max_attempt
  from payments
  group by order_id
) p
where o.id = p.order_id
  and o.payment_attempt_seq < coalesce(p.max_attempt, 0);

create or replace function create_midtrans_payment_attempt(
  p_order_id uuid,
  p_amount_idr bigint
)
returns table (
  payment_id uuid,
  attempt integer,
  provider_order_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt integer;
  v_short_code text;
  v_provider_order_id text;
  v_payment_id uuid;
begin
  update orders
  set payment_attempt_seq = payment_attempt_seq + 1
  where id = p_order_id
  returning payment_attempt_seq, short_code into v_attempt, v_short_code;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  v_provider_order_id := v_short_code || '-' || v_attempt::text;

  insert into payments (
    order_id,
    provider,
    provider_order_id,
    amount_idr,
    status,
    attempt
  ) values (
    p_order_id,
    'midtrans',
    v_provider_order_id,
    p_amount_idr,
    'pending',
    v_attempt
  )
  returning id into v_payment_id;

  return query
  select v_payment_id, v_attempt, v_provider_order_id;
end;
$$;

revoke all on function create_midtrans_payment_attempt(uuid, bigint) from public;
grant execute on function create_midtrans_payment_attempt(uuid, bigint) to service_role;

-- ---------- idempotency_keys ----------

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'idempotency_status'
  ) then
    create type idempotency_status as enum ('in_progress', 'completed');
  end if;
end $$;

create table if not exists idempotency_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null,
  idempotency_key text not null,
  request_hash text not null,
  status idempotency_status not null default 'in_progress',
  response_status integer,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint, idempotency_key)
);

create index if not exists idempotency_keys_lookup_idx
  on idempotency_keys(user_id, endpoint, idempotency_key);

drop trigger if exists idempotency_keys_updated_at on idempotency_keys;
create trigger idempotency_keys_updated_at before update on idempotency_keys
  for each row execute function tg_set_updated_at();

-- ---------- order_jobs ----------

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'order_job_type'
  ) then
    create type order_job_type as enum ('book_courier');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'order_job_status'
  ) then
    create type order_job_status as enum ('pending', 'processing', 'succeeded', 'failed');
  end if;
end $$;

create table if not exists order_jobs (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  job_type order_job_type not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status order_job_status not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 6,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type, dedupe_key)
);

create index if not exists order_jobs_claim_idx
  on order_jobs(status, run_at);

create index if not exists order_jobs_order_idx
  on order_jobs(order_id, created_at desc);

drop trigger if exists order_jobs_updated_at on order_jobs;
create trigger order_jobs_updated_at before update on order_jobs
  for each row execute function tg_set_updated_at();

create or replace function enqueue_order_job(
  p_order_id uuid,
  p_job_type order_job_type,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 6,
  p_run_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  insert into order_jobs (
    order_id,
    job_type,
    dedupe_key,
    payload,
    status,
    attempt_count,
    max_attempts,
    run_at
  ) values (
    p_order_id,
    p_job_type,
    p_dedupe_key,
    coalesce(p_payload, '{}'::jsonb),
    'pending',
    0,
    greatest(p_max_attempts, 1),
    coalesce(p_run_at, now())
  )
  on conflict (job_type, dedupe_key)
  do update set
    payload = excluded.payload
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function enqueue_order_job(uuid, order_job_type, text, jsonb, integer, timestamptz) from public;
grant execute on function enqueue_order_job(uuid, order_job_type, text, jsonb, integer, timestamptz) to service_role;

create or replace function claim_order_jobs(
  p_limit integer default 10
)
returns table (
  id uuid,
  order_id uuid,
  job_type order_job_type,
  payload jsonb,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select oj.id
    from order_jobs oj
    where (
      (oj.status = 'pending' and oj.run_at <= now())
      or (
        oj.status = 'processing'
        and oj.locked_at is not null
        and oj.locked_at <= now() - interval '5 minutes'
      )
    )
    order by oj.run_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  ),
  claimed as (
    update order_jobs oj
    set
      status = 'processing',
      locked_at = now()
    where oj.id in (select c.id from candidates c)
    returning oj.id, oj.order_id, oj.job_type, oj.payload, oj.attempt_count, oj.max_attempts
  )
  select c.id, c.order_id, c.job_type, c.payload, c.attempt_count, c.max_attempts
  from claimed c;
end;
$$;

revoke all on function claim_order_jobs(integer) from public;
grant execute on function claim_order_jobs(integer) to service_role;

-- ---------- centralized order status transitions ----------

create or replace function is_valid_order_status_transition(
  p_from order_status,
  p_to order_status
)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or case p_from
      when 'pending_payment' then p_to in ('paid', 'failed', 'canceled')
      when 'paid' then p_to in ('awaiting_pickup', 'failed', 'refunded', 'canceled')
      when 'awaiting_pickup' then p_to in ('runner_assigned', 'item_picked_up', 'item_purchased', 'in_transit', 'failed', 'canceled', 'refunded')
      when 'runner_assigned' then p_to in ('item_picked_up', 'item_purchased', 'in_transit', 'failed', 'canceled', 'refunded')
      when 'item_picked_up' then p_to in ('in_transit', 'delivered', 'failed', 'refunded')
      when 'item_purchased' then p_to in ('in_transit', 'delivered', 'failed', 'refunded')
      when 'in_transit' then p_to in ('delivered', 'failed', 'refunded')
      when 'delivered' then p_to in ('refunded')
      when 'failed' then p_to in ('paid', 'canceled')
      when 'canceled' then p_to in ('pending_payment')
      when 'refunded' then false
      else false
    end;
$$;

create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not is_valid_order_status_transition(old.status, new.status) then
      raise exception 'invalid order status transition: % -> %', old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_status_transition on orders;
create trigger orders_enforce_status_transition
before update of status on orders
for each row execute function enforce_order_status_transition();

create or replace function transition_order_status(
  p_order_id uuid,
  p_next_status order_status,
  p_status_reason text default null,
  p_note text default null,
  p_meta jsonb default null
)
returns table (
  changed boolean,
  status order_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status order_status;
  v_changed boolean := false;
begin
  select o.status
    into v_current_status
  from orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  if v_current_status = p_next_status then
    if p_status_reason is not null then
      update orders
      set status_reason = p_status_reason
      where id = p_order_id;
    end if;
  elsif not is_valid_order_status_transition(v_current_status, p_next_status) then
    return query
    select false, v_current_status;
    return;
  else
    update orders
    set
      status = p_next_status,
      status_reason = case
        when p_status_reason is not null then p_status_reason
        else status_reason
      end,
      canceled_at = case
        when p_next_status = 'canceled' then coalesce(canceled_at, now())
        else canceled_at
      end
    where id = p_order_id;

    v_changed := true;
  end if;

  if v_changed then
    insert into order_events (order_id, status, note, meta)
    values (p_order_id, p_next_status, p_note, p_meta);
  end if;

  return query
  select v_changed, case when v_changed then p_next_status else v_current_status end;
end;
$$;

revoke all on function transition_order_status(uuid, order_status, text, text, jsonb) from public;
grant execute on function transition_order_status(uuid, order_status, text, text, jsonb) to service_role;
