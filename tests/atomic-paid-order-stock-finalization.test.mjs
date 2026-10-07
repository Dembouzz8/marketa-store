import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261007135410_add_atomic_paid_order_stock_finalization.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `Missing ${startMarker}`)
  assert.notEqual(end, -1, `Missing ${endMarker}`)
  assert.ok(end > start, `${startMarker} must precede ${endMarker}`)
  return source.slice(start, end)
}

const preflight = section(
  migration,
  "-- OPS_4C_PREFLIGHT_START",
  "-- OPS_4C_PREFLIGHT_END"
)
const rpcSource = section(
  migration,
  "-- OPS_4C_RPC_START",
  "-- OPS_4C_RPC_END"
)
const stockBoundary = section(
  rpcSource,
  "-- OPS_4C_STOCK_BOUNDARY_START",
  "-- OPS_4C_STOCK_BOUNDARY_END"
)
const stockSuccess = section(
  rpcSource,
  "-- OPS_4C_STOCK_SUCCESS_START",
  "-- OPS_4C_STOCK_SUCCESS_END"
)
const postcondition = section(
  migration,
  "-- OPS_4C_POSTCONDITION_START",
  "-- OPS_4C_POSTCONDITION_END"
)
const rpcBodyMatch = rpcSource.match(
  /as \$function\$\r?\n([\s\S]*?)\r?\n\$function\$;/
)
assert.ok(rpcBodyMatch, "Missing proposed finalizer body")
const normalizedRpcBodyHash = createHash("md5")
  .update(rpcBodyMatch[1].replace(/\s/g, ""))
  .digest("hex")

test("migration is one bounded transaction replacing only the finalizer", () => {
  assert.match(migration, /^-- Ops 4C:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.match(migration, /set local search_path = pg_catalog, public/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal(
    (migration.match(/create or replace function public\./gi) ?? []).length,
    1
  )
  assert.equal(
    (
      migration.match(
        /create or replace function public\.finalize_paystack_paid_order\(/gi
      ) ?? []
    ).length,
    1
  )
  assert.doesNotMatch(migration, /create\s+(?:table|trigger|policy)\b/i)
  assert.doesNotMatch(migration, /create\s+function\s+public\.(?!finalize_paystack)/i)
})

test("preflight pins the reviewed finalizer and exact authority", () => {
  assert.match(preflight, /a7bcbaa3cbcdc90140e7dd476e6bc18a/)
  assert.match(preflight, /514b72708d2e5fbdebce3d342372410b/)
  assert.match(
    preflight,
    /TABLE\(outcome text, order_id uuid, retryable boolean\)/
  )
  assert.match(preflight, /procedure\.proowner = 'postgres'::pg_catalog\.regrole/)
  assert.match(preflight, /not procedure\.prosecdef/)
  assert.match(preflight, /procedure\.provolatile = 'v'/)
  assert.match(preflight, /array\['search_path=""'\]::text\[\]/)
  assert.match(preflight, /has_function_privilege\('public', rpc_oid, 'EXECUTE'\)/)
  assert.match(preflight, /has_function_privilege\('anon', rpc_oid, 'EXECUTE'\)/)
  assert.match(preflight, /'authenticated', rpc_oid, 'EXECUTE'/)
  assert.match(preflight, /'service_role', rpc_oid, 'EXECUTE'/)
})

test("preflight pins stock schemas reconciliation and idempotency boundaries", () => {
  for (const required of [
    "products_stock_check",
    "CHECK (stock >= 0)",
    "order_items_product_id_fkey",
    "ON DELETE SET NULL",
    "order_items_quantity_check",
    "CHECK (quantity > 0)",
    "payments_completion_check",
    "payment_events_completion_check",
    "payment_events_outcome_code_check",
    "payment_events_diagnostic_code_check",
    "payout_ledger_idempotency_key_key",
    "payout_ledger_sale_order_vendor_key",
    "outbox_events_idempotency_key_key",
    "outbox_events_event_type_order_id_key",
  ]) {
    assert.ok(preflight.includes(required), required)
  }
  assert.match(preflight, /role_record\.rolbypassrls/)
  assert.match(preflight, /policy\.cmd <> 'SELECT'/)
  assert.match(preflight, /'anon', 'public\.order_items', 'INSERT,UPDATE,DELETE'/)
  assert.match(
    preflight,
    /'authenticated', 'public\.order_items', 'INSERT,UPDATE,DELETE'/
  )
})

test("decrement_stock is pinned but never called or replaced", () => {
  assert.match(preflight, /0094f1ea6602edbfe18ac8f9619677b8/)
  assert.match(postcondition, /0094f1ea6602edbfe18ac8f9619677b8/)
  assert.doesNotMatch(rpcSource, /decrement_stock/i)
  assert.doesNotMatch(
    migration,
    /create or replace function public\.decrement_stock/i
  )
  assert.doesNotMatch(
    migration,
    /(?:select|perform)\s+public\.decrement_stock\s*\(/i
  )
})

test("requirements are order-scoped aggregated deterministic and overflow-safe", () => {
  assert.equal(
    (stockBoundary.match(/where item\.order_id = v_order\.id/g) ?? []).length >=
      4,
    true
  )
  assert.equal(
    (stockBoundary.match(/sum\(item\.quantity::numeric\)/g) ?? []).length,
    2
  )
  assert.equal(
    (stockBoundary.match(/group by item\.product_id/g) ?? []).length,
    2
  )
  assert.match(
    stockBoundary,
    /array_agg\([\s\S]*requirement\.product_id[\s\S]*order by requirement\.product_id/
  )
  assert.match(stockBoundary, /v_initial_item_count = 0/)
  assert.match(stockBoundary, /item\.product_id is not null/)
  assert.match(stockBoundary, /item\.quantity > 0/)
  assert.match(stockBoundary, /required_quantity > 2147483647/)
  assert.doesNotMatch(stockBoundary, /sum\(item\.quantity\)::integer/)
})

test("parallel stock arrays use parser-safe paired ROWS FROM expansion", () => {
  const invalidQualifiedParallelUnnest =
    /pg_catalog\.unnest\(\s*v_rechecked_product_ids\s*,\s*v_rechecked_required_quantities\s*\)/g
  const approvedParallelExpansion =
    /rows from \(\s*pg_catalog\.unnest\(v_rechecked_product_ids\),\s*pg_catalog\.unnest\(v_rechecked_required_quantities\)\s*\) as requirement\(product_id, required_quantity\)/g

  assert.doesNotMatch(rpcSource, invalidQualifiedParallelUnnest)
  assert.equal((rpcSource.match(approvedParallelExpansion) ?? []).length, 2)
  assert.match(
    stockBoundary,
    /pg_catalog\.cardinality\(v_rechecked_product_ids\)[\s\S]*is distinct from[\s\S]*pg_catalog\.cardinality\(v_rechecked_required_quantities\)/
  )

  const cardinalityCheck = stockBoundary.indexOf(
    "pg_catalog.cardinality(v_rechecked_product_ids)"
  )
  const validationExpansion = stockBoundary.indexOf("from rows from (")
  const updateExpansion = stockSuccess.indexOf("from rows from (")

  assert.notEqual(cardinalityCheck, -1)
  assert.notEqual(validationExpansion, -1)
  assert.notEqual(updateExpansion, -1)
  assert.ok(cardinalityCheck < validationExpansion)
})

test("products lock first in UUID order without activation predicates", () => {
  const productLock = section(
    stockBoundary,
    "perform product.id",
    "get diagnostics v_locked_product_count = row_count;"
  )
  assert.match(productLock, /from public\.products as product/)
  assert.match(productLock, /order by product\.id/)
  assert.match(productLock, /for update of product/)
  assert.doesNotMatch(productLock, /is_active|vendor/i)
  assert.ok(
    stockBoundary.indexOf("perform product.id") <
      stockBoundary.indexOf("perform item.id")
  )
})

test("order items lock after products with NOWAIT and are rederived", () => {
  const itemLock = section(
    stockBoundary,
    "perform item.id",
    "select\n      pg_catalog.count(*)"
  )
  assert.match(itemLock, /where item\.order_id = v_order\.id/)
  assert.match(itemLock, /order by item\.id/)
  assert.match(itemLock, /for update of item nowait/)
  assert.match(
    stockBoundary,
    /v_rechecked_product_ids is distinct from v_stock_product_ids/
  )
  assert.match(
    stockBoundary,
    /v_rechecked_required_quantities[\s\S]*is distinct from v_stock_required_quantities/
  )
  assert.match(
    stockBoundary,
    /v_rechecked_product_count is distinct from v_stock_product_count/
  )
  assert.doesNotMatch(stockBoundary, /skip locked/i)
})

test("controlled stock failures use exact durable reconciliation states", () => {
  for (const diagnostic of [
    "PAID_STOCK_PRODUCT_UNAVAILABLE",
    "PAID_STOCK_INSUFFICIENT",
    "PAID_STOCK_REQUIREMENTS_CHANGED",
  ]) {
    assert.ok(stockBoundary.includes(`'${diagnostic}'`), diagnostic)
  }
  assert.match(
    stockBoundary,
    /update public\.payments as payment[\s\S]*finalization_state = 'reconciliation_required'[\s\S]*outcome_code = 'RECONCILIATION_REQUIRED'[\s\S]*financial_contract_version = null[\s\S]*finalized_at = null/
  )
  assert.match(
    stockBoundary,
    /update public\.payment_events as event[\s\S]*processing_state = 'reconciliation_required'[\s\S]*completed_at = v_now[\s\S]*outcome_code = 'RECONCILIATION_REQUIRED'[\s\S]*diagnostic_code = v_stock_diagnostic[\s\S]*payment_id = v_payment\.id/
  )
  assert.match(
    stockBoundary,
    /select 'RECONCILIATION_REQUIRED'::text, v_order\.id, false/
  )
  assert.doesNotMatch(stockBoundary, /update public\.products/)
  assert.doesNotMatch(stockBoundary, /insert into public\.payout_ledger/)
  assert.doesNotMatch(stockBoundary, /set status = 'confirmed'/)
  assert.doesNotMatch(stockBoundary, /insert into public\.outbox_events/)
})

test("successful stock mutation is one aggregated checked update", () => {
  assert.equal(
    (rpcSource.match(/update public\.products as product/g) ?? []).length,
    1
  )
  assert.match(
    stockSuccess,
    /stock = product\.stock - requirement\.required_quantity::integer/
  )
  assert.match(stockSuccess, /updated_at = v_now/)
  assert.match(
    stockSuccess,
    /pg_catalog\.unnest\(v_rechecked_product_ids\),[\s\S]*pg_catalog\.unnest\(v_rechecked_required_quantities\)/
  )
  assert.match(stockSuccess, /get diagnostics v_updated_product_count = row_count/)
  assert.match(
    stockSuccess,
    /v_updated_product_count <> v_rechecked_product_count/
  )
  assert.match(stockSuccess, /raise exception 'Ops 4C stock update count changed/)
})

test("stock update shares and leads the existing financial rollback block", () => {
  const financialStart = rpcSource.indexOf(
    "    begin\n      -- OPS_4C_STOCK_SUCCESS_START"
  )
  const financialEnd = rpcSource.indexOf(
    "\n    end;\n\n    return query\n    select 'FINALIZED'::text",
    financialStart
  )
  assert.notEqual(financialStart, -1)
  assert.notEqual(financialEnd, -1)
  const financialBlock = rpcSource.slice(financialStart, financialEnd)
  const stock = financialBlock.indexOf("update public.products as product")
  const legacy = financialBlock.indexOf("if v_contract_version = 1 then")
  const credit = financialBlock.indexOf("insert into public.payout_ledger")
  const confirmation = financialBlock.indexOf("set status = 'confirmed'")
  const payment = financialBlock.indexOf("finalization_state = 'completed'")
  const outbox = financialBlock.indexOf("insert into public.outbox_events")
  const handler = financialBlock.indexOf("when unique_violation then")
  for (const position of [stock, legacy, credit, confirmation, payment, outbox, handler]) {
    assert.notEqual(position, -1)
  }
  assert.ok(stock < legacy)
  assert.ok(legacy < credit)
  assert.ok(credit < confirmation)
  assert.ok(confirmation < payment)
  assert.ok(payment < outbox)
  assert.ok(outbox < handler)
  assert.match(financialBlock, /OUTBOX_INTENT_CONFLICT/)
  assert.match(financialBlock, /SALE_CREDIT_UNIQUE_CONFLICT/)
})

test("all closed and invalid paths precede the stock boundary", () => {
  const stockStart = rpcSource.indexOf("-- OPS_4C_STOCK_BOUNDARY_START")
  for (const outcome of [
    "EVENT_ALREADY_COMPLETED",
    "ALREADY_FINALIZED",
    "LEGACY_ALREADY_FINALIZED",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "INVALID_PROVIDER_PAYLOAD",
  ]) {
    const position = rpcSource.indexOf(`'${outcome}'`)
    assert.notEqual(position, -1, outcome)
    assert.ok(position < stockStart, outcome)
  }
  assert.ok(
    rpcSource.indexOf("if v_order.status = 'cancelled' then") < stockStart
  )
  assert.ok(
    rpcSource.indexOf("if v_order.status in ('confirmed', 'fulfilled') then") <
      stockStart
  )
})

test("legacy and V2 validation converge before activation-neutral stock handling", () => {
  const beforeStock = rpcSource.slice(
    0,
    rpcSource.indexOf("-- OPS_4C_STOCK_BOUNDARY_START")
  )
  assert.match(
    beforeStock,
    /if v_order\.financial_contract_version = 2 then[\s\S]*v_contract_version := 2;[\s\S]*elsif v_order\.financial_contract_version is null then[\s\S]*v_contract_version := 1;/
  )
  assert.doesNotMatch(stockBoundary, /product\.is_active|vendor\.is_active/)
  assert.doesNotMatch(stockSuccess, /product\.is_active|vendor\.is_active/)
})

test("migration contains no top-level backfill or historical product update", () => {
  const outsideRpc = migration
    .replace(preflight, "")
    .replace(rpcSource, "")
    .replace(postcondition, "")
  assert.doesNotMatch(outsideRpc, /update\s+public\.products\b/i)
  assert.doesNotMatch(outsideRpc, /insert\s+into\s+public\.payout_ledger\b/i)
  assert.doesNotMatch(outsideRpc, /insert\s+into\s+public\.outbox_events\b/i)
  assert.doesNotMatch(outsideRpc, /\bdelete\s+from\s+public\.(?:products|orders|order_items)\b/i)
})

test("postconditions pin source ordering RLS and frozen lifecycle authority", () => {
  assert.equal(normalizedRpcBodyHash, "7d381e91b5fe6585d4d5e60c4d7f6cc8")
  assert.match(postcondition, /7d381e91b5fe6585d4d5e60c4d7f6cc8/)
  for (const required of [
    "stock mutation is outside the atomic success boundary",
    "stock derivation, locking, or mutation contract is incorrect",
    "paid-stock reconciliation is not durable and controlled",
    "a closed or invalid payment path can reach stock consumption",
    "product or order-item RLS authority changed",
    "decrement_stock changed",
    "frozen outbox or notification authority changed",
  ]) {
    assert.ok(postcondition.includes(required), required)
  }
  for (const signature of [
    "claim_paid_order_outbox(text,integer)",
    "mark_paid_order_outbox_delivered(uuid,uuid)",
    "mark_paid_order_outbox_failed(uuid,uuid,text)",
    "expand_paid_order_notification_deliveries(uuid,uuid)",
    "begin_paid_order_notification_delivery(uuid,uuid,uuid,text)",
    "mark_paid_order_notification_delivered(uuid,uuid,uuid,uuid,text)",
    "mark_paid_order_notification_failed(uuid,uuid,uuid,uuid,text,boolean)",
    "mark_paid_order_notification_unknown(uuid,uuid,uuid,uuid,text)",
  ]) {
    assert.ok(postcondition.includes(signature), signature)
  }
})

function deriveRequirements(items) {
  const requirements = new Map()
  for (const item of items) {
    assert.ok(item.productId)
    assert.ok(item.quantity > 0n)
    requirements.set(
      item.productId,
      (requirements.get(item.productId) ?? 0n) + item.quantity
    )
  }
  return [...requirements].sort(([left], [right]) => left.localeCompare(right))
}

test("pure requirement model documents aggregation and integer capacity", () => {
  assert.deepEqual(
    deriveRequirements([
      { productId: "b", quantity: 1n },
      { productId: "a", quantity: 2n },
      { productId: "a", quantity: 3n },
    ]),
    [
      ["a", 5n],
      ["b", 1n],
    ]
  )
  assert.equal(2_147_483_647n <= 2_147_483_647n, true)
  assert.equal(2_147_483_648n <= 2_147_483_647n, false)
})
