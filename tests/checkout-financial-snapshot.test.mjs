import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

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

test("browser checkout cannot supply financial or vendor authority", () => {
  const checkoutFields = sourceBetween(
    "const CHECKOUT_FIELDS = new Set([",
    "])\nconst SHIPPING_FIELDS"
  )
  const itemFields = sourceBetween(
    "const ITEM_FIELDS = new Set([",
    "])\nconst NIGERIAN_STATES"
  )

  assert.match(checkoutFields, /"checkout_attempt_id"/u)
  assert.match(checkoutFields, /"shipping_address"/u)
  assert.match(checkoutFields, /"items"/u)
  assert.doesNotMatch(checkoutFields, /price|amount|currency|fee|vendor/iu)
  assert.match(itemFields, /"product_id"/u)
  assert.match(itemFields, /"product_variant_id"/u)
  assert.match(itemFields, /"quantity"/u)
  assert.doesNotMatch(itemFields, /price|amount|currency|fee|vendor/iu)
})

test("trusted RPC is the sole fresh construction and financial authority", () => {
  assert.match(
    source,
    /await supabase\.rpc\("construct_trusted_checkout_order", \{/u
  )
  assert.doesNotMatch(source, /\.from\("products"\)/u)
  assert.doesNotMatch(source, /\.from\("vendors"\)/u)
  assert.doesNotMatch(source, /parsePriceToKobo|parseFeePercentToBps/u)
  assert.doesNotMatch(source, /calculateItemFinancialSnapshot/u)
  assert.doesNotMatch(source, /platform_fee_pct|platform_fee_bps/u)
})

test("Edge function performs no direct checkout construction writes", () => {
  for (const table of ["orders", "checkout_attempts", "order_items"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\.from\\("${table}"\\)\\s*\\.insert`, "u"),
      table
    )
  }
  assert.doesNotMatch(source, /cleanupOrder/u)
  assert.doesNotMatch(source, /\.delete\(\)/u)
})

test("RPC receives only trusted identity, customer, address, expiry, and item inputs", () => {
  const rpcArguments = sourceBetween(
    'await supabase.rpc("construct_trusted_checkout_order", {',
    "    })\n\n  if (constructionError)"
  )
  const expectedArguments = [
    "p_checkout_attempt_id: checkoutAttemptId",
    "p_customer_id: verifiedCustomerId",
    "p_customer_email: customerEmail",
    "p_customer_name: customerName",
    "p_customer_phone: customerPhone",
    "p_shipping_address: shippingAddress",
    "p_request_fingerprint: requestFingerprint",
    "p_expires_at: expiresAt",
    "p_items: items",
  ]
  for (const argument of expectedArguments) {
    assert.ok(rpcArguments.includes(argument), argument)
  }
  assert.doesNotMatch(rpcArguments, /price|amount|fee|vendor|stock/iu)
})

test("Paystack amount and order identity come only from a validated RPC row", () => {
  const parseIndex = source.indexOf("parseTrustedConstructionResult(")
  const orderIndex = source.indexOf("const orderId = construction.orderId", parseIndex)
  const amountIndex = source.indexOf(
    "const paystackAmount = construction.totalAmountKobo",
    orderIndex
  )
  const paystackIndex = source.indexOf(
    '"https://api.paystack.co/transaction/initialize"',
    amountIndex
  )
  assert.ok(parseIndex >= 0)
  assert.ok(orderIndex > parseIndex)
  assert.ok(amountIndex > orderIndex)
  assert.ok(paystackIndex > amountIndex)
  assert.match(source, /amount: paystackAmount/u)
  assert.doesNotMatch(source, /amount: totalKobo/u)
})

test("trusted total is constrained to the installed numeric contract", () => {
  assert.match(source, /const MAX_TRUSTED_TOTAL_KOBO = 999_999_999_999n/u)
  assert.match(
    source,
    /amount < 1n \|\| amount > MAX_TRUSTED_TOTAL_KOBO/u
  )
  assert.match(source, /Number\.isSafeInteger\(safeAmount\)/u)
})

test("reuse is checked before construction and RPC reuse never initializes payment", () => {
  const firstReuse = source.indexOf(
    "const existingAttempt = await existingAttemptResponse("
  )
  const rpc = source.indexOf(
    'await supabase.rpc("construct_trusted_checkout_order", {'
  )
  const already = source.indexOf(
    'if (construction.outcome === "already_constructed")'
  )
  const recovered = source.indexOf(
    "const recoveredAttempt = await existingAttemptResponse(",
    already
  )
  const paystack = source.indexOf(
    '"https://api.paystack.co/transaction/initialize"'
  )
  assert.ok(firstReuse >= 0 && rpc > firstReuse)
  assert.ok(already > rpc && recovered > already)
  assert.ok(paystack > recovered)
  assert.match(
    source.slice(already, paystack),
    /if \(recoveredAttempt\) return recoveredAttempt/u
  )
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
  assert.doesNotMatch(source, /\.update\(\{[^}]*stock/su)
  assert.doesNotMatch(source, /status:\s*"(?:confirmed|fulfilled)"/u)
})

test("authentication, profile, provider response, and success contracts remain", () => {
  assert.match(source, /const MAX_BODY_BYTES = 32 \* 1024/u)
  assert.match(source, /const MAX_ITEMS = 50/u)
  assert.match(source, /const MAX_QUANTITY = 99/u)
  assert.match(source, /await supabase\.auth\.getUser\(accessToken\)/u)
  assert.match(source, /\.from\("customer_profiles"\)/u)
  assert.match(source, /validAuthorizationUrl\(authorizationUrl\)/u)
  assert.match(
    source,
    /order_id: orderId,[\s\S]*reference,[\s\S]*authorization_url: authorizationUrl/u
  )
})
