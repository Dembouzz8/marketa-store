import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261103084943_add_generalized_order_item_variant_snapshot.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")
const normalized = migration.replace(/\r\n/g, "\n")

const ids = {
  variant: "11111111-1111-4111-8111-111111111111",
  product: "22222222-2222-4222-8222-222222222222",
  vendor: "33333333-3333-4333-8333-333333333333",
  axis1: "44444444-4444-4444-8444-444444444444",
  axis2: "55555555-5555-4555-8555-555555555555",
  axis3: "66666666-6666-4666-8666-666666666666",
  value1: "77777777-7777-4777-8777-777777777777",
  value2: "88888888-8888-4888-8888-888888888888",
  value3: "99999999-9999-4999-8999-999999999999",
}

const topKeys = [
  "schema_version",
  "variant_id",
  "product_id",
  "vendor_id",
  "combination_signature",
  "options",
]

const optionKeys = [
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
]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const codePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u
const decimalPattern = /^(?:0|[1-9][0-9]{0,11})(?:[.][0-9]{1,6})?$/u

function byteLength(value) {
  return Buffer.byteLength(value, "utf8")
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
}

// This executable model exercises the reviewed document contract. It is not a
// substitute for running the PostgreSQL function in the disposable database.
function validateSnapshot(snapshot) {
  if (!hasExactKeys(snapshot, topKeys)) return false
  if (byteLength(JSON.stringify(snapshot)) > 16_384) return false
  if (snapshot.schema_version !== 1) return false
  if (![snapshot.variant_id, snapshot.product_id, snapshot.vendor_id].every(
    (value) => typeof value === "string" && uuidPattern.test(value)
  )) return false
  if (typeof snapshot.combination_signature !== "string") return false
  if (byteLength(snapshot.combination_signature) < 73 ||
      byteLength(snapshot.combination_signature) > 221) return false
  if (!Array.isArray(snapshot.options) ||
      snapshot.options.length < 1 || snapshot.options.length > 3) return false

  const axes = new Set()
  const positions = new Set()
  const values = new Set()
  let previousPosition = 0

  for (const option of snapshot.options) {
    if (!hasExactKeys(option, optionKeys)) return false
    if (!uuidPattern.test(option.axis_id) || !uuidPattern.test(option.value_id)) {
      return false
    }
    if (!Number.isInteger(option.axis_position) ||
        option.axis_position < 1 || option.axis_position > 3 ||
        option.axis_position <= previousPosition) return false
    if (typeof option.axis_display_name !== "string" ||
        option.axis_display_name.trim().length < 1 ||
        [...option.axis_display_name.trim()].length > 80) return false
    if (typeof option.option_code !== "string" ||
        byteLength(option.option_code) > 80 ||
        !codePattern.test(option.option_code)) return false
    if (!["label", "measurement", "colour"].includes(option.value_kind)) {
      return false
    }
    if (typeof option.value_display_label !== "string" ||
        option.value_display_label.trim().length < 1 ||
        [...option.value_display_label.trim()].length > 80) return false
    if (axes.has(option.axis_id) || positions.has(option.axis_position) ||
        values.has(option.value_id)) return false

    const nullableString = (value, max, pattern = null) =>
      value === null ||
      (typeof value === "string" && value.trim().length >= 1 &&
        [...value.trim()].length <= max && (!pattern || pattern.test(value)))

    if (option.numeric_value !== null &&
        (typeof option.numeric_value !== "string" ||
          byteLength(option.numeric_value) > 19 ||
          !decimalPattern.test(option.numeric_value) ||
          Number(option.numeric_value) <= 0)) return false
    if (!nullableString(option.unit_code, 80, codePattern) ||
        !nullableString(option.unit_name, 80) ||
        !nullableString(option.unit_symbol, 20) ||
        !nullableString(option.size_system_code, 80, codePattern) ||
        !nullableString(option.size_system_name, 80)) return false
    if ((option.unit_code === null) !== (option.unit_name === null) ||
        (option.unit_code === null) !== (option.unit_symbol === null) ||
        (option.size_system_code === null) !==
          (option.size_system_name === null)) return false

    if (option.value_kind === "measurement" &&
        (option.numeric_value === null || option.unit_code === null ||
          option.size_system_code !== null)) return false
    if (option.value_kind === "label" &&
        (option.numeric_value !== null || option.unit_code !== null)) return false
    if (option.value_kind === "colour" &&
        (option.numeric_value !== null || option.unit_code !== null ||
          option.size_system_code !== null)) return false

    axes.add(option.axis_id)
    positions.add(option.axis_position)
    values.add(option.value_id)
    previousPosition = option.axis_position
  }

  const expectedSignature = [...snapshot.options]
    .sort((left, right) => left.axis_id.localeCompare(right.axis_id))
    .map((option) => `${option.axis_id}=${option.value_id}`)
    .join("|")
  return snapshot.combination_signature === expectedSignature
}

function option(overrides = {}) {
  return {
    axis_id: ids.axis1,
    axis_position: 1,
    axis_display_name: "Colour",
    option_code: "colour",
    value_kind: "colour",
    value_id: ids.value1,
    value_display_label: "Black",
    numeric_value: null,
    unit_code: null,
    unit_name: null,
    unit_symbol: null,
    size_system_code: null,
    size_system_name: null,
    ...overrides,
  }
}

function snapshot(options = [option()], overrides = {}) {
  const combinationSignature = [...options]
    .sort((left, right) => left.axis_id.localeCompare(right.axis_id))
    .map((entry) => `${entry.axis_id}=${entry.value_id}`)
    .join("|")
  return {
    schema_version: 1,
    variant_id: ids.variant,
    product_id: ids.product,
    vendor_id: ids.vendor,
    combination_signature: combinationSignature,
    options,
    ...overrides,
  }
}

function identityBranch(row) {
  const ordinary = row.product_variant_id === null &&
    row.variant_size_snapshot === null &&
    row.variant_colour_snapshot === null &&
    row.variant_options_snapshot === null
  const legacy = row.product_variant_id !== null && row.product_id !== null &&
    (row.variant_size_snapshot !== null || row.variant_colour_snapshot !== null) &&
    row.variant_options_snapshot === null
  const generalized = row.product_variant_id !== null && row.product_id !== null &&
    row.vendor_id !== null && row.variant_size_snapshot === null &&
    row.variant_colour_snapshot === null && row.variant_options_snapshot !== null &&
    validateSnapshot(row.variant_options_snapshot) &&
    row.variant_options_snapshot.variant_id === row.product_variant_id &&
    row.variant_options_snapshot.product_id === row.product_id &&
    row.variant_options_snapshot.vendor_id === row.vendor_id
  return ordinary || legacy || generalized
}

test("migration is transactional and uses the approved timeouts", () => {
  assert.match(normalized, /^-- Product Variants Batch 2C-C2:[\s\S]*\nbegin;/)
  assert.match(normalized, /set local lock_timeout = '10s';/)
  assert.match(normalized, /set local statement_timeout = '120s';/)
  assert.match(normalized, /do \$preflight\$/)
  assert.match(normalized, /do \$postcondition\$/)
  assert.match(normalized, /\ncommit;\s*$/)
})

test("snapshot column is nullable, has no default, and receives no backfill", () => {
  assert.match(
    normalized,
    /alter table public\.order_items\s+add column variant_options_snapshot jsonb;/
  )
  assert.doesNotMatch(normalized, /variant_options_snapshot jsonb (?:not null|default)/i)
  assert.doesNotMatch(normalized, /update\s+public\.order_items/i)
})

test("validator is pure, immutable, invoker-rights, and tightly granted", () => {
  const start = normalized.indexOf(
    "create function public.validate_order_item_variant_options_snapshot("
  )
  const end = normalized.indexOf("$function$;", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = normalized.slice(start, end)

  assert.match(body, /language plpgsql\s+immutable\s+security invoker/)
  assert.match(body, /set search_path = ''/)
  assert.match(body, /when others then\s+return false/)
  assert.doesNotMatch(body, /\bfrom\s+public\.|\bjoin\s+public\.|\bexecute\b/i)
  assert.match(normalized, /revoke all privileges on function[\s\S]*from public, anon, authenticated, service_role;/)
  assert.match(normalized, /grant execute on function[\s\S]*to service_role;/)
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    assert.match(
      normalized,
      new RegExp(`has_function_privilege\\(\\s*'${role}', procedure\\.oid, 'EXECUTE'`)
    )
  }
})

test("validator enforces exact keys, byte limits, stable IDs, and canonical signature", () => {
  assert.match(normalized, /p_snapshot \?& required_top_keys/)
  assert.match(normalized, /p_snapshot - required_top_keys/)
  assert.match(normalized, /option_record\.option_value \?& required_option_keys/)
  assert.match(normalized, /option_record\.option_value - required_option_keys/)
  assert.match(normalized, /pg_catalog\.octet_length\(p_snapshot::text\) > 16384/)
  assert.match(normalized, /pg_catalog\.string_agg\(/)
  assert.match(
    normalized,
    /\(option_entry\.value ->> 'axis_id'\)\s+\|\| '=' \|\| \(option_entry\.value ->> 'value_id'\)/
  )
  assert.match(normalized, /order by option_entry\.value ->> 'axis_id'/)
})

test("one-axis and three-axis snapshots satisfy the executable contract model", () => {
  assert.equal(validateSnapshot(snapshot()), true)

  const options = [
    option(),
    option({
      axis_id: ids.axis2,
      axis_position: 2,
      axis_display_name: "Size",
      option_code: "size",
      value_kind: "label",
      value_id: ids.value2,
      value_display_label: "UK 10",
      size_system_code: "uk",
      size_system_name: "United Kingdom",
    }),
    option({
      axis_id: ids.axis3,
      axis_position: 3,
      axis_display_name: "Length",
      option_code: "length",
      value_kind: "measurement",
      value_id: ids.value3,
      value_display_label: "25 cm",
      numeric_value: "25.000000",
      unit_code: "cm",
      unit_name: "Centimetre",
      unit_symbol: "cm",
    }),
  ]
  assert.equal(validateSnapshot(snapshot(options)), true)
})

test("display ordering stays positional while canonical signatures stay UUID-sorted", () => {
  const options = [
    option({
      axis_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      axis_position: 1,
      value_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }),
    option({
      axis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      axis_position: 2,
      axis_display_name: "Size",
      option_code: "size",
      value_kind: "label",
      value_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      value_display_label: "Large",
    }),
    option({
      axis_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      axis_position: 3,
      axis_display_name: "Length",
      option_code: "length",
      value_kind: "measurement",
      value_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      value_display_label: "25 cm",
      numeric_value: "25.000000",
      unit_code: "cm",
      unit_name: "Centimetre",
      unit_symbol: "cm",
    }),
  ]
  const document = snapshot(options)
  const displayOrderedSignature = options
    .map((entry) => `${entry.axis_id}=${entry.value_id}`)
    .join("|")

  assert.deepEqual(document.options.map((entry) => entry.axis_position), [1, 2, 3])
  assert.notEqual(document.combination_signature, displayOrderedSignature)
  assert.equal(validateSnapshot(document), true)
  assert.equal(
    validateSnapshot({
      ...document,
      combination_signature: displayOrderedSignature,
    }),
    false
  )
})

test("missing, extra, mistyped, and unsupported top-level data is rejected", () => {
  const missing = snapshot()
  delete missing.vendor_id
  assert.equal(validateSnapshot(missing), false)
  assert.equal(validateSnapshot({ ...snapshot(), unexpected: true }), false)
  assert.equal(validateSnapshot({ ...snapshot(), schema_version: 2 }), false)
  assert.equal(validateSnapshot({ ...snapshot(), options: "invalid" }), false)
  assert.equal(validateSnapshot(null), false)
})

test("invalid UUIDs and noncanonical UUID text are rejected", () => {
  assert.equal(validateSnapshot({ ...snapshot(), variant_id: "invalid" }), false)
  assert.equal(
    validateSnapshot({
      ...snapshot(),
      variant_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    }),
    false
  )
  assert.equal(
    validateSnapshot(snapshot([option({ axis_id: "invalid" })])),
    false
  )
})

test("zero and four option entries are rejected", () => {
  assert.equal(validateSnapshot(snapshot([])), false)
  assert.equal(validateSnapshot(snapshot([
    option(),
    option({ axis_id: ids.axis2, axis_position: 2, value_id: ids.value2 }),
    option({ axis_id: ids.axis3, axis_position: 3, value_id: ids.value3 }),
    option({
      axis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      axis_position: 4,
      value_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  ])), false)
})

test("duplicate axes, positions, and values are rejected", () => {
  assert.equal(validateSnapshot(snapshot([
    option(),
    option({ axis_position: 2, value_id: ids.value2 }),
  ])), false)
  assert.equal(validateSnapshot(snapshot([
    option(),
    option({ axis_id: ids.axis2, value_id: ids.value2 }),
  ])), false)
  assert.equal(validateSnapshot(snapshot([
    option(),
    option({ axis_id: ids.axis2, axis_position: 2 }),
  ])), false)
})

test("incorrect option ordering and incorrect signatures are rejected", () => {
  const reversed = [
    option({ axis_id: ids.axis2, axis_position: 2, value_id: ids.value2 }),
    option(),
  ]
  assert.equal(validateSnapshot(snapshot(reversed)), false)
  assert.equal(
    validateSnapshot({ ...snapshot(), combination_signature: `${ids.axis1}=${ids.value2}` }),
    false
  )
})

test("numeric values are exact decimal strings with coherent metadata", () => {
  const measurement = option({
    value_kind: "measurement",
    option_code: "length",
    numeric_value: "12.500000",
    unit_code: "cm",
    unit_name: "Centimetre",
    unit_symbol: "cm",
  })
  assert.equal(validateSnapshot(snapshot([measurement])), true)
  assert.equal(validateSnapshot(snapshot([{ ...measurement, numeric_value: 12.5 }])), false)
  assert.equal(validateSnapshot(snapshot([{ ...measurement, numeric_value: "1e2" }])), false)
  assert.equal(validateSnapshot(snapshot([{ ...measurement, numeric_value: "0" }])), false)
  assert.equal(validateSnapshot(snapshot([{ ...measurement, unit_symbol: null }])), false)
})

test("labels preserve source character limits while documents use byte limits", () => {
  assert.equal(
    validateSnapshot(snapshot([option({ axis_display_name: "é".repeat(41) })])),
    true
  )
  assert.equal(
    validateSnapshot(snapshot([option({ value_display_label: "é".repeat(81) })])),
    false
  )
  assert.equal(
    validateSnapshot(snapshot([option({ value_display_label: "x".repeat(17_000) })])),
    false
  )
})

test("explicit JSON null is required for optional presentation fields", () => {
  const missingNull = option()
  delete missingNull.numeric_value
  assert.equal(validateSnapshot(snapshot([missingNull])), false)
  assert.equal(validateSnapshot(snapshot([option({ numeric_value: "1.0" })])), false)
  assert.equal(validateSnapshot(snapshot([option({ size_system_code: "uk" })])), false)
})

test("ordinary, legacy, and generalized identity branches remain disjoint", () => {
  const base = {
    product_id: ids.product,
    vendor_id: ids.vendor,
    product_variant_id: null,
    variant_size_snapshot: null,
    variant_colour_snapshot: null,
    variant_options_snapshot: null,
  }
  assert.equal(identityBranch(base), true)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_size_snapshot: "Large",
  }), true)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_colour_snapshot: "Black",
  }), true)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_size_snapshot: "Large",
    variant_colour_snapshot: "Black",
  }), true)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_options_snapshot: snapshot(),
  }), true)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_size_snapshot: "Large",
    variant_options_snapshot: snapshot(),
  }), false)
  assert.equal(identityBranch({
    ...base,
    product_variant_id: ids.variant,
    variant_options_snapshot: { ...snapshot(), vendor_id: ids.product },
  }), false)
})

test("candidate key and composite foreign key preserve historical variants", () => {
  assert.match(
    normalized,
    /constraint product_variants_id_product_id_vendor_id_key\s+unique \(id, product_id, vendor_id\)/
  )
  assert.match(
    normalized,
    /constraint order_items_product_variant_product_vendor_fkey[\s\S]*foreign key \(product_variant_id, product_id, vendor_id\)[\s\S]*references public\.product_variants \(id, product_id, vendor_id\)[\s\S]*on update restrict\s+on delete restrict/
  )
  assert.match(normalized, /validate constraint order_items_product_variant_product_vendor_fkey/)
})

test("identity CHECK calls the validator explicitly and matches all three IDs", () => {
  assert.match(
    normalized,
    /public\.validate_order_item_variant_options_snapshot\(\s*variant_options_snapshot\s*\) is true/
  )
  for (const [snapshotKey, column] of [
    ["variant_id", "product_variant_id"],
    ["product_id", "product_id"],
    ["vendor_id", "vendor_id"],
  ]) {
    assert.match(
      normalized,
      new RegExp(`variant_options_snapshot ->> '${snapshotKey}'\\s*= ${column}::text`)
    )
  }
})

test("immutable trigger protects all snapshots plus variant product and vendor identity", () => {
  const functionStart = normalized.indexOf(
    "create or replace function public.protect_order_item_variant_identity()"
  )
  const functionEnd = normalized.indexOf("$function$;", functionStart)
  const helper = normalized.slice(functionStart, functionEnd)
  for (const field of [
    "product_variant_id",
    "variant_size_snapshot",
    "variant_colour_snapshot",
    "variant_options_snapshot",
  ]) {
    assert.match(helper, new RegExp(`new\\.${field} is distinct from old\\.${field}`))
  }
  assert.match(helper, /old\.product_variant_id is not null/)
  assert.match(helper, /new\.product_variant_id is not null/)
  assert.match(helper, /new\.product_id is distinct from old\.product_id/)
  assert.match(helper, /new\.vendor_id is distinct from old\.vendor_id/)
  assert.match(
    normalized,
    /before update of\s+product_id,\s+vendor_id,\s+product_variant_id,\s+variant_size_snapshot,\s+variant_colour_snapshot,\s+variant_options_snapshot/
  )
})

test("purchase guard and financial functions are hash-protected and not replaced", () => {
  assert.match(normalized, /b7ef9997e19e38d33274104723faccee/)
  assert.match(normalized, /37c763494aed0f4e13daa004b88b6dee/)
  assert.match(normalized, /0094f1ea6602edbfe18ac8f9619677b8/)
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.guard_foundation_order_item_variant/
  )
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.finalize_paystack_paid_order/
  )
  assert.doesNotMatch(normalized, /create or replace function public\.decrement_stock/)
  assert.match(
    normalized,
    /order_items_foundation_variant_guard[\s\S]*guard_foundation_order_item_variant/
  )
})

test("migration preserves RLS, table grants, publication, and business rows", () => {
  assert.doesNotMatch(normalized, /\b(create|alter|drop) policy\b/i)
  assert.doesNotMatch(normalized, /\b(enable|disable|force|no force) row level security\b/i)
  assert.doesNotMatch(normalized, /\bupdate\s+public\.(products|product_variants|orders|order_items|payments|payment_events|payout_ledger|outbox_events)\b/i)
  assert.doesNotMatch(normalized, /\binsert\s+into\s+public\.(products|product_variants|orders|order_items|payments|payment_events|payout_ledger|outbox_events)\b/i)
  assert.doesNotMatch(normalized, /\bdelete\s+from\s+public\.(products|product_variants|orders|order_items|payments|payment_events|payout_ledger|outbox_events)\b/i)
  assert.match(normalized, /existing RLS policies changed/)
  assert.match(normalized, /table authority changed/)
  assert.match(normalized, /business rows changed/)
})

test("focused source checks explicitly defer runtime behavior to PostgreSQL", () => {
  assert.match(
    normalized,
    /Variant purchasing and variant-aware paid-order finalization remain unavailable/
  )
  assert.doesNotMatch(normalized, /authorization_url|checkout_attempt/i)
  assert.ok(
    true,
    "SQL execution, constraint enforcement, effective ACLs, and trigger behavior require isolated PostgreSQL validation"
  )
})
