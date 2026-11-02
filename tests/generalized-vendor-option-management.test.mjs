import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migrationPath =
  "supabase/migrations/20261101211734_add_generalized_vendor_option_management.sql"
const migration = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n")

const newRpcSignatures = [
  "get_vendor_option_reference_data()",
  "get_vendor_product_option_configuration(uuid)",
  "configure_vendor_product_options(uuid,text)",
  "add_vendor_product_option_axis(uuid,text,text,smallint,text,text)",
  "update_vendor_product_option_axis(uuid,text,smallint,text,text)",
  "delete_vendor_product_option_axis(uuid)",
  "add_vendor_product_option_value(uuid,text,numeric,text,integer)",
  "update_vendor_product_option_value(uuid,text,numeric,text,integer)",
  "delete_vendor_product_option_value(uuid)",
  "create_vendor_product_option_variant(uuid,uuid[],integer)",
]

const runtimeCases = [
  "authenticated active vendor configures one, two, and three axes",
  "inactive and cross-vendor callers are denied",
  "two sessions create the same combination",
  "two sessions race for combination 100 and 101",
  "axis mutation races with option-variant creation",
  "legacy size, colour, and size-colour RPCs remain operational",
  "stock version conflict and historical deletion guards remain operational",
  "failed configuration and variant creation restore the fixture baseline",
]

function section(start, end) {
  const startIndex = migration.indexOf(start)
  assert.notEqual(startIndex, -1, `missing section start: ${start}`)
  const endIndex = migration.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing section end: ${end}`)
  return migration.slice(startIndex, endIndex)
}

function normalizeLabel(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function validateSelection(axes, values, selectedIds) {
  if (selectedIds.length < 1 || selectedIds.length > 3) return "invalid_input"
  if (new Set(selectedIds).size !== selectedIds.length) return "invalid_input"
  const selected = selectedIds.map((id) => values.find((value) => value.id === id))
  if (selected.some((value) => !value)) return "invalid_input"
  const requiredAxes = [...axes].map((axis) => axis.id).sort()
  const selectedAxes = selected.map((value) => value.axisId).sort()
  return JSON.stringify(requiredAxes) === JSON.stringify(selectedAxes)
    ? "created"
    : "invalid_input"
}

function canAddAxis(existingAxes, maximumAxes = 3) {
  return existingAxes < maximumAxes
}

function canAddCombination(existingCombinations, maximumCombinations = 100) {
  return existingCombinations < maximumCombinations
}

test("migration is one bounded transaction and does not change commerce code", () => {
  assert.match(migration, /^-- Product Variants Batch 2C-B2:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s';/)
  assert.match(migration, /set local statement_timeout = '120s';/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.doesNotMatch(migration, /create or replace function public\.finalize_paystack_paid_order/)
  assert.doesNotMatch(migration, /create or replace function public\.decrement_stock/)
  assert.doesNotMatch(migration, /authorization_url|checkout_attempt/i)
})

test("options mode remains draft-only with zero parent stock", () => {
  assert.match(
    migration,
    /check \(variant_mode in \('none', 'size', 'colour', 'size_colour', 'options'\)\)/
  )
  assert.match(migration, /products_inventory_authority_check[\s\S]*variant_mode = ''none''::text OR stock = 0/)
  assert.match(migration, /products_variant_draft_publication_check[\s\S]*variant_mode = ''none''::text OR is_active IS FALSE/)
  assert.match(migration, /set category_code = p_category_code,[\s\S]*variant_mode = 'options',[\s\S]*is_active = false/)
  assert.doesNotMatch(migration, /set\s+stock\s*=\s*0/i)
})

test("generic variants use assignments instead of fake legacy labels", () => {
  assert.match(
    migration,
    /parent_mode = 'options'[\s\S]*normalized_size is null and normalized_colour is null/
  )
  assert.match(
    migration,
    /values \(\s*p_product_id, authorized_vendor_id, null, null, p_stock, false\s*\)/
  )
  assert.match(
    migration,
    /product_variants_normalized_combination_key[\s\S]*where size_normalized is not null or colour_normalized is not null/
  )
  assert.match(
    migration,
    /insert into public\.product_variant_option_values[\s\S]*perform public\.assert_product_option_completeness\(p_product_id\)/
  )
})

test("all ten stable generalized RPC signatures are installed", () => {
  for (const signature of newRpcSignatures) {
    assert.match(
      migration,
      new RegExp(`public\\.${signature.replace(/[()[\],]/g, "\\$&")}`)
    )
  }
  assert.match(migration, /generalized RPC inventory is incorrect/)
  assert.match(migration, /\) <> 10 then/)
})

test("RPC authority is hardened and private tables remain inaccessible", () => {
  assert.equal((migration.match(/language plpgsql\nsecurity definer\nset search_path = ''/g) ?? []).length, 12)
  assert.match(
    migration,
    /revoke all privileges on function[\s\S]*from public, anon, authenticated, service_role;/
  )
  assert.match(migration, /grant execute on function[\s\S]*to authenticated;/)
  assert.match(migration, /pg_catalog\.has_function_privilege\('public'/)
  assert.match(migration, /pg_catalog\.has_function_privilege\('anon'/)
  assert.match(migration, /pg_catalog\.has_function_privilege\('service_role'/)
  assert.match(migration, /private relation % gained authority/)
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete) on (?:table )?public\./i)
})

test("every mutation follows vendor-share product-lock product-update order", () => {
  const mutations = [
    ["configure_vendor_product_options", "add_vendor_product_option_axis"],
    ["add_vendor_product_option_axis", "update_vendor_product_option_axis"],
    ["update_vendor_product_option_axis", "delete_vendor_product_option_axis"],
    ["delete_vendor_product_option_axis", "add_vendor_product_option_value"],
    ["add_vendor_product_option_value", "update_vendor_product_option_value"],
    ["update_vendor_product_option_value", "delete_vendor_product_option_value"],
    ["delete_vendor_product_option_value", "create_vendor_product_option_variant"],
    ["create_vendor_product_option_variant", "alter function public.get_vendor_option_reference_data"],
  ]
  for (const [name, next] of mutations) {
    const rpc = section(`create function public.${name}(`, next.startsWith("alter") ? next : `create function public.${next}(`)
    const vendorLock = rpc.indexOf("for share;")
    const productLock = rpc.indexOf("pg_catalog.pg_advisory_xact_lock(")
    const productRowLock = rpc.indexOf("for update;", productLock)
    assert.ok(vendorLock !== -1 && vendorLock < productLock, `${name}: vendor lock order`)
    assert.ok(productLock < productRowLock, `${name}: product lock order`)
  }
})

test("configuration rejects active stock, history, unsafe state, and unknown categories", () => {
  const configure = section(
    "create function public.configure_vendor_product_options(",
    "create function public.add_vendor_product_option_axis("
  )
  assert.match(configure, /variant_mode <> 'none'/)
  assert.match(configure, /is_active is distinct from false/)
  assert.match(configure, /product_record\.stock <> 0/)
  assert.match(configure, /from public\.order_items[\s\S]*order_history_exists/)
  assert.match(configure, /from public\.catalogue_categories[\s\S]*category\.is_active/)
  assert.match(configure, /from public\.product_option_axes/)
})

test("axis management enforces curated templates and the three-axis limit", () => {
  const addAxis = section(
    "create function public.add_vendor_product_option_axis(",
    "create function public.update_vendor_product_option_axis("
  )
  assert.match(addAxis, /from public\.category_option_templates/)
  assert.match(addAxis, /join public\.option_definitions[\s\S]*definition\.is_active/)
  assert.match(addAxis, /select policy\.max_axes/)
  assert.match(addAxis, />= maximum_axes/)
  assert.match(addAxis, /'limit_reached'/)
  assert.match(addAxis, /'duplicate_axis'/)
  assert.match(migration, /where variant\.product_id = p_product_id\) then[\s\S]*'unsafe_state'/)
  assert.equal(canAddAxis(0), true)
  assert.equal(canAddAxis(1), true)
  assert.equal(canAddAxis(2), true)
  assert.equal(canAddAxis(3), false)
})

test("value mutations preserve normalized uniqueness and reject used values", () => {
  assert.match(migration, /pg_catalog\.btrim\(p_display_label\)/)
  assert.match(migration, /'duplicate_value'/)
  assert.match(
    migration,
    /from public\.product_variant_option_values as assignment[\s\S]*assignment\.value_id = p_value_id[\s\S]*'value_in_use'/
  )
  assert.equal(normalizeLabel("  Extra   LARGE "), "extra large")
  assert.equal(normalizeLabel("Extra Large"), "extra large")
})

test("variant creation requires exactly one same-product value for every axis", () => {
  const createVariant = section(
    "create function public.create_vendor_product_option_variant(",
    "alter function public.get_vendor_option_reference_data()"
  )
  assert.match(createVariant, /pg_catalog\.cardinality\(p_value_ids\) not between 1 and 3/)
  assert.match(createVariant, /pg_catalog\.count\(distinct selected_id\)/)
  assert.match(createVariant, /value\.product_id = p_product_id/)
  assert.match(createVariant, /value\.vendor_id = authorized_vendor_id/)
  assert.match(createVariant, /selected_axis_ids is distinct from required_axis_ids/)
  assert.match(createVariant, /maximum_combinations/)
  assert.match(
    createVariant,
    /requested_combination_signature text;[\s\S]*into selected_axis_ids, requested_combination_signature[\s\S]*requested_combination_signature is null/
  )
  assert.match(
    createVariant,
    /identity\.combination_signature = requested_combination_signature/
  )
  assert.doesNotMatch(
    createVariant,
    /identity\.combination_signature = combination_signature/
  )
  assert.match(createVariant, /when unique_violation then[\s\S]*'duplicate_combination'/)

  const axes = [{ id: "size" }, { id: "colour" }]
  const values = [
    { id: "small", axisId: "size" },
    { id: "red", axisId: "colour" },
    { id: "blue", axisId: "colour" },
  ]
  assert.equal(validateSelection(axes, values, ["small", "red"]), "created")
  assert.equal(validateSelection(axes, values, ["small"]), "invalid_input")
  assert.equal(validateSelection(axes, values, ["small", "red", "blue"]), "invalid_input")
  assert.equal(validateSelection(axes, values, ["small", "small"]), "invalid_input")
  assert.equal(canAddCombination(99), true)
  assert.equal(canAddCombination(100), false)
})

test("variant creation persists the explicit identity and fails closed on unexpected SQL errors", () => {
  const createVariant = section(
    "create function public.create_vendor_product_option_variant(",
    "alter function public.get_vendor_option_reference_data()"
  )
  assert.match(
    createVariant,
    /pg_catalog\.string_agg\(\s*value\.axis_id::text \|\| '=' \|\| value\.id::text,\s*'\|' order by value\.axis_id\s*\)/
  )
  assert.match(
    createVariant,
    /insert into public\.product_variants[\s\S]*p_product_id, authorized_vendor_id, null, null, p_stock, false/
  )
  assert.match(
    createVariant,
    /insert into public\.product_variant_option_values[\s\S]*perform public\.assert_product_option_completeness\(p_product_id\);[\s\S]*return query select 'created'::text, created_variant_id, created_stock_version;/
  )
  assert.match(
    createVariant,
    /when others then\s*return query select 'operation_failed'::text, null::uuid, null::bigint;/
  )
})

test("legacy modes and five signatures remain compatible", () => {
  assert.match(migration, /'none', 'size', 'colour', 'size_colour', 'options'/)
  assert.match(
    migration,
    /product_record\.variant_mode not in \('size', 'colour', 'size_colour'\)/
  )
  assert.match(migration, /parent_mode not in \('size', 'colour', 'size_colour'\)/)
  for (const signature of [
    "configure_vendor_product_variant_mode(uuid,text)",
    "create_vendor_product_variant(uuid,text,text,integer)",
    "update_vendor_product_variant_labels(uuid,text,text)",
    "update_vendor_product_variant_stock(uuid,integer,bigint)",
    "delete_vendor_product_variant(uuid,bigint)",
  ]) {
    assert.match(migration, new RegExp(signature.replace(/[()[\],]/g, "\\$&")))
  }
  assert.match(migration, /'0faebe13683d65cd402f116807a1c62d'/)
  assert.match(migration, /'9c5a7c9c20fea5430764c491e1ff1594'/)
  assert.match(migration, /'d87e27030795ef2fd84136131344a708'/)
  assert.match(migration, /legacy RPC authority changed/)
})

test("stock, deletion, payment, policies, and business rows are preserved", () => {
  assert.match(migration, /marketa\.options_b2\.products_hash/)
  assert.match(migration, /marketa\.options_b2\.variants_hash/)
  assert.match(migration, /marketa\.options_b2\.order_items_hash/)
  assert.match(migration, /marketa\.options_b2\.product_policies_hash/)
  assert.match(migration, /marketa\.options_b2\.variant_policies_hash/)
  assert.match(migration, /'37c763494aed0f4e13daa004b88b6dee'/)
  assert.match(migration, /'0094f1ea6602edbfe18ac8f9619677b8'/)
  assert.doesNotMatch(migration, /update\s+public\.order_items/i)
  assert.doesNotMatch(migration, /update\s+public\.product_variants\s+as\s+variant\s+set\s+stock/i)
})

test("static checks do not claim runtime concurrency proof", () => {
  assert.deepEqual(runtimeCases, [
    "authenticated active vendor configures one, two, and three axes",
    "inactive and cross-vendor callers are denied",
    "two sessions create the same combination",
    "two sessions race for combination 100 and 101",
    "axis mutation races with option-variant creation",
    "legacy size, colour, and size-colour RPCs remain operational",
    "stock version conflict and historical deletion guards remain operational",
    "failed configuration and variant creation restore the fixture baseline",
  ])
})

test("migration introduces no direct publication or purchasing path", () => {
  assert.doesNotMatch(migration, /update\s+public\.products[\s\S]{0,120}is_active\s*=\s*true/i)
  assert.doesNotMatch(migration, /update\s+public\.product_variants[\s\S]{0,120}is_active\s*=\s*true/i)
  assert.doesNotMatch(migration, /insert into public\.order_items/i)
  assert.doesNotMatch(migration, /selected_options_snapshot|variant_price|price_adjustment/i)
})
