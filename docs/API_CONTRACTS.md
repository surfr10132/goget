# API Contracts

## Conventions

- Base API URL: `API_PUBLIC_URL` (default local: `http://localhost:4000`)
- Content type: `application/json` unless noted
- Auth:
  - `/api/*` routes require authenticated bearer token
  - `/webhooks/*` routes are provider callbacks and do not require user auth
- Health route is public

## Health

### `GET /health`

Returns service liveness.

Response shape:

- `ok: boolean`
- `time: ISO timestamp`

## Sourcing routes

### `POST /api/sourcing/search`

Searches across configured sourcing adapters and optionally persists quote snapshots when `requestId` is provided.

Request shape:

- `query: string` (required)
- `referenceUrl?: string`
- `near?: { lat: number, lng: number }`
- `maxDistanceKm?: number` (default 35)
- `maxPriceIDR?: number`
- `limit?: number` (default 12)
- `requestId?: uuid`

Response shape:

- `items: Array<normalized item>`

### `POST /api/sourcing/test`

Same input shape as `/search`, but uses test merchant seed data.

Response shape:

- `items: Array<normalized item>`
- `source: "test"`

### `GET /api/sourcing/directory`

Queries active merchants from the internal directory.

Query params:

- `q?: string`
- `limit?: number` (default 12)

Response: array of merchant rows.

## Quote routes

### `POST /api/quotes/preview-rates`

Stateless courier estimate based on pickup/dropoff distance.

Request shape:

- `pickup: { lat: number, lng: number }`
- `dropoff: { lat: number, lng: number }`
- `itemValueIDR?: integer` (default 0)

Response shape:

- `rates: Array<{ provider, tier, label, priceIDR, etaMinutes, distanceKm, rateToken }>`
- `distanceKm: number`

Errors:

- `422` when distance exceeds supported threshold.

### `POST /api/quotes/rates`

Fetches live courier rates for an existing quote + address and persists snapshots.

Request shape:

- `quoteId: uuid`
- `addressId: uuid`
- `weightKg?: number`

Response shape:

- `rates: Array<provider quote>`

## Order routes

### `POST /api/orders`

Creates order and payment session from an existing quote + courier rate + address.

Request shape:

- `quoteId: uuid`
- `courierRateId: uuid`
- `addressId: uuid`

Response shape:

- `order: { id, shortCode, totalIDR, breakdown }`
- `payment: { snapToken, redirectUrl }`

### `POST /api/orders/quick`

Atomic create flow used when checkout starts from real-time sourced listing (no pre-existing quote persisted by UI flow).

Request sections:

- `item`
- `pickup`
- `dropoff`
- `recipient`
- `courier`

Response shape mirrors `POST /api/orders`.

### `POST /api/orders/concierge`

Concierge flow where user already paid seller externally and GoGet charges only logistics/service.

Includes additional product metadata such as marketplace reference and source URL.

Response shape:

- `order: { id, shortCode, status, totalIDR, breakdown }`
- `payment: { snapToken, redirectUrl }`

### `GET /api/orders`

Lists current user orders (newest first).

Response shape:

- `orders: Array<order summary with quote, delivery, address snippets>`

### `GET /api/orders/:id`

Returns detailed order record for owner, including payments, deliveries, and events.

### `POST /api/orders/:id/book-courier`

Books courier for order by selected rate (normally triggered post-payment webhook; exposed for internal/ops use).

## Tracking route

### `GET /api/tracking/:shortCode`

Returns owner-visible tracking summary by order short code.

Response shape includes:

- order status and totals
- quote metadata
- active delivery metadata
- status timeline (`order_events`)

## Webhooks

### `POST /webhooks/midtrans`

- Verifies Midtrans signature.
- Deduplicates event by `(provider, external_id)`.
- Updates payment status.
- Updates parent order status.
- Triggers courier booking asynchronously on paid settlement.

### `POST /webhooks/gosend`

- Parses provider payload.
- Maps raw courier status to canonical order status.
- Updates delivery and order records.

### `POST /webhooks/grab`

Same processing model as GoSend webhook route.

## Error handling patterns

- `404` for not found resources.
- `403` for ownership/authz failures.
- `422` for business-rule validation failures.
- `503` for temporarily unavailable provider adapters.
- `500` for unexpected persistence/integration failures.

## Idempotency and retry notes

- Webhook dedupe is persisted in `webhook_events`.
- Payment attempts use unique provider order IDs (`short_code-attempt`).
- Courier booking is designed to be retried safely after transient failures.
