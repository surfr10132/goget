import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  currentDir,
  "../../../../packages/db/supabase/migrations/20260517000300_part3_persistence_snapshots.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("part 3 persistence migration coverage", () => {
  it("adds orders snapshot + booking retry visibility columns", () => {
    expect(migrationSql).toMatch(/add column if not exists selected_listing_snapshot jsonb/i);
    expect(migrationSql).toMatch(/add column if not exists checkout_fee_snapshot jsonb/i);
    expect(migrationSql).toMatch(/add column if not exists courier_preference_snapshot jsonb/i);
    expect(migrationSql).toMatch(/add column if not exists booking_retry_state text/i);
    expect(migrationSql).toMatch(/add column if not exists booking_retry_attempt_count integer/i);
    expect(migrationSql).toMatch(/add column if not exists booking_retry_max_attempts integer/i);
  });

  it("defines booking retry state constraints and index", () => {
    expect(migrationSql).toMatch(/orders_booking_retry_state_check/i);
    expect(migrationSql).toMatch(/'idle'/i);
    expect(migrationSql).toMatch(/'retrying'/i);
    expect(migrationSql).toMatch(/orders_booking_retry_state_idx/i);
  });

  it("hardens internal reliability tables with RLS", () => {
    expect(migrationSql).toMatch(/alter table order_jobs enable row level security/i);
    expect(migrationSql).toMatch(/alter table idempotency_keys enable row level security/i);
  });
});
