# GoGet

Find hard-to-find things in Indonesia. Buy them yourself on Tokopedia / Shopee / Bukalapak via an in-app browser, then let GoGet pick them up from the seller and deliver via GoSend or Grab.

GoGet is a **concierge delivery** layer — not a marketplace. You always transact directly with the seller on their own platform. GoGet only handles discovery and the last-mile logistics.

## What's in here

```
GoGet/
├─ apps/
│  ├─ web/      Next.js 14 (App Router) — user web app
│  ├─ mobile/   Expo (React Native) — iOS + Android
│  └─ api/      Hono orchestration service (rate compare, order state, webhooks)
├─ packages/
│  ├─ shared/   Types, money helpers, courier + payment SDK wrappers
│  └─ db/       Supabase migrations (Postgres + PostGIS + RLS)
└─ docs/
```

## Documentation

- `docs/README.md` — documentation index
- `docs/PRODUCT_REQUIREMENTS.md` — product scope and requirements
- `docs/SYSTEM_ARCHITECTURE.md` — technical system design
- `docs/API_CONTRACTS.md` — API and webhook contracts
- `docs/IMPLEMENTATION_ROADMAP.md` — phased execution roadmap

## Architecture

```
   ┌───────────┐  ┌────────────┐
   │ Web (Next)│  │Mobile(Expo)│
   └─────┬─────┘  └──────┬─────┘
         │               │
         │  ┌────────────┴────────────┐
         │  │  In-app browser handoff │  user buys on marketplace directly
         │  │  · web: window.open()    │  (window.open on web,
         │  │  · mobile: WebBrowser    │   expo-web-browser on mobile)
         │  └─────────────────────────┘
         │
         │   user auth + queries (Supabase JS)
   ┌─────▼─────┐
   │ Supabase  │ Postgres + Auth + Realtime + Storage
   └─────┬─────┘
         │ RLS-protected reads
   ┌─────┴───────────────────────┐
   │      Orchestration API      │ Hono (Node)
   │  · sourcing (TKP/Shopee/BLP)│  ← search-only: URL, title, price, image
   │  · rate compare (GoSend/Grab)│
   │  · concierge order machine  │  ← courier+service+PPN only, no item resale
   │  · Midtrans + courier hooks │
   └──────┬───────┬──────┬───────┘
          │       │      │
       GoSend   Grab  Midtrans (Snap)
```

GoGet never touches the user's purchase: no carts, no checkout proxying, no
item-resale payment. The API is the only place that talks to courier and
payment providers. The clients only talk to Supabase (for owned data via RLS)
and to the API. Order creation routes are idempotent (`Idempotency-Key`) and
persist listing/checkout/courier snapshots plus booking retry visibility fields
for read models.

## Order lifecycle

```
            (user finds product)
                  │
                  ▼  taps "Order on Tokopedia/Shopee/Bukalapak"
        ┌─────────────────────┐
        │ in-app browser opens│  user pays the seller directly
        └─────────┬───────────┘
                  │  user taps "I've placed my order"
                  ▼
      confirm purchase (ref + declared value)
                  │
                  ▼
        pickup + delivery details
                  │
                  ▼
                courier
                  │
                  ▼
         pending_payment      ← courier fee + service fee + PPN
                  │  Midtrans webhook → "paid"
                  ▼
                paid
                  │  enqueue booking job
                  ▼
      booking retries (pending/processing/retrying)
                  │  success → courier booked
                  ▼
            awaiting_pickup
                  │  courier webhooks
                  ▼
  runner_assigned → item_picked_up
                  → in_transit
                  → delivered
```
Failures route to `failed` / `refunded` (including retry exhaustion). Canceled before payment → `canceled`.
The old `item_purchased` enum value is kept for backwards-compat but new
rows use `item_picked_up`.

## Setup

### Prereqs
- Node 20+ and pnpm 9+
- Supabase CLI (`brew install supabase/tap/supabase`)
- Docker (for local Supabase)
- Midtrans sandbox account (free)
- GoSend / Grab partner credentials (request via their merchant portals — until
  approved, leave the env vars empty and the API will skip rate calls for that
  provider)

### One-time
```bash
cp .env.example .env       # fill in keys
pnpm install
pnpm --filter @goget/db start    # boots local Supabase
pnpm --filter @goget/db reset    # applies migrations + RLS
```

### Run everything
```bash
pnpm dev                   # turbo: starts api + web + mobile dev servers
```

Open:
- Web: http://localhost:3000
- API health: http://localhost:4000/health
- Mobile: scan the Expo QR with the Expo Go app

### Configure webhooks
Point provider webhooks at:
- Midtrans: `POST https://<API_PUBLIC_URL>/webhooks/midtrans`
- GoSend:   `POST https://<API_PUBLIC_URL>/webhooks/gosend`
- Grab:     `POST https://<API_PUBLIC_URL>/webhooks/grab`

Internal retry processor endpoint:
- `POST https://<API_PUBLIC_URL>/webhooks/order-jobs/process` with `Authorization: Bearer <ORDER_JOBS_PROCESS_TOKEN>` (or `x-order-jobs-token`)

For local dev use [ngrok](https://ngrok.com) to expose port 4000.

## What's wired up vs. placeholder

**Real:**
- Database schema + RLS
- Concierge fee model (courier + flat service fee + PPN, integer rupiah)
- GoSend adapter (calculate + book + cancel + webhook parse)
- Grab adapter (OAuth + quote + book + cancel + webhook parse)
- Rate comparison with price/speed bias
- Search intake supports either product URL or keyword, with 35-mile (~56km) filtering by coordinates and zipcode geocode fallback
- Tokopedia / Shopee / Bukalapak search adapters (URL/title/price/image only — no cart logic)
  with per-host rate limiting, retries, Zod validation, and tolerant per-item parsing
- Midtrans Snap + signature-verified webhook (idempotent)
- Concierge order state machine + idempotent webhook log
- Idempotent order creation (`POST /api/orders*`) with replay-safe response caching
- Order snapshots persisted on create (`selected_listing_snapshot`, `checkout_fee_snapshot`, `courier_preference_snapshot`)
- Courier booking retry job processing with user-visible retry status in order and tracking read models
- In-app WebView handoff (web: `window.open` new tab; mobile: `expo-web-browser`)
- Phone OTP sign-in (web + mobile via Supabase)
- Address picker with map (Leaflet + Nominatim, server-side proxy at `/api/geocode`)
- Web pages: home, search, checkout (concierge), orders, account
- Mobile screens: home, search, product-webview, checkout, orders, account

**Stubbed / TODO for real launch:**
- Saved addresses (currently entered fresh per order)
- "Concierge mode" fallback: when search finds nothing on any marketplace, hand the request to ops via WhatsApp
- Merchant onboarding for the GoGet `directory` source
- Runner app (separate Expo build, future)
- Push notifications via Expo + APNs/FCM
- Ratings / disputes / refund workflow
- Anti-fraud: per-user order velocity, payment risk scoring
- Insurance pricing tied to declared item value

## Legal/regulatory checklist (Indonesia)

- **OJK / BI**: GoGet doesn't custody funds beyond a single transaction with Midtrans (settlement to GoGet's PT) → not a PJP license itself, but Midtrans must be on the approved processor list. Confirm with counsel before going live.
- **Marketplace ToS**: GoGet does not transact on behalf of users — the user opens the marketplace's own product page in a browser and pays the seller directly. Search-side scraping of public listings is still a grey area; long-term plan is to swap each adapter for the marketplace's official affiliate / partner search API as we sign agreements.
- **Consumer protection (UU PK No. 8/1999)**: GoGet's relationship with the user is a delivery contract, not a resale. Refund policy applies only to the delivery service.
- **PPN (VAT)**: 11% applies to GoGet's service fee. Item resale is handled by the seller on the marketplace and taxed under their own arrangement. Confirm with an Indonesian tax advisor before launch.
- **PDP Law**: store the minimum PII required; encrypt phone numbers at rest.

## Roadmap

1. Saved addresses + first end-to-end concierge order in Midtrans sandbox.
2. Replace Midtrans + courier env vars with real keys → first paid delivery.
3. Build ops dashboard for the concierge fallback (when search returns nothing).
4. Swap each scraper for the marketplace's official affiliate / search API as partnerships land.
5. Onboard 20 specialty merchants into the `directory` source (importers, hobby shops, pharmacies).
6. Launch in one city (Jakarta) → expand to Bandung, Surabaya, Bali.

Co-Authored-By: Claude
