-- =====================================================================
-- Row Level Security
-- The service role (server) bypasses RLS. Clients use anon/auth keys.
-- =====================================================================

alter table profiles enable row level security;
alter table addresses enable row level security;
alter table item_requests enable row level security;
alter table quotes enable row level security;
alter table courier_rates enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table deliveries enable row level security;
alter table payments enable row level security;
alter table merchants enable row level security;

-- Profiles: a user can read/write their own.
create policy "own profile readable" on profiles for select using (auth.uid() = id);
create policy "own profile updatable" on profiles for update using (auth.uid() = id);
create policy "self insert profile" on profiles for insert with check (auth.uid() = id);

-- Addresses: owner only.
create policy "own addresses" on addresses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Item requests: owner only.
create policy "own requests" on item_requests for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Quotes: visible to the request owner.
create policy "own request quotes readable" on quotes for select
  using (exists (select 1 from item_requests r
                 where r.id = quotes.request_id and r.user_id = auth.uid()));

create policy "own request courier rates readable" on courier_rates for select
  using (exists (select 1 from quotes q
                 join item_requests r on r.id = q.request_id
                 where q.id = courier_rates.quote_id and r.user_id = auth.uid()));

-- Orders: owner readable.
create policy "own orders readable" on orders for select using (auth.uid() = user_id);
create policy "own order events readable" on order_events for select
  using (exists (select 1 from orders o where o.id = order_events.order_id and o.user_id = auth.uid()));
create policy "own deliveries readable" on deliveries for select
  using (exists (select 1 from orders o where o.id = deliveries.order_id and o.user_id = auth.uid()));
create policy "own payments readable" on payments for select
  using (exists (select 1 from orders o where o.id = payments.order_id and o.user_id = auth.uid()));

-- Merchants: anyone authenticated may browse the directory.
create policy "merchants readable" on merchants for select using (auth.role() = 'authenticated');
