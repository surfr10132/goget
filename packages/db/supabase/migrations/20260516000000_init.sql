-- =====================================================================
-- GoGet — initial schema
-- All money stored in IDR minor units (rupiah, no cents in IDR).
-- All timestamps in UTC; convert to Asia/Jakarta on display.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";
create extension if not exists "postgis";

-- ---------- Enums ----------

create type user_role as enum ('customer', 'runner', 'merchant', 'admin');
create type address_kind as enum ('home', 'office', 'store', 'other');

create type request_status as enum (
  'draft',           -- user composing
  'submitted',       -- waiting for sourcing
  'sourcing',        -- system/ops finding it
  'quoted',          -- options shown to user
  'expired',         -- user did not accept in time
  'canceled'         -- user/system canceled before order
);

create type order_status as enum (
  'pending_payment',
  'paid',
  'awaiting_pickup',
  'runner_assigned',
  'item_purchased',
  'in_transit',
  'delivered',
  'refunded',
  'failed',
  'canceled'
);

create type courier_provider as enum ('gosend', 'grab', 'manual');
create type courier_tier as enum ('instant', 'sameday', 'car_instant', 'car_sameday');

create type payment_provider as enum ('midtrans');
create type payment_status as enum ('pending', 'authorized', 'paid', 'failed', 'refunded', 'expired');

create type source_channel as enum ('tokopedia', 'shopee', 'bukalapak', 'directory', 'manual');

-- ---------- Users / Profiles ----------

-- Supabase manages auth.users; we extend with a profile row.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  full_name text,
  phone_e164 text unique,
  preferred_language text default 'id',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_phone_idx on profiles (phone_e164);

create table addresses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind address_kind not null default 'home',
  label text,
  recipient_name text not null,
  recipient_phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  province text not null,
  postal_code text,
  geo geography(point, 4326) not null,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index addresses_user_idx on addresses (user_id);
create index addresses_geo_idx on addresses using gist (geo);

-- ---------- Merchant directory ----------
-- Curated stores GoGet knows about, plus stores discovered via scraping.

create table merchants (
  id uuid primary key default uuid_generate_v4(),
  external_id text,                          -- vendor id on tokopedia/shopee/etc.
  source source_channel not null default 'directory',
  name text not null,
  legal_name text,
  description text,
  phone text,
  email text,
  website text,
  geo geography(point, 4326),
  address_line text,
  city text,
  province text,
  rating numeric(3,2),
  is_active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index merchants_geo_idx on merchants using gist (geo);
create index merchants_name_trgm on merchants using gin (name gin_trgm_ops);

-- ---------- Item requests ----------
-- A user describes what they want; system produces quotes.

create table item_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  query text not null,                       -- free-text description
  reference_url text,                        -- optional product link
  photo_urls text[] not null default '{}',
  max_price_idr bigint,                      -- optional ceiling for item price
  delivery_address_id uuid references addresses(id),
  status request_status not null default 'submitted',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index item_requests_user_idx on item_requests (user_id, created_at desc);
create index item_requests_status_idx on item_requests (status);

-- ---------- Quotes (sourcing results) ----------
-- Multiple candidate items per request: different stores, prices, ETAs.

create table quotes (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references item_requests(id) on delete cascade,
  merchant_id uuid references merchants(id),
  source source_channel not null,
  external_url text,
  title text not null,
  description text,
  image_url text,
  item_price_idr bigint not null,
  available_qty integer,
  pickup_geo geography(point, 4326),
  pickup_address text,
  est_pickup_ready_minutes integer,          -- "ready in ~30 min"
  notes text,
  is_chosen boolean not null default false,
  created_at timestamptz not null default now()
);

create index quotes_request_idx on quotes (request_id);

-- ---------- Courier rate snapshots ----------
-- For a given quote + delivery address, compare GoSend vs Grab in real time.

create table courier_rates (
  id uuid primary key default uuid_generate_v4(),
  quote_id uuid not null references quotes(id) on delete cascade,
  provider courier_provider not null,
  tier courier_tier not null,
  price_idr bigint not null,
  eta_minutes integer,
  distance_km numeric(6,2),
  raw_response jsonb,
  expires_at timestamptz,                    -- rates are usually short-lived
  created_at timestamptz not null default now()
);

create index courier_rates_quote_idx on courier_rates (quote_id);

-- ---------- Orders ----------
-- Created when user confirms a quote + courier choice and pays.

create table orders (
  id uuid primary key default uuid_generate_v4(),
  short_code text unique not null,           -- "GG-3F9K2X", for support
  user_id uuid not null references profiles(id),
  request_id uuid not null references item_requests(id),
  quote_id uuid not null references quotes(id),
  merchant_id uuid references merchants(id),
  delivery_address_id uuid not null references addresses(id),

  -- Money breakdown (IDR, integer)
  item_price_idr bigint not null,
  service_fee_idr bigint not null,
  courier_fee_idr bigint not null,
  tax_idr bigint not null default 0,
  total_idr bigint not null,

  status order_status not null default 'pending_payment',
  status_reason text,
  canceled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_user_idx on orders (user_id, created_at desc);
create index orders_status_idx on orders (status);

create table order_events (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  status order_status not null,
  note text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on order_events (order_id, created_at);

-- ---------- Deliveries ----------
-- Each order has exactly one active delivery; we may re-book on failure.

create table deliveries (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  provider courier_provider not null,
  tier courier_tier not null,
  external_booking_id text,                  -- provider's id
  tracking_url text,
  driver_name text,
  driver_phone text,
  driver_vehicle text,
  driver_plate text,
  pickup_at timestamptz,
  delivered_at timestamptz,
  last_known_geo geography(point, 4326),
  status text,                               -- raw status from provider
  raw_meta jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deliveries_order_idx on deliveries (order_id);
create index deliveries_active_idx on deliveries (is_active) where is_active;

-- ---------- Payments ----------

create table payments (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  provider payment_provider not null default 'midtrans',
  provider_order_id text not null,           -- midtrans order_id
  method text,                                -- 'gopay', 'va', 'qris', 'cc', ...
  amount_idr bigint not null,
  status payment_status not null default 'pending',
  paid_at timestamptz,
  expires_at timestamptz,
  raw_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);

create index payments_order_idx on payments (order_id);

-- ---------- Webhook log (idempotency + audit) ----------

create table webhook_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null,                    -- 'midtrans' | 'gosend' | 'grab'
  external_id text not null,                 -- dedupe key from provider
  payload jsonb not null,
  signature text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, external_id)
);

-- ---------- Helper: short_code generator ----------

create or replace function generate_short_code() returns text as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  result text := 'GG-';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$ language plpgsql volatile;

create or replace function set_order_short_code() returns trigger as $$
begin
  if new.short_code is null or new.short_code = '' then
    loop
      new.short_code := generate_short_code();
      exit when not exists (select 1 from orders where short_code = new.short_code);
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger orders_short_code before insert on orders
  for each row execute function set_order_short_code();

-- ---------- updated_at triggers ----------

create or replace function tg_set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on profiles
  for each row execute function tg_set_updated_at();
create trigger item_requests_updated_at before update on item_requests
  for each row execute function tg_set_updated_at();
create trigger orders_updated_at before update on orders
  for each row execute function tg_set_updated_at();
create trigger deliveries_updated_at before update on deliveries
  for each row execute function tg_set_updated_at();
create trigger payments_updated_at before update on payments
  for each row execute function tg_set_updated_at();
