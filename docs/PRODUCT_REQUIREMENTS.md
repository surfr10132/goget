# Product Requirements Document (PRD)

## Product

GoGet helps users in Indonesia get hard-to-find items by separating item purchase from delivery:

- User buys directly from marketplace sellers (Tokopedia, Shopee, Bukalapak) using an in-app browser handoff.
- GoGet handles only pickup and last-mile delivery (GoSend, Grab), plus service fee collection.

GoGet is a concierge logistics product, not a marketplace or reseller.

## Problem statement

Users can find niche products online but still face friction in pickup and reliable delivery coordination. Existing flows assume standard checkout and do not provide a lightweight concierge layer for post-purchase pickup logistics across marketplaces.

## Target users

- Urban Indonesia users (starting in Jakarta) who:
  - buy from multiple marketplaces,
  - need fast pickup + delivery coordination,
  - want one consistent post-purchase experience.
- Secondary users: internal ops team handling fallback/manual sourcing and delivery exceptions.

## Jobs to be done

1. Discover a product quickly across multiple sources.
2. Open marketplace listing and complete payment directly with the seller.
3. Confirm purchase details once.
4. Pay only GoGet logistics/service charges.
5. Track pickup and delivery status to completion.

## Core principles

- No custody of item purchase flow.
- No cart proxying or seller checkout interception.
- Clear fee transparency: courier fee + flat GoGet service fee + PPN.
- Auditable, event-driven order lifecycle.

## MVP scope

### In scope

- Search/sourcing across Tokopedia, Shopee, Bukalapak (+ test/directory source).
- Web + mobile user flows for:
  - search,
  - marketplace handoff,
  - concierge checkout,
  - payment redirect,
  - order tracking/history.
- Courier quote comparison and booking.
- Midtrans payment collection for logistics fees.
- Webhook-driven status transitions and timeline.
- Supabase-backed auth, storage, and RLS-protected data.

### Out of scope (MVP)

- Holding user funds for item purchase.
- Seller-side marketplace integrations for direct checkout.
- Advanced dispute/refund automation.
- Runner-native app (separate build).
- Full anti-fraud/risk scoring system.

## User flow (MVP)

1. User searches item.
2. User selects a listing and opens marketplace page in browser handoff.
3. User pays seller directly on marketplace.
4. User returns and submits purchase confirmation + recipient details.
5. GoGet shows courier options and total service payment.
6. User pays GoGet via Midtrans.
7. On payment settlement, GoGet books courier.
8. User tracks order until delivered.

## Functional requirements

### FR-1 Sourcing

- Must return normalized item cards: source, title, price, URL, image.
- Must support optional location-aware filtering and distance limits.
- Must support test seed sourcing without live provider credentials.

### FR-2 Checkout and pricing

- Must compute fees from courier rate + flat service fee + PPN.
- Must persist selected courier rate snapshot for later booking/audit.
- Must support “quick” and “concierge” order creation paths.

### FR-3 Payment

- Must create payment attempts with unique provider order IDs.
- Must process Midtrans webhook idempotently.
- Must transition order to paid/failed based on verified payment status.

### FR-4 Delivery orchestration

- Must book courier only after payment success.
- Must map courier provider statuses into GoGet canonical order states.
- Must provide user-visible tracking timeline.

### FR-5 Security and data access

- API routes under `/api/*` require authenticated user context.
- User data access must be protected by Supabase RLS and ownership checks.
- Webhook endpoints must be signature-verified and idempotent.

## Non-functional requirements

- Reliability: webhook processing must be idempotent and replay-safe.
- Performance: search and rate quote routes should return within interactive UX thresholds.
- Observability: order and webhook events must provide enough audit detail for support.
- Compliance-ready: design must preserve clear service-role boundary (delivery service vs item resale).

## Success metrics

### Product metrics

- Search-to-order conversion rate.
- Payment success rate.
- On-time delivery completion rate.
- Failed or canceled order rate.
- Repeat order rate.

### Operational metrics

- Time from payment settlement to courier booking.
- Webhook processing failure rate.
- Manual intervention rate per 100 orders.

## Launch readiness criteria

- End-to-end order flow succeeds reliably in sandbox.
- Payment + courier webhooks validated for retries/duplicates.
- Delivery status timeline visible and accurate in web/mobile.
- Ops can recover from failed booking/payment edge cases.

## Open product questions

- Exact fallback UX when no search results are found.
- Insurance pricing model tied to declared item value.
- How user-visible refund and dispute policies should appear in-app.
- Which city-level launch constraints apply after Jakarta pilot.
