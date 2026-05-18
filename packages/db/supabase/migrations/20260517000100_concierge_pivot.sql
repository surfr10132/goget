-- Concierge pivot: GoGet no longer resells the item. The user buys it themselves
-- on Tokopedia/Shopee/Bukalapak via an in-app WebView; GoGet only schedules the
-- pickup and delivery. The legacy item-resale columns stay (nullable) to keep
-- old rows readable, but new columns capture the WebView handoff state.

-- 1. Add "item_picked_up" to the order_status enum (replaces item_purchased).
--    Postgres can't drop enum values cleanly, so the old value remains valid;
--    app code now writes the new value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'item_picked_up'
      AND enumtypid = 'order_status'::regtype
  ) THEN
    ALTER TYPE order_status ADD VALUE 'item_picked_up' AFTER 'runner_assigned';
  END IF;
END $$;

-- 2. Concierge metadata on orders. All nullable so legacy rows are valid.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS marketplace_order_ref   TEXT,
  ADD COLUMN IF NOT EXISTS product_source_url      TEXT,
  ADD COLUMN IF NOT EXISTS product_thumbnail_url   TEXT,
  ADD COLUMN IF NOT EXISTS item_declared_value_idr INTEGER;

COMMENT ON COLUMN orders.marketplace_order_ref IS
  'Marketplace invoice/order reference captured after the user confirms purchase via WebView.';
COMMENT ON COLUMN orders.product_source_url IS
  'URL the WebView handoff sent the user to (Tokopedia/Shopee/Bukalapak product page).';
COMMENT ON COLUMN orders.item_declared_value_idr IS
  'User-declared item value used for delivery insurance and pickup receipt matching.';

-- 3. RLS: no new policies needed. The existing "orders are owned by the
--    auth.uid() matching user_id" policy already covers reads + writes for
--    the new columns.

-- 4. Note on item_purchases: kept untouched. Future cleanup may drop it once
--    no production rows reference it. Leaving as-is for now so backfill jobs
--    and historical reporting don't break.
