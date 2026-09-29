import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260929111018_set_launch_platform_fee_to_five_percent.sql"
const migrationSource = fs.readFileSync(path.join(root, migrationFile), "utf8")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const schemaPreflight = between(
  migrationSource,
  "do $schema_preflight$",
  "$schema_preflight$;"
)
const dataPreflight = between(
  migrationSource,
  "do $data_preflight$",
  "$data_preflight$;"
)
const snapshot = between(migrationSource, "do $snapshot$", "$snapshot$;")
const mutation = between(
  migrationSource,
  "alter table public.vendors disable trigger vendors_updated_at;",
  "do $postcondition$"
)
const postcondition = between(
  migrationSource,
  "do $postcondition$",
  "$postcondition$;"
)

test("migration is one repeatable-read transaction with a locked vendor baseline", () => {
  assert.match(migrationSource, /^-- Ops 2B2A:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set transaction isolation level repeatable read/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /set local search_path = pg_catalog, public/)
  assert.match(migrationSource, /lock table public\.vendors in access exclusive mode/)
  assert.ok(
    migrationSource.indexOf("lock table public.vendors in access exclusive mode") <
      migrationSource.indexOf("do $schema_preflight$"),
    "the vendor lock must precede the first baseline query"
  )
  assert.match(migrationSource, /\ncommit;\s*$/)
  assert.equal((migrationSource.match(/^begin;$/gm) ?? []).length, 1)
  assert.equal((migrationSource.match(/^commit;$/gm) ?? []).length, 1)
})

test("preflight requires the exact audited ten-percent fee schema", () => {
  assert.match(schemaPreflight, /format_type\([\s\S]*= 'numeric\(5,2\)'/)
  assert.match(schemaPreflight, /not attribute\.attnotnull/)
  assert.match(schemaPreflight, /pg_get_expr\([\s\S]*\) = '10\.00'/)
  assert.match(schemaPreflight, /vendors_platform_fee_pct_check/)
  assert.match(
    schemaPreflight,
    /CHECK \(platform_fee_pct >= 0::numeric AND platform_fee_pct <= 100::numeric\)/
  )
  assert.match(schemaPreflight, /constraint_record\.convalidated/)
})

test("data preflight rejects null invalid and custom fee rows", () => {
  assert.match(dataPreflight, /vendor\.platform_fee_pct is null/)
  assert.match(dataPreflight, /vendor\.platform_fee_pct < 0/)
  assert.match(dataPreflight, /vendor\.platform_fee_pct > 100/)
  assert.match(
    dataPreflight,
    /vendor\.platform_fee_pct is distinct from 10\.00/
  )
  assert.match(dataPreflight, /marketa_ops2b2a\.vendor_count/)
})

test("mutation changes only the default and exact audited ten-percent rows", () => {
  assert.match(
    mutation,
    /alter column platform_fee_pct set default 5\.00/
  )
  assert.match(
    mutation,
    /update public\.vendors as vendor\s+set platform_fee_pct = 5\.00\s+where vendor\.platform_fee_pct = 10\.00;/
  )
  assert.equal((mutation.match(/update public\.vendors/gi) ?? []).length, 1)
  assert.doesNotMatch(
    mutation,
    /update public\.vendors[\s\S]*set platform_fee_pct = 5\.00\s*;/i
  )
})

test("the audited timestamp trigger is bypassed only around the fee rewrite", () => {
  assert.match(schemaPreflight, /trigger\.tgname = 'vendors_updated_at'/)
  assert.match(schemaPreflight, /trigger\.tgenabled = 'O'/)
  assert.match(schemaPreflight, /public\.handle_updated_at\(\)/)
  assert.match(
    mutation,
    /^alter table public\.vendors disable trigger vendors_updated_at;/
  )
  assert.match(
    mutation,
    /alter table public\.vendors enable trigger vendors_updated_at;\s*$/
  )
})

test("postconditions prove the five-percent result and row preservation", () => {
  assert.match(postcondition, /pg_get_expr\([\s\S]*\) = '5\.00'/)
  assert.match(
    postcondition,
    /vendor\.platform_fee_pct is distinct from 5\.00/
  )
  assert.match(postcondition, /platform fee range constraint changed/)
  assert.match(postcondition, /marketa_ops2b2a\.vendor_count/)
  assert.match(postcondition, /marketa_ops2b2a\.vendor_non_fee_rows/)
  assert.match(postcondition, /a non-fee vendor field changed/)
})

test("vendor RLS policies ownership fields and activation authority are unchanged", () => {
  for (const evidence of [
    "'owner'",
    "'acl'",
    "'rls'",
    "'force_rls'",
    "'policies'",
    "'triggers'",
    "'non_fee_columns'",
    "'constraints'",
    "'indexes'",
    "'activation_rpc'",
  ]) {
    assert.ok(snapshot.includes(evidence), evidence)
    assert.ok(postcondition.includes(evidence), evidence)
  }
  assert.match(
    postcondition,
    /has_column_privilege\([\s\S]*'authenticated'[\s\S]*'public\.vendors'[\s\S]*'is_active'[\s\S]*'UPDATE'/
  )
  assert.match(postcondition, /marketa_ops2b2a\.vendor_security/)
})

test("Ops 1A and Ops 2B1 objects are snapshotted unchanged", () => {
  assert.match(schemaPreflight, /69bc5e9b0bd95769525f9816a9791145/)
  assert.match(schemaPreflight, /Ops 1A decrement_stock containment changed/)
  assert.match(schemaPreflight, /public\.payments/)
  assert.match(schemaPreflight, /public\.payment_events/)
  assert.match(schemaPreflight, /finalize_vendor|finalize_paystack_paid_order/)
  assert.match(snapshot, /marketa_ops2b2a\.ops1a_state/)
  assert.match(snapshot, /marketa_ops2b2a\.ops2b1_state/)
  assert.match(snapshot, /'legacy_relations'/)
  for (const relation of [
    "public.orders",
    "public.order_items",
    "public.payout_ledger",
    "public.events_ledger",
  ]) {
    assert.ok(snapshot.includes(`'${relation}'::pg_catalog.regclass`), relation)
    assert.ok(postcondition.includes(`'${relation}'::pg_catalog.regclass`), relation)
  }
  assert.match(postcondition, /Ops 1A containment changed/)
  assert.match(postcondition, /Ops 2B1 objects changed/)
})

test("protected order payment ledger and product rows are unchanged", () => {
  for (const relation of [
    "orders",
    "order_items",
    "payments",
    "payment_events",
    "payout_ledger",
    "events_ledger",
    "products",
  ]) {
    assert.ok(snapshot.includes(`'${relation}'`), relation)
    assert.ok(postcondition.includes(`'${relation}'`), relation)
  }
  assert.match(snapshot, /marketa_ops2b2a\.protected_rows/)
  assert.match(postcondition, /marketa_ops2b2a\.protected_rows/)

  assert.doesNotMatch(
    mutation,
    /(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s+public\.(?:orders|order_items|payments|payment_events|payout_ledger|events_ledger|products)\b/i
  )
  assert.doesNotMatch(mutation, /\b(?:stock|decrement_stock)\b/i)
})

test("migration contains no checkout webhook workflow or payment invocation", () => {
  assert.doesNotMatch(mutation, /checkout|webhook|n8n|http|net\.|edge function/i)
  assert.doesNotMatch(
    mutation,
    /(?:perform|call|select)\s+public\.finalize_paystack_paid_order/i
  )
  assert.doesNotMatch(
    mutation,
    /(?:perform|call|select)\s+public\.decrement_stock/i
  )
})
