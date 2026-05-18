# System Architecture

## Overview

GoGet is a pnpm/turbo monorepo with three app surfaces and shared domain packages:

- `apps/web` — Next.js web app for customer flows.
- `apps/mobile` — Expo React Native app.
- `apps/api` — Hono orchestration API for sourcing, quotes, orders, tracking, webhooks.
- `packages/shared` — domain types, pricing, courier/payment/sourcing adapters.
- `packages/db` — Supabase schema and migrations (Postgres + PostGIS + RLS).

## Architectural boundaries

### Client responsibilities (web/mobile)

- Auth with Supabase.
- User-facing flows (search, checkout, orders, account).
- Marketplace purchase handoff (open listing; user pays seller directly).
- Call GoGet API for orchestration operations.

### API responsibilities (`apps/api`)

- Validate and orchestrate sourcing, quotes, and order creation.
- Compute logistics pricing components via shared fee logic.
- Create Midtrans transactions and process payment outcomes.
- Book couriers only after confirmed payment.
- Normalize provider webhook statuses into canonical order states.

### Data responsibilities (Supabase/Postgres)

- Persist user, request, quote, rate, order, payment, delivery, event records.
- Enforce ownership and access patterns via RLS and API-side checks.
- Keep auditable event history through `order_events` and `webhook_events`.

## Runtime request flow

1. Client authenticates with Supabase and sends bearer token to API for `/api/*` routes.
2. API validates auth and route payloads (Zod).
3. API reads/writes Supabase tables for request/order/payment state.
4. API calls external providers:
   - Midtrans for payment session creation and settlement callbacks.
   - GoSend/Grab for courier quote/booking/status callbacks.
5. Webhooks update canonical state and append events.

## Canonical order lifecycle

- `pending_payment`
- `paid`
- `awaiting_pickup`
- `runner_assigned`
- `item_picked_up` (new canonical label; legacy `item_purchased` retained for compatibility)
- `in_transit`
- `delivered`
- failure paths: `failed`, `refunded`, `canceled`

State updates are event-backed through `order_events`.

## Data model (core tables)

- `profiles`, `addresses`
- `item_requests`, `quotes`, `courier_rates`
- `orders`, `order_events`
- `payments`
- `deliveries`
- `webhook_events`
- `order_jobs`
- `idempotency_keys`

Important design points:

- `orders.selected_rate_id` stores chosen courier rate explicitly.
- `orders` stores create-time snapshots (`selected_listing_snapshot`, `checkout_fee_snapshot`, `courier_preference_snapshot`) and retry visibility fields (`booking_retry_*`).
- `payments` uses unique `(provider, provider_order_id)` and per-order `attempt` strategy.
- `webhook_events` deduplicates by `(provider, external_id)`.
- `idempotency_keys` enforces replay-safe order creation semantics across `POST /api/orders*`.
- PostGIS geography fields are used for pickup/dropoff coordinates.

## Pricing model

Fee breakdown is computed from shared logic (`packages/shared/src/fees.ts`):

- Flat service fee: Rp 8.000
- Tax: 11% PPN on service fee
- Total GoGet charge: `courier_fee + service_fee + tax`

Item price remains recorded for reporting and ops context, but user pays item seller directly outside GoGet payment flow.

## Security model

- API auth middleware protects all `/api/*` routes.
- Webhook routes are unauthenticated but signature-verified and idempotent.
- CORS is allowlisted to known local/prod origins; wildcard is intentionally avoided.
- Ownership checks ensure users can only read/write their own orders/addresses/quotes.

## Reliability strategies

- Idempotent webhook log before state mutation.
- Idempotent order creation via `Idempotency-Key` + persisted response replay.
- Payment row inserted before Midtrans session creation to avoid orphan settlement callbacks.
- Booking is deferred until payment settlement.
- Courier booking retries are processed via `order_jobs` with bounded attempts/backoff and order-level retry snapshots.
- Event history is append-only for audit and debugging.

## External integrations

- Supabase: auth, Postgres, Realtime/storage capabilities.
- Midtrans: payment transaction and webhook settlement.
- GoSend and Grab: rate estimate/booking/tracking webhooks.
- Marketplace sources: search/listing data ingestion, not checkout custody.

## Deployment and environments

- Local dev via `pnpm dev` (Turbo orchestration).
- API and client URLs set via environment variables.
- Provider credentials are optional in dev; endpoints degrade gracefully when unavailable.
- Internal retry processing endpoint (`POST /webhooks/order-jobs/process`) is guarded by `ORDER_JOBS_PROCESS_TOKEN`.

## Known constraints

- Real provider access depends on partner approvals.
- Search scraping should migrate toward official marketplace APIs over time.
- Some compatibility fields remain while concierge pivot completes cleanup.
