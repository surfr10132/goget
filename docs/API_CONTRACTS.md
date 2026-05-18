# API Contracts

## Conventions

- Base API URL: `API_PUBLIC_URL` (default local: `http://localhost:4000`)
- Content type: `application/json` unless noted
- Auth:
  - `/api/*` routes require authenticated bearer token
  - `/webhooks/*` routes are provider callbacks and do not require user auth
- Order creation routes require an `Idempotency-Key` header:
  - `POST /api/orders`
  - `POST /api/orders/quick`
  - `POST /api/orders/concierge`
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
Request shape (modern):

- `mode: "url" | "keyword"`
- `query?: string` (required for `keyword`, optional for `url`)
- `referenceUrl?: string` (required for `url`)
- `location: {`
  - `near?: { lat: number, lng: number }`
  - `zipcode?: string` (Indonesia 5-digit postal code)
  - `maxDistanceKm?: number` (default 35, max 35)
  - `}`
- `maxPriceIDR?: number`
- `limit?: number` (default 12)
- `requestId?: uuid`

Legacy request shape remains accepted for backward compatibility:

- `query: string`
- `referenceUrl?: string`
- `near?: { lat: number, lng: number }`
- `zipcode?: string`
- `maxDistanceKm?: number`
- `maxPriceIDR?: number`
- `limit?: number`
- `requestId?: uuid`

Response shape:

- `mode: "url" | "keyword"`
- `location: { near: { lat, lng } | null, zipcode: string | null, maxDistanceKm: number }`
- `items: Array<normalized item>`
  - Includes compatibility fields (`priceIDR`, `merchantName`, `pickupAddress`, etc.)
  - Includes normalized comparison fields:
    - `itemSubtotalIDR`
    - `sellerName`
    - `sellerLocation`
    - `estimatedDeliveryMinutes`
    - `rankingScore`

Notes:

- If only `zipcode` is provided, the API geocodes zipcode → coordinates before sourcing.
- Distance filtering is applied against the resolved location using `maxDistanceKm` (default 35km).

### `POST /api/sourcing/test`

Same input/response shape as `/search`, but uses test merchant seed data.

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

Headers:

- `Idempotency-Key: <unique client key>`

Request shape:

- `quoteId: uuid`
- `courierRateId: uuid`
- `addressId: uuid`

Response shape:

- `order: { id, shortCode, totalIDR, breakdown }`
- `payment: { amountIDR, snapToken, redirectUrl }`

`order.breakdown` fields:

- `itemSubtotalIDR` (marketplace item value for display/reference)
- `deliveryFeeIDR`
- `courierFeeIDR` (backward-compatible alias of `deliveryFeeIDR`)
- `serviceFeeIDR`
- `taxIDR`
- `totalIDR` (charged amount in concierge flow: delivery + service + tax)

Persistence side effects:

- Saves `selected_listing_snapshot` from the chosen quote item/rate context.
- Saves `checkout_fee_snapshot` from computed checkout totals.
- Saves `courier_preference_snapshot` from selected courier details.
- Initializes `fulfillment_retry` snapshot fields on the order record.

### `POST /api/orders/quick`

Atomic create flow used when checkout starts from real-time sourced listing (no pre-existing quote persisted by UI flow).

Headers:

- `Idempotency-Key: <unique client key>`

Request sections:

- `item`
- `pickup`
- `dropoff`
- `recipient`
- `courier`

`courier` request fields:

- `provider`, `tier`, `priceIDR`, `etaMinutes`, `distanceKm`, `rateToken`
- `useLinkedAccount?: boolean`
- `linkedAccountRef?: string`

Response shape mirrors `POST /api/orders`.

### `POST /api/orders/concierge`

Concierge flow where user already paid seller externally and GoGet charges only logistics/service.

Includes additional product metadata such as marketplace reference and source URL.

Headers:

- `Idempotency-Key: <unique client key>`

`courier` request fields:

- `provider`, `tier`, `priceIDR`, `etaMinutes`, `distanceKm`, `rateToken`
- `useLinkedAccount?: boolean`
- `linkedAccountRef?: string`

Response shape:

- `order: { id, shortCode, status, totalIDR, breakdown }`
- `payment: { amountIDR, snapToken, redirectUrl }`

### `GET /api/orders`

Lists current user orders (newest first).

Response shape:

- `orders: Array<order summary with quote, delivery, address snippets>`
- Each order row also includes:
  - `selected_listing_snapshot`
  - `checkout_fee_snapshot`
  - `courier_preference_snapshot`
  - `fulfillment_retry: { state, attemptCount, maxAttempts, lastError, nextRetryAt, updatedAt }`

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
- selected listing / checkout / courier preference snapshots
- `fulfillment_retry` visibility fields for booking retry/failure progress

## Webhooks

### `POST /webhooks/midtrans`

- Verifies Midtrans signature.
- Deduplicates event by `(provider, external_id)`.
- Updates payment status.
- Updates parent order status.
- Triggers courier booking asynchronously on paid settlement.

### `POST /webhooks/order-jobs/process`

Internal endpoint used by scheduler/cron to process pending courier-booking retry jobs.

Auth:

- Requires either `Authorization: Bearer <ORDER_JOBS_PROCESS_TOKEN>` or `x-order-jobs-token: <ORDER_JOBS_PROCESS_TOKEN>`

Query params:

- `limit?: number` (default 10, clamped to safe bounds)

Response shape:

- `ok: true`
- `claimed: number`
- `succeeded: number`
- `retried: number`
- `failed: number`

### `POST /webhooks/gosend`

- Parses provider payload.
- Maps raw courier status to canonical order status.
- Updates delivery and order records.

### `POST /webhooks/grab`

Same processing model as GoSend webhook route.

## Error handling patterns
- `400` for malformed payloads or missing required headers (for example missing `Idempotency-Key`).
- `401` for unauthorized internal webhook invocations.
- `404` for not found resources.
- `403` for ownership/authz failures.
- `409` for idempotency conflicts (payload mismatch or duplicate request already in progress).
- `422` for business-rule validation failures.
- `503` for temporarily unavailable provider adapters.
- `500` for unexpected persistence/integration failures.

## Idempotency and retry notes

- Webhook dedupe is persisted in `webhook_events`.
- Payment attempts use unique provider order IDs (`short_code-attempt`).
- Courier booking is designed to be retried safely after transient failures.
- `fulfillment_retry.state` values are: `idle`, `pending`, `processing`, `retrying`, `succeeded`, `failed`.
