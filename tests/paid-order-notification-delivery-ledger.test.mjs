import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260930194732_add_paid_order_notification_delivery_ledger.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")

function section(startMarker, endMarker) {
  const start = migration.indexOf(startMarker)
  const end = migration.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, startMarker)
  assert.notEqual(end, -1, endMarker)
  assert.ok(end > start, `${startMarker} must precede ${endMarker}`)
  return migration.slice(start, end)
}

const preflight = section(
  "-- OPS_3C1B_PREFLIGHT_START",
  "-- OPS_3C1B_PREFLIGHT_END"
)
const tableSource = section("-- OPS_3C1B_TABLE_START", "-- OPS_3C1B_TABLE_END")
const expandSource = section(
  "-- OPS_3C1B_EXPAND_START",
  "-- OPS_3C1B_EXPAND_END"
)
const beginSource = section("-- OPS_3C1B_BEGIN_START", "-- OPS_3C1B_BEGIN_END")
const deliveredSource = section(
  "-- OPS_3C1B_DELIVERED_START",
  "-- OPS_3C1B_DELIVERED_END"
)
const failedSource = section(
  "-- OPS_3C1B_FAILED_START",
  "-- OPS_3C1B_FAILED_END"
)
const unknownSource = section(
  "-- OPS_3C1B_UNKNOWN_START",
  "-- OPS_3C1B_UNKNOWN_END"
)
const parentDeliveredSource = section(
  "-- OPS_3C1B_PARENT_DELIVERED_START",
  "-- OPS_3C1B_PARENT_DELIVERED_END"
)
const postcondition = section(
  "-- OPS_3C1B_POSTCONDITION_START",
  "-- OPS_3C1B_POSTCONDITION_END"
)

function branch(source, status, nextStatus) {
  const start = source.indexOf(`status = '${status}'`)
  const end = nextStatus
    ? source.indexOf(`status = '${nextStatus}'`, start + 1)
    : source.length
  assert.notEqual(start, -1, status)
  assert.notEqual(end, -1, nextStatus)
  return source.slice(start, end)
}

function interruptOldAttempts(deliveries, currentLease) {
  return deliveries.map((delivery) => {
    if (
      delivery.status === "processing" &&
      delivery.activeParentLeaseToken !== currentLease
    ) {
      return {
        ...delivery,
        status: "unknown",
        activeParentLeaseToken: null,
        attemptToken: null,
        attemptStartedAt: null,
        lastErrorCode: "INTERRUPTED_DELIVERY_ATTEMPT",
      }
    }
    return { ...delivery }
  })
}

function beginAttempt(delivery, parentCurrent, provider, freshToken) {
  if (
    !parentCurrent ||
    delivery.status !== "pending" ||
    delivery.attemptCount >= 12 ||
    !/^[A-Za-z0-9._:-]{1,80}$/.test(provider)
  ) {
    return null
  }
  return {
    ...delivery,
    status: "processing",
    attemptCount: delivery.attemptCount + 1,
    activeParentLeaseToken: parentCurrent,
    attemptToken: freshToken,
    provider,
  }
}

function acknowledgeDelivered(delivery, parentLease, attemptToken) {
  if (
    delivery.status !== "processing" ||
    delivery.activeParentLeaseToken !== parentLease ||
    delivery.attemptToken !== attemptToken
  ) {
    return false
  }
  delivery.status = "delivered"
  delivery.activeParentLeaseToken = null
  delivery.attemptToken = null
  delivery.deliveredAt = "now"
  delivery.lastErrorCode = null
  return true
}

function failAttempt(delivery, parentLease, attemptToken, permanent) {
  if (
    delivery.status !== "processing" ||
    delivery.activeParentLeaseToken !== parentLease ||
    delivery.attemptToken !== attemptToken
  ) {
    return null
  }
  delivery.status = permanent || delivery.attemptCount >= 12
    ? "dead_letter"
    : "pending"
  delivery.activeParentLeaseToken = null
  delivery.attemptToken = null
  delivery.lastErrorCode = "DELIVERY_FAILED"
  return delivery.status
}

function markUnknown(delivery, parentLease, attemptToken) {
  if (
    delivery.status !== "processing" ||
    delivery.activeParentLeaseToken !== parentLease ||
    delivery.attemptToken !== attemptToken
  ) {
    return false
  }
  delivery.status = "unknown"
  delivery.activeParentLeaseToken = null
  delivery.attemptToken = null
  delivery.lastErrorCode = "DELIVERY_OUTCOME_UNKNOWN"
  return true
}

function canCompleteParent(expectedKeys, deliveries) {
  return (
    deliveries.length === expectedKeys.length &&
    deliveries.every((delivery) => delivery.status === "delivered") &&
    expectedKeys.every((key) =>
      deliveries.some((delivery) => delivery.deliveryKey === key)
    ) &&
    deliveries.every((delivery) => expectedKeys.includes(delivery.deliveryKey))
  )
}

function finalizedContractCanExpand(order, payment) {
  if (
    payment.status !== "success" ||
    payment.finalizationState !== "completed" ||
    payment.outcomeCode !== "FINALIZED" ||
    payment.financialContractVersion !== order.financialContractVersion ||
    ![1, 2].includes(order.financialContractVersion) ||
    order.totalAmountKobo == null ||
    order.totalAmountKobo <= 0 ||
    order.totalAmountNaira * 100 !== order.totalAmountKobo ||
    payment.amountKobo !== order.totalAmountKobo ||
    payment.currency !== order.currency
  ) {
    return false
  }
  if (order.financialContractVersion === 1) return order.currency === "NGN"
  return /^[A-Z]{3}$/.test(order.currency)
}

function finalizeLegacyPending(legacyOrder) {
  assert.equal(legacyOrder.status, "pending")
  assert.equal(legacyOrder.financialContractVersion, null)
  const totalAmountKobo = legacyOrder.totalAmountNaira * 100
  return {
    order: {
      status: "confirmed",
      paymentFinalizedAt: "now",
      totalAmountNaira: legacyOrder.totalAmountNaira,
      totalAmountKobo,
      currency: "NGN",
      financialContractVersion: 1,
    },
    payment: {
      status: "success",
      finalizationState: "completed",
      outcomeCode: "FINALIZED",
      amountKobo: totalAmountKobo,
      currency: "NGN",
      financialContractVersion: 1,
    },
    parent: { eventType: "paid_order", eventVersion: 1 },
    finalizationOutcome: "FINALIZED",
  }
}

function dormantStateChanged(
  deliveryCount,
  currentParentCount,
  currentParentFingerprint,
  baselines
) {
  return deliveryCount !== 0 || !baselines.some((baseline) =>
    baseline.parentCount === currentParentCount &&
    baseline.parentFingerprint === currentParentFingerprint
  )
}

test("migration is one transactional dormant foundation", () => {
  assert.match(migration, /^-- Ops 3C1B:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.match(migration, /set local search_path = pg_catalog, public/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal((migration.match(/create table public\.notification_deliveries/g) ?? []).length, 1)
  assert.doesNotMatch(migration, /create extension|alter extension/i)
})

test("child schema has the exact narrow columns and no contact or payload storage", () => {
  const createTable = tableSource.slice(
    tableSource.indexOf("create table public.notification_deliveries"),
    tableSource.indexOf("\n);\n\ncreate index")
  )
  const columnNames = [...createTable.matchAll(/^  ([a-z_]+) [a-z]/gm)].map(
    (match) => match[1]
  ).filter((name) => name !== "constraint")
  assert.deepEqual(columnNames, [
    "id",
    "outbox_event_id",
    "order_id",
    "recipient_kind",
    "vendor_id",
    "channel",
    "delivery_key",
    "status",
    "attempt_count",
    "active_parent_lease_token",
    "attempt_token",
    "attempt_started_at",
    "provider",
    "provider_message_id",
    "delivered_at",
    "last_error_code",
    "created_at",
    "updated_at",
  ])
  assert.doesNotMatch(
    createTable,
    /recipient_email|email_address|phone|message_body|raw_payload|\bjsonb?\b/i
  )
  assert.match(createTable, /foreign key \(outbox_event_id\)[\s\S]*on delete restrict/)
  assert.match(createTable, /foreign key \(order_id\)[\s\S]*on delete restrict/)
  assert.match(createTable, /foreign key \(vendor_id\)[\s\S]*on delete restrict/)
})

test("recipient and channel scope is customer or vendor email only", () => {
  assert.match(tableSource, /recipient_kind in \('customer', 'vendor'\)/)
  assert.match(tableSource, /channel = 'email'/)
  assert.doesNotMatch(tableSource, /'admin'|'whatsapp'|'sms'|'marketing'|'skipped'/i)
})

test("delivery keys are deterministic and unique", () => {
  assert.match(
    tableSource,
    /delivery_key = 'paid-order:' \|\| order_id::text \|\| ':customer:email'/
  )
  assert.match(
    tableSource,
    /delivery_key = 'paid-order:' \|\| order_id::text\s*\|\| ':vendor:' \|\| vendor_id::text \|\| ':email'/
  )
  assert.match(tableSource, /unique \(delivery_key\)/)
})

test("status set and bounded diagnostics are exact", () => {
  assert.match(
    tableSource,
    /status in \('pending', 'processing', 'delivered', 'unknown', 'dead_letter'\)/
  )
  assert.match(tableSource, /attempt_count between 0 and 12/)
  assert.match(tableSource, /provider ~ '\^\[A-Za-z0-9\._:-\]\{1,80\}\$'/)
  assert.match(tableSource, /last_error_code ~ '\^\[A-Z0-9_\]\{1,80\}\$'/)
  assert.match(tableSource, /char_length\(provider_message_id\) between 1 and 255/)
  assert.match(tableSource, /provider_message_id !~ '\[\[:cntrl:\]\]'/)
})

test("pending state tuple is bounded and lease-free", () => {
  const source = branch(tableSource, "pending", "processing")
  assert.match(source, /attempt_count between 0 and 11/)
  for (const field of [
    "active_parent_lease_token",
    "attempt_token",
    "attempt_started_at",
    "delivered_at",
  ]) assert.match(source, new RegExp(`${field} is null`))
})

test("processing state tuple requires one active bounded attempt", () => {
  const source = branch(tableSource, "processing", "delivered")
  assert.match(source, /attempt_count between 1 and 12/)
  for (const field of [
    "active_parent_lease_token",
    "attempt_token",
    "attempt_started_at",
    "provider",
  ]) assert.match(source, new RegExp(`${field} is not null`))
  assert.match(source, /delivered_at is null/)
})

test("delivered state tuple proves delivery and clears active attempt state", () => {
  const source = branch(tableSource, "delivered", "unknown")
  assert.match(source, /attempt_count between 1 and 12/)
  assert.match(source, /provider is not null/)
  assert.match(source, /delivered_at is not null/)
  assert.match(source, /last_error_code is null/)
  for (const field of [
    "active_parent_lease_token",
    "attempt_token",
    "attempt_started_at",
  ]) assert.match(source, new RegExp(`${field} is null`))
})

test("unknown and dead-letter tuples preserve bounded failure evidence", () => {
  for (const [status, next] of [["unknown", "dead_letter"], ["dead_letter", null]]) {
    const source = branch(tableSource, status, next)
    assert.match(source, /attempt_count between 1 and 12/)
    assert.match(source, /last_error_code is not null/)
    assert.match(source, /delivered_at is null/)
    for (const field of [
      "active_parent_lease_token",
      "attempt_token",
      "attempt_started_at",
    ]) assert.match(source, new RegExp(`${field} is null`))
  }
})

test("child ledger has only the three approved indexes and no queue columns", () => {
  assert.match(tableSource, /unique \(delivery_key\)/)
  assert.match(
    tableSource,
    /on public\.notification_deliveries \(outbox_event_id, status, id\)/
  )
  assert.match(
    tableSource,
    /on public\.notification_deliveries \(order_id, recipient_kind, vendor_id\)/
  )
  const createTable = tableSource.slice(0, tableSource.indexOf("create index"))
  assert.doesNotMatch(createTable, /\bavailable_at\b|\blocked_at\b|\blocked_by\b/)
})

test("table authority is service-only and pins BYPASSRLS", () => {
  assert.match(tableSource, /alter table public\.notification_deliveries owner to postgres/)
  assert.match(tableSource, /enable row level security/)
  assert.doesNotMatch(tableSource, /create policy/i)
  assert.match(
    tableSource,
    /revoke all privileges on table public\.notification_deliveries\s+from public, anon, authenticated, service_role/
  )
  assert.match(
    tableSource,
    /grant select, insert, update on table public\.notification_deliveries\s+to service_role/
  )
  assert.doesNotMatch(tableSource, /grant[^;]*delete/i)
  assert.match(postcondition, /role_record\.rolname = 'service_role'\s+and role_record\.rolbypassrls/)
  assert.match(postcondition, /acl\.grantee = 0[\s\S]*acl\.privilege_type in \('SELECT', 'INSERT', 'UPDATE', 'DELETE'\)/)
})

test("expansion requires the current paid-order parent lease", () => {
  for (const required of [
    "event_type is distinct from 'paid_order'",
    "event_version is distinct from 1",
    "status is distinct from 'processing'",
    "lease_token is distinct from p_parent_lease_token",
    "idempotency_key is distinct from",
  ]) assert.ok(expandSource.includes(required), required)
  assert.match(expandSource, /where parent_event\.id = p_outbox_event_id\s+for update/)
})

test("expansion proves confirmed paid financial state and item ownership", () => {
  for (const required of [
    "v_order.status is distinct from 'confirmed'",
    "v_order.payment_finalized_at is null",
    "payment.status = 'success'",
    "payment.finalization_state = 'completed'",
    "payment.outcome_code = 'FINALIZED'",
    "v_payment_count <> 1",
    "v_payment_contract_version",
    "is distinct from v_order.financial_contract_version",
    "v_payment_amount_kobo is distinct from v_order.total_amount_kobo",
    "v_payment_currency is distinct from v_order.currency",
    "v_item_count < 1",
    "v_vendor_count < 1",
    "not v_items_have_vendors",
  ]) assert.ok(expandSource.includes(required), required)
})

test("finalized version-one contracts use the persisted kobo snapshot", () => {
  const versionOneStart = expandSource.indexOf(
    "if v_order.financial_contract_version = 1 then"
  )
  const versionTwoStart = expandSource.indexOf(
    "elsif v_order.financial_contract_version = 2 then"
  )
  assert.ok(versionOneStart >= 0 && versionTwoStart > versionOneStart)
  const versionOne = expandSource.slice(versionOneStart, versionTwoStart)
  for (const required of [
    "v_order.total_amount_kobo is null",
    "v_order.total_amount_kobo <= 0",
    "v_order.currency is distinct from 'NGN'",
    "v_order.total_amount * 100",
    "is distinct from v_order.total_amount_kobo::numeric",
    "v_payment_amount_kobo is distinct from v_order.total_amount_kobo",
    "v_payment_currency is distinct from v_order.currency",
    "v_payment_contract_version is distinct from 1",
  ]) assert.ok(versionOne.includes(required), required)

  const legacyPending = {
    status: "pending",
    totalAmountNaira: 1250,
    financialContractVersion: null,
  }
  const valid = finalizeLegacyPending(legacyPending)
  assert.equal(legacyPending.financialContractVersion, null)
  assert.equal(valid.finalizationOutcome, "FINALIZED")
  assert.equal(valid.order.status, "confirmed")
  assert.equal(valid.payment.finalizationState, "completed")
  assert.equal(valid.parent.eventType, "paid_order")
  assert.equal(valid.order.financialContractVersion, 1)
  assert.equal(finalizedContractCanExpand(valid.order, valid.payment), true)

  assert.equal(finalizedContractCanExpand(
    { ...valid.order, totalAmountKobo: null },
    valid.payment
  ), false)
  assert.equal(finalizedContractCanExpand(
    { ...valid.order, currency: "USD" },
    { ...valid.payment, currency: "USD" }
  ), false)
  assert.equal(finalizedContractCanExpand(
    valid.order,
    { ...valid.payment, amountKobo: valid.payment.amountKobo + 1 }
  ), false)
  assert.equal(finalizedContractCanExpand(
    valid.order,
    { ...valid.payment, financialContractVersion: 2 }
  ), false)
})

test("version-two contracts retain their validation and require matching payment version", () => {
  const versionTwoStart = expandSource.indexOf(
    "elsif v_order.financial_contract_version = 2 then"
  )
  const unsupportedStart = expandSource.indexOf(
    "raise exception 'Paid-order financial contract version is unsupported.'"
  )
  assert.ok(versionTwoStart >= 0 && unsupportedStart > versionTwoStart)
  const versionTwo = expandSource.slice(versionTwoStart, unsupportedStart)
  for (const required of [
    "v_order.total_amount_kobo is null",
    "v_order.total_amount_kobo <= 0",
    "v_order.currency is null",
    "v_order.currency !~ '^[A-Z]{3}$'",
    "v_order.total_amount * 100 <> v_order.total_amount_kobo::numeric",
    "v_payment_amount_kobo is distinct from v_order.total_amount_kobo",
    "v_payment_currency is distinct from v_order.currency",
    "v_payment_contract_version is distinct from 2",
  ]) assert.ok(versionTwo.includes(required), required)

  const order = {
    totalAmountNaira: 1250,
    totalAmountKobo: 125000,
    currency: "NGN",
    financialContractVersion: 2,
  }
  const payment = {
    status: "success",
    finalizationState: "completed",
    outcomeCode: "FINALIZED",
    amountKobo: 125000,
    currency: "NGN",
    financialContractVersion: 2,
  }
  assert.equal(finalizedContractCanExpand(order, payment), true)
  assert.equal(finalizedContractCanExpand(
    order,
    { ...payment, financialContractVersion: 1 }
  ), false)
})

test("null and unsupported finalized contract versions fail before child creation", () => {
  assert.doesNotMatch(
    expandSource,
    /financial_contract_version is null then|legacy financial contract/i
  )
  assert.match(
    expandSource,
    /else\s+raise exception 'Paid-order financial contract version is unsupported\.'/
  )
  const childInsert = expandSource.indexOf("insert into public.notification_deliveries")
  const unsupported = expandSource.indexOf(
    "raise exception 'Paid-order financial contract version is unsupported.'"
  )
  assert.ok(unsupported >= 0 && childInsert > unsupported)

  const finalized = finalizeLegacyPending({
    status: "pending",
    totalAmountNaira: 1250,
    financialContractVersion: null,
  })
  for (const financialContractVersion of [null, 0, 3, 99]) {
    assert.equal(finalizedContractCanExpand(
      { ...finalized.order, financialContractVersion },
      { ...finalized.payment, financialContractVersion }
    ), false, String(financialContractVersion))
  }

  for (const required of [
    "payment.outcome_code = ''FINALIZED''",
    "v_payment_contract_version%is distinct from v_order.financial_contract_version",
    "if v_order.financial_contract_version = 1 then",
    "elsif v_order.financial_contract_version = 2 then",
    "financial_contract_version is null then",
  ]) assert.ok(postcondition.includes(required), required)
})

test("expansion creates one customer plus distinct vendors and then verifies the exact set", () => {
  assert.match(expandSource, /'customer'::text as recipient_kind/)
  assert.match(expandSource, /'vendor'::text,[\s\S]*from public\.order_items/)
  assert.match(expandSource, /group by item\.vendor_id/)
  assert.match(expandSource, /v_expected_count := 1 \+ v_vendor_count/)
  const insert = expandSource.indexOf("insert into public.notification_deliveries")
  const verify = expandSource.indexOf("if v_actual_count <> v_expected_count")
  assert.ok(insert >= 0 && verify > insert)
  for (const required of [
    "delivery.order_id is distinct from v_order.id",
    "delivery.channel is distinct from 'email'",
    "delivery.recipient_kind not in ('customer', 'vendor')",
    "delivery.vendor_id = expected_vendor.vendor_id",
  ]) assert.ok(expandSource.includes(required), required)
})

test("ON CONFLICT is limited to idempotent child creation", () => {
  assert.equal(
    (migration.match(/^\s*on conflict \(delivery_key\) do nothing;/gim) ?? []).length,
    1
  )
  assert.match(expandSource, /on conflict \(delivery_key\) do nothing/)
  assert.doesNotMatch(migration, /on conflict[\s\S]{0,80}do update/i)
})

test("old-lease processing becomes unknown while current-lease processing remains", () => {
  assert.match(
    expandSource,
    /status = 'unknown'[\s\S]*last_error_code = 'INTERRUPTED_DELIVERY_ATTEMPT'[\s\S]*delivery\.status = 'processing'[\s\S]*active_parent_lease_token\s+is distinct from p_parent_lease_token/
  )
  const result = interruptOldAttempts([
    {
      id: "old",
      status: "processing",
      attemptCount: 2,
      activeParentLeaseToken: "old-lease",
      attemptToken: "old-attempt",
      attemptStartedAt: "then",
    },
    {
      id: "current",
      status: "processing",
      attemptCount: 1,
      activeParentLeaseToken: "current-lease",
      attemptToken: "current-attempt",
      attemptStartedAt: "now",
    },
  ], "current-lease")
  assert.equal(result[0].status, "unknown")
  assert.equal(result[0].attemptCount, 2)
  assert.equal(result[1].status, "processing")
  assert.equal(result[1].attemptToken, "current-attempt")
})

test("begin validates parent authority and creates exactly one fresh child attempt", () => {
  assert.match(beginSource, /parent_event\.status = 'processing'/)
  assert.match(beginSource, /parent_event\.lease_token = p_parent_lease_token/)
  assert.match(beginSource, /delivery\.status = 'pending'/)
  assert.match(beginSource, /delivery\.attempt_count < 12/)
  assert.match(beginSource, /attempt_count = delivery\.attempt_count \+ 1/)
  assert.match(beginSource, /active_parent_lease_token = p_parent_lease_token/)
  assert.match(beginSource, /attempt_token = gen_random_uuid\(\)/)
  assert.doesNotMatch(beginSource, /email|phone/i)

  const started = beginAttempt(
    { status: "pending", attemptCount: 3 },
    "parent-lease",
    "mail-provider",
    "fresh-attempt"
  )
  assert.equal(started.attemptCount, 4)
  assert.equal(started.activeParentLeaseToken, "parent-lease")
  assert.equal(started.attemptToken, "fresh-attempt")
})

test("delivered acknowledgement requires both live tokens and rejects stale workers", () => {
  assert.match(deliveredSource, /parent_event\.lease_token = p_parent_lease_token/)
  assert.match(deliveredSource, /delivery\.active_parent_lease_token = p_parent_lease_token/)
  assert.match(deliveredSource, /delivery\.attempt_token = p_attempt_token/)
  assert.match(deliveredSource, /get diagnostics v_updated_rows = row_count/)
  assert.match(deliveredSource, /return v_updated_rows = 1/)

  const delivery = {
    status: "processing",
    activeParentLeaseToken: "new-parent",
    attemptToken: "new-attempt",
  }
  assert.equal(acknowledgeDelivered(delivery, "old-parent", "new-attempt"), false)
  assert.equal(acknowledgeDelivered(delivery, "new-parent", "old-attempt"), false)
  assert.equal(acknowledgeDelivered(delivery, "new-parent", "new-attempt"), true)
})

test("failure transitions retry below twelve and dead-letter at the terminal boundary", () => {
  assert.match(
    failedSource,
    /when p_permanent or delivery\.attempt_count >= 12 then 'dead_letter'\s+else 'pending'/
  )
  assert.match(failedSource, /delivery\.active_parent_lease_token = p_parent_lease_token/)
  assert.match(failedSource, /delivery\.attempt_token = p_attempt_token/)
  assert.doesNotMatch(failedSource, /available_at|backoff|interval/i)

  const retry = {
    status: "processing",
    attemptCount: 11,
    activeParentLeaseToken: "lease",
    attemptToken: "attempt-11",
  }
  assert.equal(failAttempt(retry, "lease", "attempt-11", false), "pending")

  const twelfth = {
    status: "processing",
    attemptCount: 12,
    activeParentLeaseToken: "lease",
    attemptToken: "attempt-12",
  }
  assert.equal(failAttempt(twelfth, "lease", "attempt-12", false), "dead_letter")

  const permanent = {
    status: "processing",
    attemptCount: 1,
    activeParentLeaseToken: "lease",
    attemptToken: "attempt-1",
  }
  assert.equal(failAttempt(permanent, "lease", "attempt-1", true), "dead_letter")
})

test("ambiguous attempt becomes unknown and cannot automatically return to pending", () => {
  assert.match(unknownSource, /set status = 'unknown'/)
  assert.match(unknownSource, /delivery\.active_parent_lease_token = p_parent_lease_token/)
  assert.match(unknownSource, /delivery\.attempt_token = p_attempt_token/)
  assert.doesNotMatch(unknownSource, /set status = 'pending'/)
  const delivery = {
    status: "processing",
    attemptCount: 1,
    activeParentLeaseToken: "lease",
    attemptToken: "attempt",
  }
  assert.equal(markUnknown(delivery, "lease", "attempt"), true)
  assert.equal(delivery.status, "unknown")
  assert.equal(beginAttempt(delivery, "lease-2", "provider", "new-attempt"), null)
})

test("parent completion requires the exact child set and every child delivered", () => {
  for (const required of [
    "v_actual_count <> v_expected_count",
    "delivery.status <> 'delivered'",
    "recipient_kind = 'customer'",
    "recipient_kind = 'vendor'",
    "delivery.vendor_id = expected_vendor.vendor_id",
    "delivery.recipient_kind not in ('customer', 'vendor')",
  ]) assert.ok(parentDeliveredSource.includes(required), required)

  const expected = ["customer", "vendor-a"]
  assert.equal(canCompleteParent(expected, [
    { deliveryKey: "customer", status: "delivered" },
    { deliveryKey: "vendor-a", status: "delivered" },
  ]), true)
  assert.equal(canCompleteParent(expected, [
    { deliveryKey: "customer", status: "delivered" },
  ]), false)
  for (const status of ["pending", "processing", "unknown", "dead_letter"]) {
    assert.equal(canCompleteParent(expected, [
      { deliveryKey: "customer", status: "delivered" },
      { deliveryKey: "vendor-a", status },
    ]), false, status)
  }
})

test("parent claim failure and producer definitions remain frozen", () => {
  for (const [signature, hash] of [
    ["public.claim_paid_order_outbox(text,integer)", "8ae6ff05b9cb70602e15dd863ccd08ef"],
    ["public.mark_paid_order_outbox_failed(uuid,uuid,text)", "c4850d6e31b694358aee75304907e2c8"],
    [
      "public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)",
      "a7bcbaa3cbcdc90140e7dd476e6bc18a",
    ],
  ]) {
    assert.ok(preflight.includes(signature), signature)
    assert.ok(postcondition.includes(signature), signature)
    assert.ok(migration.includes(hash), hash)
  }
  assert.equal(
    (migration.match(/create or replace function public\.mark_paid_order_outbox_delivered/g) ?? []).length,
    1
  )
  assert.doesNotMatch(migration, /create or replace function public\.claim_paid_order_outbox/)
  assert.doesNotMatch(migration, /create or replace function public\.mark_paid_order_outbox_failed/)
  assert.doesNotMatch(migration, /create or replace function public\.finalize_paystack_paid_order/)
})

test("all lifecycle RPCs are invoker volatile service-only functions", () => {
  const signatures = [
    "public.expand_paid_order_notification_deliveries(uuid,uuid)",
    "public.begin_paid_order_notification_delivery(uuid,uuid,uuid,text)",
    "public.mark_paid_order_notification_delivered(uuid,uuid,uuid,uuid,text)",
    "public.mark_paid_order_notification_failed(uuid,uuid,uuid,uuid,text,boolean)",
    "public.mark_paid_order_notification_unknown(uuid,uuid,uuid,uuid,text)",
    "public.mark_paid_order_outbox_delivered(uuid,uuid)",
  ]
  const compactMigration = migration.replace(/\s+/g, "")
  for (const signature of signatures) {
    assert.ok(postcondition.includes(signature), signature)
    assert.ok(
      compactMigration.includes(
        `revokeallprivilegesonfunction${signature}frompublic,anon,authenticated,service_role;`
      ),
      signature
    )
    assert.ok(
      compactMigration.includes(`grantexecuteonfunction${signature}toservice_role;`),
      signature
    )
  }
  assert.match(postcondition, /procedure\.prosecdef/)
  assert.match(postcondition, /procedure\.provolatile[\s\S]*<> 'v'/)
  assert.match(postcondition, /array\['search_path=""'\]::text\[\]/)
  assert.match(postcondition, /acl\.grantee = 0[\s\S]*acl\.privilege_type = 'EXECUTE'/)
})

test("migration contains no financial stock or provider-side mutation", () => {
  assert.doesNotMatch(
    migration,
    /(?:insert into|update|delete from) public\.(?:orders|order_items|payments|payment_events|payout_ledger|events_ledger|products|vendors)\b/i
  )
  assert.doesNotMatch(migration, /decrement_stock|\bstock\s*=/i)
  assert.doesNotMatch(
    migration,
    /resend|sendgrid|postmark|brevo|mailgun|smtp|twilio|whatsapp|https?:\/\/|net\.http|http_post|fetch\s*\(/i
  )
})

test("migration adds no child scheduler backoff or network extension", () => {
  assert.doesNotMatch(tableSource, /\bavailable_at\b|\blocked_at\b|\blocked_by\b/)
  assert.doesNotMatch(migration, /cron\.schedule|create extension|pgmq/i)
  assert.match(preflight, /extension\.extname in \('pg_cron', 'pg_net'\)/)
  assert.match(postcondition, /extension\.extname in \('pg_cron', 'pg_net'\)/)
})

test("migration performs no current or historical child backfill", () => {
  assert.equal(
    (migration.match(/insert into public\.notification_deliveries/g) ?? []).length,
    1
  )
  assert.match(expandSource, /insert into public\.notification_deliveries/)
  const outsideExpansion = migration.replace(expandSource, "")
  assert.doesNotMatch(outsideExpansion, /insert into public\.notification_deliveries/)
  assert.match(postcondition, /count\(\*\) from public\.notification_deliveries\) <> 0/)
  assert.match(migration, /ops_3c1b_parent_baseline/)
  assert.match(postcondition, /dormant row state changed/)
  assert.doesNotMatch(migration, /select public\.expand_paid_order_notification_deliveries|perform public\.expand_paid_order_notification_deliveries/i)
})

test("dormant-state postcondition avoids a multi-column scalar subquery", () => {
  assert.doesNotMatch(
    postcondition,
    /\(current_parent_count, current_parent_fingerprint\) is distinct from \(\s*select baseline\.parent_count, baseline\.parent_fingerprint/
  )
  assert.match(
    postcondition,
    /count\(\*\) from public\.notification_deliveries\) <> 0\s+or not exists \(/
  )
  assert.match(
    postcondition,
    /baseline\.parent_count\s+is not distinct from current_parent_count/
  )
  assert.match(
    postcondition,
    /baseline\.parent_fingerprint\s+is not distinct from current_parent_fingerprint/
  )
  assert.match(
    postcondition,
    /raise exception 'Ops 3C1B postcondition: dormant row state changed\.'/
  )

  const matchingBaseline = [{
    parentCount: 1,
    parentFingerprint: "same-fingerprint",
  }]
  assert.equal(dormantStateChanged(0, 1, "same-fingerprint", matchingBaseline), false)
  assert.equal(dormantStateChanged(0, 2, "same-fingerprint", matchingBaseline), true)
  assert.equal(dormantStateChanged(0, 1, "different-fingerprint", matchingBaseline), true)
  assert.equal(dormantStateChanged(0, 1, "same-fingerprint", []), true)
  assert.equal(dormantStateChanged(1, 1, "same-fingerprint", matchingBaseline), true)
})

test("preflight and postconditions pin current foundation and resulting catalog", () => {
  for (const required of [
    "parent outbox columns changed",
    "parent outbox constraints changed",
    "parent outbox indexes changed",
    "parent outbox grants changed",
    "parent outbox RPC foundation changed",
    "paid-order producer changed",
    "paid-order parent baseline changed",
    "delivery-ledger namespace is occupied",
  ]) assert.ok(preflight.includes(required), required)
  for (const required of [
    "delivery columns are incorrect",
    "delivery constraints are incorrect",
    "delivery state tuples are incorrect",
    "delivery indexes are incorrect",
    "delivery authority is incorrect",
    "expansion contract is incorrect",
    "parent completion is not child-gated",
    "frozen parent or producer RPC changed",
    "dormant row state changed",
  ]) assert.ok(postcondition.includes(required), required)
  assert.match(preflight, /to_regprocedure\([\s\S]*\) is null/)
  assert.match(postcondition, /to_regprocedure\([\s\S]*\) is null/)
})
