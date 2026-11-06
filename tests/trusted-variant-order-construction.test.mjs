import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261105084924_add_trusted_variant_order_construction.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")
const normalized = migration.replace(/\r\n/g, "\n")
const checkout = fs.readFileSync(
  path.join(root, "supabase/functions/handle-checkout/index.ts"),
  "utf8"
).replace(/\r\n/g, "\n")

function bodyBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function normalizeItems(items) {
  const combined = new Map()

  for (const item of items) {
    assert.match(item.product_id, /^[0-9a-f-]{36}$/u)
    assert.ok(Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99)
    const variantId = item.product_variant_id ?? null
    const key = `${item.product_id}:${variantId ?? "ordinary"}`
    combined.set(key, {
      product_id: item.product_id,
      product_variant_id: variantId,
      quantity: (combined.get(key)?.quantity ?? 0) + item.quantity,
    })
  }

  const result = [...combined.values()].sort((left, right) =>
    `${left.product_id}:${left.product_variant_id ?? ""}`.localeCompare(
      `${right.product_id}:${right.product_variant_id ?? ""}`
    )
  )
  assert.ok(result.every((item) => item.quantity <= 99))
  return result
}

function financialSnapshot(unitAmountKobo, quantity, feeBps) {
  const gross = unitAmountKobo * BigInt(quantity)
  const fee = (gross * BigInt(feeBps) + 5_000n) / 10_000n
  return {
    unit_amount_kobo: unitAmountKobo,
    gross_amount_kobo: gross,
    platform_fee_bps: feeBps,
    platform_fee_amount_kobo: fee,
    vendor_net_amount_kobo: gross - fee,
  }
}

function combinationSignature(options) {
  return [...options]
    .sort((left, right) => left.axis_id.localeCompare(right.axis_id))
    .map((option) => `${option.axis_id}=${option.value_id}`)
    .join("|")
}

function validCustomerPhone(value) {
  if (typeof value !== "string") return false
  const length = value.trim().length
  return length >= 1 && length <= 32
}

function validRequestFingerprint(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)
}

function replayDecision({
  storedExpiresAt,
  now,
  fingerprintMatches = true,
  variantSelectionMatches = true,
  customerMatches = true,
  status = "pending",
  paymentInitialized = false,
}) {
  if (
    !fingerprintMatches ||
    !variantSelectionMatches ||
    !customerMatches ||
    status !== "pending"
  ) {
    return { outcome: "conflict", paymentInitialized, mutated: false }
  }

  if (
    storedExpiresAt === null ||
    !Number.isFinite(storedExpiresAt) ||
    storedExpiresAt <= now
  ) {
    return { outcome: "expired", paymentInitialized, mutated: false }
  }

  return { outcome: "already_constructed", paymentInitialized, mutated: false }
}

function constructionAclIsValid({
  ownerName = "postgres",
  ownerOid = 10,
  serviceRoleOid = 20,
  securityDefiner = true,
  volatility = "v",
  searchPath = 'search_path=""',
  acl,
}) {
  if (
    ownerName !== "postgres" ||
    !securityDefiner ||
    volatility !== "v" ||
    searchPath !== 'search_path=""' ||
    acl === null ||
    serviceRoleOid === null
  ) return false

  const serviceEntries = acl.filter((entry) => entry.grantee === serviceRoleOid)
  if (
    serviceEntries.length !== 1 ||
    serviceEntries[0].grantor !== ownerOid ||
    serviceEntries[0].privilege !== "EXECUTE" ||
    serviceEntries[0].isGrantable
  ) return false

  return !acl.some(
    (entry) =>
      entry.privilege === "EXECUTE" &&
      entry.grantee !== ownerOid &&
      entry.grantee !== serviceRoleOid
  )
}

test("migration is transactional, bounded, and preserves the draft-only release boundary", () => {
  assert.match(normalized, /^begin;\n/u)
  assert.match(normalized, /^begin;\n\nset transaction isolation level repeatable read;/u)
  assert.match(normalized, /set local lock_timeout = '10s';/u)
  assert.match(normalized, /set local statement_timeout = '120s';/u)
  assert.match(normalized, /products_variant_draft_publication_check/u)
  assert.match(normalized, /product_variants_draft_only_check/u)
  assert.match(normalized, /commit;\n$/u)
  assert.doesNotMatch(normalized, /drop constraint products_variant_draft_publication_check/iu)
  assert.doesNotMatch(normalized, /drop constraint product_variants_draft_only_check/iu)
})

test("trusted phone validation matches the existing trimmed 1-to-32 checkout contract", () => {
  assert.match(
    normalized,
    /p_customer_phone is null[\s\S]*?pg_catalog\.char_length\(pg_catalog\.btrim\(p_customer_phone\)\)[\s\S]*?not between 1 and 32/u
  )
  assert.match(
    checkout,
    /const customerPhone =[\s\S]*?profile\.phone\.trim\(\)[\s\S]*?!hasLengthBetween\(customerPhone, 1, 32\)/u
  )

  for (const rejected of [null, "", "   ", "x".repeat(33), "x".repeat(40)]) {
    assert.equal(validCustomerPhone(rejected), false)
  }
  for (const accepted of ["x", "x".repeat(4), "x".repeat(5), "x".repeat(32)]) {
    assert.equal(validCustomerPhone(accepted), true)
  }
})

test("request fingerprints explicitly reject null and retain the lowercase SHA-256 format", () => {
  const nullCheck = normalized.indexOf("p_request_fingerprint is null")
  const regexCheck = normalized.indexOf("p_request_fingerprint !~ '^[0-9a-f]{64}$'")
  const orderInsert = normalized.indexOf("insert into public.orders (")
  assert.ok(nullCheck > 0 && regexCheck > nullCheck && orderInsert > regexCheck)

  assert.equal(validRequestFingerprint(null), false)
  assert.equal(validRequestFingerprint(""), false)
  assert.equal(validRequestFingerprint("g".repeat(64)), false)
  assert.equal(validRequestFingerprint("a".repeat(64)), true)
})

test("preflight pins snapshot reference tables, columns, primary keys, and axis relationships", () => {
  for (const table of [
    "public.option_definitions",
    "public.option_units",
    "public.option_size_systems",
  ]) {
    assert.ok(normalized.includes(`to_regclass('${table}')`), `missing ${table}`)
  }
  for (const column of ["value_kind", "symbol", "option_size_systems", "name"]) {
    assert.ok(normalized.includes(column), `missing reference column check: ${column}`)
  }
  for (const constraint of [
    "option_definitions_pkey",
    "option_units_pkey",
    "option_size_systems_pkey",
    "product_option_axes_option_fkey",
    "product_option_axes_unit_fkey",
    "product_option_axes_size_system_fkey",
  ]) {
    assert.ok(normalized.includes(constraint), `missing reference constraint check: ${constraint}`)
  }
  assert.match(normalized, /pg_get_constraintdef\(constraint_record\.oid, true\)[\s\S]*?is distinct from required_constraint\.definition/u)
})

test("D4 remains responsible for canonical shipping normalization and Nigerian-state validation", () => {
  assert.match(checkout, /const NIGERIAN_STATES = new Set\(\[/u)
  assert.match(checkout, /normalizeWhitespace\(value\.shipping_address\.address\)/u)
  assert.match(checkout, /normalizeWhitespace\(value\.shipping_address\.city\)/u)
  assert.match(checkout, /value\.shipping_address\.state\.trim\(\)/u)
  assert.match(checkout, /!NIGERIAN_STATES\.has\(state\)/u)
  assert.match(
    normalized,
    /The caller must authenticate the customer and apply the canonical handle-checkout shipping normalization and Nigerian-state validation before invocation\./u
  )
})

test("repeatable-read snapshots protect migration data guards from concurrent checkout drift", () => {
  const isolation = normalized.indexOf("set transaction isolation level repeatable read;")
  const preflight = normalized.indexOf("do $preflight$")
  assert.ok(isolation > 0 && isolation < preflight)
  assert.match(normalized, /marketa\.d2\.orders_count/u)
  assert.match(normalized, /marketa\.d2\.order_items_count/u)
  assert.match(normalized, /marketa\.d2\.checkout_attempts_count/u)
  assert.match(normalized, /marketa\.d2\.orders_hash/u)
  assert.match(normalized, /marketa\.d2\.order_items_hash/u)
})

test("preflight pins the deployed guard, C2 validator, and C3 finalizer", () => {
  assert.match(normalized, /b7ef9997e19e38d33274104723faccee/u)
  assert.match(normalized, /c34ac95900ffa3c7bd2072256a56f203/u)
  assert.match(normalized, /74a760039e13ce5ff09e3b9ef76d7c21/u)
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.finalize_paystack_paid_order/iu
  )
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.validate_order_item_variant_options_snapshot/iu
  )
})

test("trusted construction RPC exposes only the required checkout identities", () => {
  const signature = normalized.match(
    /create function public\.construct_trusted_checkout_order\([\s\S]*?\)\nreturns table/u
  )?.[0]
  assert.ok(signature)
  for (const parameter of [
    "p_checkout_attempt_id uuid",
    "p_customer_id uuid",
    "p_customer_email text",
    "p_customer_name text",
    "p_customer_phone text",
    "p_shipping_address jsonb",
    "p_request_fingerprint text",
    "p_expires_at timestamptz",
    "p_items jsonb",
  ]) {
    assert.ok(signature.includes(parameter), `missing ${parameter}`)
  }
  for (const forbidden of [
    "p_price",
    "p_vendor_id",
    "p_stock",
    "p_platform_fee",
    "p_snapshot",
    "p_combination_signature",
    "p_payment_status",
  ]) {
    assert.ok(!signature.includes(forbidden), `forbidden input ${forbidden}`)
  }
})

test("RPC is fixed-search-path SECURITY DEFINER and service-role-only", () => {
  const rpc = bodyBetween(
    normalized,
    "create function public.construct_trusted_checkout_order(",
    "do $postcondition$"
  )
  assert.match(rpc, /security definer\nset search_path = ''/u)
  assert.match(rpc, /alter function public\.construct_trusted_checkout_order[\s\S]*?owner to postgres;/u)
  assert.match(rpc, /revoke all privileges[\s\S]*?from public, anon, authenticated;/u)
  assert.match(rpc, /grant execute[\s\S]*?to service_role;/u)
  assert.match(normalized, /unexpected construction RPC grantee/u)
})

test("construction RPC ACL permits only its postgres owner and non-grantable service_role EXECUTE", () => {
  const owner = { grantee: 10, grantor: 10, privilege: "EXECUTE", isGrantable: true }
  const service = { grantee: 20, grantor: 10, privilege: "EXECUTE", isGrantable: false }
  const validAcl = [owner, service]

  assert.equal(constructionAclIsValid({ acl: validAcl }), true)
  assert.equal(constructionAclIsValid({ acl: [owner] }), false)
  assert.equal(
    constructionAclIsValid({
      acl: [owner, { ...service, isGrantable: true }],
    }),
    false
  )
  for (const grantee of [0, 30, 40, 50]) {
    assert.equal(
      constructionAclIsValid({
        acl: [owner, service, { grantee, grantor: 10, privilege: "EXECUTE", isGrantable: false }],
      }),
      false
    )
  }
  assert.equal(constructionAclIsValid({ ownerName: "other", acl: validAcl }), false)
  assert.equal(constructionAclIsValid({ acl: null }), false)
  assert.equal(constructionAclIsValid({ serviceRoleOid: null, acl: validAcl }), false)
  assert.equal(constructionAclIsValid({ securityDefiner: false, acl: validAcl }), false)
  assert.equal(constructionAclIsValid({ volatility: "s", acl: validAcl }), false)
  assert.equal(constructionAclIsValid({ searchPath: "search_path=public", acl: validAcl }), false)

  assert.match(normalized, /procedure\.proowner as owner_oid/u)
  assert.match(normalized, /function_record\.proacl is null/u)
  assert.match(normalized, /acl\.grantor = function_record\.owner_oid/u)
  assert.match(normalized, /and not acl\.is_grantable/u)
  assert.match(normalized, /acl\.grantee <> function_record\.owner_oid/u)
  assert.match(normalized, /acl\.grantee <> service_role_oid/u)
  assert.match(normalized, /'public',[\s\S]*?construct_trusted_checkout_order[\s\S]*?'EXECUTE'/u)
})

test("private one-time authorization has no browser or direct service-role authority", () => {
  assert.match(normalized, /create schema marketa_private;/u)
  assert.match(
    normalized,
    /revoke all privileges on schema marketa_private\n  from public, anon, authenticated, service_role;/u
  )
  assert.match(
    normalized,
    /alter table marketa_private\.trusted_order_item_insert_authorizations\n  enable row level security;/u
  )
  assert.match(
    normalized,
    /revoke all privileges on table\n  marketa_private\.trusted_order_item_insert_authorizations\nfrom public, anon, authenticated, service_role;/u
  )
  assert.doesNotMatch(normalized, /grant .*trusted_order_item_insert_authorizations/iu)
})

test("variant authorization is transaction, backend, order, line, and value bound", () => {
  const guard = bodyBetween(
    normalized,
    "create or replace function public.guard_foundation_order_item_variant()",
    "create function public.construct_trusted_checkout_order("
  )
  assert.match(guard, /auth_row\.transaction_id = pg_catalog\.txid_current\(\)/u)
  assert.match(guard, /auth_row\.backend_pid = pg_catalog\.pg_backend_pid\(\)/u)
  assert.match(guard, /auth_row\.order_id = new\.order_id/u)
  assert.match(guard, /auth_row\.line_identity = new\.product_id::text/u)
  assert.match(guard, /auth_row\.product_variant_id = new\.product_variant_id/u)
  assert.match(guard, /variant_options_snapshot[\s\S]*?is not distinct from new\.variant_options_snapshot/u)
  assert.match(guard, /delete from marketa_private\.trusted_order_item_insert_authorizations/u)
  assert.doesNotMatch(normalized, /\bas authorization\b/iu)
  assert.match(guard, /Variant order-item insertion is not authorized\./u)
})

test("custom settings cannot forge the trusted insertion path", () => {
  const guard = bodyBetween(
    normalized,
    "create or replace function public.guard_foundation_order_item_variant()",
    "create function public.construct_trusted_checkout_order("
  )
  assert.doesNotMatch(guard, /current_setting|set_config|marketa\./iu)
  assert.doesNotMatch(guard, /session_user|current_user/iu)
})

test("ordinary order items keep the existing ordinary-product guard path", () => {
  const guard = bodyBetween(
    normalized,
    "create or replace function public.guard_foundation_order_item_variant()",
    "create function public.construct_trusted_checkout_order("
  )
  assert.match(guard, /if new\.product_variant_id is null then/u)
  assert.match(guard, /parent_mode is distinct from 'none'/u)
  assert.match(guard, /Ordinary order items require an ordinary product\./u)
  assert.match(guard, /return new;/u)
})

test("direct variant insertion remains fail-closed for service_role and authenticated", () => {
  const guard = bodyBetween(
    normalized,
    "create or replace function public.guard_foundation_order_item_variant()",
    "create function public.construct_trusted_checkout_order("
  )
  assert.match(guard, /consumed_line_identity is null/u)
  assert.match(guard, /errcode = '42501'/u)
  assert.match(normalized, /has_function_privilege\(\n      'service_role',[\s\S]*?guard_foundation_order_item_variant\(\)'[\s\S]*?'EXECUTE'/u)
  assert.match(normalized, /has_function_privilege\(\n      'authenticated',[\s\S]*?construct_trusted_checkout_order/u)
})

test("RPC creates order, checkout attempt, and items atomically before returning", () => {
  const rpc = bodyBetween(
    normalized,
    "create function public.construct_trusted_checkout_order(",
    "alter function public.construct_trusted_checkout_order("
  )
  const orderInsert = rpc.indexOf("insert into public.orders (")
  const attemptInsert = rpc.indexOf("insert into public.checkout_attempts (")
  const itemInsert = rpc.indexOf("insert into public.order_items (")
  const result = rpc.indexOf("'constructed'::text")
  assert.ok(orderInsert > 0 && attemptInsert > orderInsert)
  assert.ok(itemInsert > attemptInsert && result > itemInsert)
  assert.doesNotMatch(rpc, /fetch|paystack|payment_events|finalize_paystack_paid_order/iu)
})

test("checkout replay is serialized and exact-fingerprint/customer scoped", () => {
  assert.match(normalized, /marketa-checkout-attempt:/u)
  assert.match(normalized, /existing_record\.customer_id is distinct from p_customer_id/u)
  assert.match(normalized, /existing_record\.request_fingerprint is distinct from\n        p_request_fingerprint/u)
  assert.match(normalized, /existing_record\.shipping_address is distinct from p_shipping_address/u)
  assert.match(normalized, /attempt\.expires_at,/u)
  assert.match(normalized, /existing_record\.expires_at is null/u)
  assert.match(normalized, /existing_record\.expires_at <= pg_catalog\.statement_timestamp\(\)/u)
  assert.match(normalized, /Checkout attempt has expired\./u)
  assert.match(normalized, /from public\.order_items as existing_item[\s\S]*?except/u)
  assert.match(normalized, /union all[\s\S]*?except/u)
  assert.match(normalized, /'already_constructed'::text/u)
  assert.match(normalized, /Checkout attempt conflicts with existing construction\./u)
  assert.match(normalized, /Checkout attempt requires reconciliation\./u)
})

test("checkout replay model accepts only unexpired matching pending constructions", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z")
  const future = now + 60_000

  assert.deepEqual(replayDecision({ storedExpiresAt: future, now }), {
    outcome: "already_constructed",
    paymentInitialized: false,
    mutated: false,
  })
  assert.equal(replayDecision({ storedExpiresAt: now, now }).outcome, "expired")
  assert.equal(replayDecision({ storedExpiresAt: null, now }).outcome, "expired")
  assert.equal(
    replayDecision({ storedExpiresAt: future, now, fingerprintMatches: false }).outcome,
    "conflict"
  )
  assert.equal(
    replayDecision({ storedExpiresAt: future, now, variantSelectionMatches: false }).outcome,
    "conflict"
  )
  assert.equal(
    replayDecision({ storedExpiresAt: future, now, customerMatches: false }).outcome,
    "conflict"
  )
})

test("initialized payment and concurrent exact repeats remain non-mutating valid replays", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z")
  const input = {
    storedExpiresAt: now + 60_000,
    now,
    paymentInitialized: true,
  }
  const first = replayDecision(input)
  const concurrentRepeat = replayDecision(input)
  assert.deepEqual(first, {
    outcome: "already_constructed",
    paymentInitialized: true,
    mutated: false,
  })
  assert.deepEqual(concurrentRepeat, first)

  const replayPath = bodyBetween(
    normalized,
    "select\n    customer_order.id,",
    "if exists (\n    select 1\n    from public.orders as customer_order"
  )
  assert.doesNotMatch(replayPath, /\b(?:insert|update|delete)\b/iu)
})

test("item identity normalization preserves multiple variants and combines repeats", () => {
  assert.match(normalized, /group by\n      \(item\.value ->> 'product_id'\)::uuid,/u)
  assert.match(normalized, /'product_variant_id', requested\.product_variant_id::text/u)
  assert.match(normalized, /Combined checkout quantity is invalid\./u)

  const product = "11111111-1111-4111-8111-111111111111"
  const small = "22222222-2222-4222-8222-222222222222"
  const large = "33333333-3333-4333-8333-333333333333"
  assert.deepEqual(normalizeItems([
    { product_id: product, product_variant_id: small, quantity: 1 },
    { product_id: product, product_variant_id: large, quantity: 2 },
    { product_id: product, product_variant_id: small, quantity: 3 },
  ]), [
    { product_id: product, product_variant_id: small, quantity: 4 },
    { product_id: product, product_variant_id: large, quantity: 2 },
  ])
})

test("lock order is checkout attempt, vendors, sorted product locks, products, then variants", () => {
  const rpc = bodyBetween(
    normalized,
    "create function public.construct_trusted_checkout_order(",
    "alter function public.construct_trusted_checkout_order("
  )
  const attempt = rpc.indexOf("marketa-checkout-attempt:")
  const vendor = rpc.indexOf("perform vendor.id")
  const advisory = rpc.indexOf("pg_catalog.pg_advisory_xact_lock_shared(", vendor)
  const product = rpc.indexOf("perform product.id", advisory)
  const variant = rpc.indexOf("perform variant.id", product)
  assert.ok(attempt > 0 && vendor > attempt)
  assert.ok(advisory > vendor && product > advisory && variant > product)
  assert.match(rpc.slice(advisory, product), /order by product_id/u)
  assert.match(rpc.slice(variant, variant + 900), /order by variant\.id\n  for share of variant;/u)
})

test("product, vendor, publication, relationship, and stock checks are authoritative", () => {
  assert.match(normalized, /vendor\.is_active is distinct from true/u)
  assert.match(normalized, /product_record\.is_active is distinct from true/u)
  assert.match(normalized, /variant\.vendor_id = product_record\.vendor_id/u)
  assert.match(normalized, /variant_record\.is_active is distinct from true/u)
  assert.match(normalized, /product_record\.stock < item_record\.quantity/u)
  assert.match(normalized, /variant_record\.stock < item_record\.quantity/u)
  assert.doesNotMatch(normalized, /set stock =|stock = stock -|update public\.products/iu)
  assert.doesNotMatch(normalized, /update public\.product_variants/iu)
})

test("legacy size and colour snapshots come only from the locked variant", () => {
  assert.match(normalized, /product_record\.variant_mode = 'size'/u)
  assert.match(normalized, /size_snapshot := pg_catalog\.btrim\(variant_record\.size\)/u)
  assert.match(normalized, /product_record\.variant_mode = 'colour'/u)
  assert.match(normalized, /colour_snapshot := pg_catalog\.btrim\(variant_record\.colour\)/u)
  assert.match(normalized, /product_record\.variant_mode = 'size_colour'/u)
})

test("generalized snapshots use exact C2 metadata and display ordering", () => {
  for (const field of [
    "axis_id",
    "axis_position",
    "axis_display_name",
    "option_code",
    "value_kind",
    "value_id",
    "value_display_label",
    "numeric_value",
    "unit_code",
    "unit_name",
    "unit_symbol",
    "size_system_code",
    "size_system_name",
  ]) {
    assert.match(normalized, new RegExp(`'${field}'`, "u"))
  }
  assert.match(normalized, /\) order by axis\.position/u)
  assert.match(normalized, /'schema_version', 1/u)
  assert.match(normalized, /validate_order_item_variant_options_snapshot\(\n          options_snapshot/u)
})

test("canonical signature uses axis UUID order and persisted identity must match", () => {
  assert.match(normalized, /'\|' order by assignment\.axis_id/u)
  assert.match(normalized, /persisted_signature is distinct from computed_signature/u)
  assert.match(normalized, /product_variant_combination_identities as identity/u)

  const options = [
    { axis_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", value_id: "11111111-1111-4111-8111-111111111111" },
    { axis_id: "00000000-0000-4000-8000-000000000001", value_id: "22222222-2222-4222-8222-222222222222" },
  ]
  assert.equal(
    combinationSignature(options),
    "00000000-0000-4000-8000-000000000001=22222222-2222-4222-8222-222222222222|ffffffff-ffff-4fff-8fff-ffffffffffff=11111111-1111-4111-8111-111111111111"
  )
})

test("generalized construction requires complete one-to-three-axis assignments", () => {
  assert.match(normalized, /axis_count not between 1 and 3/u)
  assert.match(normalized, /assignment_count is distinct from axis_count/u)
  assert.match(normalized, /Generalized variant identity is incomplete\./u)
  assert.doesNotMatch(normalized, /cross join public\.product_option_values/iu)
})

test("financial snapshots use authoritative product price and vendor fee", () => {
  assert.match(normalized, /product_record\.price \* 100/u)
  assert.match(normalized, /product_record\.platform_fee_pct \* 100/u)
  assert.match(normalized, /gross_amount_kobo::numeric \* fee_bps::numeric \/ 10000/u)
  assert.match(normalized, /financial_contract_version,\n      product_variant_id/u)
  assert.match(normalized, /total_kobo > 999999999999/u)

  assert.deepEqual(financialSnapshot(12_345n, 3, 500), {
    unit_amount_kobo: 12_345n,
    gross_amount_kobo: 37_035n,
    platform_fee_bps: 500,
    platform_fee_amount_kobo: 1_852n,
    vendor_net_amount_kobo: 35_183n,
  })
})

test("caller cannot provide financial or snapshot fields inside item objects", () => {
  assert.match(
    normalized,
    /item\.value - array\[\n        'product_id', 'product_variant_id', 'quantity'\n      \]::text\[\]/u
  )
  assert.match(normalized, /Trusted checkout items are invalid\./u)
})

test("failed construction is naturally atomic and leaves no reusable authorization", () => {
  assert.match(normalized, /^begin;/u)
  assert.match(normalized, /primary key \(transaction_id, backend_pid, order_id, line_identity\)/u)
  assert.match(normalized, /delete from marketa_private\.trusted_order_item_insert_authorizations/u)
  assert.match(normalized, /Trusted order-item authorization was not fully consumed\./u)
  assert.doesNotMatch(normalized, /exception\s+when others[\s\S]*?return query/iu)
})

test("current ordinary Edge checkout remains source-identical and does not call D2 RPC", () => {
  assert.match(checkout, /const ITEM_FIELDS = new Set\(\["product_id", "quantity"\]\)/u)
  assert.match(checkout, /\.from\("orders"\)\n    \.insert/u)
  assert.match(checkout, /\.from\("order_items"\)\n    \.insert/u)
  assert.doesNotMatch(checkout, /construct_trusted_checkout_order/u)
})

test("migration adds no publication, payment, outbox, ledger, or public mutation behavior", () => {
  assert.doesNotMatch(normalized, /alter table public\.products\s+drop constraint/iu)
  assert.doesNotMatch(normalized, /insert into public\.payments/iu)
  assert.doesNotMatch(normalized, /insert into public\.payment_events/iu)
  assert.doesNotMatch(normalized, /insert into public\.outbox_events/iu)
  assert.doesNotMatch(normalized, /insert into public\.payout_ledger/iu)
  assert.doesNotMatch(normalized, /grant execute[\s\S]*?to (?:anon|authenticated)/iu)
  assert.doesNotMatch(normalized, /grant .* on table public\./iu)
})

test("runtime-positive variant cases remain explicitly gated by current draft constraints", () => {
  const requiredFutureRuntimeCases = [
    "legacy size",
    "legacy colour",
    "generalized one-axis",
    "generalized three-axis",
    "mixed ordinary/variant",
    "multiple variants of one parent",
    "cross-product rejection",
    "cross-vendor rejection",
    "direct service-role bypass",
    "rollback and baseline restoration",
  ]
  assert.equal(requiredFutureRuntimeCases.length, 10)
  assert.match(normalized, /product_record\.is_active is distinct from true/u)
  assert.match(normalized, /variant_record\.is_active is distinct from true/u)
})

test("migration changes only dormant database authority", () => {
  assert.match(normalized, /create schema marketa_private;/u)
  assert.match(normalized, /create function public\.construct_trusted_checkout_order/u)
  assert.match(normalized, /create or replace function public\.guard_foundation_order_item_variant/u)
  assert.doesNotMatch(normalized, /create policy|alter policy|drop policy/iu)
  assert.doesNotMatch(normalized, /create trigger/iu)
})
