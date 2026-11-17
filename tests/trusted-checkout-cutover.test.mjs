import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { TextEncoder } from "node:util"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionFile = "supabase/functions/handle-checkout/index.ts"
const source = fs.readFileSync(path.join(root, functionFile), "utf8")

function sourceBetween(start, end, includeStart = false) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(includeStart ? startIndex : startIndex + start.length, endIndex)
}

function loadContract() {
  const constants = sourceBetween(
    "const MAX_BODY_BYTES",
    "const corsHeaders",
    true
  )
  const types = sourceBetween(
    "type CheckoutErrorCode",
    "function jsonHeaders",
    true
  )
  const primitives = sourceBetween(
    "function isPlainObject",
    "// D4_TRUSTED_CHECKOUT_CONTRACT_START",
    true
  )
  const contract = sourceBetween(
    "// D4_TRUSTED_CHECKOUT_CONTRACT_START",
    "// D4_TRUSTED_CHECKOUT_CONTRACT_END"
  )
  const validation = sourceBetween(
    "function validateCheckout",
    "async function readBoundedBody",
    true
  )
  const fingerprint = sourceBetween(
    "async function createRequestFingerprint",
    "type CheckoutSupabaseClient",
    true
  )
  const instrumented = `
    ${constants}
    ${types}
    ${primitives}
    ${contract}
    ${validation}
    ${fingerprint}
    globalThis.__contract = {
      validateJson: (json) => validateCheckout(JSON.parse(json)),
      variantAllowedJson: (json) => variantCheckoutAllowed(JSON.parse(json)),
      sortJson: (json) => JSON.stringify(JSON.parse(json).sort(compareCheckoutItems)),
      parseResultJson: (json, count) =>
        parseTrustedConstructionResult(JSON.parse(json), count),
      classifyErrorJson: (json) =>
        classifyTrustedConstructionError(JSON.parse(json)),
      fingerprintJson: (checkoutJson, customerJson) =>
        createRequestFingerprint(JSON.parse(checkoutJson), JSON.parse(customerJson)),
    }
  `
  const compiled = ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const context = { crypto: globalThis.crypto, TextEncoder }
  vm.runInNewContext(compiled, context, { filename: functionFile })
  return context.__contract
}

const contract = loadContract()
const productA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const productB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const variantA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const variantB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const checkoutAttempt = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const orderId = "ffffffff-ffff-4fff-8fff-ffffffffffff"

function checkout(items) {
  return JSON.stringify({
    checkout_attempt_id: checkoutAttempt,
    shipping_address: {
      address: "1 Market Street",
      city: "Lagos",
      state: "Lagos",
    },
    items,
  })
}

function loadHandler(options = {}) {
  const calls = {
    auth: 0,
    fetch: [],
    rpc: [],
    updates: [],
  }
  const attemptReads = [...(options.attemptReads ?? [])]
  const orderReads = [...(options.orderReads ?? [])]
  let capturedHandler
  let context

  const realmValue = (value) =>
    vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context)
  const nextRead = (reads) =>
    realmValue(reads.shift() ?? { data: null, error: null })

  const supabase = {
    auth: {
      async getUser() {
        calls.auth += 1
        return realmValue(
          options.auth ?? {
            data: {
              user: {
                id: "11111111-1111-4111-8111-111111111111",
                email: "buyer@example.com",
              },
            },
            error: null,
          }
        )
      },
    },
    from(table) {
      let updatePayload = null
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        update(payload) {
          updatePayload = payload
          calls.updates.push({ table, payload })
          return query
        },
        async maybeSingle() {
          if (table === "customer_profiles") {
            return realmValue(
              options.profile ?? {
                data: { full_name: "Ada Buyer", phone: "+2348000000000" },
                error: null,
              }
            )
          }
          if (table === "checkout_attempts") return nextRead(attemptReads)
          if (table === "orders") return nextRead(orderReads)
          throw new Error(`Unexpected maybeSingle table: ${table}`)
        },
        async single() {
          if (!updatePayload) throw new Error(`Unexpected single table: ${table}`)
          if (table === "orders") {
            return realmValue(
              options.orderUpdate ?? { data: { id: orderId }, error: null }
            )
          }
          if (table === "checkout_attempts") {
            return realmValue(
              options.attemptUpdate ?? {
                data: { checkout_attempt_id: checkoutAttempt },
                error: null,
              }
            )
          }
          throw new Error(`Unexpected update table: ${table}`)
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      return realmValue(
        options.rpc ?? {
          data: [
            {
              construction_outcome: "constructed",
              constructed_order_id: orderId,
              constructed_total_amount_kobo: "12345",
              constructed_item_count: 1,
            },
          ],
          error: null,
        }
      )
    },
  }

  const runtimeSource = source.slice(source.indexOf("const MAX_BODY_BYTES"))
  const compiled = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  context = vm.createContext({
    crypto: globalThis.crypto,
    TextDecoder,
    TextEncoder,
    Request,
    Response,
    Headers,
    URL,
    console: { error() {} },
    createClient: () => supabase,
    Deno: {
      env: {
        get(name) {
          return {
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
            STOREFRONT_URL: "https://marketa.example",
            PAYSTACK_SECRET_KEY: "test-paystack-key",
          }[name]
        },
      },
    },
    serve(handler) {
      capturedHandler = handler
    },
    async fetch(url, init) {
      calls.fetch.push({ url, init })
      if (options.paystackThrows) throw new Error("simulated provider ambiguity")
      return {
        ok: options.paystackOk ?? true,
        async json() {
          return realmValue(
            options.paystackPayload ?? {
              status: true,
              data: {
                reference: "TEST_reference_1",
                authorization_url: "https://checkout.paystack.test/authorize",
              },
            }
          )
        },
      }
    },
  })
  vm.runInContext(compiled, context, { filename: functionFile })

  return {
    calls,
    async post(body) {
      const response = await capturedHandler(
        new Request("https://functions.example/handle-checkout", {
          method: "POST",
          headers: {
            authorization: "Bearer test-access-token",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        })
      )
      return { response, payload: await response.json() }
    },
  }
}

test("strict item identities accept ordinary and distinct variant lines", () => {
  const ordinary = contract.validateJson(
    checkout([{ product_id: productA, quantity: 2 }])
  )
  assert.equal(ordinary.ok, true)
  assert.equal(Object.hasOwn(ordinary.value.items[0], "product_variant_id"), false)

  const variants = contract.validateJson(
    checkout([
      { product_id: productA, product_variant_id: variantB, quantity: 1 },
      { product_id: productA, product_variant_id: variantA, quantity: 2 },
    ])
  )
  assert.equal(variants.ok, true)
  assert.equal(variants.value.items.length, 2)
  assert.equal(variants.value.items[0].product_variant_id, variantA)
  assert.equal(variants.value.items[1].product_variant_id, variantB)

  const normalized = contract.validateJson(
    checkout([
      {
        product_id: productA.toUpperCase(),
        product_variant_id: variantA.toUpperCase(),
        quantity: 1,
      },
    ])
  )
  assert.equal(normalized.ok, true)
  assert.equal(normalized.value.items[0].product_id, productA)
  assert.equal(normalized.value.items[0].product_variant_id, variantA)
})

test("strict item identities reject exact duplicates and malformed variants", () => {
  const duplicate = contract.validateJson(
    checkout([
      { product_id: productA, product_variant_id: variantA, quantity: 1 },
      { product_id: productA, product_variant_id: variantA, quantity: 2 },
    ])
  )
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, "DUPLICATE_PRODUCT")

  for (const product_variant_id of [null, "", "not-a-uuid", 4]) {
    const result = contract.validateJson(
      checkout([{ product_id: productA, product_variant_id, quantity: 1 }])
    )
    assert.equal(result.ok, false, String(product_variant_id))
    assert.equal(result.code, "INVALID_ITEMS")
  }
})

test("malformed requests and client financial fields are rejected", () => {
  for (const value of [null, [], "checkout", 4]) {
    const result = contract.validateJson(JSON.stringify(value))
    assert.equal(result.ok, false)
    assert.equal(result.code, "INVALID_REQUEST")
  }

  for (const financialField of [
    ["price", 100],
    ["total_amount", 100],
    ["vendor_id", productB],
    ["platform_fee_bps", 500],
    ["variant_options_snapshot", {}],
  ]) {
    const [field, value] = financialField
    const result = contract.validateJson(
      checkout([{ product_id: productA, quantity: 1, [field]: value }])
    )
    assert.equal(result.ok, false, field)
    assert.equal(result.code, "INVALID_ITEMS")
  }
})

test("variant purchasing remains fail-closed while ordinary items pass the gate", () => {
  assert.equal(
    contract.variantAllowedJson(
      JSON.stringify([{ product_id: productA, quantity: 1 }])
    ),
    true
  )
  assert.equal(
    contract.variantAllowedJson(
      JSON.stringify([
        { product_id: productA, product_variant_id: variantA, quantity: 1 },
      ])
    ),
    false
  )
  assert.match(source, /const VARIANT_CHECKOUT_ENABLED = false/u)

  const gateIndex = source.indexOf("if (!variantCheckoutAllowed(items))")
  const clientIndex = source.indexOf("const supabase = createClient(")
  const rpcIndex = source.indexOf(
    'await supabase.rpc("construct_trusted_checkout_order", {'
  )
  assert.ok(gateIndex >= 0 && clientIndex > gateIndex && rpcIndex > clientIndex)
})

test("blocked variant requests call neither the RPC nor Paystack", async () => {
  const harness = loadHandler()
  const { response, payload } = await harness.post(
    JSON.parse(
      checkout([
        { product_id: productA, product_variant_id: variantA, quantity: 1 },
      ])
    )
  )
  assert.equal(response.status, 400)
  assert.equal(payload.error.code, "INVALID_ITEMS")
  assert.equal(harness.calls.auth, 0)
  assert.equal(harness.calls.rpc.length, 0)
  assert.equal(harness.calls.fetch.length, 0)
})

test("constructed outcome supplies exact trusted RPC arguments and initializes once", async () => {
  const body = JSON.parse(checkout([{ product_id: productA, quantity: 1 }]))
  const harness = loadHandler()
  const { response, payload } = await harness.post(body)

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.order_id, orderId)
  assert.equal(payload.data.reused, false)
  assert.equal(harness.calls.rpc.length, 1)
  assert.equal(harness.calls.fetch.length, 1)

  const [{ name, args }] = harness.calls.rpc
  assert.equal(name, "construct_trusted_checkout_order")
  assert.equal(args.p_checkout_attempt_id, checkoutAttempt)
  assert.equal(args.p_customer_id, "11111111-1111-4111-8111-111111111111")
  assert.equal(args.p_customer_email, "buyer@example.com")
  assert.equal(args.p_customer_name, "Ada Buyer")
  assert.equal(args.p_customer_phone, "+2348000000000")
  assert.equal(JSON.stringify(args.p_shipping_address), JSON.stringify(body.shipping_address))
  assert.equal(JSON.stringify(args.p_items), JSON.stringify(body.items))
  assert.match(args.p_request_fingerprint, /^[0-9a-f]{64}$/u)
  assert.ok(Date.parse(args.p_expires_at) > Date.now())

  const paymentBody = JSON.parse(harness.calls.fetch[0].init.body)
  assert.equal(paymentBody.amount, 12345)
  assert.equal(paymentBody.email, "buyer@example.com")
  assert.equal(paymentBody.currency, "NGN")
})

test("already_constructed resolves stored authorization without new Paystack", async () => {
  const body = JSON.parse(checkout([{ product_id: productA, quantity: 1 }]))
  const fingerprint = await contract.fingerprintJson(
    JSON.stringify({
      shipping_address: body.shipping_address,
      items: body.items,
    }),
    JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
      name: "Ada Buyer",
      phone: "+2348000000000",
    })
  )
  const attempt = {
    checkout_attempt_id: checkoutAttempt,
    order_id: orderId,
    request_fingerprint: fingerprint,
    payment_reference: "TEST_existing_reference",
    payment_authorization_url: "https://checkout.paystack.test/existing",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
  const order = {
    id: orderId,
    customer_id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    payment_ref: "TEST_existing_reference",
  }
  const harness = loadHandler({
    attemptReads: [
      { data: null, error: null },
      { data: attempt, error: null },
    ],
    orderReads: [
      { data: null, error: null },
      { data: order, error: null },
    ],
    rpc: {
      data: [
        {
          construction_outcome: "already_constructed",
          constructed_order_id: orderId,
          constructed_total_amount_kobo: "12345",
          constructed_item_count: 1,
        },
      ],
      error: null,
    },
  })
  const { response, payload } = await harness.post(body)
  assert.equal(response.status, 200)
  assert.equal(payload.data.reused, true)
  assert.equal(payload.data.reference, "TEST_existing_reference")
  assert.equal(harness.calls.rpc.length, 1)
  assert.equal(harness.calls.fetch.length, 0)
})

test("malformed RPC output and controlled RPC errors never reach Paystack", async () => {
  const body = JSON.parse(checkout([{ product_id: productA, quantity: 1 }]))
  const malformed = loadHandler({ rpc: { data: [], error: null } })
  const malformedResult = await malformed.post(body)
  assert.equal(malformedResult.response.status, 503)
  assert.equal(malformedResult.payload.error.code, "SERVICE_UNAVAILABLE")
  assert.equal(malformed.calls.fetch.length, 0)

  const expired = loadHandler({
    rpc: {
      data: null,
      error: { code: "23514", message: "Checkout attempt has expired." },
    },
  })
  const expiredResult = await expired.post(body)
  assert.equal(expiredResult.response.status, 409)
  assert.equal(expiredResult.payload.error.code, "CHECKOUT_EXPIRED")
  assert.equal(expired.calls.fetch.length, 0)
})

test("canonical ordering is product then ordinary-before-variant identity", () => {
  const sorted = JSON.parse(
    contract.sortJson(
      JSON.stringify([
        { product_id: productB, quantity: 1 },
        { product_id: productA, product_variant_id: variantB, quantity: 1 },
        { product_id: productA, product_variant_id: variantA, quantity: 1 },
        { product_id: productA, quantity: 1 },
      ])
    )
  )
  assert.deepEqual(
    sorted.map((item) => item.product_variant_id ?? "ordinary"),
    ["ordinary", variantA, variantB, "ordinary"]
  )
  assert.equal(sorted[3].product_id, productB)
})

test("ordinary checkout fingerprint remains byte-for-byte compatible", async () => {
  const fingerprint = await contract.fingerprintJson(
    JSON.stringify({
      shipping_address: {
        address: "1 Market Street",
        city: "Lagos",
        state: "Lagos",
      },
      items: [{ product_id: productA, quantity: 2 }],
    }),
    JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
      name: "Ada Buyer",
      phone: "+2348000000000",
    })
  )
  assert.equal(
    fingerprint,
    "2d448ad233bc5e52366aaaca3a0331974dc88f2e8b4b0264ab27ab5ee4513968"
  )
})

test("changed variant identities produce different server fingerprints", async () => {
  const customer = JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111",
    email: "buyer@example.com",
    name: "Ada Buyer",
    phone: "+2348000000000",
  })
  const checkoutWith = (product_variant_id) =>
    JSON.stringify({
      shipping_address: {
        address: "1 Market Street",
        city: "Lagos",
        state: "Lagos",
      },
      items: [{ product_id: productA, product_variant_id, quantity: 1 }],
    })

  const first = await contract.fingerprintJson(checkoutWith(variantA), customer)
  const second = await contract.fingerprintJson(checkoutWith(variantB), customer)
  assert.notEqual(first, second)
})

test("trusted construction parser accepts only one complete bounded row", () => {
  for (const outcome of ["constructed", "already_constructed"]) {
    const parsed = contract.parseResultJson(
      JSON.stringify([
        {
          construction_outcome: outcome,
          constructed_order_id: orderId,
          constructed_total_amount_kobo: "12345",
          constructed_item_count: 2,
        },
      ]),
      2
    )
    assert.equal(parsed.outcome, outcome)
    assert.equal(parsed.orderId, orderId)
    assert.equal(parsed.totalAmountKobo, 12345)
  }

  for (const rows of [
    [],
    [{ construction_outcome: "constructed" }],
    [
      {
        construction_outcome: "unknown",
        constructed_order_id: orderId,
        constructed_total_amount_kobo: "12345",
        constructed_item_count: 2,
      },
    ],
    [
      {
        construction_outcome: "constructed",
        constructed_order_id: orderId,
        constructed_total_amount_kobo: "1000000000000",
        constructed_item_count: 2,
      },
    ],
  ]) {
    assert.equal(contract.parseResultJson(JSON.stringify(rows), 2), null)
  }
})

test("database failures map to controlled responses without leaking details", () => {
  const cases = [
    ["23505", "anything", "CHECKOUT_ATTEMPT_CONFLICT"],
    ["23514", "Checkout attempt has expired.", "CHECKOUT_EXPIRED"],
    [
      "23514",
      "Checkout attempt requires reconciliation.",
      "CHECKOUT_INITIALIZING",
    ],
    ["23514", "A checkout vendor is unavailable.", "VENDOR_UNAVAILABLE"],
    [
      "23514",
      "Ordinary checkout inventory is unavailable.",
      "INSUFFICIENT_STOCK",
    ],
    ["22003", "raw money detail", "INVALID_PRODUCT_PRICE"],
    ["22023", "raw input detail", "INVALID_ITEMS"],
    ["XX000", "secret database detail", "SERVICE_UNAVAILABLE"],
  ]
  for (const [code, message, expected] of cases) {
    const result = contract.classifyErrorJson(JSON.stringify({ code, message }))
    assert.equal(result.code, expected)
    assert.notEqual(result.message, message)
  }
})

test("existing replay, attempt conflict, and attempt expiry stay authoritative", async () => {
  const body = JSON.parse(checkout([{ product_id: productA, quantity: 1 }]))
  const fingerprint = await contract.fingerprintJson(
    JSON.stringify({ shipping_address: body.shipping_address, items: body.items }),
    JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
      name: "Ada Buyer",
      phone: "+2348000000000",
    })
  )
  const baseAttempt = {
    checkout_attempt_id: checkoutAttempt,
    order_id: orderId,
    request_fingerprint: fingerprint,
    payment_reference: "TEST_existing_reference",
    payment_authorization_url: "https://checkout.paystack.test/existing",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
  const pendingOrder = {
    id: orderId,
    customer_id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    payment_ref: "TEST_existing_reference",
  }

  const replay = loadHandler({
    attemptReads: [{ data: baseAttempt, error: null }],
    orderReads: [{ data: pendingOrder, error: null }],
  })
  const replayResult = await replay.post(body)
  assert.equal(replayResult.response.status, 200)
  assert.equal(replayResult.payload.data.reused, true)
  assert.equal(replay.calls.rpc.length, 0)
  assert.equal(replay.calls.fetch.length, 0)

  const conflict = loadHandler({
    attemptReads: [
      {
        data: { ...baseAttempt, request_fingerprint: "0".repeat(64) },
        error: null,
      },
    ],
  })
  const conflictResult = await conflict.post(body)
  assert.equal(conflictResult.response.status, 409)
  assert.equal(conflictResult.payload.error.code, "CHECKOUT_ATTEMPT_CONFLICT")
  assert.equal(conflict.calls.rpc.length, 0)

  const expired = loadHandler({
    attemptReads: [
      {
        data: {
          ...baseAttempt,
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      },
    ],
    orderReads: [{ data: pendingOrder, error: null }],
  })
  const expiredResult = await expired.post(body)
  assert.equal(expiredResult.response.status, 409)
  assert.equal(expiredResult.payload.error.code, "CHECKOUT_EXPIRED")
  assert.equal(expired.calls.rpc.length, 0)
})

test("provider and authorization-persistence ambiguity remain conservative", async () => {
  const body = JSON.parse(checkout([{ product_id: productA, quantity: 1 }]))
  for (const options of [
    { paystackThrows: true },
    { orderUpdate: { data: null, error: { code: "XX000" } } },
    { attemptUpdate: { data: null, error: { code: "XX000" } } },
  ]) {
    const harness = loadHandler(options)
    const { response, payload } = await harness.post(body)
    assert.equal(response.status, 503)
    assert.equal(payload.error.code, "CHECKOUT_INITIALIZING")
    assert.equal(harness.calls.rpc.length, 1)
    assert.equal(harness.calls.fetch.length, 1)
  }
})

test("only constructed output can reach new Paystack initialization", () => {
  const outcomeBranch = source.indexOf(
    'if (construction.outcome === "already_constructed")'
  )
  const constructedOrder = source.indexOf(
    "const orderId = construction.orderId",
    outcomeBranch
  )
  const paystack = source.indexOf(
    '"https://api.paystack.co/transaction/initialize"',
    constructedOrder
  )
  assert.ok(outcomeBranch >= 0)
  assert.ok(constructedOrder > outcomeBranch && paystack > constructedOrder)
  assert.match(
    source.slice(outcomeBranch, constructedOrder),
    /if \(recoveredAttempt\) return recoveredAttempt[\s\S]*return errorResponse/u
  )
})

test("cutover contains no direct construction or legacy financial path", () => {
  assert.doesNotMatch(source, /\.from\("products"\)|\.from\("vendors"\)/u)
  assert.doesNotMatch(
    source,
    /\.from\("(?:orders|checkout_attempts|order_items)"\)\s*\.insert/u
  )
  assert.doesNotMatch(
    source,
    /parsePriceToKobo|calculateItemFinancialSnapshot|cleanupOrder/u
  )
})
