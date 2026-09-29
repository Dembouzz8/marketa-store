import assert from "node:assert/strict"
import { createHash, createHmac, webcrypto } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionFile = "supabase/functions/paystack-webhook/index.ts"
const source = fs.readFileSync(path.join(root, functionFile), "utf8")
const webhookSecret = "test-webhook-secret"
const serviceRoleKey = "test-service-role-key"
const orderId = "11111111-1111-4111-8111-111111111111"
const largeTransactionId = "9007199254740993123"
const reference = "MARKETA_test_reference"

function signedPayload({
  event = "charge.success",
  transactionId = largeTransactionId,
  amount = "125050",
  domain = "test",
  status = "success",
  currency = "NGN",
  paidAt = "2026-09-29T12:34:56.000Z",
  extraData = "",
} = {}) {
  return `{"event":"${event}","data":{"id":${transactionId},"reference":"${reference}","status":"${status}","amount":${amount},"currency":"${currency}","paid_at":"${paidAt}","domain":"${domain}"${extraData}}}`
}

function signatureFor(rawBody) {
  return createHmac("sha512", webhookSecret).update(rawBody).digest("hex")
}

function sha256For(rawBody) {
  return createHash("sha256").update(rawBody).digest("hex")
}

function rpcRow(outcome = "FINALIZED", retryable = false, id = orderId) {
  return { outcome, order_id: id, retryable }
}

function createMode(overrides = {}) {
  const mode = {
    env: {
      PAYSTACK_WEBHOOK_SECRET: webhookSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      N8N_PAID_ORDER_WEBHOOK_URL: undefined,
    },
    rpcResults: [{ data: [rpcRow()], error: null }],
    rpcCalls: [],
    tableCalls: [],
    fetchCalls: [],
    timeoutDelays: [],
    clearedTimeouts: 0,
    clientCreations: [],
    logs: [],
    orderResult: {
      data: {
        id: orderId,
        customer_email: "customer@example.test",
        customer_phone: "+2348000000000",
        total_amount: "1250.50",
      },
      error: null,
    },
    ...overrides,
  }

  mode.client = {
    async rpc(name, parameters) {
      mode.rpcCalls.push({ name, parameters })
      const result = mode.rpcResults.shift()
      if (result instanceof Error) throw result
      if (!result) return { data: null, error: { code: "missing_test_result" } }
      return {
        ...result,
        data: Array.isArray(result.data)
          ? result.data.map((row) =>
              row && typeof row === "object"
                ? Object.assign(Object.create(null), row)
                : row
            )
          : result.data,
      }
    },
    from(table) {
      mode.tableCalls.push(table)
      if (mode.orderLookupThrows) throw new Error("private lookup failure")
      if (table !== "orders") throw new Error(`Unexpected table: ${table}`)
      const builder = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        maybeSingle() {
          return Promise.resolve(mode.orderResult)
        },
      }
      return builder
    },
  }
  return mode
}

let activeMode = createMode()
let servedHandler
const compiledModule = { exports: {} }
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

vm.runInNewContext(
  compiled,
  {
    module: compiledModule,
    exports: compiledModule.exports,
    Request,
    Response,
    Headers,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    crypto: webcrypto,
    AbortController,
    setTimeout(callback, delay) {
      activeMode.timeoutDelays.push(delay)
      if (activeMode.triggerNotificationTimeout) {
        const timeout = { cancelled: false }
        queueMicrotask(() => {
          if (!timeout.cancelled) callback()
        })
        return timeout
      }
      return globalThis.setTimeout(callback, delay)
    },
    clearTimeout(timeout) {
      activeMode.clearedTimeouts += 1
      if (typeof timeout === "object" && timeout !== null) {
        timeout.cancelled = true
        return
      }
      globalThis.clearTimeout(timeout)
    },
    console: {
      error(...values) {
        activeMode.logs.push(values)
      },
    },
    Deno: {
      env: {
        get(name) {
          return activeMode.env[name]
        },
      },
    },
    fetch: async (url, options) => {
      activeMode.fetchCalls.push({ url, options })
      if (activeMode.fetchThrows) throw new Error("private notification error")
      if (activeMode.fetchWaitsForAbort) {
        return new Promise((resolve, reject) => {
          if (options.signal.aborted) {
            reject(new Error("private notification timeout"))
            return
          }
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("private notification timeout")),
            { once: true }
          )
        })
      }
      return new Response(null, { status: activeMode.fetchStatus ?? 200 })
    },
    require(name) {
      if (name === "https://deno.land/std@0.168.0/http/server.ts") {
        return {
          serve(handler) {
            servedHandler = handler
          },
        }
      }
      if (name === "https://esm.sh/@supabase/supabase-js@2.38.0") {
        return {
          createClient(url, key, options) {
            activeMode.clientCreations.push({ url, key, options })
            return activeMode.client
          },
        }
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  },
  { filename: functionFile }
)

assert.equal(typeof servedHandler, "function")

async function invoke(mode, {
  rawBody = signedPayload(),
  signature = signatureFor(rawBody),
  method = "POST",
  includeSignature = true,
} = {}) {
  activeMode = mode
  const headers = new Headers({ "Content-Type": "application/json" })
  if (includeSignature) headers.set("x-paystack-signature", signature)
  const request = new Request("https://functions.example.test/paystack-webhook", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: rawBody }),
  })
  const response = await servedHandler(request)
  return { response, body: await response.json(), mode, request }
}

test("verifies the exact raw body with HMAC SHA-512 before trusting JSON", async () => {
  const malformed = "{not-json"
  const invalidMode = createMode()
  const invalid = await invoke(invalidMode, {
    rawBody: malformed,
    signature: "0".repeat(128),
  })
  assert.equal(invalid.response.status, 401)
  assert.equal(invalidMode.rpcCalls.length, 0)

  const signedMode = createMode()
  const signed = await invoke(signedMode, {
    rawBody: malformed,
    signature: signatureFor(malformed),
  })
  assert.equal(signed.response.status, 400)
  assert.equal(signedMode.rpcCalls.length, 0)
  assert.match(source, /\{ name: "HMAC", hash: "SHA-512" \}/)
  assert.equal((source.match(/req\.body\.getReader\(\)/g) ?? []).length, 1)
  assert.doesNotMatch(source, /req\.(?:json|text|arrayBuffer)\(/)
})

test("rejects missing and malformed signatures and missing secret explicitly", async () => {
  const missingMode = createMode()
  const missing = await invoke(missingMode, { includeSignature: false })
  assert.equal(missing.response.status, 401)

  const malformedMode = createMode()
  const malformed = await invoke(malformedMode, { signature: "not-hex" })
  assert.equal(malformed.response.status, 401)
  assert.equal(malformed.request.bodyUsed, false)

  const secretMode = createMode({
    env: {
      PAYSTACK_WEBHOOK_SECRET: undefined,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
  })
  const noSecret = await invoke(secretMode)
  assert.equal(noSecret.response.status, 503)
  assert.equal(secretMode.rpcCalls.length, 0)
})

test("only charge.success invokes finalization", async () => {
  const unsupportedBody = signedPayload({ event: "transfer.success" })
  const unsupportedMode = createMode()
  const unsupported = await invoke(unsupportedMode, {
    rawBody: unsupportedBody,
    signature: signatureFor(unsupportedBody),
  })
  assert.equal(unsupported.response.status, 200)
  assert.equal(unsupportedMode.rpcCalls.length, 0)
  assert.equal(unsupportedMode.clientCreations.length, 0)

  const successMode = createMode()
  const success = await invoke(successMode)
  assert.equal(success.response.status, 200)
  assert.equal(successMode.rpcCalls.length, 1)
})

test("passes exact signed provider facts and raw-body SHA-256 to the RPC once", async () => {
  const rawBody = signedPayload()
  const mode = createMode()
  const result = await invoke(mode, { rawBody, signature: signatureFor(rawBody) })
  assert.equal(result.response.status, 200)
  assert.equal(mode.rpcCalls.length, 1)
  assert.equal(mode.rpcCalls[0].name, "finalize_paystack_paid_order")
  assert.deepEqual(JSON.parse(JSON.stringify(mode.rpcCalls[0].parameters)), {
    p_payload_sha256: sha256For(rawBody),
    p_event_type: "charge.success",
    p_environment: "test",
    p_transaction_id: largeTransactionId,
    p_reference: reference,
    p_status: "success",
    p_amount_kobo: "125050",
    p_currency: "NGN",
    p_paid_at: "2026-09-29T12:34:56.000Z",
  })
  assert.match(mode.rpcCalls[0].parameters.p_payload_sha256, /^[0-9a-f]{64}$/)
})

test("preserves a transaction ID larger than Number.MAX_SAFE_INTEGER losslessly", async () => {
  assert.ok(BigInt(largeTransactionId) > BigInt(Number.MAX_SAFE_INTEGER))
  const mode = createMode()
  await invoke(mode)
  assert.equal(mode.rpcCalls[0].parameters.p_transaction_id, largeTransactionId)
  assert.match(source, /const TRANSACTION_ID_PATTERN = \/\^\[0-9\]\+\$\//)
  assert.doesNotMatch(source, /String\([^)]*(?:data\.id|eventData\.id)/)
  assert.doesNotMatch(source, /Number\([^)]*(?:transaction|\.id)/i)
})

test("rejects duplicate top-level data before finalization", async () => {
  const data = `{"id":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}`
  const rawBody = `{"event":"charge.success","data":${data},"data":${data}}`
  const mode = createMode()
  const result = await invoke(mode, {
    rawBody,
    signature: signatureFor(rawBody),
  })
  assert.equal(result.response.status, 400)
  assert.equal(mode.rpcCalls.length, 0)
})

test("rejects duplicate direct data id and amount before finalization", async () => {
  for (const rawBody of [
    `{"event":"charge.success","data":{"id":1,"id":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}}`,
    `{"event":"charge.success","data":{"id":${largeTransactionId},"reference":"${reference}","status":"success","amount":1,"amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}}`,
  ]) {
    const mode = createMode()
    const result = await invoke(mode, {
      rawBody,
      signature: signatureFor(rawBody),
    })
    assert.equal(result.response.status, 400, rawBody)
    assert.equal(mode.rpcCalls.length, 0, rawBody)
  }
})

test("ignores nested id and amount fields and preserves direct provider facts", async () => {
  const rawBody = signedPayload({
    extraData:
      ',"metadata":{"id":7,"amount":8,"nested":{"id":9,"amount":10}}',
  })
  const mode = createMode()
  const result = await invoke(mode, {
    rawBody,
    signature: signatureFor(rawBody),
  })
  assert.equal(result.response.status, 200)
  assert.equal(mode.rpcCalls.length, 1)
  assert.equal(
    mode.rpcCalls[0].parameters.p_transaction_id,
    largeTransactionId
  )
  assert.equal(mode.rpcCalls[0].parameters.p_amount_kobo, "125050")
})

test("handles escaped string contents around direct scanner targets", async () => {
  const rawBody = `{"event":"charge.success","data":{"before":"quote: \\\" and slash: \\\\","id":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"after":"slash: \\\\ and quote: \\\"","currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}}`
  const mode = createMode()
  const result = await invoke(mode, {
    rawBody,
    signature: signatureFor(rawBody),
  })
  assert.equal(result.response.status, 200)
  assert.equal(mode.rpcCalls.length, 1)
  assert.equal(
    mode.rpcCalls[0].parameters.p_transaction_id,
    largeTransactionId
  )
  assert.equal(mode.rpcCalls[0].parameters.p_amount_kobo, "125050")
})

test("treats escaped property names by their JSON meaning and rejects ambiguity", async () => {
  const escapedKeys = `{"event":"charge.success","\\u0064ata":{"\\u0069d":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}}`
  const acceptedMode = createMode()
  const accepted = await invoke(acceptedMode, {
    rawBody: escapedKeys,
    signature: signatureFor(escapedKeys),
  })
  assert.equal(accepted.response.status, 200)
  assert.equal(acceptedMode.rpcCalls.length, 1)
  assert.equal(
    acceptedMode.rpcCalls[0].parameters.p_transaction_id,
    largeTransactionId
  )

  const directData = `{"id":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}`
  for (const rawBody of [
    `{"event":"charge.success","data":{"id":1,"\\u0069d":${largeTransactionId},"reference":"${reference}","status":"success","amount":125050,"currency":"NGN","paid_at":"2026-09-29T12:34:56.000Z","domain":"test"}}`,
    `{"event":"charge.success","data":${directData},"\\u0064ata":${directData}}`,
  ]) {
    const mode = createMode()
    const result = await invoke(mode, {
      rawBody,
      signature: signatureFor(rawBody),
    })
    assert.equal(result.response.status, 400, rawBody)
    assert.equal(mode.rpcCalls.length, 0, rawBody)
  }
})

test("rejects malformed provider fields without floating-point amount conversion", async () => {
  for (const rawBody of [
    signedPayload({ transactionId: "1e3" }),
    signedPayload({ amount: "1.5" }),
    signedPayload({ amount: "0" }),
    signedPayload({ amount: "9223372036854775808" }),
    signedPayload({ domain: "sandbox" }),
    signedPayload({ paidAt: "not-a-time" }),
  ]) {
    const mode = createMode()
    const result = await invoke(mode, {
      rawBody,
      signature: signatureFor(rawBody),
    })
    assert.equal(result.response.status, 400, rawBody)
    assert.equal(mode.rpcCalls.length, 0)
  }
  assert.doesNotMatch(source, /Number\([^)]*amount/i)
  assert.doesNotMatch(source, /parseFloat|Math\.round/)
})

test("maps stable and durably recorded outcomes to 200", async () => {
  for (const outcome of [
    "FINALIZED",
    "ALREADY_FINALIZED",
    "EVENT_ALREADY_COMPLETED",
    "LEGACY_ALREADY_FINALIZED",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "PAYMENT_IDENTITY_CONFLICT",
    "CREDIT_CONFLICT",
    "LEGACY_FINALIZATION_REQUIRES_RECONCILIATION",
    "RECONCILIATION_REQUIRED",
  ]) {
    const mode = createMode({
      rpcResults: [{ data: [rpcRow(outcome, false)], error: null }],
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 200, outcome)
  }

  const invalidMode = createMode({
    rpcResults: [
      { data: [rpcRow("INVALID_PROVIDER_PAYLOAD", false, null)], error: null },
    ],
  })
  const invalid = await invoke(invalidMode)
  assert.equal(invalid.response.status, 200)
})

test("maps retryable controlled outcomes to 503", async () => {
  for (const outcome of ["ORDER_NOT_FOUND_RETRYABLE", "RETRYABLE_FAILURE"] ) {
    const mode = createMode({
      rpcResults: [{ data: [rpcRow(outcome, true, null)], error: null }],
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 503, outcome)
  }

  const invalidMode = createMode({
    rpcResults: [
      { data: [rpcRow("INVALID_PROVIDER_PAYLOAD", true, null)], error: null },
    ],
  })
  const invalid = await invoke(invalidMode)
  assert.equal(invalid.response.status, 503)
})

test("RPC errors, transport failures, and malformed results return 503", async () => {
  const cases = [
    [{ data: null, error: { code: "PGRST" } }],
    [new Error("private transport failure")],
    [{ data: [], error: null }],
    [{ data: [rpcRow(), rpcRow()], error: null }],
    [{ data: [{ outcome: "UNKNOWN", order_id: null, retryable: false }], error: null }],
    [{ data: [{ outcome: "FINALIZED", order_id: orderId, retryable: "false" }], error: null }],
    [{ data: [{ outcome: "FINALIZED", order_id: orderId, retryable: true }], error: null }],
  ]
  for (const rpcResults of cases) {
    const mode = createMode({ rpcResults: [...rpcResults] })
    const result = await invoke(mode)
    assert.equal(result.response.status, 503)
    assert.equal(mode.rpcCalls.length, 1)
  }
})

test("n8n receives the existing logical payload only for FINALIZED", async () => {
  const mode = createMode({
    env: {
      PAYSTACK_WEBHOOK_SECRET: webhookSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      N8N_PAID_ORDER_WEBHOOK_URL: "https://n8n.example.test/paid-order",
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.deepEqual(mode.tableCalls, ["orders"])
  assert.equal(mode.fetchCalls.length, 1)
  assert.equal(mode.fetchCalls[0].url, "https://n8n.example.test/paid-order")
  assert.deepEqual(JSON.parse(mode.fetchCalls[0].options.body), {
    order_id: orderId,
    customer_email: "customer@example.test",
    customer_phone: "+2348000000000",
    total_amount: "1250.50",
    reference,
  })
})

test("n8n is not called for retries, terminal results, or reconciliation", async () => {
  for (const [outcome, retryable] of [
    ["ALREADY_FINALIZED", false],
    ["EVENT_ALREADY_COMPLETED", false],
    ["LEGACY_ALREADY_FINALIZED", false],
    ["AMOUNT_MISMATCH", false],
    ["RECONCILIATION_REQUIRED", false],
    ["RETRYABLE_FAILURE", true],
  ]) {
    const mode = createMode({
      env: {
        PAYSTACK_WEBHOOK_SECRET: webhookSecret,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        N8N_PAID_ORDER_WEBHOOK_URL: "https://n8n.example.test/paid-order",
      },
      rpcResults: [{ data: [rpcRow(outcome, retryable)], error: null }],
    })
    await invoke(mode)
    assert.equal(mode.tableCalls.length, 0, outcome)
    assert.equal(mode.fetchCalls.length, 0, outcome)
  }
})

test("n8n failure does not change FINALIZED acknowledgement", async () => {
  for (const overrides of [
    { fetchThrows: true },
    { fetchStatus: 500 },
    { orderLookupThrows: true },
  ]) {
    const mode = createMode({
      env: {
        PAYSTACK_WEBHOOK_SECRET: webhookSecret,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        N8N_PAID_ORDER_WEBHOOK_URL: "https://n8n.example.test/paid-order",
      },
      ...overrides,
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 200)
    assert.equal(mode.rpcCalls.length, 1)
  }
})

test("n8n timeout is bounded without retrying finalized financial work", async () => {
  const mode = createMode({
    env: {
      PAYSTACK_WEBHOOK_SECRET: webhookSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      N8N_PAID_ORDER_WEBHOOK_URL: "https://n8n.example.test/paid-order",
    },
    triggerNotificationTimeout: true,
    fetchWaitsForAbort: true,
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(mode.rpcCalls.length, 1)
  assert.equal(mode.fetchCalls.length, 1)
  assert.deepEqual(mode.tableCalls, ["orders"])
  assert.deepEqual(mode.timeoutDelays, [5_000])
  assert.equal(mode.fetchCalls[0].options.signal.aborted, true)
  assert.equal(mode.clearedTimeouts, 1)
  assert.equal(mode.logs.length, 1)
  assert.equal(mode.logs[0][1].category, "notification_failure")
})

test("webhook contains no legacy financial or stock writer", () => {
  assert.equal((source.match(/finalize_paystack_paid_order/g) ?? []).length, 1)
  for (const table of [
    "events_ledger",
    "payments",
    "payment_events",
    "payout_ledger",
    "order_items",
    "vendors",
    "products",
  ]) {
    assert.equal(source.includes(`.from("${table}")`), false, table)
  }
  assert.doesNotMatch(source, /\.update\(\{\s*status:\s*"confirmed"/)
  assert.doesNotMatch(source, /platform_fee_pct|vendorShare|seller|decrement_stock/)
  assert.doesNotMatch(source, /\bstock\b/i)
})

test("logs contain only controlled diagnostics and no customer PII", async () => {
  const rawBody = signedPayload({
    extraData:
      ',"customer":{"email":"private@example.test","phone":"+2348111111111"}',
  })
  const mode = createMode({
    rpcResults: [{ data: null, error: { message: "private database detail" } }],
  })
  await invoke(mode, { rawBody, signature: signatureFor(rawBody) })
  const logs = JSON.stringify(mode.logs)
  for (const privateValue of [
    rawBody,
    webhookSecret,
    serviceRoleKey,
    "private@example.test",
    "+2348111111111",
    "private database detail",
    reference,
  ]) {
    assert.equal(logs.includes(privateValue), false, privateValue)
  }
})

test("body ceiling and method boundary fail before privileged work", async () => {
  const methodMode = createMode()
  const method = await invoke(methodMode, { method: "GET" })
  assert.equal(method.response.status, 405)
  assert.equal(methodMode.rpcCalls.length, 0)

  const rawBody = "x".repeat(256 * 1024 + 1)
  const sizeMode = createMode()
  const size = await invoke(sizeMode, {
    rawBody,
    signature: signatureFor(rawBody),
  })
  assert.equal(size.response.status, 413)
  assert.equal(sizeMode.rpcCalls.length, 0)
})
