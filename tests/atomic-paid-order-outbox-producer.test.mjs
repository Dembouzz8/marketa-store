import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260930125733_add_atomic_paid_order_outbox_producer.sql"
const priorMigrationFile =
  "supabase/migrations/20260928224257_add_atomic_paid_order_finalization.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")
const priorMigration = fs.readFileSync(path.join(root, priorMigrationFile), "utf8")

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, startMarker)
  assert.notEqual(end, -1, endMarker)
  assert.ok(end > start, `${startMarker} must precede ${endMarker}`)
  return source.slice(start, end)
}

function replaceOnce(source, current, replacement, label) {
  assert.equal(source.split(current).length - 1, 1, label)
  return source.replace(current, replacement)
}

const preflight = section(
  migration,
  "-- OPS_3B2_PREFLIGHT_START",
  "-- OPS_3B2_PREFLIGHT_END"
)
const rpcSource = section(
  migration,
  "-- OPS_3B2_RPC_START",
  "-- OPS_3B2_RPC_END"
)
  .replace("-- OPS_3B2_RPC_START", "")
  .trimStart()
const postcondition = section(
  migration,
  "-- OPS_3B2_POSTCONDITION_START",
  "-- OPS_3B2_POSTCONDITION_END"
)
const priorRpc = section(
  priorMigration,
  "create function public.finalize_paystack_paid_order(",
  "comment on function public.finalize_paystack_paid_order("
).trimEnd()

const outboxInsertStart = rpcSource.indexOf("insert into public.outbox_events (")
assert.notEqual(outboxInsertStart, -1)
const outboxInsertEnd = rpcSource.indexOf(";", outboxInsertStart)
assert.notEqual(outboxInsertEnd, -1)
const outboxInsert = rpcSource.slice(outboxInsertStart, outboxInsertEnd + 1)

const financialStart = rpcSource.indexOf("    begin\n      if v_contract_version = 1 then")
const financialEnd = rpcSource.indexOf(
  "\n    end;\n\n    return query\n    select 'FINALIZED'::text",
  financialStart
)
assert.notEqual(financialStart, -1)
assert.notEqual(financialEnd, -1)
const financialBlock = rpcSource.slice(financialStart, financialEnd + "\n    end;".length)

test("migration is one transactional replacement of the existing RPC", () => {
  assert.match(migration, /^-- Ops 3B2:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.match(migration, /set local search_path = pg_catalog, public/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal(
    (migration.match(/create or replace function public\./g) ?? []).length,
    1
  )
  assert.equal(
    (
      migration.match(
        /create or replace function public\.finalize_paystack_paid_order\(/g
      ) ?? []
    ).length,
    1
  )
  assert.doesNotMatch(migration, /create table|alter table|drop table/i)
})

test("RPC signature return shape and existing behavior remain exact", () => {
  assert.match(
    rpcSource,
    /create or replace function public\.finalize_paystack_paid_order\(\s*p_payload_sha256 text,\s*p_event_type text,\s*p_environment text,\s*p_transaction_id text,\s*p_reference text,\s*p_status text,\s*p_amount_kobo bigint,\s*p_currency text,\s*p_paid_at timestamptz\s*\)/
  )
  assert.match(
    rpcSource,
    /returns table \(\s*outcome text,\s*order_id uuid,\s*retryable boolean\s*\)/
  )
  assert.match(rpcSource, /language plpgsql\s+volatile\s+security invoker/)
  assert.match(rpcSource, /set search_path = ''/)

  let restored = rpcSource
    .replace(
      "create or replace function public.finalize_paystack_paid_order(",
      "create function public.finalize_paystack_paid_order("
    )
    .replace("  v_constraint_name text;\n", "")
    .replace(`\n      ${outboxInsert}\n`, "")

  const newHandler = section(
    restored,
    "    exception\n      when unique_violation then",
    "    end;\n\n    return query\n    select 'FINALIZED'::text"
  )
  const oldHandler = `    exception
      when unique_violation then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'CREDIT_CONFLICT',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'CREDIT_CONFLICT',
            diagnostic_code = 'SALE_CREDIT_UNIQUE_CONFLICT',
            payment_id = v_payment.id
        where event.id = v_event.id;

        return query
        select 'CREDIT_CONFLICT'::text, v_order.id, false;
        return;
`
  restored = replaceOnce(restored, newHandler, oldHandler, "unique handler")
  const restoredRpc = restored.trimEnd()
  if (restoredRpc !== priorRpc) {
    let difference = 0
    while (
      difference < restoredRpc.length &&
      difference < priorRpc.length &&
      restoredRpc[difference] === priorRpc[difference]
    ) {
      difference += 1
    }
    assert.fail(
      `unexpected RPC drift at ${difference}: ${JSON.stringify(
        restoredRpc.slice(difference - 30, difference + 30)
      )} versus ${JSON.stringify(priorRpc.slice(difference - 30, difference + 30))}`
    )
  }
})

test("paid-order producer writes exactly one minimal deterministic intent", () => {
  assert.equal(
    (rpcSource.match(/insert into public\.outbox_events\s*\(/g) ?? []).length,
    1
  )
  assert.match(
    outboxInsert,
    /insert into public\.outbox_events \(\s*event_type,\s*event_version,\s*order_id,\s*idempotency_key\s*\) values \(\s*'paid_order',\s*1,\s*v_order\.id,\s*'paid-order:' \|\| v_order\.id::text\s*\);/
  )
  assert.doesNotMatch(outboxInsert, /on conflict/i)
  assert.doesNotMatch(
    outboxInsert,
    /email|phone|customer|vendor|reference|amount|payload|json/i
  )
})

test("outbox insert shares the protected financial subtransaction", () => {
  for (const required of [
    "insert into public.payout_ledger",
    "set status = 'confirmed'",
    "finalization_state = 'completed'",
    "outcome_code = 'FINALIZED'",
    "processing_state = 'completed'",
    "insert into public.outbox_events",
    "exception",
    "when unique_violation",
  ]) {
    assert.ok(financialBlock.includes(required), required)
  }

  const credit = financialBlock.indexOf("insert into public.payout_ledger")
  const order = financialBlock.indexOf("set status = 'confirmed'")
  const payment = financialBlock.indexOf("finalization_state = 'completed'")
  const paymentEvent = financialBlock.indexOf("processing_state = 'completed'")
  const outbox = financialBlock.indexOf("insert into public.outbox_events")
  const handler = financialBlock.indexOf(
    "\n    exception\n      when unique_violation"
  )
  assert.ok(credit < order)
  assert.ok(order < payment)
  assert.ok(payment < paymentEvent)
  assert.ok(paymentEvent < outbox)
  assert.ok(outbox < handler)
})

test("unique violations distinguish outbox conflicts from credit conflicts", () => {
  assert.match(rpcSource, /v_constraint_name text;/)
  assert.match(
    financialBlock,
    /get stacked diagnostics\s+v_constraint_name = constraint_name;/
  )
  assert.match(
    financialBlock,
    /v_constraint_name in \(\s*'outbox_events_idempotency_key_key',\s*'outbox_events_event_type_order_id_key'\s*\)/
  )
  const outboxConflict = section(
    financialBlock,
    "if v_constraint_name in (",
    "        end if;"
  )
  assert.match(
    outboxConflict,
    /finalization_state = 'reconciliation_required'[\s\S]*outcome_code = 'RECONCILIATION_REQUIRED'/
  )
  assert.match(
    outboxConflict,
    /processing_state = 'reconciliation_required'[\s\S]*diagnostic_code = 'OUTBOX_INTENT_CONFLICT'/
  )
  assert.match(
    outboxConflict,
    /select 'RECONCILIATION_REQUIRED'::text, v_order\.id, false/
  )

  const afterOutboxConflict = financialBlock.slice(
    financialBlock.indexOf("        end if;") + "        end if;".length
  )
  assert.match(
    afterOutboxConflict,
    /outcome_code = 'CREDIT_CONFLICT'[\s\S]*diagnostic_code = 'SALE_CREDIT_UNIQUE_CONFLICT'[\s\S]*select 'CREDIT_CONFLICT'::text, v_order\.id, false/
  )
})

test("other database failures retain the retryable outer failure path", () => {
  const afterFinancialBlock = rpcSource.slice(financialEnd)
  assert.match(
    afterFinancialBlock,
    /exception\s+when others then[\s\S]*processing_state = 'retryable_failure'[\s\S]*outcome_code = 'RETRYABLE_FAILURE'[\s\S]*diagnostic_code = 'UNEXPECTED_DATABASE_FAILURE'[\s\S]*select 'RETRYABLE_FAILURE'::text, null::uuid, true/
  )
  assert.equal((financialBlock.match(/when others/g) ?? []).length, 0)
})

test("idempotent terminal and reconciliation paths precede the sole producer", () => {
  for (const outcome of [
    "EVENT_ALREADY_COMPLETED",
    "ALREADY_FINALIZED",
    "LEGACY_ALREADY_FINALIZED",
    "PAYMENT_IDENTITY_CONFLICT",
    "RECONCILIATION_REQUIRED",
    "CREDIT_CONFLICT",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "ORDER_NOT_FOUND_RETRYABLE",
    "INVALID_PROVIDER_PAYLOAD",
  ]) {
    assert.ok(rpcSource.indexOf(`'${outcome}'`) < financialStart, outcome)
  }
  assert.equal(
    rpcSource.indexOf("insert into public.outbox_events"),
    financialStart + financialBlock.indexOf("insert into public.outbox_events")
  )
})

test("eligible legacy and V2 finalizations converge on the same producer", () => {
  assert.match(
    rpcSource.slice(0, financialStart),
    /if v_order\.financial_contract_version = 2 then[\s\S]*v_contract_version := 2;[\s\S]*elsif v_order\.financial_contract_version is null then[\s\S]*v_contract_version := 1;/
  )
  assert.match(financialBlock, /if v_contract_version = 1 then/)
  assert.equal(
    financialBlock.indexOf("insert into public.outbox_events"),
    financialBlock.lastIndexOf("insert into public.outbox_events")
  )
})

test("preflight pins the applied outbox foundation and current RPC", () => {
  for (const required of [
    "paid-order outbox table metadata changed",
    "paid-order outbox is not dormant",
    "paid-order outbox columns changed",
    "paid-order outbox constraints changed",
    "paid-order outbox constraint definitions changed",
    "paid-order outbox indexes changed",
    "paid-order outbox grants changed",
    "outbox lifecycle RPC % changed",
    "atomic finalization RPC changed",
  ]) {
    assert.ok(preflight.includes(required), required)
  }
  assert.match(preflight, /pg_catalog\.count\(\*\) from public\.outbox_events\) <> 0/)
  assert.match(preflight, /outbox_events_state_tuple_check/)
  assert.match(preflight, /attempt_count <= 11/)
  assert.match(preflight, /attempt_count >= 1%attempt_count <= 12/)
  assert.match(preflight, /9d66b59ebfa95623d1e4e3905181199b/)
})

test("service-role table authority and RLS bypass are pinned in both guards", () => {
  for (const guard of [preflight, postcondition]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      assert.match(
        guard,
        new RegExp(
          `not pg_catalog\\.has_table_privilege\\(\\s*'service_role', 'public\\.outbox_events', '${privilege}'`
        )
      )
    }
    assert.match(
      guard,
      /pg_catalog\.has_table_privilege\(\s*'service_role', 'public\.outbox_events', 'DELETE'/
    )
    assert.match(
      guard,
      /from pg_catalog\.pg_roles as role_record[\s\S]*role_record\.rolname = 'service_role'[\s\S]*role_record\.rolbypassrls/
    )
    assert.doesNotMatch(
      guard,
      /'service_role', 'public\.outbox_events', 'SELECT,INSERT,UPDATE'/
    )
  }
})

test("combined privilege lists are used only to prove browser roles have none", () => {
  // has_table_privilege with a comma list uses ANY semantics, so it cannot
  // prove that service_role has every required privilege.
  assert.doesNotMatch(
    migration,
    /'service_role', 'public\.outbox_events', 'SELECT,INSERT,UPDATE'/
  )
  for (const guard of [preflight, postcondition]) {
    assert.match(
      guard,
      /'anon', 'public\.outbox_events', 'SELECT,INSERT,UPDATE,DELETE'/
    )
    assert.match(
      guard,
      /'authenticated', 'public\.outbox_events', 'SELECT,INSERT,UPDATE,DELETE'/
    )
  }
})

test("postconditions prove authority producer shape dormancy and frozen foundation", () => {
  for (const required of [
    "finalization RPC authority changed",
    "paid-order outbox producer is incorrect",
    "atomic conflict handling is incorrect",
    "finalization RPC is not the sole database producer",
    "paid-order outbox foundation changed",
    "paid-order outbox constraint set changed",
    "paid-order outbox index set changed",
    "paid-order outbox constraints changed",
    "prohibited scheduler/network extension is installed",
  ]) {
    assert.ok(postcondition.includes(required), required)
  }
  assert.match(postcondition, /insert_token constant text := 'insert into public\.outbox_events'/)
  assert.match(postcondition, /producer_count <> 1/)
  assert.match(postcondition, /pg_catalog\.count\(\*\) from public\.outbox_events\) <> 0/)
})

test("RPC authority is reasserted without browser access", () => {
  assert.match(
    migration,
    /alter function public\.finalize_paystack_paid_order\(\s*text, text, text, text, text, text, bigint, text, timestamptz\s*\) owner to postgres/
  )
  assert.match(
    migration,
    /revoke all privileges on function public\.finalize_paystack_paid_order\([\s\S]*\) from public, anon, authenticated, service_role/
  )
  assert.match(
    migration,
    /grant execute on function public\.finalize_paystack_paid_order\([\s\S]*\) to service_role/
  )
})

test("migration adds no alternate producer backfill stock or network behavior", () => {
  const outsideRpc = migration.replace(rpcSource, "")
  assert.doesNotMatch(outsideRpc, /insert\s+into\s+public\.outbox_events\s*\(/i)
  assert.doesNotMatch(migration, /create\s+trigger/i)
  assert.doesNotMatch(migration, /create\s+extension/i)
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|position|substring)\b/i
  )
  assert.doesNotMatch(migration, /cron\.schedule|net\.http|https?:\/\/|\bn8n\b/i)
  assert.doesNotMatch(migration, /decrement_stock|update\s+public\.products/i)
  assert.doesNotMatch(
    outsideRpc,
    /insert\s+into\s+public\.(?:orders|payments|payment_events)\b/i
  )
})

function runModel(scenario) {
  const state = {
    credits: 0,
    orderConfirmed: false,
    paymentCompleted: false,
    eventCompleted: false,
    outbox: 0,
    outcome: null,
    retryable: null,
    producerAttempted: false,
  }
  if (scenario === "replay") {
    state.outcome = "EVENT_ALREADY_COMPLETED"
    state.retryable = false
    return state
  }

  const beforeFinancial = { ...state }
  state.credits = 1
  state.orderConfirmed = true
  state.paymentCompleted = true
  state.eventCompleted = true
  state.producerAttempted = true

  if (scenario === "outbox_unique_conflict") {
    Object.assign(state, beforeFinancial, {
      outcome: "RECONCILIATION_REQUIRED",
      retryable: false,
      producerAttempted: true,
    })
    return state
  }
  if (scenario === "other_outbox_failure") {
    Object.assign(state, beforeFinancial, {
      outcome: "RETRYABLE_FAILURE",
      retryable: true,
      producerAttempted: true,
    })
    return state
  }

  state.outbox = 1
  state.outcome = "FINALIZED"
  state.retryable = false
  return state
}

test("pure model demonstrates atomic success conflict failure and replay", () => {
  assert.deepEqual(runModel("success"), {
    credits: 1,
    orderConfirmed: true,
    paymentCompleted: true,
    eventCompleted: true,
    outbox: 1,
    outcome: "FINALIZED",
    retryable: false,
    producerAttempted: true,
  })
  for (const [scenario, outcome, retryable] of [
    ["outbox_unique_conflict", "RECONCILIATION_REQUIRED", false],
    ["other_outbox_failure", "RETRYABLE_FAILURE", true],
  ]) {
    const result = runModel(scenario)
    assert.equal(result.credits, 0)
    assert.equal(result.orderConfirmed, false)
    assert.equal(result.paymentCompleted, false)
    assert.equal(result.eventCompleted, false)
    assert.equal(result.outbox, 0)
    assert.equal(result.outcome, outcome)
    assert.equal(result.retryable, retryable)
    assert.equal(result.producerAttempted, true)
  }
  const replay = runModel("replay")
  assert.equal(replay.outbox, 0)
  assert.equal(replay.producerAttempted, false)
  assert.equal(replay.outcome, "EVENT_ALREADY_COMPLETED")
})
