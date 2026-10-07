import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionDirectory = "supabase/functions/dispatch-paid-order-outbox"
const emailFile = `${functionDirectory}/paid-order-email.ts`
const adapterFile = `${functionDirectory}/resend-adapter.ts`
const emailSource = fs.readFileSync(path.join(root, emailFile), "utf8")
const adapterSource = fs.readFileSync(path.join(root, adapterFile), "utf8")
const logs = []

function compile(source, filename, requireModule = () => {
  throw new Error("Unexpected runtime import")
}) {
  const compiledModule = { exports: {} }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  vm.runInNewContext(
    output,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require: requireModule,
      AbortController,
      BigInt,
      Response,
      TextDecoder,
      Uint8Array,
      clearTimeout,
      fetch: () => {
        throw new Error("Real network access is forbidden")
      },
      setTimeout,
      console: {
        error(...values) {
          logs.push(values)
        },
        log(...values) {
          logs.push(values)
        },
      },
    },
    { filename }
  )
  return compiledModule.exports
}

const emailModule = compile(emailSource, emailFile)
const adapterModule = compile(adapterSource, adapterFile, (name) => {
  if (name === "./paid-order-email.ts") return emailModule
  throw new Error(`Unexpected import: ${name}`)
})
const { escapeHtml, formatKobo, renderPaidOrderEmail } = emailModule
const { createProductionEmailAdapter, validSender } = adapterModule

const apiKey = "re_abcdefghijklmnopqrstuvwxyz012345"
const sender = "Marketa <orders@marketa.example>"
const orderId = "11111111-1111-4111-8111-111111111111"
const vendorId = "22222222-2222-4222-8222-222222222222"
const attemptKey = `paid-order:${orderId}:customer:email:attempt:1`

function env(values = {}) {
  const configuration = {
    RESEND_API_KEY: apiKey,
    MARKETA_EMAIL_FROM: sender,
    ...values,
  }
  return (name) => configuration[name]
}

function customerCommand(overrides = {}) {
  return {
    recipientKind: "customer",
    to: "customer@example.test",
    idempotencyKey: attemptKey,
    orderId,
    totalAmountKobo: "500000",
    currency: "NGN",
    items: [
      {
        productName: "Market Basket",
        quantity: 2,
        grossAmountKobo: "500000",
      },
    ],
    ...overrides,
  }
}

function vendorCommand(overrides = {}) {
  return {
    recipientKind: "vendor",
    to: "vendor@example.test",
    idempotencyKey: `paid-order:${orderId}:vendor:${vendorId}:email:attempt:1`,
    orderId,
    vendor: { id: vendorId, name: "Test Vendor" },
    items: [
      {
        productName: "Vendor Product",
        quantity: 2,
        grossAmountKobo: "500000",
        platformFeeAmountKobo: "25000",
        vendorNetAmountKobo: "475000",
        currency: "NGN",
      },
    ],
    ...overrides,
  }
}

function jsonResponse(status = 200, body = { id: "provider-message-1" }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function createFetch(response = jsonResponse()) {
  const calls = []
  const fetchImpl = async (...parameters) => {
    calls.push(parameters)
    return response
  }
  return { calls, fetchImpl }
}

function normalized(value) {
  return JSON.parse(JSON.stringify(value))
}

test("provider configuration rejects missing and malformed API keys", () => {
  for (const value of [undefined, "", "not-resend", " re_valid", "re_bad key"] ) {
    const { fetchImpl } = createFetch()
    assert.equal(
      createProductionEmailAdapter(env({ RESEND_API_KEY: value }), fetchImpl),
      null
    )
  }
})

test("provider configuration rejects missing malformed and injected senders", () => {
  for (const value of [
    undefined,
    "",
    "not-an-email",
    "sender@example.com\r\nBcc: victim@example.com",
    " sender@example.com",
    "Display <sender@example.com> ",
  ]) {
    const { fetchImpl } = createFetch()
    assert.equal(
      createProductionEmailAdapter(env({ MARKETA_EMAIL_FROM: value }), fetchImpl),
      null
    )
  }
})

test("simple and display-name senders are accepted exactly", () => {
  assert.equal(validSender("orders@marketa.example"), true)
  assert.equal(validSender("Marketa Orders <orders@marketa.example>"), true)
  assert.ok(
    createProductionEmailAdapter(
      env({ MARKETA_EMAIL_FROM: "orders@marketa.example" }),
      createFetch().fetchImpl
    )
  )
  assert.ok(createProductionEmailAdapter(env(), createFetch().fetchImpl))
})

test("configuration values and provider failures are never logged", async () => {
  logs.length = 0
  const adapter = createProductionEmailAdapter(env(), async () => {
    throw new Error(`private ${apiKey} ${sender}`)
  })
  assert.ok(adapter)
  await adapter.sendEmail(customerCommand())
  assert.deepEqual(logs, [])
  assert.doesNotMatch(adapterSource, /console\.(?:log|error|warn)/)
})

test("adapter emits exactly one minimal Resend request", async () => {
  const transport = createFetch()
  const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
  assert.ok(adapter)
  const result = await adapter.sendEmail(customerCommand())
  assert.deepEqual(normalized(result), {
    outcome: "DELIVERED",
    providerMessageId: "provider-message-1",
  })
  assert.equal(transport.calls.length, 1)
  const [url, init] = transport.calls[0]
  assert.equal(url, "https://api.resend.com/emails")
  assert.equal(init.method, "POST")
  assert.equal(init.headers.Authorization, `Bearer ${apiKey}`)
  assert.equal(init.headers["Content-Type"], "application/json")
  assert.equal(init.headers["Idempotency-Key"], attemptKey)
  const body = JSON.parse(init.body)
  assert.deepEqual(Object.keys(body).sort(), ["from", "html", "subject", "text", "to"])
  assert.equal(body.from, sender)
  assert.deepEqual(body.to, ["customer@example.test"])
  assert.equal(body.subject, "Your Marketa order is confirmed")
  assert.equal(typeof body.html, "string")
  assert.equal(typeof body.text, "string")
  assert.doesNotMatch(init.body, new RegExp(`${orderId}|${vendorId}|payment.reference|attempt_token|lease_token`, "i"))
})

test("oversized or controlled idempotency keys fail before fetch", async () => {
  for (const idempotencyKey of ["x".repeat(257), "bad\nkey", ""]) {
    const transport = createFetch()
    const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
    const result = await adapter.sendEmail(customerCommand({ idempotencyKey }))
    assert.deepEqual(normalized(result), {
      outcome: "PERMANENT_FAILURE",
      diagnosticCode: "RESEND_INVALID_REQUEST",
    })
    assert.equal(transport.calls.length, 0)
  }
})

test("customer renderer includes only customer-safe paid-order facts", () => {
  const rendered = renderPaidOrderEmail(customerCommand())
  assert.equal(rendered.subject, "Your Marketa order is confirmed")
  assert.match(rendered.html, /Payment received/)
  assert.match(rendered.html, /Market Basket/)
  assert.match(rendered.html, /Quantity: 2/)
  assert.match(rendered.html, /Gross amount: NGN 5,000\.00/)
  assert.match(rendered.html, /Total paid: NGN 5,000\.00/)
  assert.doesNotMatch(rendered.html, /platform fee|vendor net|vendor@example/i)
  assert.doesNotMatch(rendered.html, new RegExp(`${orderId}|${vendorId}`))
})

test("vendor renderer contains only the supplied vendor financial facts", () => {
  const rendered = renderPaidOrderEmail(vendorCommand())
  assert.equal(rendered.subject, "New paid order on Marketa")
  assert.match(rendered.html, /Test Vendor/)
  assert.match(rendered.html, /Vendor Product/)
  assert.match(rendered.html, /Gross amount: NGN 5,000\.00/)
  assert.match(rendered.html, /Platform fee: NGN 250\.00/)
  assert.match(rendered.html, /Vendor net: NGN 4,750\.00/)
  assert.doesNotMatch(rendered.html, /customer@example|customer phone/i)
  assert.doesNotMatch(rendered.html, new RegExp(`${orderId}|${vendorId}`))
})

test("HTML escapes all required special characters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;")
  const rendered = renderPaidOrderEmail(
    vendorCommand({
      vendor: { id: vendorId, name: `A & <B> "C" 'D'` },
      items: [
        {
          ...vendorCommand().items[0],
          productName: `P & <Q> "R" 'S'`,
        },
      ],
    })
  )
  assert.match(rendered.html, /A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;/)
  assert.match(rendered.html, /P &amp; &lt;Q&gt; &quot;R&quot; &#39;S&#39;/)
  assert.doesNotMatch(rendered.html, /<B>|<Q>/)
})

test("plain text is rendered explicitly without HTML markup", () => {
  const rendered = renderPaidOrderEmail(customerCommand())
  assert.match(rendered.text, /Purchased items:/)
  assert.match(rendered.text, /Market Basket — Quantity: 2/)
  assert.match(rendered.text, /Total paid: NGN 5,000\.00/)
  assert.doesNotMatch(rendered.text, /<[^>]+>/)
})

test("money formatting is exact and BigInt-safe", () => {
  assert.equal(formatKobo("500000", "NGN"), "NGN 5,000.00")
  assert.equal(formatKobo("999999999999", "NGN"), "NGN 9,999,999,999.99")
  assert.equal(formatKobo("900719925474099312345", "USD"), "USD 9,007,199,254,740,993,123.45")
  const formatter = emailSource.slice(
    emailSource.indexOf("export function formatKobo"),
    emailSource.indexOf("function validItem")
  )
  assert.match(formatter, /BigInt\(kobo\)/)
  assert.doesNotMatch(formatter, /Number\(|parseFloat|parseInt/)
})

test("valid 2xx response requires a bounded provider message ID", async () => {
  for (const [body, expected] of [
    [{ id: "provider-message-2" }, { outcome: "DELIVERED", providerMessageId: "provider-message-2" }],
    [{}, { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }],
    [{ id: "" }, { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }],
    [{ id: "bad\nidentifier" }, { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }],
    [{ id: "x".repeat(256) }, { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }],
  ]) {
    const transport = createFetch(jsonResponse(200, body))
    const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
    assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), expected)
    assert.equal(transport.calls.length, 1)
  }
})

test("malformed 2xx JSON is UNKNOWN", async () => {
  const transport = createFetch(new Response("not-json", { status: 201 }))
  const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
  assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
    outcome: "UNKNOWN",
    diagnosticCode: "RESEND_PROVIDER_UNCERTAIN",
  })
})

test("known HTTP failures use exact conservative classifications", async () => {
  const cases = new Map([
    [400, ["PERMANENT_FAILURE", "RESEND_INVALID_REQUEST"]],
    [401, ["RETRYABLE_FAILURE", "RESEND_UNAUTHORIZED"]],
    [403, ["RETRYABLE_FAILURE", "RESEND_FORBIDDEN"]],
    [404, ["PERMANENT_FAILURE", "RESEND_NOT_FOUND"]],
    [408, ["UNKNOWN", "RESEND_REQUEST_UNCERTAIN"]],
    [409, ["UNKNOWN", "RESEND_IDEMPOTENCY_UNCERTAIN"]],
    [422, ["PERMANENT_FAILURE", "RESEND_VALIDATION_FAILED"]],
    [429, ["RETRYABLE_FAILURE", "RESEND_RATE_LIMITED"]],
  ])
  for (const [status, [outcome, diagnosticCode]] of cases) {
    const transport = createFetch(new Response("private provider body", { status }))
    const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
    assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
      outcome,
      diagnosticCode,
    })
    assert.equal(transport.calls.length, 1)
  }
})

test("ambiguous HTTP responses never enter the retryable state", async () => {
  for (const [status, diagnosticCode] of [
    [408, "RESEND_REQUEST_UNCERTAIN"],
    [409, "RESEND_IDEMPOTENCY_UNCERTAIN"],
    [500, "RESEND_PROVIDER_UNCERTAIN"],
    [502, "RESEND_PROVIDER_UNCERTAIN"],
    [503, "RESEND_PROVIDER_UNCERTAIN"],
  ]) {
    const transport = createFetch(new Response("private provider body", { status }))
    const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
    const result = normalized(await adapter.sendEmail(customerCommand()))
    assert.deepEqual(result, { outcome: "UNKNOWN", diagnosticCode })
    assert.notEqual(result.outcome, "RETRYABLE_FAILURE")
    assert.equal(transport.calls.length, 1)
  }
})

test("5xx and unexpected HTTP statuses are UNKNOWN", async () => {
  for (const status of [500, 502, 503, 418]) {
    const transport = createFetch(new Response("private provider body", { status }))
    const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
    assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
      outcome: "UNKNOWN",
      diagnosticCode: "RESEND_PROVIDER_UNCERTAIN",
    })
    assert.equal(transport.calls.length, 1)
  }
})

test("AbortError and generic network throws are UNKNOWN without retry", async () => {
  for (const failure of [
    new DOMException("aborted", "AbortError"),
    new Error("private transport failure"),
  ]) {
    let calls = 0
    const adapter = createProductionEmailAdapter(env(), async () => {
      calls += 1
      throw failure
    })
    assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
      outcome: "UNKNOWN",
      diagnosticCode: "PROVIDER_RESULT_UNKNOWN",
    })
    assert.equal(calls, 1)
  }
})

test("the eight-second abort contract produces UNKNOWN without resend", async () => {
  let calls = 0
  let capturedSignal
  const adapter = createProductionEmailAdapter(
    env(),
    async (_url, init) => {
      calls += 1
      capturedSignal = init.signal
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        )
      })
    },
    1
  )
  assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
    outcome: "UNKNOWN",
    diagnosticCode: "PROVIDER_RESULT_UNKNOWN",
  })
  assert.equal(calls, 1)
  assert.equal(capturedSignal.aborted, true)
  assert.match(adapterSource, /const PROVIDER_TIMEOUT_MS = 8_000/)
})

test("provider timeout remains active while a success body is consumed", async () => {
  let calls = 0
  const adapter = createProductionEmailAdapter(
    env(),
    async (_url, init) => {
      calls += 1
      return new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true }
            )
          },
        }),
        { status: 200 }
      )
    },
    1
  )
  assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
    outcome: "UNKNOWN",
    diagnosticCode: "RESEND_PROVIDER_UNCERTAIN",
  })
  assert.equal(calls, 1)
})

test("oversized success responses are UNKNOWN and bounded", async () => {
  const transport = createFetch(new Response("x".repeat(16 * 1024 + 1), { status: 200 }))
  const adapter = createProductionEmailAdapter(env(), transport.fetchImpl)
  assert.deepEqual(normalized(await adapter.sendEmail(customerCommand())), {
    outcome: "UNKNOWN",
    diagnosticCode: "RESEND_PROVIDER_UNCERTAIN",
  })
  assert.equal(transport.calls.length, 1)
  assert.match(adapterSource, /const MAX_RESPONSE_BYTES = 16 \* 1024/)
})

test("provider response bodies raw exceptions and IDs are never logged", async () => {
  logs.length = 0
  const privateBody = "private-provider-body"
  const providerId = "private-provider-id"
  const first = createProductionEmailAdapter(
    env(),
    createFetch(new Response(privateBody, { status: 500 })).fetchImpl
  )
  const second = createProductionEmailAdapter(
    env(),
    createFetch(jsonResponse(200, { id: providerId })).fetchImpl
  )
  await first.sendEmail(customerCommand())
  await second.sendEmail(customerCommand())
  assert.deepEqual(logs, [])
})

test("adapter source has no retry loop or provider-specific side channel", () => {
  assert.equal((adapterSource.match(/await fetchImpl\(/g) ?? []).length, 1)
  assert.doesNotMatch(adapterSource, /while\s*\([^)]*fetch|for\s*\([^)]*fetch/)
  assert.doesNotMatch(adapterSource, /n8n|paystack|smtp|reply[_-]?to/i)
})
