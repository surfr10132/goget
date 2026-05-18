import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  currentDir,
  "../../../../packages/db/supabase/migrations/20260517000200_reliable_order_state_machine.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("reliability migration coverage", () => {
  it("defines idempotency key storage with a unique user/endpoint/key constraint", () => {
    expect(migrationSql).toMatch(/create table if not exists idempotency_keys/i);
    expect(migrationSql).toMatch(/unique\s*\(user_id,\s*endpoint,\s*idempotency_key\)/i);
    expect(migrationSql).toMatch(/request_hash text not null/i);
    expect(migrationSql).toMatch(/status idempotency_status not null default 'in_progress'/i);
  });

  it("defines concurrency-safe payment attempt allocation RPC", () => {
    expect(migrationSql).toMatch(/create or replace function create_midtrans_payment_attempt/i);
    expect(migrationSql).toMatch(/set payment_attempt_seq = payment_attempt_seq \+ 1/i);
    expect(migrationSql).toMatch(/returning payment_attempt_seq,\s*short_code/i);
    expect(migrationSql).toMatch(/provider_order_id/i);
  });

  it("defines durable order job queue and claim semantics", () => {
    expect(migrationSql).toMatch(/create table if not exists order_jobs/i);
    expect(migrationSql).toMatch(/unique\s*\(job_type,\s*dedupe_key\)/i);
    expect(migrationSql).toMatch(/create or replace function enqueue_order_job/i);
    expect(migrationSql).toMatch(/create or replace function claim_order_jobs/i);
    expect(migrationSql).toMatch(/for update skip locked/i);
  });
});
