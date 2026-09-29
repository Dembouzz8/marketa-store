import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260928224257_add_atomic_paid_order_finalization.sql"
const migrationSource = fs.readFileSync(path.join(root, migrationFile), "utf8")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const preflight = between(migrationSource, "do $preflight$", "$preflight$;")
const snapshot = between(migrationSource, "do $snapshot$", "$snapshot$;")
const rpcSource = between(
  migrationSource,
  "create function public.finalize_paystack_paid_order(",
  "\n$function$;"
)
const postcondition = between(
  migrationSource,
  "do $postcondition$",
  "$postcondition$;"
)

test("migration is one transactional additive database foundation", () => {
  assert.match(migrationSource, /^-- Ops 2B1:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /set local search_path = pg_catalog, public/)
  assert.match(migrationSource, /do \$preflight\$/)
  assert.match(migrationSource, /do \$snapshot\$/)
  assert.match(migrationSource, /do \$postcondition\$/)
  assert.match(migrationSource, /\ncommit;\s*$/)
  assert.doesNotMatch(migrationSource, /\bupdate\s+public\.events_ledger\b/i)
  assert.doesNotMatch(migrationSource, /\bdelete\s+from\s+public\.events_ledger\b/i)
})

test("payments has provider, transaction, reference, and order identities", () => {
  const table = between(
    migrationSource,
    "create table public.payments (",
    "\n);"
  )

  for (const field of [
    "id uuid primary key",
    "provider text not null",
    "environment text not null",
    "transaction_id text not null",
    "reference text not null",
    "order_id uuid",
    "status text not null",
    "amount_kobo bigint not null",
    "currency text not null",
    "paid_at timestamptz",
    "financial_contract_version smallint",
    "finalization_state text not null",
  ]) {
    assert.ok(table.includes(field), field)
  }

  assert.match(table, /provider = 'paystack'/)
  assert.match(table, /environment in \('test', 'live'\)/)
  assert.match(table, /transaction_id ~ '\^\[1-9\]\[0-9\]\{0,19\}\$'/)
  assert.match(table, /amount_kobo > 0/)
  assert.match(table, /currency ~ '\^\[A-Z\]\{3\}\$'/)
  assert.match(table, /references public\.orders \(id\) on delete restrict/)
  assert.match(
    table,
    /unique \(provider, environment, transaction_id\)/
  )
  assert.match(table, /unique \(provider, environment, reference\)/)
  assert.match(table, /unique \(order_id\)/)
  assert.doesNotMatch(table, /customer_(?:id|email|phone|name)/)
})

test("payment_events uses one exact delivery hash and controlled states", () => {
  const table = between(
    migrationSource,
    "create table public.payment_events (",
    "\n);"
  )

  assert.match(table, /payload_sha256 text not null/)
  assert.equal((table.match(/payload_sha256/g) ?? []).length >= 2, true)
  assert.doesNotMatch(table, /event_fingerprint|payload_hash|raw_payload|payload json/i)
  assert.doesNotMatch(table, /customer_(?:email|phone|name)/i)
  assert.match(
    table,
    /unique \(provider, environment, payload_sha256\)/
  )
  for (const state of [
    "received",
    "processing",
    "completed",
    "terminal_rejected",
    "retryable_failure",
    "reconciliation_required",
  ]) {
    assert.ok(table.includes(`'${state}'`), state)
  }
  assert.match(table, /attempt_count integer not null default 1/)
  assert.match(table, /diagnostic_code text/)
  assert.match(table, /references public\.payments \(id\) on delete restrict/)
})

test("orders receive nullable versioned total evidence without historical defaults", () => {
  const alteration = between(
    migrationSource,
    "alter table public.orders",
    "alter table public.order_items"
  )
  for (const column of [
    "total_amount_kobo bigint",
    "currency text",
    "financial_contract_version smallint",
    "payment_finalized_at timestamptz",
  ]) {
    assert.ok(alteration.includes(`add column ${column}`), column)
  }
  assert.doesNotMatch(alteration, /add column[\s\S]*default/i)
  assert.match(alteration, /financial_contract_version in \(1, 2\)/)
  assert.match(alteration, /currency = 'NGN'/)
  assert.match(alteration, /total_amount \* 100 = total_amount_kobo::numeric/)
})

test("order items require a complete exact gross fee and net snapshot", () => {
  const alteration = between(
    migrationSource,
    "alter table public.order_items",
    "alter table public.payout_ledger"
  )
  for (const column of [
    "unit_amount_kobo bigint",
    "gross_amount_kobo bigint",
    "platform_fee_bps integer",
    "platform_fee_amount_kobo bigint",
    "vendor_net_amount_kobo bigint",
    "currency text",
    "financial_contract_version smallint",
  ]) {
    assert.ok(alteration.includes(`add column ${column}`), column)
  }
  assert.match(alteration, /platform_fee_bps between 0 and 10000/)
  assert.match(
    alteration,
    /gross_amount_kobo = unit_amount_kobo \* quantity::bigint/
  )
  assert.match(
    alteration,
    /gross_amount_kobo = platform_fee_amount_kobo \+ vendor_net_amount_kobo/
  )
  assert.match(alteration, /unit_price \* 100 = unit_amount_kobo::numeric/)
  assert.match(alteration, /subtotal \* 100 = gross_amount_kobo::numeric/)
})

test("sale credits are deterministic and legacy-compatible", () => {
  const alteration = between(
    migrationSource,
    "alter table public.payout_ledger",
    "create table public.payments"
  )
  for (const column of [
    "source_kind text",
    "idempotency_key text",
    "gross_amount_kobo bigint",
    "platform_fee_amount_kobo bigint",
    "net_amount_kobo bigint",
    "currency text",
    "financial_contract_version smallint",
  ]) {
    assert.ok(alteration.includes(`add column ${column}`), column)
  }
  assert.match(alteration, /source_kind = 'sale'/)
  assert.match(alteration, /type = 'credit'/)
  assert.match(alteration, /gross_amount_kobo = platform_fee_amount_kobo \+ net_amount_kobo/)
  assert.match(alteration, /amount \* 100 = net_amount_kobo::numeric/)
  assert.match(
    alteration,
    /create unique index payout_ledger_idempotency_key_key[\s\S]*where idempotency_key is not null/
  )
  assert.match(
    alteration,
    /create unique index payout_ledger_sale_order_vendor_key[\s\S]*where source_kind = 'sale'/
  )
})

test("RPC accepts only authenticated provider facts", () => {
  const signature = between(rpcSource, "(", ")\nreturns table")
  for (const parameter of [
    "p_payload_sha256 text",
    "p_event_type text",
    "p_environment text",
    "p_transaction_id text",
    "p_reference text",
    "p_status text",
    "p_amount_kobo bigint",
    "p_currency text",
    "p_paid_at timestamptz",
  ]) {
    assert.ok(signature.includes(parameter), parameter)
  }
  assert.doesNotMatch(
    signature,
    /order_id|vendor_id|fee|net|customer|email|phone|browser/i
  )
  assert.match(rpcSource, /returns table \([\s\S]*outcome text[\s\S]*order_id uuid[\s\S]*retryable boolean/)
})

test("RPC is volatile SECURITY INVOKER with an empty fixed search path", () => {
  assert.match(rpcSource, /language plpgsql/)
  assert.match(rpcSource, /volatile/)
  assert.match(rpcSource, /security invoker/)
  assert.match(rpcSource, /set search_path = ''/)
  assert.doesNotMatch(rpcSource, /security definer/)
  assert.match(postcondition, /procedure\.proowner = 'postgres'::pg_catalog\.regrole/)
  assert.match(postcondition, /not procedure\.prosecdef/)
  assert.match(postcondition, /procedure\.provolatile = 'v'/)
  assert.match(postcondition, /array\['search_path=""'\]::text\[\]/)
})

test("RPC execution and new tables are service-role-only", () => {
  assert.match(
    migrationSource,
    /revoke all privileges on table public\.payments[\s\S]*from public, anon, authenticated, service_role/
  )
  assert.match(
    migrationSource,
    /revoke all privileges on table public\.payment_events[\s\S]*from public, anon, authenticated, service_role/
  )
  assert.match(migrationSource, /grant all privileges on table public\.payments to service_role/)
  assert.match(migrationSource, /grant all privileges on table public\.payment_events to service_role/)
  assert.match(
    migrationSource,
    /revoke all privileges on function public\.finalize_paystack_paid_order\([\s\S]*from public, anon, authenticated, service_role/
  )
  assert.match(
    migrationSource,
    /grant execute on function public\.finalize_paystack_paid_order\([\s\S]*to service_role/
  )
  assert.match(postcondition, /has_function_privilege\('anon', rpc_oid, 'EXECUTE'\)/)
  assert.match(postcondition, /has_function_privilege\('authenticated', rpc_oid, 'EXECUTE'\)/)
})

test("event failures are reclaimable and terminal events are not replayed", () => {
  assert.match(
    rpcSource,
    /on conflict \(provider, environment, payload_sha256\)[\s\S]*attempt_count = existing_event\.attempt_count \+ 1/
  )
  assert.match(
    rpcSource,
    /if v_event\.processing_state = 'completed'[\s\S]*EVENT_ALREADY_COMPLETED/
  )
  assert.match(
    rpcSource,
    /if v_event\.processing_state in \('terminal_rejected', 'reconciliation_required'\)/
  )
  assert.match(
    rpcSource,
    /processing_state = 'processing'[\s\S]*completed_at = null[\s\S]*outcome_code = null/
  )
})

test("invalid delivery identity stays unrecorded and retryable", () => {
  const deliveryValidation = between(
    rpcSource,
    "begin\n  if p_payload_sha256 is null",
    "  v_safe_transaction_id := case"
  )

  assert.match(deliveryValidation, /p_payload_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(deliveryValidation, /p_event_type is distinct from 'charge\.success'/)
  assert.match(deliveryValidation, /p_environment not in \('test', 'live'\)/)
  assert.match(
    deliveryValidation,
    /select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, true/
  )
  assert.doesNotMatch(deliveryValidation, /insert into public\.payment_events/)
  assert.doesNotMatch(deliveryValidation, /p_transaction_id|p_reference|p_status|p_amount_kobo|p_currency/)
})

test("invalid payment facts are durably terminal without creating payments", () => {
  const eventEstablishment = between(
    rpcSource,
    "v_safe_transaction_id := case",
    "  if v_event.processing_state = 'completed' then"
  )
  const invalidPaymentFacts = between(
    rpcSource,
    "if p_transaction_id is null",
    "  update public.payment_events as event\n  set processing_state = 'processing'"
  )

  assert.match(eventEstablishment, /insert into public\.payment_events/)
  assert.match(eventEstablishment, /v_safe_transaction_id/)
  assert.match(eventEstablishment, /v_safe_reference/)
  assert.doesNotMatch(
    eventEstablishment,
    /values \([\s\S]*p_transaction_id,[\s\S]*p_reference,/
  )
  for (const fact of [
    "p_transaction_id",
    "p_reference",
    "p_status",
    "p_amount_kobo",
    "p_currency",
  ]) {
    assert.ok(invalidPaymentFacts.includes(fact), fact)
  }
  assert.match(invalidPaymentFacts, /processing_state = 'terminal_rejected'/)
  assert.match(invalidPaymentFacts, /completed_at = v_now/)
  assert.match(invalidPaymentFacts, /outcome_code = 'INVALID_PROVIDER_PAYLOAD'/)
  assert.match(invalidPaymentFacts, /diagnostic_code = 'INVALID_PAYMENT_FACTS'/)
  assert.match(
    invalidPaymentFacts,
    /select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, false/
  )
  assert.doesNotMatch(invalidPaymentFacts, /insert into public\.payments/)
  assert.ok(
    rpcSource.indexOf("if v_event.processing_state in ('terminal_rejected', 'reconciliation_required') then") <
      rpcSource.indexOf("if p_transaction_id is null"),
    "durably rejected exact-delivery retries must return before payment validation"
  )
})

test("existing payment identity includes the authenticated paid_at fact", () => {
  const paymentFactCheck = between(
    rpcSource,
    "if v_payment.transaction_id is distinct from p_transaction_id",
    "    update public.payment_events as event\n    set payment_id = v_payment.id"
  )

  assert.match(paymentFactCheck, /v_payment\.paid_at is distinct from p_paid_at/)
  assert.match(paymentFactCheck, /outcome_code = 'PAYMENT_IDENTITY_CONFLICT'/)
  assert.match(paymentFactCheck, /diagnostic_code = 'PAYMENT_FACT_MISMATCH'/)
  assert.match(
    paymentFactCheck,
    /select 'PAYMENT_IDENTITY_CONFLICT'::text, v_payment\.order_id, false/
  )
  assert.doesNotMatch(paymentFactCheck, /set paid_at = p_paid_at/)
})

test("payment and order concurrency use unique identities and row locks", () => {
  assert.match(rpcSource, /on conflict do nothing/)
  assert.equal((rpcSource.match(/for update;/g) ?? []).length >= 4, true)
  assert.match(
    rpcSource,
    /where customer_order\.payment_ref = p_reference[\s\S]*for update;/
  )
  assert.match(
    rpcSource,
    /where customer_order\.id = v_order\.id[\s\S]*and customer_order\.status = 'pending'/
  )
})

test("unknown references remain retryable and cancelled paid orders reconcile", () => {
  const unknownBranch = between(
    rpcSource,
    "if not found then\n      update public.payments",
    "select payment.id"
  )
  assert.match(unknownBranch, /ORDER_NOT_FOUND_RETRYABLE/)
  assert.match(unknownBranch, /processing_state = 'retryable_failure'/)
  assert.match(unknownBranch, /select 'ORDER_NOT_FOUND_RETRYABLE'::text, null::uuid, true/)

  const cancelledBranch = between(
    rpcSource,
    "if v_order.status = 'cancelled' then",
    "if v_order.status in ('confirmed', 'fulfilled') then"
  )
  assert.match(cancelledBranch, /RECONCILIATION_REQUIRED/)
  assert.match(cancelledBranch, /PAID_CANCELLED_ORDER/)
  assert.doesNotMatch(cancelledBranch, /ORDER_NOT_PAYABLE|terminal_rejected/)
})

test("legacy pending compatibility proves values and never defaults the fee", () => {
  assert.match(rpcSource, /v_order\.financial_contract_version is null/)
  assert.match(rpcSource, /v_item_total <> v_order\.total_amount/)
  assert.match(rpcSource, /vendor\.platform_fee_pct is not null/)
  assert.match(rpcSource, /vendor\.platform_fee_pct between 0 and 100/)
  assert.match(rpcSource, /v_valid_vendor_count <> v_vendor_count/)
  assert.match(rpcSource, /financial_contract_version = 1/)
  assert.match(rpcSource, /LEGACY_FINALIZATION_REQUIRES_RECONCILIATION/)
  assert.doesNotMatch(
    rpcSource,
    /coalesce\s*\(\s*vendor\.platform_fee_pct\s*,\s*10(?:\.0+)?\s*\)/i
  )
  assert.doesNotMatch(rpcSource, /platform_fee_pct\s*\?\?\s*10/i)
})

test("confirmed historical orders do not gain payment rows or credits", () => {
  const legacyConfirmed = between(
    rpcSource,
    "if v_order.status in ('confirmed', 'fulfilled') then",
    "if v_order.status <> 'pending' then"
  )
  assert.match(legacyConfirmed, /v_order\.financial_contract_version is null/)
  assert.match(legacyConfirmed, /payment_id = null/)
  assert.match(legacyConfirmed, /delete from public\.payments/)
  assert.match(legacyConfirmed, /LEGACY_ALREADY_FINALIZED/)
  assert.doesNotMatch(legacyConfirmed, /insert into public\.payout_ledger/)
})

test("sale credits and order confirmation are inside one rollback boundary", () => {
  const financialBlock = between(
    rpcSource,
    "    begin\n      if v_contract_version = 1 then",
    "    return query\n    select 'FINALIZED'::text"
  )
  assert.match(financialBlock, /insert into public\.payout_ledger/)
  assert.match(financialBlock, /set status = 'confirmed'/)
  assert.match(financialBlock, /finalization_state = 'completed'/)
  assert.match(financialBlock, /processing_state = 'completed'/)
  assert.match(financialBlock, /exception[\s\S]*when unique_violation/)
  assert.match(financialBlock, /CREDIT_CONFLICT/)

  assert.match(
    rpcSource,
    /exception[\s\S]*when others then[\s\S]*processing_state = 'retryable_failure'[\s\S]*UNEXPECTED_DATABASE_FAILURE/
  )
})

test("all required controlled RPC results are explicit", () => {
  for (const result of [
    "FINALIZED",
    "ALREADY_FINALIZED",
    "EVENT_ALREADY_COMPLETED",
    "LEGACY_ALREADY_FINALIZED",
    "ORDER_NOT_FOUND_RETRYABLE",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "INVALID_PROVIDER_PAYLOAD",
    "PAYMENT_IDENTITY_CONFLICT",
    "CREDIT_CONFLICT",
    "LEGACY_FINALIZATION_REQUIRES_RECONCILIATION",
    "RECONCILIATION_REQUIRED",
    "RETRYABLE_FAILURE",
  ]) {
    assert.ok(rpcSource.includes(`'${result}'`), result)
  }
  assert.match(
    migrationSource,
    /Success\/idempotent:[\s\S]*Terminal:[\s\S]*Retryable:[\s\S]*Reconciliation:/
  )
})

test("historical rows and frozen product and Storage boundaries are checked", () => {
  for (const key of [
    "marketa_ops2b1.orders_rows",
    "marketa_ops2b1.order_items_rows",
    "marketa_ops2b1.events_rows",
    "marketa_ops2b1.payout_rows",
    "marketa_ops2b1.product_rows",
    "marketa_ops2b1.products_security",
    "marketa_ops2b1.storage_security",
  ]) {
    assert.ok(snapshot.includes(key), key)
    assert.ok(postcondition.includes(key), key)
  }
  assert.match(postcondition, /historical orders changed/)
  assert.match(postcondition, /historical order items changed/)
  assert.match(postcondition, /historical event rows changed/)
  assert.match(postcondition, /historical payout rows changed/)
  assert.match(postcondition, /migration fabricated payment evidence/)
  assert.match(postcondition, /product rows or stock changed/)
  assert.match(postcondition, /Batch 4A product boundary changed/)
  assert.match(postcondition, /Batch 4B1 Storage boundary changed/)
  assert.match(postcondition, /Ops 1A decrement_stock containment changed/)
})

test("RPC contains no stock, workflow, network, or raw-payload behavior", () => {
  for (const forbidden of [
    "decrement_stock",
    "stock",
    "n8n",
    "http",
    "fetch(",
    "email",
    "whatsapp",
    "slack",
    "refund",
    "raw_payload",
    "payload json",
  ]) {
    assert.equal(rpcSource.toLowerCase().includes(forbidden), false, forbidden)
  }
  assert.doesNotMatch(
    rpcSource,
    /(?:insert\s+into|update|delete\s+from)\s+public\.products\b/i
  )
})

test("preflight fails closed on audited live drift", () => {
  assert.match(preflight, /public\.orders columns no longer match the audited baseline/)
  assert.match(preflight, /public\.order_items columns no longer match the audited baseline/)
  assert.match(preflight, /public\.events_ledger columns no longer match the audited baseline/)
  assert.match(preflight, /public\.payout_ledger columns no longer match the audited baseline/)
  assert.match(preflight, /duplicate order payment references require reconciliation/)
  assert.match(preflight, /duplicate historical order\/vendor sale-credit groups require reconciliation/)
  assert.match(preflight, /a confirmed historical order lacks a sale credit/)
})

test("postconditions verify definitions, RLS, grants, and RPC authority", () => {
  assert.match(postcondition, /public\.payments columns are incorrect/)
  assert.match(postcondition, /public\.payment_events columns are incorrect/)
  assert.match(postcondition, /public\.payments constraints are incomplete/)
  assert.match(postcondition, /public\.payment_events constraints are incomplete/)
  assert.match(postcondition, /financial snapshot checks are missing/)
  assert.match(postcondition, /legacy-compatible columns are not nullable without defaults/)
  assert.match(postcondition, /RLS state is incorrect/)
  assert.match(postcondition, /has an unexpected grantee/)
  assert.match(postcondition, /finalization RPC metadata is incorrect/)
  assert.match(postcondition, /finalization RPC EXECUTE grants are incorrect/)
})
