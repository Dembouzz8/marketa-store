import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionFile = "supabase/functions/handle-checkout/index.ts"
const source = fs.readFileSync(path.join(root, functionFile), "utf8")

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex + start.length, endIndex)
}

function loadMoneyHelpers() {
  const helperSource = sourceBetween(
    "// OPS_2B2B_MONEY_HELPERS_START",
    "// OPS_2B2B_MONEY_HELPERS_END"
  )
  const instrumented = `
    const MAX_QUANTITY = 99
    ${helperSource}
    globalThis.__moneyHelpers = {
      parsePriceToKobo,
      parseFeePercentToBps,
      calculateItemFinancialSnapshot,
      koboToNairaDecimal,
      isRepresentableNumeric12_2Kobo,
      bigintToSafeNumber,
    }
  `
  const compiled = ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const context = {}
  vm.runInNewContext(compiled, context, { filename: functionFile })
  return context.__moneyHelpers
}

const helpers = loadMoneyHelpers()

test("reads authoritative prices and vendor fees as exact server-side decimals", () => {
  assert.match(
    source,
    /\.from\("products"\)\s*\.select\("id, vendor_id, price_text:price::text, stock, is_active"\)/
  )
  assert.match(
    source,
    /\.from\("vendors"\)\s*\.select\("id, is_active, platform_fee_pct_text:platform_fee_pct::text"\)/
  )
  assert.match(source, /parseFeePercentToBps\([\s\S]*platform_fee_pct_text/)
  assert.doesNotMatch(
    source,
    /const\s+platformFee(?:Bps|Pct)\s*=\s*(?:500|1000)\b/
  )
  assert.doesNotMatch(source, /platform_fee_pct_text\s*\?\?/)
})

test("browser checkout contract cannot supply price, fee, or financial fields", () => {
  const checkoutFields = sourceBetween(
    "const CHECKOUT_FIELDS = new Set([",
    "])\nconst SHIPPING_FIELDS"
  )
  const itemFields = sourceBetween(
    "const ITEM_FIELDS = new Set([",
    "])\nconst NIGERIAN_STATES"
  )

  assert.match(checkoutFields, /"checkout_attempt_id"/)
  assert.match(checkoutFields, /"shipping_address"/)
  assert.match(checkoutFields, /"items"/)
  assert.doesNotMatch(checkoutFields, /price|amount|currency|fee|vendor/i)
  assert.match(itemFields, /"product_id"/)
  assert.match(itemFields, /"quantity"/)
  assert.doesNotMatch(itemFields, /price|amount|currency|fee|vendor/i)
  assert.match(source, /Object\.keys\(value\)\.some\(\(field\) => !CHECKOUT_FIELDS\.has\(field\)\)/)
})

test("price parser converts exact decimal strings to kobo", () => {
  assert.equal(helpers.parsePriceToKobo("1"), 100n)
  assert.equal(helpers.parsePriceToKobo("1.0"), 100n)
  assert.equal(helpers.parsePriceToKobo("1.01"), 101n)
  assert.equal(helpers.parsePriceToKobo("19999.99"), 1999999n)
  assert.equal(helpers.koboToNairaDecimal(101n), "1.01")
  assert.equal(helpers.koboToNairaDecimal(1999999n), "19999.99")
})

test("price parser rejects malformed, nonpositive, and inexact values", () => {
  for (const value of [
    1,
    null,
    "",
    "0",
    "0.00",
    "-1.00",
    "+1.00",
    "01.00",
    "1.001",
    "1e2",
    "NaN",
    "Infinity",
    " 1.00",
    "1.00 ",
  ]) {
    assert.equal(helpers.parsePriceToKobo(value), null, String(value))
  }
  assert.doesNotMatch(source, /Number\(product\.price\)/)
  assert.doesNotMatch(source, /Math\.round\(unitPrice\s*\*\s*100\)/)
})

test("fee parser converts exact percentages to basis points without fallback", () => {
  assert.equal(helpers.parseFeePercentToBps("0"), 0n)
  assert.equal(helpers.parseFeePercentToBps("4.25"), 425n)
  assert.equal(helpers.parseFeePercentToBps("5.00"), 500n)
  assert.equal(helpers.parseFeePercentToBps("10.00"), 1000n)
  assert.equal(helpers.parseFeePercentToBps("100.00"), 10000n)

  for (const value of [
    null,
    5,
    "-1",
    "100.01",
    "4.251",
    "5e0",
    " 5.00",
  ]) {
    assert.equal(helpers.parseFeePercentToBps(value), null, String(value))
  }
})

test("item snapshots use integer multiplication and deterministic half-up fees", () => {
  const oneOhOne = helpers.calculateItemFinancialSnapshot(101n, 1, 500n)
  assert.equal(oneOhOne.unit_amount_kobo, 101n)
  assert.equal(oneOhOne.gross_amount_kobo, 101n)
  assert.equal(oneOhOne.platform_fee_amount_kobo, 5n)
  assert.equal(oneOhOne.vendor_net_amount_kobo, 96n)

  const nineteenNinetyNine = helpers.calculateItemFinancialSnapshot(
    1999n,
    1,
    425n
  )
  assert.equal(nineteenNinetyNine.gross_amount_kobo, 1999n)
  assert.equal(nineteenNinetyNine.platform_fee_amount_kobo, 85n)
  assert.equal(nineteenNinetyNine.vendor_net_amount_kobo, 1914n)

  const quantity = helpers.calculateItemFinancialSnapshot(101n, 3, 500n)
  assert.equal(quantity.gross_amount_kobo, 303n)
  assert.equal(quantity.platform_fee_amount_kobo, 15n)
  assert.equal(quantity.vendor_net_amount_kobo, 288n)

  const halfUp = helpers.calculateItemFinancialSnapshot(1n, 1, 5000n)
  assert.equal(halfUp.platform_fee_amount_kobo, 1n)
})

test("zero and full fee rates preserve gross equals fee plus vendor net", () => {
  const zero = helpers.calculateItemFinancialSnapshot(12345n, 2, 0n)
  assert.equal(zero.gross_amount_kobo, 24690n)
  assert.equal(zero.platform_fee_amount_kobo, 0n)
  assert.equal(zero.vendor_net_amount_kobo, 24690n)
  assert.equal(
    zero.gross_amount_kobo,
    zero.platform_fee_amount_kobo + zero.vendor_net_amount_kobo
  )

  const full = helpers.calculateItemFinancialSnapshot(12345n, 2, 10000n)
  assert.equal(full.platform_fee_amount_kobo, 24690n)
  assert.equal(full.vendor_net_amount_kobo, 0n)
  assert.equal(
    full.gross_amount_kobo,
    full.platform_fee_amount_kobo + full.vendor_net_amount_kobo
  )
})

test("invalid arithmetic inputs and unsafe provider totals fail closed", () => {
  assert.equal(helpers.calculateItemFinancialSnapshot(0n, 1, 500n), null)
  assert.equal(helpers.calculateItemFinancialSnapshot(100n, 0, 500n), null)
  assert.equal(helpers.calculateItemFinancialSnapshot(100n, 100, 500n), null)
  assert.equal(helpers.calculateItemFinancialSnapshot(100n, 1, -1n), null)
  assert.equal(helpers.calculateItemFinancialSnapshot(100n, 1, 10001n), null)
  assert.equal(
    helpers.bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER
  )
  assert.equal(
    helpers.bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    null
  )
  assert.match(source, /const paystackAmount = bigintToSafeNumber\(totalKobo\)/)
  assert.match(source, /paystackAmount === null/)
})

test("numeric(12,2) storage range is enforced before order insertion", () => {
  assert.equal(helpers.isRepresentableNumeric12_2Kobo(999999999999n), true)
  assert.equal(helpers.isRepresentableNumeric12_2Kobo(1000000000000n), false)
  assert.equal(helpers.isRepresentableNumeric12_2Kobo(0n), false)

  assert.match(
    source,
    /const MAX_NUMERIC_12_2_KOBO = 999_999_999_999n/
  )
  const rangeCheckIndex = source.indexOf(
    "!isRepresentableNumeric12_2Kobo(totalKobo)"
  )
  const orderInsertIndex = source.indexOf('.from("orders")\n    .insert({')
  assert.ok(rangeCheckIndex >= 0)
  assert.ok(orderInsertIndex > rangeCheckIndex)
})

test("order total is the exact sum of item gross amounts", () => {
  assert.match(source, /let totalKobo = 0n/)
  assert.match(source, /totalKobo \+= snapshot\.gross_amount_kobo/)
  assert.match(source, /total_amount: koboToNairaDecimal\(totalKobo\)/)
  assert.match(source, /total_amount_kobo: totalKobo\.toString\(\)/)
})

test("pending order insert writes the complete V2 order snapshot", () => {
  const orderInsert = sourceBetween(
    '.from("orders")\n    .insert({',
    '    })\n    .select("id")'
  )
  assert.match(orderInsert, /status: "pending"/)
  assert.match(orderInsert, /total_amount: koboToNairaDecimal\(totalKobo\)/)
  assert.match(orderInsert, /total_amount_kobo: totalKobo\.toString\(\)/)
  assert.match(orderInsert, /currency: "NGN"/)
  assert.match(orderInsert, /financial_contract_version: 2/)
  assert.doesNotMatch(orderInsert, /payment_finalized_at/)
})

test("order item insert writes every V2 financial snapshot field", () => {
  const orderItems = sourceBetween(
    "const orderItems = validatedItems.map((item) => ({",
    "  }))\n  const { error: itemsError }"
  )
  for (const field of [
    "unit_price",
    "subtotal",
    "unit_amount_kobo",
    "gross_amount_kobo",
    "platform_fee_bps",
    "platform_fee_amount_kobo",
    "vendor_net_amount_kobo",
    "currency",
    "financial_contract_version",
  ]) {
    assert.match(orderItems, new RegExp(`${field}:`), field)
  }
  assert.match(orderItems, /unit_amount_kobo\.toString\(\)/)
  assert.match(orderItems, /gross_amount_kobo\.toString\(\)/)
  assert.match(orderItems, /platform_fee_amount_kobo\.toString\(\)/)
  assert.match(orderItems, /vendor_net_amount_kobo\.toString\(\)/)
})

test("Paystack initialization uses a safe number and explicit NGN currency", () => {
  const paystackBody = sourceBetween(
    "body: JSON.stringify({",
    "        }),\n      }\n    )"
  )
  assert.match(paystackBody, /email: customerEmail/)
  assert.match(paystackBody, /amount: paystackAmount/)
  assert.match(paystackBody, /currency: "NGN"/)
  assert.doesNotMatch(paystackBody, /amount: totalKobo/)
})

test("existing checkout attempts are resolved before fresh product and fee reads", () => {
  const reuseIndex = source.indexOf(
    "const existingAttempt = await existingAttemptResponse("
  )
  const reuseReturnIndex = source.indexOf(
    "if (existingAttempt) return existingAttempt"
  )
  const productReadIndex = source.indexOf('.from("products")', reuseReturnIndex)
  const vendorReadIndex = source.indexOf('.from("vendors")', productReadIndex)

  assert.ok(reuseIndex >= 0)
  assert.ok(reuseReturnIndex > reuseIndex)
  assert.ok(productReadIndex > reuseReturnIndex)
  assert.ok(vendorReadIndex > productReadIndex)
  assert.doesNotMatch(
    sourceBetween(
      "async function createRequestFingerprint(",
      "type CheckoutSupabaseClient"
    ),
    /price|amount|currency|fee|vendor_id|platform/i
  )
})

test("all products, vendors, prices, fees, and totals are validated before pending writes", () => {
  const orderInsertIndex = source.indexOf('.from("orders")\n    .insert({')
  for (const prerequisite of [
    '.from("products")',
    '.from("vendors")',
    "parseFeePercentToBps(",
    "parsePriceToKobo(",
    "calculateItemFinancialSnapshot(",
    "isRepresentableNumeric12_2Kobo(totalKobo)",
    "bigintToSafeNumber(totalKobo)",
  ]) {
    const index = source.lastIndexOf(prerequisite, orderInsertIndex)
    assert.ok(index >= 0 && index < orderInsertIndex, prerequisite)
  }
})

test("checkout does not finalize payments, create ledgers, or mutate stock", () => {
  for (const forbiddenTable of [
    "payments",
    "payment_events",
    "payout_ledger",
    "events_ledger",
  ]) {
    assert.equal(source.includes(`.from("${forbiddenTable}")`), false)
  }
  assert.equal(source.includes("finalize_paystack_paid_order"), false)
  assert.equal(source.includes("decrement_stock"), false)
  assert.doesNotMatch(source, /\.update\(\{[^}]*stock/s)
  assert.doesNotMatch(source, /status:\s*"(?:confirmed|fulfilled)"/)
})

test("existing validation, cleanup, insertion order, and response contracts remain", () => {
  assert.match(source, /const MAX_BODY_BYTES = 32 \* 1024/)
  assert.match(source, /const MAX_ITEMS = 50/)
  assert.match(source, /const MAX_QUANTITY = 99/)
  assert.match(source, /await supabase\.auth\.getUser\(accessToken\)/)
  assert.match(source, /\.from\("customer_profiles"\)/)
  assert.match(source, /const cleanupOrder = async \(\) =>/)

  const orderIndex = source.indexOf('.from("orders")\n    .insert({')
  const attemptIndex = source.indexOf('.from("checkout_attempts")\n    .insert({', orderIndex)
  const itemIndex = source.indexOf('.from("order_items")\n    .insert(orderItems)', attemptIndex)
  const paystackIndex = source.indexOf(
    'fetch(\n      "https://api.paystack.co/transaction/initialize"',
    itemIndex
  )
  assert.ok(orderIndex >= 0)
  assert.ok(attemptIndex > orderIndex)
  assert.ok(itemIndex > attemptIndex)
  assert.ok(paystackIndex > itemIndex)
  assert.match(
    source,
    /order_id: orderId,[\s\S]*reference,[\s\S]*authorization_url: authorizationUrl/
  )
})
