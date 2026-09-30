import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260930102944_add_paid_order_outbox_foundation.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")

function section(startMarker, endMarker) {
  const start = migration.indexOf(startMarker)
  const end = migration.indexOf(endMarker)
  assert.notEqual(start, -1, startMarker)
  assert.notEqual(end, -1, endMarker)
  assert.ok(end > start, `${startMarker} must precede ${endMarker}`)
  return migration.slice(start, end)
}

const tableSource = section("-- OPS_3B1_TABLE_START", "-- OPS_3B1_TABLE_END")
const claimSource = section("-- OPS_3B1_CLAIM_START", "-- OPS_3B1_CLAIM_END")
const deliveredSource = section(
  "-- OPS_3B1_DELIVERED_START",
  "-- OPS_3B1_DELIVERED_END"
)
const failureSource = section(
  "-- OPS_3B1_FAILURE_START",
  "-- OPS_3B1_FAILURE_END"
)

function minutesForAttempt(attemptCount) {
  if (attemptCount >= 12) return null
  return [0, 1, 2, 4, 8, 16, 32][attemptCount] ?? 60
}

function claimModel(events, now, workerId, batchSize) {
  const leaseMs = 2 * 60 * 1000
  for (const event of events) {
    if (
      event.status === "processing" &&
      event.lockedAt <= now - leaseMs &&
      event.attemptCount >= 12
    ) {
      event.status = "dead_letter"
      event.lockedAt = null
      event.lockedBy = null
      event.leaseToken = null
      event.lastErrorCode ??= "LEASE_EXPIRED_MAX_ATTEMPTS"
    }
  }

  const eligible = events
    .filter(
      (event) =>
        (event.status === "pending" &&
          event.availableAt <= now &&
          event.attemptCount < 12) ||
        (event.status === "processing" &&
          event.lockedAt <= now - leaseMs &&
          event.attemptCount < 12)
    )
    .sort(
      (left, right) =>
        left.availableAt - right.availableAt ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id)
    )
    .slice(0, batchSize)

  for (const event of eligible) {
    event.status = "processing"
    event.attemptCount += 1
    event.lockedAt = now
    event.lockedBy = workerId
    event.leaseToken = `lease:${event.id}:${event.attemptCount}`
  }
  return eligible.map((event) => event.id)
}

function deliverModel(event, leaseToken, now) {
  if (event.status !== "processing" || event.leaseToken !== leaseToken) {
    return false
  }
  event.status = "delivered"
  event.deliveredAt = now
  event.lockedAt = null
  event.lockedBy = null
  event.leaseToken = null
  event.lastErrorCode = null
  return true
}

function failModel(event, leaseToken, errorCode, now) {
  if (event.status !== "processing" || event.leaseToken !== leaseToken) {
    return null
  }
  const delay = minutesForAttempt(event.attemptCount)
  event.status = delay === null ? "dead_letter" : "pending"
  if (delay !== null) event.availableAt = now + delay * 60 * 1000
  event.lockedAt = null
  event.lockedBy = null
  event.leaseToken = null
  event.deliveredAt = null
  event.lastErrorCode = errorCode
  return event.status
}

test("migration is one transactional dormant foundation", () => {
  assert.match(migration, /^-- Ops 3B1:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.match(migration, /set local search_path = pg_catalog, public/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal((migration.match(/create table public\.outbox_events/g) ?? []).length, 1)
  assert.doesNotMatch(migration, /insert into public\.outbox_events/i)
  assert.match(migration, /select pg_catalog\.count\(\*\) from public\.outbox_events\) <> 0/)
})

test("table has the exact narrow paid-order columns and defaults", () => {
  for (const pattern of [
    /id uuid primary key default gen_random_uuid\(\)/,
    /event_type text not null/,
    /event_version smallint not null default 1/,
    /order_id uuid not null/,
    /idempotency_key text not null/,
    /status text not null default 'pending'/,
    /attempt_count integer not null default 0/,
    /available_at timestamptz not null default pg_catalog\.now\(\)/,
    /locked_at timestamptz/,
    /locked_by text/,
    /lease_token uuid/,
    /delivered_at timestamptz/,
    /last_error_code text/,
    /created_at timestamptz not null default pg_catalog\.now\(\)/,
    /updated_at timestamptz not null default pg_catalog\.now\(\)/,
  ]) {
    assert.match(tableSource, pattern)
  }
  assert.match(
    tableSource,
    /foreign key \(order_id\) references public\.orders \(id\) on delete restrict/
  )
})

test("event identity is paid-order-only and deterministic", () => {
  assert.match(tableSource, /check \(event_type = 'paid_order'\)/)
  assert.match(tableSource, /check \(event_version = 1\)/)
  assert.match(
    tableSource,
    /idempotency_key = 'paid-order:' \|\| order_id::text/
  )
  assert.match(tableSource, /unique \(idempotency_key\)/)
  assert.match(tableSource, /unique \(event_type, order_id\)/)
  assert.doesNotMatch(tableSource, /payload\s+json/i)
})

test("state and diagnostic constraints are complete", () => {
  assert.match(
    tableSource,
    /status in \('pending', 'processing', 'delivered', 'dead_letter'\)/
  )
  assert.match(tableSource, /attempt_count between 0 and 12/)
  assert.match(tableSource, /\^\[A-Za-z0-9\._:-\]\{1,80\}\$/)
  assert.match(tableSource, /\^\[A-Z0-9_\]\{1,80\}\$/)

  const stateConstraint = tableSource.slice(
    tableSource.indexOf("constraint outbox_events_state_tuple_check")
  )
  for (const required of [
    "status = 'pending'",
    "status = 'processing'",
    "status = 'delivered'",
    "status = 'dead_letter'",
    "locked_at is null",
    "locked_at is not null",
    "locked_by is null",
    "locked_by is not null",
    "lease_token is null",
    "lease_token is not null",
    "delivered_at is null",
    "delivered_at is not null",
    "attempt_count = 12",
    "last_error_code is not null",
  ]) {
    assert.ok(stateConstraint.includes(required), required)
  }
  assert.match(
    stateConstraint,
    /status = 'delivered'[\s\S]*last_error_code is null/
  )
})

test("default postcondition uses a parser-safe expected value assignment", () => {
  assert.match(migration, /actual_default text;\s+expected_default text;/)
  assert.match(
    migration,
    /expected_default := case function_name[\s\S]*when 'id' then 'gen_random_uuid\(\)'[\s\S]*when 'event_version' then '1'[\s\S]*when 'status' then '''pending''::text'[\s\S]*when 'attempt_count' then '0'[\s\S]*else 'now\(\)'[\s\S]*end;/
  )
  assert.match(
    migration,
    /if actual_default is distinct from expected_default then/
  )
  assert.doesNotMatch(migration, /is distinct from case/i)
})

test("state tuples enforce status-specific attempt ranges", () => {
  const stateConstraint = tableSource.slice(
    tableSource.indexOf("constraint outbox_events_state_tuple_check")
  )
  const statusBranch = (status, nextStatus) => {
    const start = stateConstraint.indexOf(`status = '${status}'`)
    const end = nextStatus
      ? stateConstraint.indexOf(`status = '${nextStatus}'`, start)
      : stateConstraint.length
    assert.notEqual(start, -1, status)
    assert.notEqual(end, -1, nextStatus)
    return stateConstraint.slice(start, end)
  }

  assert.match(
    statusBranch("pending", "processing"),
    /attempt_count between 0 and 11/
  )
  assert.match(
    statusBranch("processing", "delivered"),
    /attempt_count between 1 and 12/
  )
  assert.match(
    statusBranch("delivered", "dead_letter"),
    /attempt_count between 1 and 12/
  )
  assert.match(statusBranch("dead_letter"), /attempt_count = 12/)

  const validAttemptForStatus = (status, attemptCount) => {
    if (status === "pending") return attemptCount >= 0 && attemptCount <= 11
    if (status === "processing" || status === "delivered") {
      return attemptCount >= 1 && attemptCount <= 12
    }
    if (status === "dead_letter") return attemptCount === 12
    return false
  }

  assert.equal(validAttemptForStatus("pending", 12), false)
  assert.equal(validAttemptForStatus("processing", 0), false)
  assert.equal(validAttemptForStatus("delivered", 0), false)
  for (let attemptCount = 1; attemptCount <= 12; attemptCount += 1) {
    assert.equal(validAttemptForStatus("processing", attemptCount), true)
    assert.equal(validAttemptForStatus("delivered", attemptCount), true)
  }
  assert.equal(validAttemptForStatus("processing", 13), false)
  assert.equal(validAttemptForStatus("delivered", 13), false)
})

test("only the approved queue and lease indexes are added", () => {
  assert.match(
    tableSource,
    /create index outbox_events_ready_queue_idx[\s\S]*\(available_at, created_at, id\)[\s\S]*where status = 'pending'/
  )
  assert.match(
    tableSource,
    /create index outbox_events_processing_lease_idx[\s\S]*\(locked_at, id\)[\s\S]*where status = 'processing'/
  )
  assert.equal((tableSource.match(/create index /g) ?? []).length, 2)
  assert.equal((tableSource.match(/ unique \(/g) ?? []).length, 2)
})

test("RLS and grants lock browsers out and give service_role no DELETE", () => {
  assert.match(tableSource, /alter table public\.outbox_events owner to postgres/)
  assert.match(tableSource, /alter table public\.outbox_events enable row level security/)
  assert.doesNotMatch(migration, /create policy[\s\S]*outbox_events/i)
  assert.match(
    tableSource,
    /revoke all privileges on table public\.outbox_events\s+from public, anon, authenticated, service_role/
  )
  assert.match(
    tableSource,
    /grant select, insert, update on table public\.outbox_events to service_role/
  )
  assert.doesNotMatch(tableSource, /grant[^;]*delete/i)
  assert.match(migration, /role\.rolname = 'service_role'[\s\S]*role\.rolbypassrls/)
})

test("claim RPC has bounded inputs and service-role-only authority", () => {
  assert.match(
    claimSource,
    /create function public\.claim_paid_order_outbox\(\s*p_worker_id text,\s*p_batch_size integer default 10/
  )
  assert.match(claimSource, /returns table \([\s\S]*event_id uuid[\s\S]*lease_token uuid/)
  assert.match(claimSource, /security invoker/)
  assert.match(claimSource, /volatile/)
  assert.match(claimSource, /set search_path = ''/)
  assert.match(claimSource, /p_worker_id !~ '\^\[A-Za-z0-9\._:-\]\{1,80\}\$'/)
  assert.match(claimSource, /p_batch_size < 1 or p_batch_size > 10/)
  assert.match(
    migration,
    /revoke all privileges on function public\.claim_paid_order_outbox\(text, integer\)[\s\S]*from public, anon, authenticated, service_role/
  )
  assert.match(
    migration,
    /grant execute on function public\.claim_paid_order_outbox\(text, integer\)\s+to service_role/
  )
})

test("claim uses one timestamp, fixed leases, SKIP LOCKED, and one increment", () => {
  assert.equal((claimSource.match(/v_now timestamptz := pg_catalog\.now\(\)/g) ?? []).length, 1)
  assert.equal((claimSource.match(/interval '2 minutes'/g) ?? []).length, 2)
  assert.match(claimSource, /for update of queued skip locked/)
  assert.match(
    claimSource,
    /order by queued\.available_at, queued\.created_at, queued\.id[\s\S]*limit p_batch_size/
  )
  assert.equal(
    (claimSource.match(/attempt_count = queued\.attempt_count \+ 1/g) ?? []).length,
    1
  )
  assert.match(
    claimSource,
    /queued\.status = 'pending'[\s\S]*queued\.available_at <= v_now[\s\S]*queued\.attempt_count < 12/
  )
  assert.doesNotMatch(claimSource, /attempt_count\s*=\s*13|attempt_count\s*\+\s*2/)
})

test("claim reclaims expired work and dead-letters expired attempt twelve", () => {
  assert.match(
    claimSource,
    /expired\.status = 'processing'[\s\S]*expired\.locked_at <= v_now - interval '2 minutes'[\s\S]*expired\.attempt_count >= 12/
  )
  assert.match(claimSource, /'LEASE_EXPIRED_MAX_ATTEMPTS'/)
  assert.match(
    claimSource,
    /queued\.status = 'processing'[\s\S]*queued\.locked_at <= v_now - interval '2 minutes'[\s\S]*queued\.attempt_count < 12/
  )
})

test("delivered RPC requires the current lease and clears lease state", () => {
  assert.match(
    deliveredSource,
    /where queued\.id = p_event_id[\s\S]*queued\.status = 'processing'[\s\S]*queued\.lease_token = p_lease_token/
  )
  assert.match(deliveredSource, /set status = 'delivered'/)
  assert.match(deliveredSource, /delivered_at = v_now/)
  assert.match(deliveredSource, /locked_at = null/)
  assert.match(deliveredSource, /locked_by = null/)
  assert.match(deliveredSource, /lease_token = null/)
  assert.match(deliveredSource, /last_error_code = null/)
  assert.match(deliveredSource, /return v_updated_rows = 1/)
})

test("failure RPC validates the current lease and owns retry timing", () => {
  assert.match(failureSource, /p_error_code !~ '\^\[A-Z0-9_\]\{1,80\}\$'/)
  assert.match(
    failureSource,
    /where queued\.id = p_event_id[\s\S]*queued\.status = 'processing'[\s\S]*queued\.lease_token = p_lease_token/
  )
  assert.match(
    failureSource,
    /when queued\.attempt_count >= 12 then 'dead_letter'[\s\S]*else 'pending'/
  )
  for (const [attempt, minutes] of [
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 32],
  ]) {
    assert.match(
      failureSource,
      new RegExp(`when ${attempt} then interval '${minutes} minute`)
    )
  }
  assert.match(failureSource, /else interval '60 minutes'/)
  assert.doesNotMatch(failureSource, /p_(?:delay|available|retry)/i)
})

test("pure claim model keeps workers exclusive and never creates attempt thirteen", () => {
  const now = Date.parse("2026-09-30T10:00:00.000Z")
  const events = [
    {
      id: "blocked-pending-12",
      status: "pending",
      attemptCount: 12,
      availableAt: now - 100,
      createdAt: now - 100,
      lockedAt: null,
      lockedBy: null,
      leaseToken: null,
      lastErrorCode: "TIMEOUT",
    },
    {
      id: "a",
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      createdAt: now - 2,
      lockedAt: null,
      lockedBy: null,
      leaseToken: null,
      lastErrorCode: null,
    },
    {
      id: "b",
      status: "processing",
      attemptCount: 11,
      availableAt: now - 10,
      createdAt: now - 1,
      lockedAt: now - 121_000,
      lockedBy: "old",
      leaseToken: "old-b",
      lastErrorCode: "TIMEOUT",
    },
    {
      id: "c",
      status: "processing",
      attemptCount: 12,
      availableAt: now - 20,
      createdAt: now,
      lockedAt: now - 121_000,
      lockedBy: "old",
      leaseToken: "old-c",
      lastErrorCode: null,
    },
  ]

  assert.deepEqual(claimModel(events, now, "worker-1", 10), ["b", "a"])
  assert.deepEqual(claimModel(events, now, "worker-2", 10), [])
  assert.equal(events.find((event) => event.id === "a").attemptCount, 1)
  assert.equal(events.find((event) => event.id === "b").attemptCount, 12)
  assert.equal(events.find((event) => event.id === "c").status, "dead_letter")
  assert.equal(events.find((event) => event.id === "c").attemptCount, 12)
  assert.equal(
    events.find((event) => event.id === "blocked-pending-12").status,
    "pending"
  )
  assert.equal(
    events.find((event) => event.id === "blocked-pending-12").attemptCount,
    12
  )
  assert.equal(
    events.find((event) => event.id === "c").lastErrorCode,
    "LEASE_EXPIRED_MAX_ATTEMPTS"
  )
})

test("pure delivery and failure models reject stale leases", () => {
  const now = Date.parse("2026-09-30T10:00:00.000Z")
  const delivered = {
    status: "processing",
    attemptCount: 1,
    leaseToken: "current",
    lockedAt: now,
    lockedBy: "worker",
    deliveredAt: null,
    lastErrorCode: "OLD_FAILURE",
  }
  assert.equal(deliverModel(delivered, "stale", now), false)
  assert.equal(delivered.status, "processing")
  assert.equal(deliverModel(delivered, "current", now), true)
  assert.deepEqual(
    {
      status: delivered.status,
      lockedAt: delivered.lockedAt,
      lockedBy: delivered.lockedBy,
      leaseToken: delivered.leaseToken,
      lastErrorCode: delivered.lastErrorCode,
    },
    {
      status: "delivered",
      lockedAt: null,
      lockedBy: null,
      leaseToken: null,
      lastErrorCode: null,
    }
  )

  const failed = {
    status: "processing",
    attemptCount: 2,
    leaseToken: "current",
    lockedAt: now,
    lockedBy: "worker",
    deliveredAt: null,
    availableAt: now,
    lastErrorCode: null,
  }
  assert.equal(failModel(failed, "stale", "TIMEOUT", now), null)
  assert.equal(failed.status, "processing")
  assert.equal(failModel(failed, "current", "TIMEOUT", now), "pending")
  assert.equal(failed.availableAt, now + 2 * 60 * 1000)
})

test("pure backoff model is exact and the twelfth failure dead-letters", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => minutesForAttempt(index + 1)),
    [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, null]
  )

  const now = Date.parse("2026-09-30T10:00:00.000Z")
  const event = {
    status: "processing",
    attemptCount: 12,
    leaseToken: "current",
    lockedAt: now,
    lockedBy: "worker",
    deliveredAt: null,
    availableAt: now - 1,
    lastErrorCode: null,
  }
  assert.equal(
    failModel(event, "current", "DELIVERY_TIMEOUT", now),
    "dead_letter"
  )
  assert.equal(event.attemptCount, 12)
  assert.equal(event.availableAt, now - 1)
  assert.equal(event.lastErrorCode, "DELIVERY_TIMEOUT")
})

test("postconditions cover schema, ACLs, RPCs, dormancy, and frozen rows", () => {
  for (const required of [
    "outbox columns are incorrect",
    "outbox column types are incorrect",
    "outbox nullability is incorrect",
    "outbox constraints are incorrect",
    "outbox indexes are incorrect",
    "outbox partial indexes are incorrect",
    "outbox table grants are incorrect",
    "outbox lifecycle definitions are incorrect",
    "outbox foundation is not dormant",
    "finalization authority changed",
    "decrement_stock authority changed",
    "protected financial or product rows changed",
  ]) {
    assert.ok(migration.includes(required), required)
  }
  assert.match(
    migration,
    /status = ''pending''%attempt_count >= 0%attempt_count <= 11%/
  )
  assert.match(
    migration,
    /status = ''processing''%attempt_count >= 1%attempt_count <= 12%/
  )
  assert.match(
    migration,
    /status = ''delivered''%attempt_count >= 1%attempt_count <= 12%/
  )
  for (const table of [
    "orders",
    "order_items",
    "payments",
    "payment_events",
    "payout_ledger",
    "events_ledger",
    "products",
  ]) {
    assert.ok(migration.includes(`marketa_ops3b1.${table}_count`), table)
    assert.ok(migration.includes(`marketa_ops3b1.${table}_rows`), table)
  }
})

test("foundation creates no producer, scheduler, network, or financial mutation", () => {
  assert.doesNotMatch(
    migration,
    /create\s+(?:or\s+replace\s+)?function\s+public\.finalize_paystack_paid_order/i
  )
  assert.doesNotMatch(
    migration,
    /(?:perform|call|select)\s+public\.finalize_paystack_paid_order/i
  )
  assert.doesNotMatch(migration, /create\s+trigger/i)
  assert.doesNotMatch(migration, /create\s+extension/i)
  assert.doesNotMatch(migration, /cron\.schedule|net\.http|vault\./i)
  assert.doesNotMatch(migration, /n8n|fetch\s*\(|https?:\/\//i)
  assert.doesNotMatch(migration, /update\s+public\.(?:orders|order_items|payments|payment_events|payout_ledger|events_ledger|products)\b/i)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(?:orders|order_items|payments|payment_events|payout_ledger|events_ledger|products|outbox_events)\b/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\./i)
})
