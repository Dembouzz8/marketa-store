import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { TextEncoder } from "node:util"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const helperFile = "src/lib/order-item-snapshot.ts"
const orderDataFile = "src/lib/order-data-server.ts"
const customerFile = "src/app/(store)/account/orders/page.tsx"
const vendorListFile = "src/app/vendor/orders/page.tsx"
const vendorDetailFile = "src/app/vendor/orders/[id]/page.tsx"
const helperSource = fs.readFileSync(path.join(root, helperFile), "utf8")
const orderDataSource = fs.readFileSync(path.join(root, orderDataFile), "utf8")
const customerSource = fs.readFileSync(path.join(root, customerFile), "utf8")
const vendorListSource = fs.readFileSync(path.join(root, vendorListFile), "utf8")
const vendorDetailSource = fs.readFileSync(path.join(root, vendorDetailFile), "utf8")

function loadHelper() {
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const testModule = { exports: {} }
  const execute = new Function("exports", "module", "TextEncoder", compiled)
  execute(testModule.exports, testModule, TextEncoder)
  return testModule.exports
}

const {
  aggregateOrderItemFinancials,
  formatNairaFromKobo,
  presentOrderItemSnapshot,
} = loadHelper()

const ids = {
  product: "11111111-1111-4111-8111-111111111111",
  vendor: "22222222-2222-4222-8222-222222222222",
  otherVendor: "33333333-3333-4333-8333-333333333333",
  variant: "44444444-4444-4444-8444-444444444444",
  axis1: "55555555-5555-4555-8555-555555555555",
  axis2: "66666666-6666-4666-8666-666666666666",
  value1: "77777777-7777-4777-8777-777777777777",
  value2: "88888888-8888-4888-8888-888888888888",
}

function financialRow(overrides = {}) {
  return {
    quantity: 2,
    product_id: ids.product,
    vendor_id: ids.vendor,
    product_variant_id: null,
    variant_size_snapshot: null,
    variant_colour_snapshot: null,
    variant_options_snapshot: null,
    unit_price: "100.00",
    subtotal: "200.00",
    unit_amount_kobo: "10000",
    gross_amount_kobo: "20000",
    platform_fee_bps: 500,
    platform_fee_amount_kobo: "1000",
    vendor_net_amount_kobo: "19000",
    currency: "NGN",
    financial_contract_version: 2,
    ...overrides,
  }
}

function option(overrides = {}) {
  return {
    axis_id: ids.axis1,
    axis_position: 1,
    axis_display_name: "Colour",
    option_code: "colour",
    value_kind: "colour",
    value_id: ids.value1,
    value_display_label: "Midnight Black",
    numeric_value: null,
    unit_code: null,
    unit_name: null,
    unit_symbol: null,
    size_system_code: null,
    size_system_name: null,
    ...overrides,
  }
}

function generalizedSnapshot(options = [option()], overrides = {}) {
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

function variantRow(overrides = {}) {
  return financialRow({
    product_variant_id: ids.variant,
    ...overrides,
  })
}

test("1. ordinary historical items retain quantity and stored amounts", () => {
  const presentation = presentOrderItemSnapshot(financialRow())
  assert.equal(presentation.quantity, 2)
  assert.equal(presentation.variant.kind, "ordinary")
  assert.equal(presentation.financial.unitAmountKobo, 10000n)
  assert.equal(presentation.financial.grossAmountKobo, 20000n)
})

test("2. legacy size-only snapshots preserve the stored label", () => {
  const presentation = presentOrderItemSnapshot(
    variantRow({ variant_size_snapshot: "XL" })
  )
  assert.equal(presentation.variant.kind, "legacy")
  assert.deepEqual(
    presentation.variant.options.map(({ axisLabel, valueLabel }) => ({
      axisLabel,
      valueLabel,
    })),
    [{ axisLabel: "Size", valueLabel: "XL" }]
  )
})

test("3. legacy colour-only snapshots preserve the stored label", () => {
  const presentation = presentOrderItemSnapshot(
    variantRow({ variant_colour_snapshot: "Forest Green" })
  )
  assert.equal(presentation.variant.kind, "legacy")
  assert.equal(presentation.variant.options[0].axisLabel, "Colour")
  assert.equal(presentation.variant.options[0].valueLabel, "Forest Green")
})

test("4. legacy size-colour snapshots preserve both identities", () => {
  const presentation = presentOrderItemSnapshot(
    variantRow({
      variant_size_snapshot: "42",
      variant_colour_snapshot: "Tan",
    })
  )
  assert.deepEqual(
    presentation.variant.options.map((entry) => entry.axisLabel),
    ["Size", "Colour"]
  )
})

test("5. generalized snapshots use stored axis and value labels", () => {
  const presentation = presentOrderItemSnapshot(
    variantRow({ variant_options_snapshot: generalizedSnapshot() })
  )
  assert.equal(presentation.variant.kind, "generalized")
  assert.equal(presentation.variant.options[0].axisLabel, "Colour")
  assert.equal(presentation.variant.options[0].valueLabel, "Midnight Black")
})

test("6. generalized options preserve axis-position order", () => {
  const options = [
    option(),
    option({
      axis_id: ids.axis2,
      axis_position: 2,
      axis_display_name: "Material",
      option_code: "material",
      value_kind: "label",
      value_id: ids.value2,
      value_display_label: "Linen",
    }),
  ]
  const presentation = presentOrderItemSnapshot(
    variantRow({ variant_options_snapshot: generalizedSnapshot(options) })
  )
  assert.deepEqual(
    presentation.variant.options.map((entry) => entry.axisPosition),
    [1, 2]
  )
})

test("7. supported measurement unit metadata is preserved", () => {
  const measurement = option({
    axis_display_name: "Length",
    option_code: "length",
    value_kind: "measurement",
    value_display_label: "Forty-two centimetres",
    numeric_value: "42",
    unit_code: "centimetre",
    unit_name: "Centimetre",
    unit_symbol: "cm",
  })
  const presentation = presentOrderItemSnapshot(
    variantRow({
      variant_options_snapshot: generalizedSnapshot([measurement]),
    })
  )
  const [stored] = presentation.variant.options
  assert.equal(stored.numericValue, "42")
  assert.equal(stored.unitCode, "centimetre")
  assert.equal(stored.unitName, "Centimetre")
  assert.equal(stored.unitSymbol, "cm")
})

test("8. malformed generalized snapshots are contained", () => {
  const presentation = presentOrderItemSnapshot(
    variantRow({
      variant_options_snapshot: generalizedSnapshot([], {
        schema_version: 99,
      }),
    })
  )
  assert.equal(presentation.variant.kind, "unavailable")
  assert.equal(presentation.variant.fallback, "Variant details unavailable")
})

test("9. missing historical variant metadata is unavailable, not invented", () => {
  const presentation = presentOrderItemSnapshot(variantRow())
  assert.equal(presentation.variant.kind, "unavailable")
  assert.deepEqual(presentation.variant.options, [])
})

test("10. helper never reconstructs snapshots from mutable option tables", () => {
  assert.doesNotMatch(
    helperSource,
    /product_variants|product_option|option_values|\.from\(/u
  )
})

test("11. stored gross amount is the displayed financial authority", () => {
  const presentation = presentOrderItemSnapshot(
    financialRow({ gross_amount_kobo: "20000", current_price: "9999.00" })
  )
  assert.equal(presentation.financial.grossAmountKobo, 20000n)
  assert.equal(formatNairaFromKobo(20000n), "₦200")
})

test("12. stored platform fee remains available independently", () => {
  const presentation = presentOrderItemSnapshot(financialRow())
  assert.equal(presentation.financial.platformFeeBps, 500)
  assert.equal(presentation.financial.platformFeeAmountKobo, 1000n)
})

test("13. stored vendor net remains available independently", () => {
  const presentation = presentOrderItemSnapshot(financialRow())
  assert.equal(presentation.financial.vendorNetAmountKobo, 19000n)
})

test("14. financial aggregation uses exact integer-kobo arithmetic", () => {
  const first = financialRow({
    quantity: 1,
    unit_amount_kobo: "10001",
    gross_amount_kobo: "10001",
    platform_fee_amount_kobo: "501",
    vendor_net_amount_kobo: "9500",
  })
  const second = financialRow({
    quantity: 1,
    unit_amount_kobo: "20002",
    gross_amount_kobo: "20002",
    platform_fee_amount_kobo: "1000",
    vendor_net_amount_kobo: "19002",
  })
  const total = aggregateOrderItemFinancials([first, second])
  assert.equal(total.grossAmountKobo, 30003n)
  assert.equal(total.platformFeeAmountKobo, 1501n)
  assert.equal(total.vendorNetAmountKobo, 28502n)
})

test("15. current vendor fee changes cannot alter recorded earnings", () => {
  const lowCurrentFee = presentOrderItemSnapshot(
    financialRow({ current_vendor_fee_pct: 1 })
  )
  const highCurrentFee = presentOrderItemSnapshot(
    financialRow({ current_vendor_fee_pct: 99 })
  )
  assert.equal(
    lowCurrentFee.financial.vendorNetAmountKobo,
    highCurrentFee.financial.vendorNetAmountKobo
  )
})

test("16. current catalogue price changes cannot alter recorded amounts", () => {
  const lowPrice = presentOrderItemSnapshot(financialRow({ current_price: 1 }))
  const highPrice = presentOrderItemSnapshot(
    financialRow({ current_price: 1_000_000 })
  )
  assert.equal(
    lowPrice.financial.grossAmountKobo,
    highPrice.financial.grossAmountKobo
  )
})

test("17. legacy financial rows use stored unit and subtotal only", () => {
  const presentation = presentOrderItemSnapshot(
    financialRow({
      unit_amount_kobo: null,
      gross_amount_kobo: null,
      platform_fee_bps: null,
      platform_fee_amount_kobo: null,
      vendor_net_amount_kobo: null,
      currency: null,
      financial_contract_version: null,
    })
  )
  assert.equal(presentation.financial.contract, "legacy")
  assert.equal(presentation.financial.unitAmountKobo, 10000n)
  assert.equal(presentation.financial.grossAmountKobo, 20000n)
  assert.equal(presentation.financial.platformFeeAmountKobo, null)
  assert.equal(presentation.financial.vendorNetAmountKobo, null)
})

test("18. missing snapshot amounts never become zero earnings", () => {
  const presentation = presentOrderItemSnapshot(
    financialRow({ gross_amount_kobo: null })
  )
  assert.equal(presentation.financial.contract, "unavailable")
  assert.equal(presentation.financial.grossAmountKobo, null)
  assert.equal(presentation.financial.vendorNetAmountKobo, null)
  assert.equal(formatNairaFromKobo(null), null)
})

test("19. multi-vendor totals aggregate only the selected vendor subset", () => {
  const rows = [
    financialRow(),
    financialRow({
      vendor_id: ids.otherVendor,
      gross_amount_kobo: "90000",
      platform_fee_amount_kobo: "4500",
      vendor_net_amount_kobo: "85500",
    }),
  ]
  const authorizedRows = rows.filter((row) => row.vendor_id === ids.vendor)
  const total = aggregateOrderItemFinancials(authorizedRows)
  assert.equal(total.grossAmountKobo, 20000n)
  assert.equal(total.vendorNetAmountKobo, 19000n)
  assert.match(orderDataSource, /\.eq\("vendor_id", vendorIdentity\.data\)/u)
})

test("20. customer history uses the authenticated server-only boundary", () => {
  assert.match(customerSource, /await getCustomerOrderHistory\(/u)
  assert.match(orderDataSource, /^import "server-only"/u)
  assert.match(orderDataSource, /await client\.auth\.getUser\(\)/u)
  assert.match(orderDataSource, /\.eq\("customer_id", identity\.data\)/u)
  assert.doesNotMatch(
    `${customerSource}\n${orderDataSource.match(/const CUSTOMER_ORDER_FIELDS[\s\S]*?`\n/u)?.[0] ?? ""}`,
    /platform_fee_amount_kobo|vendor_net_amount_kobo/u
  )
})

test("21. vendor history derives and applies authenticated vendor ownership", () => {
  assert.match(vendorListSource, /await getVendorOrderHistory\(\)/u)
  assert.match(vendorDetailSource, /await getVendorOrderDetail\(id\)/u)
  assert.match(orderDataSource, /\.eq\("user_id", userId\)/u)
  assert.match(orderDataSource, /\.eq\("vendor_id", vendorIdentity\.data\)/u)
})

test("22. arbitrary order IDs require an authorized vendor item first", () => {
  const detailFunction = orderDataSource.indexOf("async function getVendorOrderDetail")
  const itemQuery = orderDataSource.indexOf('.from("order_items")', detailFunction)
  const orderIdFilter = orderDataSource.indexOf(
    '.eq("order_id", orderId)',
    itemQuery
  )
  const vendorFilter = orderDataSource.indexOf(
    '.eq("vendor_id", vendorIdentity.data)',
    orderIdFilter
  )
  const emptyGuard = orderDataSource.indexOf(
    'if (itemData.length === 0)',
    vendorFilter
  )
  const orderQuery = orderDataSource.indexOf('.from("orders")', emptyGuard)
  assert.ok(itemQuery >= 0)
  assert.ok(orderIdFilter > itemQuery)
  assert.ok(vendorFilter > orderIdFilter)
  assert.ok(emptyGuard > vendorFilter)
  assert.ok(orderQuery > emptyGuard)
})

test("23. privileged access is centralized and absent from history pages", () => {
  for (const source of [customerSource, vendorListSource, vendorDetailSource]) {
    assert.doesNotMatch(source, /supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY/u)
  }
  assert.match(orderDataSource, /^import "server-only"/u)
  assert.match(orderDataSource, /privilegedClient: supabaseAdmin/u)
  assert.doesNotMatch(orderDataSource, /SUPABASE_SERVICE_ROLE_KEY/u)
})

test("24. accepted D4-1 files remain byte-identical", () => {
  const expected = new Map([
    [
      "supabase/functions/handle-checkout/index.ts",
      "a2416556eae4cab9b4ac98e74ffe2e057db412122f4582b9004e8b826667b12d",
    ],
    [
      "tests/checkout-financial-snapshot.test.mjs",
      "ad7c7fc99717bad95a41604e0c9261a0a934cb16628af39c16e5cb7a098d9534",
    ],
    [
      "tests/trusted-variant-order-construction.test.mjs",
      "e729300b6f811ba8a7ff27115a6a8371d2333eb849f7073181d38189ee3110dd",
    ],
    [
      "tests/trusted-checkout-cutover.test.mjs",
      "edcff67ce135b123d5b92fc5fdf2bcc5fc86211bdce20134d3f6d0e0d57dc8ee",
    ],
    [
      "tests/product-variants-backend.test.mjs",
      "50388cb1048c61171d90eba8c47f627853d7c5b6b7019382196d130d4b524a56",
    ],
    [
      "tests/product-variants-foundation.test.mjs",
      "74ff7b084d81b135435762f0ee38c0168de8987395ca4a2f7336042fd9ce16c9",
    ],
  ])

  for (const [file, hash] of expected) {
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, file)))
      .digest("hex")
    assert.equal(actual, hash, file)
  }
})
