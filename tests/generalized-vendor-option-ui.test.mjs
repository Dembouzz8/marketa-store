import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const manager = readFileSync(
  "src/components/vendor/product-options-manager.tsx",
  "utf8"
).replace(/\r\n/g, "\n")
const editPage = readFileSync(
  "src/app/vendor/products/[id]/edit/page.tsx",
  "utf8"
).replace(/\r\n/g, "\n")
const legacyManager = readFileSync(
  "src/components/vendor/product-variants-manager.tsx",
  "utf8"
).replace(/\r\n/g, "\n")
const productForm = readFileSync(
  "src/components/vendor/product-form.tsx",
  "utf8"
).replace(/\r\n/g, "\n")
const productsTable = readFileSync(
  "src/components/vendor/products-table.tsx",
  "utf8"
).replace(/\r\n/g, "\n")
const types = readFileSync("src/types/index.ts", "utf8").replace(/\r\n/g, "\n")

const requiredB2Rpcs = [
  "get_vendor_option_reference_data",
  "get_vendor_product_option_configuration",
  "configure_vendor_product_options",
  "add_vendor_product_option_axis",
  "update_vendor_product_option_axis",
  "delete_vendor_product_option_axis",
  "add_vendor_product_option_value",
  "update_vendor_product_option_value",
  "delete_vendor_product_option_value",
  "create_vendor_product_option_variant",
]

function validCombination(axisIds, selectedByAxis) {
  const selected = axisIds.map((axisId) => selectedByAxis[axisId]).filter(Boolean)
  return (
    axisIds.length > 0 &&
    selected.length === axisIds.length &&
    new Set(selected).size === selected.length
  )
}

function parseStock(value) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647
    ? parsed
    : null
}

test("edit page preserves authenticated active-vendor ownership checks", () => {
  assert.match(editPage, /createSupabaseServerClient\(\)/)
  assert.match(editPage, /supabase\.auth\.getUser\(\)/)
  assert.match(editPage, /\.from\("vendors"\)[\s\S]*\.eq\("user_id", user\.id\)/)
  assert.match(editPage, /if \(!vendor\.is_active\)/)
  assert.match(
    editPage,
    /\.from\("products"\)[\s\S]*\.eq\("id", id\)[\s\S]*\.eq\("vendor_id", vendor\.id\)/
  )
})

test("server initializes both approved read RPCs without privileged credentials", () => {
  assert.match(editPage, /supabase\.rpc\("get_vendor_option_reference_data"\)/)
  assert.match(
    editPage,
    /supabase\.rpc\("get_vendor_product_option_configuration", \{\s*p_product_id: product\.id/
  )
  assert.match(editPage, /await Promise\.all\(/)
  assert.doesNotMatch(editPage + manager, /service_role|SUPABASE_SERVICE_ROLE/i)
})

test("all ten deployed B2 RPC names are used and no alternatives are invented", () => {
  for (const rpc of requiredB2Rpcs) {
    assert.match(manager + editPage, new RegExp(`"${rpc}"`), rpc)
  }
  assert.doesNotMatch(manager, /insert_vendor_option|save_vendor_option|upsert_vendor_option/)
})

test("universal mutations never directly write private B1 tables", () => {
  for (const table of [
    "catalogue_categories",
    "option_definitions",
    "option_units",
    "option_size_systems",
    "category_option_templates",
    "product_option_axes",
    "product_option_values",
    "product_variant_option_values",
    "product_option_policy",
    "product_variant_combination_identities",
  ]) {
    assert.doesNotMatch(manager, new RegExp(`\\.from\\("${table}"\\)`), table)
  }
  assert.doesNotMatch(manager, /\.insert\(|\.update\(|\.delete\(/)
})

test("JSONB reference and configuration payloads are validated field by field", () => {
  for (const field of [
    "categories",
    "options",
    "units",
    "size_systems",
    "templates",
    "product_id",
    "category_code",
    "variant_mode",
    "is_active",
    "parent_stock",
    "axes",
    "variants",
    "selected_value_ids",
  ]) {
    assert.match(manager, new RegExp(`value\\.${field}|row\\.${field}`), field)
  }
  assert.match(manager, /firstRpcRecord[\s\S]*data\.length !== 1/)
  assert.match(manager, /row\.outcome !== "ok"/)
  assert.match(manager, /hasValidMutationIdentity/)
  assert.match(manager, /isUuid\(result\.row\.axis_id\)/)
  assert.match(manager, /isUuid\(result\.row\.value_id\)/)
  assert.match(manager, /isUuid\(result\.row\.variant_id\)/)
  assert.match(manager, /isNonnegativeInteger\(result\.row\.result_stock_version\)/)
  assert.doesNotMatch(manager, /:\s*any\b|as\s+any\b|<any>/)
})

test("canonical categories and templates come only from reference data", () => {
  assert.match(manager, /referenceData\.categories\.map/)
  assert.match(manager, /referenceData\?\.templates/)
  assert.match(manager, /template\.category_code === categoryCode/)
  assert.match(manager, /optionByCode\.get\(template\.option_code\)/)
  assert.doesNotMatch(manager, /const categories\s*=\s*\[/)
  assert.doesNotMatch(manager, /products\.category\s*===/)
})

test("configuration preserves visible and server-authoritative eligibility", () => {
  assert.match(
    manager,
    /visibleMode === "none"[\s\S]*product\.is_active === false[\s\S]*product\.stock === 0/
  )
  assert.match(manager, /p_product_id: product\.id, p_category_code: categoryCode/)
  for (const outcome of [
    "access_denied",
    "invalid_input",
    "invalid_state",
    "not_found",
    "order_history_exists",
    "operation_failed",
  ]) {
    assert.match(manager, new RegExp(`${outcome}:`), outcome)
  }
  assert.doesNotMatch(manager, /set product\.is_active|set product\.stock/)
})

test("uncertain configuration and mutations require authoritative refresh", () => {
  assert.match(manager, /setRequiresRefresh\(true\)/)
  assert.match(manager, /if \(!outcomeMessages\[result\.outcome\]\)/)
  assert.match(manager, /operation may have completed/i)
  assert.match(manager, /Reload authoritative data before trying again/i)
  assert.match(manager, /disabled=\{[\s\S]*requiresRefresh/)
  assert.doesNotMatch(
    manager,
    /setUncertain\([\s\S]{0,300}configureOptions\(\)|setUncertain\([\s\S]{0,300}runMutation\(/
  )
})

test("axis creation uses curated metadata and exact B2 parameters", () => {
  assert.match(manager, /configuration\.axes\.length < 3/)
  assert.match(manager, /configuredOptionCodes\.has\(template\.option_code\)/)
  assert.match(
    manager,
    /"add_vendor_product_option_axis"[\s\S]*p_product_id: product\.id[\s\S]*p_option_code: selectedDefinition\.code[\s\S]*p_display_name: displayName[\s\S]*p_position: position[\s\S]*p_unit_code:[\s\S]*p_size_system_code:/
  )
  assert.match(manager, /selectedDefinition\.requires_unit/)
  assert.match(manager, /selectedDefinition\.requires_size_system/)
  assert.match(manager, /unit\.dimension_code === selectedDefinition\?\.dimension_code/)
})

test("axis editing and deletion use exact identifiers and controlled outcomes", () => {
  assert.match(
    manager,
    /"update_vendor_product_option_axis"[\s\S]*p_axis_id: axis\.id/
  )
  assert.match(
    manager,
    /"delete_vendor_product_option_axis"[\s\S]*p_axis_id: deleteTarget\.id/
  )
  assert.match(manager, /duplicate_axis:/)
  assert.match(manager, /unsafe_state:/)
  assert.match(manager, /kind: "axis"/)
})

test("value forms respect label measurement and colour value kinds", () => {
  assert.match(manager, /value_kind === "measurement"/)
  assert.match(manager, /numericValue <= 0/)
  assert.match(manager, /value_kind === "colour"/)
  assert.match(manager, /HEX_COLOUR_PATTERN/)
  assert.match(manager, /value_kind !== "measurement" && numericValue !== null/)
  assert.match(manager, /value_kind !== "colour" && swatch !== null/)
})

test("value add update and delete use exact deployed RPC parameters", () => {
  assert.match(
    manager,
    /"add_vendor_product_option_value"[\s\S]*p_axis_id: axis\.id[\s\S]*p_display_label: label[\s\S]*p_numeric_value: numericValue[\s\S]*p_swatch_hex: swatch[\s\S]*p_sort_order: sortOrder/
  )
  assert.match(
    manager,
    /"update_vendor_product_option_value"[\s\S]*p_value_id: editingId/
  )
  assert.match(
    manager,
    /"delete_vendor_product_option_value"[\s\S]*p_value_id: deleteTarget\.id/
  )
  assert.match(manager, /duplicate_value:/)
  assert.match(manager, /value_in_use:/)
})

test("one-axis and three-axis selections require exactly one value per axis", () => {
  assert.equal(validCombination(["size"], { size: "s" }), true)
  assert.equal(
    validCombination(
      ["waist", "inseam", "colour"],
      { waist: "32", inseam: "30", colour: "navy" }
    ),
    true
  )
  assert.equal(validCombination(["size", "colour"], { size: "m" }), false)
  assert.equal(
    validCombination(["size", "colour"], { size: "same", colour: "same" }),
    false
  )
  assert.match(manager, /selectedIds\.length !== axes\.length/)
  assert.match(manager, /new Set\(selectedIds\)\.size !== selectedIds\.length/)
})

test("variant creation submits explicit selected IDs and never creates a Cartesian product", () => {
  assert.match(
    manager,
    /"create_vendor_product_option_variant"[\s\S]*p_product_id: product\.id[\s\S]*p_value_ids: selectedIds[\s\S]*p_stock: stock/
  )
  assert.match(manager, /Combinations are never generated automatically/)
  assert.match(manager, /configuration\.variants\.length >= 100/)
  assert.match(manager, /duplicate_combination:/)
  assert.doesNotMatch(manager, /cartesian|generateCombinations|createAllCombinations/i)
})

test("combination labels follow authoritative axis position", () => {
  assert.match(
    manager,
    /variant\.selected_value_ids[\s\S]*\.flatMap\(\(valueId\) => \{[\s\S]*const selectedValue = valueById\.get\(valueId\)[\s\S]*return selectedValue \? \[selectedValue\] : \[\][\s\S]*\.sort\(\(left, right\) => left\.axis\.position - right\.axis\.position\)[\s\S]*\.map\(\(\{ value \}\) => value\.display_label\)[\s\S]*\.join\(" · "\)/
  )
})

test("stock values are bounded to PostgreSQL integer range", () => {
  assert.equal(parseStock("0"), 0)
  assert.equal(parseStock("2147483647"), 2_147_483_647)
  assert.equal(parseStock("2147483648"), null)
  assert.equal(parseStock("-1"), null)
  assert.equal(parseStock("1.5"), null)
  assert.match(manager, /MAX_POSTGRES_INTEGER = 2_147_483_647/)
})

test("inventory updates send stock_version and refresh authoritative state", () => {
  assert.match(
    manager,
    /"update_vendor_product_variant_stock"[\s\S]*p_variant_id: variant\.id[\s\S]*p_stock: stock[\s\S]*p_expected_stock_version: variant\.stock_version/
  )
  assert.match(manager, /result\.outcome === "conflict"[\s\S]*refreshConfiguration\(\)/)
  assert.match(
    manager,
    /result\.outcome === "conflict"[\s\S]*refreshConfiguration\(\)[\s\S]*onConflict\?\.\(\)/
  )
  assert.match(
    manager,
    /"Variant stock updated\."[\s\S]*setEditingStockId\(null\)[\s\S]*setEditingStockId\(null\)[\s\S]*setStockDraft\(""\)/
  )
  assert.match(manager, /await refreshConfiguration\(\)/)
  assert.match(manager, /\["updated", "no_change"\]/)
  assert.doesNotMatch(manager, /setConfiguration\([^\n]*stock:/)
})

test("variant deletion is confirmed and version guarded", () => {
  assert.match(manager, /<Dialog open=\{Boolean\(deleteTarget\)\}/)
  assert.match(manager, /kind: "variant", variant, label/)
  assert.match(
    manager,
    /"delete_vendor_product_variant"[\s\S]*p_variant_id: variant\.id[\s\S]*p_expected_stock_version: variant\.stock_version/
  )
  assert.match(manager, /historical_reference:/)
})

test("rapid interactions are serialized by one pending operation gate", () => {
  assert.match(manager, /if \(pendingOperation \|\| requiresRefresh\) return false/)
  assert.match(manager, /setPendingOperation\(key\)/)
  assert.match(manager, /finally \{\s*setPendingOperation\(null\)/)
  assert.match(manager, /disabled=\{Boolean\(pendingOperation\)/)
})

test("product changes remount universal state and reload against the product ID", () => {
  assert.match(
    editPage,
    /key=\{`options:\$\{product\.id\}:\$\{product\.variant_mode\}`\}/
  )
  assert.match(manager, /p_product_id: product\.id/)
  assert.match(manager, /nextConfiguration\.product_id !== product\.id/)
})

test("workflow is responsive and destructive actions are accessible", () => {
  assert.match(manager, /sm:grid-cols-2/)
  assert.match(manager, /lg:grid-cols-3|lg:grid-cols-4/)
  assert.match(manager, /aria-live="polite"/)
  assert.match(manager, /aria-label=\{`Edit \$\{value\.display_label\}`\}/)
  assert.match(manager, /<DialogTitle>/)
  assert.match(manager, /<DialogDescription>/)
  assert.doesNotMatch(manager, /toast\(/)
})

test("legacy modes and ordinary product management remain available", () => {
  assert.match(types, /"none"[\s\S]*"size"[\s\S]*"colour"[\s\S]*"size_colour"[\s\S]*"options"/)
  assert.match(legacyManager, /configure_vendor_product_variant_mode/)
  assert.match(legacyManager, /create_vendor_product_variant/)
  assert.match(editPage, /product\.variant_mode !== "options"/)
  assert.match(productForm, /product\?\.variant_mode === "options"/)
  assert.match(productsTable, /mode === "options"[\s\S]*"Universal options"/)
  assert.match(productsTable, /if \(mode === "size"\)/)
  assert.match(productsTable, /if \(mode === "colour"\)/)
})

test("B3 introduces no customer purchasing publication or payment behavior", () => {
  const changedUi = [manager, editPage, productForm, productsTable].join("\n")
  for (const excluded of [
    "handle-checkout",
    "finalize_paystack_paid_order",
    "authorization_url",
    "price_adjustment",
    "selected_options_snapshot",
  ]) {
    assert.equal(changedUi.toLowerCase().includes(excluded), false, excluded)
  }
  assert.match(manager, /Customer purchasing and publication\s+remain unavailable/)
  assert.doesNotMatch(manager, /is_active:\s*true/)
})
