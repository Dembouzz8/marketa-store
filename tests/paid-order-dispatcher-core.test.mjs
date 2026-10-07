import assert from "node:assert/strict"
import { webcrypto } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionFile = "supabase/functions/dispatch-paid-order-outbox/index.ts"
const configFile = "supabase/functions/dispatch-paid-order-outbox/deno.json"
const source = fs.readFileSync(path.join(root, functionFile), "utf8")
const config = JSON.parse(fs.readFileSync(path.join(root, configFile), "utf8"))

const eventId = "11111111-1111-4111-8111-111111111111"
const orderId = "22222222-2222-4222-8222-222222222222"
const leaseToken = "33333333-3333-4333-8333-333333333333"
const customerChildId = "44444444-4444-4444-8444-444444444444"
const vendorChildId = "55555555-5555-4555-8555-555555555555"
const vendorId = "66666666-6666-4666-8666-666666666666"
const productId = "77777777-7777-4777-8777-777777777777"
const customerAttemptToken = "88888888-8888-4888-8888-888888888888"
const vendorAttemptToken = "99999999-9999-4999-8999-999999999999"
const secondAttemptToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const dispatcherSecret = "dispatcher-test-secret-32-characters!"

function child(kind, status = "pending") {
  const vendor = kind === "vendor" ? vendorId : null
  return {
    id: kind === "vendor" ? vendorChildId : customerChildId,
    outbox_event_id: eventId,
    order_id: orderId,
    recipient_kind: kind,
    vendor_id: vendor,
    channel: "email",
    delivery_key:
      kind === "vendor"
        ? `paid-order:${orderId}:vendor:${vendorId}:email`
        : `paid-order:${orderId}:customer:email`,
    status,
    attempt_count: status === "pending" ? 0 : 1,
  }
}

function createMode(overrides = {}) {
  const mode = {
    env: {
      MARKETA_DISPATCHER_SECRET: dispatcherSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    rpcCalls: [],
    tableCalls: [],
    clientCreations: [],
    logs: [],
    fetchCalls: [],
    providerFactoryCalls: 0,
    productionAdapter: null,
    rpcHandlers: {},
    tableErrors: {},
    tableThrows: new Set(),
    tableData: {
      notification_deliveries: [child("customer"), child("vendor")],
      orders: {
        id: orderId,
        customer_email: "customer@example.test",
        customer_name: "Test Customer",
        status: "confirmed",
        total_amount: "100.00",
        total_amount_kobo: "10000",
        currency: "NGN",
        financial_contract_version: 2,
        payment_finalized_at: "2026-10-01T10:00:00.000Z",
      },
      payments: [
        {
          order_id: orderId,
          status: "success",
          amount_kobo: "10000",
          currency: "NGN",
          financial_contract_version: 2,
          finalization_state: "completed",
          outcome_code: "FINALIZED",
        },
      ],
      order_items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          order_id: orderId,
          product_id: productId,
          vendor_id: vendorId,
          quantity: 2,
          unit_price: "50.00",
          subtotal: "100.00",
          unit_amount_kobo: "5000",
          gross_amount_kobo: "10000",
          platform_fee_bps: 500,
          platform_fee_amount_kobo: "500",
          vendor_net_amount_kobo: "9500",
          currency: "NGN",
          financial_contract_version: 2,
        },
      ],
      products: [{ id: productId, vendor_id: vendorId, name: "Test Product" }],
      vendors: [
        {
          id: vendorId,
          name: "Test Vendor",
          email: "vendor@example.test",
        },
      ],
    },
    ...overrides,
  }

  mode.client = {
    async rpc(name, parameters) {
      mode.rpcCalls.push({ name, parameters })
      const handler = mode.rpcHandlers[name]
      if (handler) return handler(parameters, mode)
      if (name === "claim_paid_order_outbox") {
        return {
          data: [
            {
              event_id: eventId,
              order_id: orderId,
              idempotency_key: `paid-order:${orderId}`,
              event_version: 1,
              attempt_count: 1,
              lease_token: leaseToken,
            },
          ],
          error: null,
        }
      }
      if (name === "expand_paid_order_notification_deliveries") {
        const deliveries = mode.tableData.notification_deliveries
        return {
          data: [
            {
              delivery_count: String(deliveries.length),
              pending_count: String(
                deliveries.filter((entry) => entry.status === "pending").length
              ),
              processing_count: String(
                deliveries.filter((entry) => entry.status === "processing").length
              ),
              delivered_count: String(
                deliveries.filter((entry) => entry.status === "delivered").length
              ),
              unknown_count: String(
                deliveries.filter((entry) => entry.status === "unknown").length
              ),
              dead_letter_count: String(
                deliveries.filter((entry) => entry.status === "dead_letter").length
              ),
            },
          ],
          error: null,
        }
      }
      if (name === "begin_paid_order_notification_delivery") {
        const delivery = mode.tableData.notification_deliveries.find(
          (entry) => entry.id === parameters.p_delivery_id
        )
        if (!delivery) return { data: [], error: null }
        const attemptCount = delivery.attempt_count + 1
        return {
          data: [
            {
              delivery_id: delivery.id,
              delivery_key: delivery.delivery_key,
              recipient_kind: delivery.recipient_kind,
              vendor_id: delivery.vendor_id,
              attempt_count: attemptCount,
              attempt_token:
                attemptCount === 2
                  ? secondAttemptToken
                  : delivery.recipient_kind === "customer"
                  ? customerAttemptToken
                  : vendorAttemptToken,
            },
          ],
          error: null,
        }
      }
      if (
        name === "mark_paid_order_notification_delivered" ||
        name === "mark_paid_order_notification_unknown" ||
        name === "mark_paid_order_outbox_delivered"
      ) {
        return { data: true, error: null }
      }
      if (name === "mark_paid_order_notification_failed") {
        return {
          data: [
            {
              delivery_status: parameters.p_permanent ? "dead_letter" : "pending",
              delivery_attempt_count: 1,
            },
          ],
          error: null,
        }
      }
      if (name === "mark_paid_order_outbox_failed") {
        return {
          data: [
            {
              outbox_status: "pending",
              next_available_at: "2026-10-01T10:01:00.000Z",
              outbox_attempt_count: 1,
            },
          ],
          error: null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
    from(table) {
      if (mode.tableThrows.has(table)) throw new Error("private table failure")
      const call = { table, columns: null, filters: [], ordering: null }
      mode.tableCalls.push(call)
      const builder = {
        select(columns) {
          call.columns = columns
          return builder
        },
        eq(column, value) {
          call.filters.push({ operation: "eq", column, value })
          return builder
        },
        in(column, value) {
          call.filters.push({ operation: "in", column, value })
          return builder
        },
        order(column, options) {
          call.ordering = { column, options }
          return builder
        },
        maybeSingle() {
          return Promise.resolve({
            data: mode.tableData[table] ?? null,
            error: mode.tableErrors[table] ?? null,
          })
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: mode.tableData[table] ?? null,
            error: mode.tableErrors[table] ?? null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  return mode
}

function createAdapter(results = []) {
  const adapter = {
    providerName: "fake-email",
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
    async sendEmail(command) {
      adapter.calls.push(command)
      adapter.inFlight += 1
      adapter.maxInFlight = Math.max(adapter.maxInFlight, adapter.inFlight)
      try {
        const next = results.shift() ?? {
          outcome: "DELIVERED",
          providerMessageId: `message-${adapter.calls.length}`,
        }
        if (next instanceof Error) throw next
        if (typeof next === "function") return await next(command)
        return next
      } finally {
        adapter.inFlight -= 1
      }
    },
  }
  return adapter
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
    TextEncoder,
    Uint8Array,
    URL,
    fetch(...parameters) {
      activeMode.fetchCalls.push(parameters)
      throw new Error("Real provider fetch is forbidden")
    },
    crypto: webcrypto,
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
    require(name) {
      if (name === "https://deno.land/std@0.168.0/http/server.ts") {
        return {
          serve(handler) {
            servedHandler = handler
          },
        }
      }
      if (name === "@supabase/supabase-js") {
        return {
          createClient(url, key, options) {
            activeMode.clientCreations.push({ url, key, options })
            return activeMode.client
          },
        }
      }
      if (name === "./resend-adapter.ts") {
        return {
          createProductionEmailAdapter(getEnv) {
            activeMode.providerFactoryCalls += 1
            return getEnv("RESEND_API_KEY") === "re_test_configured_key" &&
                getEnv("MARKETA_EMAIL_FROM") === "orders@marketa.example"
              ? activeMode.productionAdapter
              : null
          },
        }
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  },
  { filename: functionFile }
)

const { dispatchOnePaidOrder, handleDispatcherRequest } = compiledModule.exports
assert.equal(typeof servedHandler, "function")
assert.equal(typeof dispatchOnePaidOrder, "function")
assert.equal(typeof handleDispatcherRequest, "function")

function runtimeRequest({ method = "POST", token = dispatcherSecret, body } = {}) {
  const headers = new Headers()
  if (token !== null) headers.set("Authorization", `Bearer ${token}`)
  return new Request("https://functions.example.test/dispatch-paid-order-outbox", {
    method,
    headers,
    ...(body === undefined || method === "GET" || method === "HEAD"
      ? {}
      : { body: JSON.stringify(body) }),
  })
}

function dependencies(mode, adapter) {
  return {
    getEnv(name) {
      return mode.env[name]
    },
    createServiceClient(url, key) {
      mode.clientCreations.push({ url, key })
      return mode.client
    },
    emailAdapter: adapter,
    createWorkerId() {
      return "edge-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    },
    log(marker) {
      mode.logs.push([marker])
    },
  }
}

async function invokeProduction(mode, options) {
  activeMode = mode
  const response = await servedHandler(runtimeRequest(options))
  return { response, body: await response.json() }
}

async function invokeHttp(mode, adapter, options) {
  activeMode = mode
  const response = await handleDispatcherRequest(
    runtimeRequest(options),
    dependencies(mode, adapter)
  )
  return { response, body: await response.json() }
}

async function invokeCore(mode, adapter = createAdapter(), now) {
  activeMode = mode
  const result = await dispatchOnePaidOrder(
    mode.client,
    adapter,
    "edge-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    (marker) => mode.logs.push([marker]),
    now
  )
  return { result, mode, adapter }
}

function forceParentFailure(mode) {
  mode.rpcHandlers.expand_paid_order_notification_deliveries = () => ({
    data: null,
    error: { code: "private" },
  })
}

test("uses the repository Edge import-map convention", () => {
  assert.equal(
    config.imports["@supabase/supabase-js"],
    "npm:@supabase/supabase-js@2.110.0"
  )
})

test("accepts POST only", async () => {
  const mode = createMode()
  const { response, body } = await invokeProduction(mode, { method: "GET" })
  assert.equal(response.status, 405)
  assert.equal(body.code, "METHOD_NOT_ALLOWED")
  assert.equal(mode.rpcCalls.length, 0)
})

test("missing server secret returns 503", async () => {
  const mode = createMode({ env: {} })
  const { response, body } = await invokeProduction(mode)
  assert.equal(response.status, 503)
  assert.equal(body.code, "DISPATCHER_UNAVAILABLE")
  assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_CONFIG_MISSING"]])
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
})

test("configured secret shorter than 32 characters returns 503 before claim", async () => {
  const mode = createMode({
    env: {
      MARKETA_DISPATCHER_SECRET: "x".repeat(31),
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
  })
  const { response, body } = await invokeProduction(mode, { token: "x".repeat(31) })
  assert.equal(response.status, 503)
  assert.deepEqual(body, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_CONFIG_MISSING"]])
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
})

test("configured secret longer than 256 characters returns 503 before claim", async () => {
  const configuredSecret = "x".repeat(257)
  const mode = createMode({
    env: {
      MARKETA_DISPATCHER_SECRET: configuredSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
  })
  const { response, body } = await invokeProduction(mode, {
    token: configuredSecret,
  })
  assert.equal(response.status, 503)
  assert.deepEqual(body, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_CONFIG_MISSING"]])
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
})

test("configured secret containing whitespace or control characters returns 503", async () => {
  for (const configuredSecret of [
    `valid-prefix-${"x".repeat(20)} space`,
    `valid-prefix-${"x".repeat(20)}\ncontrol`,
    `valid-prefix-${"x".repeat(20)}\u007fcontrol`,
  ]) {
    const mode = createMode({
      env: {
        MARKETA_DISPATCHER_SECRET: configuredSecret,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      },
    })
    const { response, body } = await invokeProduction(mode, {
      token: dispatcherSecret,
    })
    assert.equal(response.status, 503)
    assert.deepEqual(body, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
    assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_CONFIG_MISSING"]])
    assert.equal(mode.clientCreations.length, 0)
    assert.equal(mode.rpcCalls.length, 0)
  }
})

test("valid strong configured secret proceeds to the provider gate", async () => {
  const mode = createMode()
  const { response, body } = await invokeProduction(mode)
  assert.equal(response.status, 503)
  assert.deepEqual(body, {
    ok: false,
    code: "DELIVERY_PROVIDER_NOT_CONFIGURED",
  })
  assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_CONFIG_MISSING"]])
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
  assert.equal(mode.providerFactoryCalls, 1)
})

test("missing authorization returns 401", async () => {
  const mode = createMode()
  const { response } = await invokeProduction(mode, { token: null })
  assert.equal(response.status, 401)
  assert.equal(mode.rpcCalls.length, 0)
})

test("malformed authorization returns 401", async () => {
  const mode = createMode()
  activeMode = mode
  const request = runtimeRequest({ token: null })
  request.headers.set("Authorization", "Basic private")
  const response = await servedHandler(request)
  assert.equal(response.status, 401)
})

test("invalid authorization returns 401", async () => {
  const mode = createMode()
  const { response } = await invokeProduction(mode, { token: "wrong-secret" })
  assert.equal(response.status, 401)
  assert.deepEqual(mode.logs, [["MARKETA_DISPATCH_AUTH_FAILED"]])
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
  assert.equal(mode.providerFactoryCalls, 0)
})

test("authentication comparison uses Web Crypto digest comparison", () => {
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(source, /difference \|=/)
})

test("dispatcher secret is never logged or returned", async () => {
  const mode = createMode()
  const { body } = await invokeProduction(mode, { token: "wrong-secret" })
  assert.doesNotMatch(JSON.stringify(mode.logs), /wrong-secret|dispatcher-test-secret/)
  assert.doesNotMatch(JSON.stringify(body), /wrong-secret|dispatcher-test-secret/)
})

test("future deployment disables platform JWT verification for bearer authentication", () => {
  assert.match(source, /Ops 3C1D deployment contract: use verify_jwt=false/)
  assert.match(source, /MARKETA_DISPATCHER_SECRET bearer value/)
})

test("production creates the Resend adapter after dispatcher authentication", () => {
  assert.match(source, /createProductionEmailAdapter/)
  assert.match(source, /createEmailAdapter: \(getEnv\) =>/)
  assert.match(source, /RESEND_API_KEY|createProductionEmailAdapter/)
  const authenticatedFactory = source.indexOf(
    "emailAdapter = dependencies.createEmailAdapter"
  )
  const serviceClient = source.indexOf("dependencies.createServiceClient")
  assert.ok(authenticatedFactory > source.indexOf("timingSafeEqual"))
  assert.ok(authenticatedFactory < serviceClient)
})

test("provider absence returns 503 with the fixed code", async () => {
  const mode = createMode()
  const { response, body } = await invokeProduction(mode)
  assert.equal(response.status, 503)
  assert.deepEqual(body, {
    ok: false,
    code: "DELIVERY_PROVIDER_NOT_CONFIGURED",
  })
})

test("provider absence returns before client creation and claim", async () => {
  const mode = createMode()
  await invokeProduction(mode)
  assert.equal(mode.clientCreations.length, 0)
  assert.equal(mode.rpcCalls.length, 0)
  assert.equal(mode.tableCalls.length, 0)
})

test("valid provider configuration enables the normal production core flow", async () => {
  const mode = createMode({
    env: {
      MARKETA_DISPATCHER_SECRET: dispatcherSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      RESEND_API_KEY: "re_test_configured_key",
      MARKETA_EMAIL_FROM: "orders@marketa.example",
    },
  })
  mode.productionAdapter = createAdapter()
  mode.productionAdapter.providerName = "resend"
  const { response, body } = await invokeProduction(mode)
  assert.equal(response.status, 200)
  assert.deepEqual(body, { ok: true, result: "DELIVERED", parents_processed: 1 })
  assert.equal(mode.providerFactoryCalls, 1)
  assert.equal(mode.clientCreations.length, 1)
  assert.equal(mode.productionAdapter.calls.length, 2)
  assert.equal(
    mode.productionAdapter.calls[0].idempotencyKey,
    `paid-order:${orderId}:customer:email:attempt:1`
  )
})

test("claim batch size is fixed at one", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const claim = mode.rpcCalls.find((call) => call.name === "claim_paid_order_outbox")
  assert.equal(claim.parameters.p_batch_size, 1)
})

test("caller-supplied batch control is ignored", async () => {
  const mode = createMode()
  await invokeHttp(mode, createAdapter(), { body: { batch_size: 10 } })
  const claim = mode.rpcCalls.find((call) => call.name === "claim_paid_order_outbox")
  assert.equal(claim.parameters.p_batch_size, 1)
})

test("no work returns a sanitized successful result", async () => {
  const mode = createMode()
  mode.rpcHandlers.claim_paid_order_outbox = () => ({ data: [], error: null })
  const { response, body } = await invokeHttp(mode, createAdapter())
  assert.equal(response.status, 200)
  assert.deepEqual(body, { ok: true, result: "NO_WORK" })
})

test("claim uses only the claim lifecycle RPC", async () => {
  const mode = createMode()
  await invokeCore(mode)
  assert.equal(mode.rpcCalls[0].name, "claim_paid_order_outbox")
  assert.match(mode.rpcCalls[0].parameters.p_worker_id, /^edge-/)
})

test("expansion uses the current parent event and lease", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const call = mode.rpcCalls.find(
    (entry) => entry.name === "expand_paid_order_notification_deliveries"
  )
  assert.equal(call.parameters.p_outbox_event_id, eventId)
  assert.equal(call.parameters.p_parent_lease_token, leaseToken)
})

test("expansion failure records bounded parent failure", async () => {
  const mode = createMode()
  forceParentFailure(mode)
  const { result } = await invokeCore(mode)
  assert.equal(result.result, "PARENT_RETRY_SCHEDULED")
  assert.equal(result.code, "DELIVERY_EXPANSION_FAILED")
  const failure = mode.rpcCalls.at(-1)
  assert.equal(failure.name, "mark_paid_order_outbox_failed")
  assert.equal(failure.parameters.p_error_code, "DELIVERY_EXPANSION_FAILED")
})

test("pending parent failure requires an attempt below 12", async () => {
  const mode = createMode()
  forceParentFailure(mode)
  mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({
    data: [
      {
        outbox_status: "pending",
        next_available_at: "2026-10-01T10:01:00.000Z",
        outbox_attempt_count: 12,
      },
    ],
    error: null,
  })
  const { result } = await invokeCore(mode)
  assert.equal(result.result, "PARENT_LEASE_LOST")
})

test("pending parent failure requires a valid non-empty timestamp", async () => {
  for (const nextAvailableAt of ["", "not-a-timestamp", null]) {
    const mode = createMode()
    forceParentFailure(mode)
    mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({
      data: [
        {
          outbox_status: "pending",
          next_available_at: nextAvailableAt,
          outbox_attempt_count: 1,
        },
      ],
      error: null,
    })
    const { result } = await invokeCore(mode)
    assert.equal(result.result, "PARENT_LEASE_LOST")
  }
})

test("dead-letter parent failure at attempt 12 is terminal", async () => {
  const mode = createMode()
  forceParentFailure(mode)
  mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({
    data: [
      {
        outbox_status: "dead_letter",
        next_available_at: "2026-10-01T10:01:00.000Z",
        outbox_attempt_count: 12,
      },
    ],
    error: null,
  })
  const { result } = await invokeCore(mode)
  assert.equal(result.result, "PARENT_DEAD_LETTER")
  assert.notEqual(result.result, "PARENT_RETRY_SCHEDULED")
  assert.equal("code" in result, false)
})

test("dead-letter parent result is sanitized over HTTP and never reports retry", async () => {
  const mode = createMode()
  forceParentFailure(mode)
  mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({
    data: [
      {
        outbox_status: "dead_letter",
        next_available_at: "private-value-is-not-exposed",
        outbox_attempt_count: 12,
      },
    ],
    error: null,
  })
  const { response, body } = await invokeHttp(mode, createAdapter())
  assert.equal(response.status, 503)
  assert.deepEqual(body, { ok: false, code: "PARENT_DEAD_LETTER" })
  assert.doesNotMatch(JSON.stringify(body), /private-value|attempt|next_available/i)
})

test("malformed parent failure rows are treated as an unconfirmed acknowledgement", async () => {
  const malformedRows = [
    [{ outbox_status: "unknown", next_available_at: "2026-10-01T10:01:00Z", outbox_attempt_count: 1 }],
    [{ outbox_status: "dead_letter", next_available_at: null, outbox_attempt_count: 11 }],
    [{ outbox_status: "pending", next_available_at: "2026-10-01T10:01:00Z", outbox_attempt_count: 1.5 }],
    [
      { outbox_status: "pending", next_available_at: "2026-10-01T10:01:00Z", outbox_attempt_count: 1 },
      { outbox_status: "pending", next_available_at: "2026-10-01T10:02:00Z", outbox_attempt_count: 2 },
    ],
  ]
  for (const data of malformedRows) {
    const mode = createMode()
    forceParentFailure(mode)
    mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({ data, error: null })
    const { result } = await invokeCore(mode)
    assert.equal(result.result, "PARENT_LEASE_LOST")
  }
})

test("parent failure RPC errors and throws are treated as lease loss", async () => {
  for (const handler of [
    () => ({ data: null, error: { code: "private" } }),
    () => {
      throw new Error("private")
    },
  ]) {
    const mode = createMode()
    forceParentFailure(mode)
    mode.rpcHandlers.mark_paid_order_outbox_failed = handler
    const { result } = await invokeCore(mode)
    assert.equal(result.result, "PARENT_LEASE_LOST")
  }
})

test("authoritative load transport failure records parent failure before begin", async () => {
  const mode = createMode()
  mode.tableErrors.orders = { code: "private" }
  const { result } = await invokeCore(mode)
  assert.equal(result.code, "DELIVERY_DATA_LOAD_FAILED")
  assert.equal(
    mode.rpcCalls.some((call) => call.name === "begin_paid_order_notification_delivery"),
    false
  )
})

test("authoritative invariant failure records DELIVERY_DATA_INVALID", async () => {
  const mode = createMode()
  mode.tableData.orders = { ...mode.tableData.orders, status: "pending" }
  const { result } = await invokeCore(mode)
  assert.equal(result.code, "DELIVERY_DATA_INVALID")
})

test("authoritative queries never use select star", async () => {
  const mode = createMode()
  await invokeCore(mode)
  assert.equal(mode.tableCalls.some((call) => call.columns === "*"), false)
  assert.doesNotMatch(source, /\.select\(\s*["']\*["']\s*\)/)
})

test("child ledger is not used as contact authority", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const childRead = mode.tableCalls.find(
    (call) => call.table === "notification_deliveries"
  )
  assert.doesNotMatch(childRead.columns, /email|phone/)
})

test("current order payment item product and vendor data load authoritatively", async () => {
  const mode = createMode()
  await invokeCore(mode)
  assert.deepEqual(
    [...new Set(mode.tableCalls.map((call) => call.table))],
    [
      "notification_deliveries",
      "orders",
      "payments",
      "order_items",
      "products",
      "vendors",
    ]
  )
})

test("payment query requires finalized successful evidence", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const payment = mode.tableCalls.find((call) => call.table === "payments")
  assert.deepEqual(payment.filters.slice(1), [
    { operation: "eq", column: "status", value: "success" },
    { operation: "eq", column: "finalization_state", value: "completed" },
    { operation: "eq", column: "outcome_code", value: "FINALIZED" },
  ])
})

test("vendor command excludes customer email and phone", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  const vendorCommand = adapter.calls.find((call) => call.recipientKind === "vendor")
  assert.ok(vendorCommand)
  assert.equal("customerEmail" in vendorCommand, false)
  assert.equal("customerPhone" in vendorCommand, false)
  assert.doesNotMatch(JSON.stringify(vendorCommand), /customer@example\.test|\+234/)
})

test("delivered children are not resent", async () => {
  const mode = createMode()
  mode.tableData.notification_deliveries = [
    child("customer", "delivered"),
    child("vendor"),
  ]
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(adapter.calls.length, 1)
  assert.equal(adapter.calls[0].recipientKind, "vendor")
})

test("unknown children are never resent", async () => {
  const mode = createMode()
  mode.tableData.notification_deliveries = [child("customer", "unknown"), child("vendor")]
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(adapter.calls.length, 0)
})

test("dead-letter children are never resent", async () => {
  const mode = createMode()
  mode.tableData.notification_deliveries = [
    child("customer", "dead_letter"),
    child("vendor"),
  ]
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(adapter.calls.length, 0)
})

test("blocked child stops all new child attempts for the parent", async () => {
  const mode = createMode()
  mode.tableData.notification_deliveries = [child("customer", "unknown"), child("vendor")]
  await invokeCore(mode)
  assert.equal(
    mode.rpcCalls.some((call) => call.name === "begin_paid_order_notification_delivery"),
    false
  )
  assert.equal(mode.rpcCalls.at(-1).parameters.p_error_code, "CHILD_DELIVERY_BLOCKED")
})

test("valid pending child begins exactly one attempt", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const begins = mode.rpcCalls.filter(
    (call) => call.name === "begin_paid_order_notification_delivery"
  )
  assert.equal(begins.length, 2)
  assert.equal(new Set(begins.map((call) => call.parameters.p_delivery_id)).size, 2)
})

test("time budget exhaustion fails the parent before a child begin or provider call", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  const times = [0, 80_001]
  const { result } = await invokeCore(
    mode,
    adapter,
    () => times.shift() ?? 80_001
  )
  assert.equal(result.result, "PARENT_RETRY_SCHEDULED")
  assert.equal(result.code, "DISPATCH_TIME_BUDGET")
  assert.equal(adapter.calls.length, 0)
  assert.equal(
    mode.rpcCalls.some(
      ({ name }) => name === "begin_paid_order_notification_delivery"
    ),
    false
  )
  assert.equal(mode.rpcCalls.at(-1).name, "mark_paid_order_outbox_failed")
  assert.equal(mode.rpcCalls.at(-1).parameters.p_error_code, "DISPATCH_TIME_BUDGET")
})

test("time budget is rechecked before every later pending child", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  const times = [0, 0, 80_001]
  const { result } = await invokeCore(
    mode,
    adapter,
    () => times.shift() ?? 80_001
  )
  assert.equal(result.result, "PARENT_RETRY_SCHEDULED")
  assert.equal(result.code, "DISPATCH_TIME_BUDGET")
  assert.equal(adapter.calls.length, 1)
  assert.equal(
    mode.rpcCalls.filter(
      ({ name }) => name === "begin_paid_order_notification_delivery"
    ).length,
    1
  )
  assert.equal(mode.rpcCalls.at(-1).parameters.p_error_code, "DISPATCH_TIME_BUDGET")
})

test("begin attempt uses the adapter provider name", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  adapter.providerName = "future-provider"
  await invokeCore(mode, adapter)
  assert.equal(
    mode.rpcCalls.find((call) => call.name === "begin_paid_order_notification_delivery")
      .parameters.p_provider,
    "future-provider"
  )
})

test("adapter receives the deterministic child attempt idempotency key", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(
    adapter.calls[0].idempotencyKey,
    `paid-order:${orderId}:customer:email:attempt:1`
  )
  assert.equal(
    adapter.calls[1].idempotencyKey,
    `paid-order:${orderId}:vendor:${vendorId}:email:attempt:1`
  )
  assert.ok(adapter.calls.every(({ idempotencyKey }) => idempotencyKey.length <= 256))
})

test("the same persisted child attempt derives the same provider key", async () => {
  const first = await invokeCore(createMode(), createAdapter())
  const second = await invokeCore(createMode(), createAdapter())
  assert.deepEqual(
    first.adapter.calls.map(({ idempotencyKey }) => idempotencyKey),
    second.adapter.calls.map(({ idempotencyKey }) => idempotencyKey)
  )
})

test("a definitive retryable failure permits a distinct later attempt key", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    { outcome: "RETRYABLE_FAILURE", diagnosticCode: "DELIVERY_TIMEOUT" },
    { outcome: "DELIVERED", providerMessageId: "provider-message-two" },
  ])

  await invokeCore(mode, adapter)
  mode.tableData.notification_deliveries[0].attempt_count = 1
  await invokeCore(mode, adapter)

  const customerKeys = adapter.calls
    .filter(({ recipientKind }) => recipientKind === "customer")
    .map(({ idempotencyKey }) => idempotencyKey)
  assert.deepEqual(
    customerKeys,
    [
      `paid-order:${orderId}:customer:email:attempt:1`,
      `paid-order:${orderId}:customer:email:attempt:2`,
    ]
  )
  assert.notEqual(customerKeys[0], customerKeys[1])
  assert.doesNotMatch(
    JSON.stringify(adapter.calls),
    new RegExp(`${customerAttemptToken}|${secondAttemptToken}`)
  )
})

test("delivered adapter result calls delivered lifecycle RPC", async () => {
  const mode = createMode()
  await invokeCore(mode)
  const delivered = mode.rpcCalls.filter(
    (call) => call.name === "mark_paid_order_notification_delivered"
  )
  assert.equal(delivered.length, 2)
  assert.equal(delivered[0].parameters.p_attempt_token, customerAttemptToken)
})

test("retryable adapter failure uses permanent false", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    { outcome: "RETRYABLE_FAILURE", diagnosticCode: "DELIVERY_TIMEOUT" },
  ])
  await invokeCore(mode, adapter)
  const failure = mode.rpcCalls.find(
    (call) => call.name === "mark_paid_order_notification_failed"
  )
  assert.equal(failure.parameters.p_permanent, false)
  assert.equal(failure.parameters.p_error_code, "DELIVERY_TIMEOUT")
})

test("Resend credential configuration failures remain retryable child failures", async () => {
  for (const diagnosticCode of ["RESEND_UNAUTHORIZED", "RESEND_FORBIDDEN"]) {
    const mode = createMode()
    const adapter = createAdapter([
      { outcome: "RETRYABLE_FAILURE", diagnosticCode },
    ])
    await invokeCore(mode, adapter)
    const failure = mode.rpcCalls.find(
      (call) => call.name === "mark_paid_order_notification_failed"
    )
    assert.equal(failure.parameters.p_error_code, diagnosticCode)
    assert.equal(failure.parameters.p_permanent, false)
    assert.equal(
      mode.rpcCalls.some(
        (call) => call.name === "mark_paid_order_notification_unknown"
      ),
      false
    )
  }
})

test("permanent adapter failure uses permanent true", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    { outcome: "PERMANENT_FAILURE", diagnosticCode: "RECIPIENT_REJECTED" },
  ])
  await invokeCore(mode, adapter)
  const failure = mode.rpcCalls.find(
    (call) => call.name === "mark_paid_order_notification_failed"
  )
  assert.equal(failure.parameters.p_permanent, true)
})

test("invalid recipient begins and permanently fails without adapter call", async () => {
  const mode = createMode()
  mode.tableData.orders = { ...mode.tableData.orders, customer_email: "invalid" }
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(adapter.calls.length, 0)
  assert.equal(mode.rpcCalls[2].name, "begin_paid_order_notification_delivery")
  const failure = mode.rpcCalls.find(
    (call) => call.name === "mark_paid_order_notification_failed"
  )
  assert.equal(failure.parameters.p_error_code, "INVALID_RECIPIENT")
  assert.equal(failure.parameters.p_permanent, true)
})

test("UNKNOWN adapter result calls unknown lifecycle RPC", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    { outcome: "UNKNOWN", diagnosticCode: "PROVIDER_ACCEPTANCE_UNKNOWN" },
  ])
  await invokeCore(mode, adapter)
  const unknown = mode.rpcCalls.find(
    (call) => call.name === "mark_paid_order_notification_unknown"
  )
  assert.equal(unknown.parameters.p_error_code, "PROVIDER_ACCEPTANCE_UNKNOWN")
})

test("UNKNOWN HTTP 408 evidence prevents a later provider attempt", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    { outcome: "UNKNOWN", diagnosticCode: "RESEND_REQUEST_UNCERTAIN" },
    { outcome: "DELIVERED", providerMessageId: "must-not-send" },
  ])

  await invokeCore(mode, adapter)
  mode.tableData.notification_deliveries[0] = child("customer", "unknown")
  await invokeCore(mode, adapter)

  assert.equal(adapter.calls.length, 1)
  assert.equal(
    mode.rpcCalls.filter(
      ({ name }) => name === "begin_paid_order_notification_delivery"
    ).length,
    1
  )
})

test("thrown adapter error becomes UNKNOWN and never pending", async () => {
  const mode = createMode()
  const adapter = createAdapter([new Error("private provider failure")])
  await invokeCore(mode, adapter)
  const unknown = mode.rpcCalls.find(
    (call) => call.name === "mark_paid_order_notification_unknown"
  )
  assert.equal(unknown.parameters.p_error_code, "PROVIDER_RESULT_UNKNOWN")
  assert.equal(
    mode.rpcCalls.some((call) => call.name === "mark_paid_order_notification_failed"),
    false
  )
})

test("stale child begin acknowledgement causes controlled lease stop", async () => {
  const mode = createMode()
  mode.rpcHandlers.begin_paid_order_notification_delivery = () => ({
    data: [],
    error: null,
  })
  const { result, adapter } = await invokeCore(mode)
  assert.equal(result.result, "PARENT_LEASE_LOST")
  assert.equal(adapter.calls.length, 0)
})

test("provider success with failed database acknowledgement never resends", async () => {
  const mode = createMode()
  mode.rpcHandlers.mark_paid_order_notification_delivered = () => ({
    data: false,
    error: null,
  })
  const { result, adapter } = await invokeCore(mode)
  assert.equal(result.result, "CHILD_ACK_UNCERTAIN")
  assert.equal(adapter.calls.length, 1)
  mode.tableData.notification_deliveries[0] = child("customer", "processing")
  await invokeCore(mode, adapter)
  assert.equal(
    adapter.calls.filter(({ recipientKind }) => recipientKind === "customer").length,
    1
  )
  assert.equal(
    mode.rpcCalls.filter(
      ({ name, parameters }) =>
        name === "begin_paid_order_notification_delivery" &&
        parameters.p_delivery_id === customerChildId
    ).length,
    1
  )
  assert.equal(
    mode.rpcCalls.some((call) => call.name === "mark_paid_order_outbox_failed"),
    false
  )
})

test("each child is processed at most once per invocation", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  await invokeCore(mode, adapter)
  assert.equal(new Set(adapter.calls.map((call) => call.idempotencyKey)).size, 2)
  assert.equal(adapter.calls.length, 2)
})

test("child sends are sequential", async () => {
  const mode = createMode()
  const adapter = createAdapter([
    async () => {
      await new Promise((resolve) => queueMicrotask(resolve))
      return { outcome: "DELIVERED", providerMessageId: "first" }
    },
    async () => ({ outcome: "DELIVERED", providerMessageId: "second" }),
  ])
  await invokeCore(mode, adapter)
  assert.equal(adapter.maxInFlight, 1)
})

test("parent delivery occurs only through hardened parent RPC", async () => {
  const mode = createMode()
  const { result } = await invokeCore(mode)
  assert.equal(result.result, "DELIVERED")
  assert.equal(
    mode.rpcCalls.filter((call) => call.name === "mark_paid_order_outbox_delivered")
      .length,
    1
  )
})

test("parent delivered false schedules bounded parent failure", async () => {
  const mode = createMode()
  mode.rpcHandlers.mark_paid_order_outbox_delivered = () => ({
    data: false,
    error: null,
  })
  const { result } = await invokeCore(mode)
  assert.equal(result.code, "CHILDREN_INCOMPLETE")
  assert.equal(mode.rpcCalls.at(-1).name, "mark_paid_order_outbox_failed")
})

test("stale parent lease during failure is a controlled stop", async () => {
  const mode = createMode()
  mode.rpcHandlers.expand_paid_order_notification_deliveries = () => ({
    data: null,
    error: { code: "private" },
  })
  mode.rpcHandlers.mark_paid_order_outbox_failed = () => ({ data: [], error: null })
  const { result } = await invokeCore(mode)
  assert.equal(result.result, "PARENT_LEASE_LOST")
})

test("dispatcher performs no direct outbox or child writes", () => {
  assert.doesNotMatch(
    source,
    /\.from\(["'](?:outbox_events|notification_deliveries)["']\)[\s\S]{0,120}\.(?:insert|update|delete|upsert)\(/
  )
})

test("dispatcher performs no financial mutation", () => {
  assert.doesNotMatch(
    source,
    /\.from\(["'](?:payments|payment_events|orders|order_items|payout_ledger|vendors|products)["']\)[\s\S]{0,120}\.(?:insert|update|delete|upsert)\(/
  )
  assert.doesNotMatch(source, /finalize_paystack_paid_order/)
})

test("dispatcher performs no stock mutation", () => {
  assert.doesNotMatch(source, /decrement_stock|\.update\(\{[^}]*stock/i)
})

test("dispatcher makes no Paystack call", () => {
  assert.doesNotMatch(source, /paystack|transaction\/initialize/i)
})

test("dispatcher contains no concrete HTTP provider implementation", () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.equal(activeMode.fetchCalls.length, 0)
})

test("service-role client is isolated and sessionless", async () => {
  const mode = createMode()
  await invokeProduction(mode)
  assert.equal(mode.clientCreations.length, 0)
  assert.match(source, /autoRefreshToken: false/)
  assert.match(source, /persistSession: false/)
  assert.match(source, /detectSessionInUrl: false/)
})

test("controlled logs contain fixed markers only", async () => {
  const mode = createMode()
  mode.tableErrors.orders = {
    code: "private",
    message: "customer@example.test 22222222-2222-4222-8222-222222222222",
  }
  await invokeCore(mode)
  assert.ok(mode.logs.length > 0)
  assert.doesNotMatch(JSON.stringify(mode.logs), /customer@example\.test|22222222/)
  assert.ok(mode.logs.every((entry) => /^MARKETA_DISPATCH_[A-Z_]+$/.test(entry[0])))
})

test("provider attempt idempotency keys are absent from logs and HTTP responses", async () => {
  const mode = createMode()
  const adapter = createAdapter()
  const { body } = await invokeHttp(mode, adapter)
  const providerKey = `paid-order:${orderId}:customer:email:attempt:1`
  assert.equal(adapter.calls[0].idempotencyKey, providerKey)
  assert.equal(JSON.stringify(mode.logs).includes(providerKey), false)
  assert.equal(JSON.stringify(body).includes(providerKey), false)
})

test("HTTP responses exclude PII secrets and identifiers", async () => {
  const mode = createMode()
  mode.rpcHandlers.claim_paid_order_outbox = () => ({
    data: null,
    error: { message: `customer@example.test ${orderId} ${dispatcherSecret}` },
  })
  const { body } = await invokeHttp(mode, createAdapter())
  const text = JSON.stringify(body)
  assert.doesNotMatch(text, /customer@example\.test|22222222|dispatcher-test-secret/)
})

test("successful delivered HTTP response contains only count and fixed result", async () => {
  const mode = createMode()
  const { response, body } = await invokeHttp(mode, createAdapter())
  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    result: "DELIVERED",
    parents_processed: 1,
  })
  assert.doesNotMatch(JSON.stringify(body), /message-[0-9]+/)
})

test("HTTP endpoint never accepts a caller service-role credential field", async () => {
  const mode = createMode()
  await invokeHttp(mode, createAdapter(), {
    body: { service_role_key: "caller-controlled", batch_size: 9 },
  })
  assert.equal(mode.clientCreations[0].key, "test-service-role-key")
  assert.doesNotMatch(source, /request\.(?:json|text|formData|arrayBuffer)\(/)
})

test("source has no scheduler cron net or n8n integration", () => {
  assert.doesNotMatch(source, /pg_cron|pg_net|cron\.|n8n/i)
})

test("only approved lifecycle RPC names appear", () => {
  const names = [...source.matchAll(/safeRpc\([^,]+,\s*"([a-z_]+)"/g)].map(
    (match) => match[1]
  )
  const approved = new Set([
    "claim_paid_order_outbox",
    "expand_paid_order_notification_deliveries",
    "begin_paid_order_notification_delivery",
    "mark_paid_order_notification_delivered",
    "mark_paid_order_notification_failed",
    "mark_paid_order_notification_unknown",
    "mark_paid_order_outbox_delivered",
    "mark_paid_order_outbox_failed",
  ])
  assert.ok(names.length >= 8)
  assert.ok(names.every((name) => approved.has(name)))
})

test("source does not expose batch size through request parsing", () => {
  assert.doesNotMatch(source, /batch_size[^\n]*(?:request|body|json)/i)
  assert.match(source, /p_batch_size: 1/)
})

test("provider success acknowledgement failure preserves processing evidence", () => {
  const deliveredBranch = source.slice(
    source.indexOf('outcome.outcome === "DELIVERED"'),
    source.indexOf('outcome.outcome === "UNKNOWN"')
  )
  assert.match(deliveredBranch, /CHILD_ACK_UNCERTAIN/)
  assert.doesNotMatch(deliveredBranch, /mark_paid_order_notification_failed/)
  assert.doesNotMatch(deliveredBranch, /mark_paid_order_notification_unknown/)
})

test("provider key uses only the delivery key and persisted attempt count", () => {
  const keyBuilder = source.slice(
    source.indexOf("function providerAttemptIdempotencyKey"),
    source.indexOf("async function acknowledgeUnknown")
  )
  assert.match(keyBuilder, /`\$\{deliveryKey\}:attempt:\$\{attemptCount\}`/)
  assert.match(keyBuilder, /key\.length >= 1 && key\.length <= 256/)
  assert.doesNotMatch(keyBuilder, /attemptToken|attempt_token|randomUUID|crypto\./)
})

test("core never reclaims inside one invocation", () => {
  assert.equal((source.match(/"claim_paid_order_outbox"/g) ?? []).length, 1)
})
