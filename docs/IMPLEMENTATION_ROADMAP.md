# Implementation Roadmap

## Current baseline

The repository already includes:

- monorepo app scaffolding (web/mobile/api/shared/db),
- Supabase schema + RLS,
- sourcing + quote flows,
- Midtrans payment initiation + webhook handling,
- courier booking pipeline and status updates.

The remaining work is primarily launch hardening, operational tooling, and product polish.

## Phase 1: Launch blockers (now)

### Goals

- Ship reliable end-to-end concierge delivery for one launch city.
- Reduce manual recovery for payment and courier edge cases.

### Deliverables

1. Address management
   - Add saved addresses CRUD with default selection.
   - Validate address geometry quality and fallback UX.
2. Checkout hardening
   - Improve retry UX for canceled/expired payment attempts.
   - Add explicit user messaging around marketplace purchase confirmation.
3. Webhook and orchestration resilience
   - Add retry job for failed courier booking attempts.
   - Add dead-letter/review queue for malformed provider webhooks.
4. Support and ops visibility
   - Internal order timeline viewer for support.
   - Manual actions for rebook/cancel/refund-safe paths.

### Exit criteria

- Successful paid-and-delivered flow in staging at high confidence.
- Known failure modes have deterministic operator playbooks.

## Phase 2: Operational scale-up

### Goals

- Improve reliability, observability, and fulfillment quality.

### Deliverables

1. Monitoring and alerting
   - Track webhook lag, booking latency, and failure rates.
   - Alert on stuck statuses (for example `paid` without `awaiting_pickup` beyond threshold).
2. User communication
   - Push notifications for major status changes.
   - Better delivery ETA communication in orders view.
3. Refund/dispute framework
   - Define state transitions and evidence capture model.
   - Implement first-pass support tooling and policy checks.

### Exit criteria

- Key SLOs instrumented and visible.
- Support can resolve the majority of incidents without engineering intervention.

## Phase 3: Growth and partnerships

### Goals

- Increase order throughput and sourcing quality while reducing policy/compliance risk.

### Deliverables

1. Marketplace sourcing evolution
   - Replace brittle scraping paths with official partner APIs as agreements land.
2. Merchant network expansion
   - Expand curated directory with quality controls and availability freshness.
3. Risk and trust
   - Add anti-fraud controls, order velocity checks, and risk scoring.
   - Introduce insurance-aware pricing tied to declared item value.

### Exit criteria

- Higher conversion from search to successful delivery.
- Lower manual sourcing fallback ratio.

## Parallel workstreams

### Technical

- Contract tests for webhook payloads.
- End-to-end tests across search → payment → delivery lifecycle.
- API schema docs kept in sync with route validations.

### Product/Ops

- Clear launch city service policy and SLAs.
- User-facing terms and refund language aligned with concierge model.
- Provider onboarding checklist (credentials, sandbox, production cutover).

## Suggested sprint order

1. Saved addresses + checkout retry UX
2. Booking retry worker + stuck-order alerts
3. Support timeline and operator actions
4. Notifications + dispute/refund baseline
5. Marketplace partner API migration by source
