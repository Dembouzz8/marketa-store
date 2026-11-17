import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const moduleFile = "src/lib/order-data-server.ts"
const moduleSource = fs.readFileSync(path.join(root, moduleFile), "utf8")
const migrationFile = fs
  .readdirSync(path.join(root, "supabase", "migrations"))
  .find((name) => name.endsWith("_restrict_order_base_table_select.sql"))
assert.ok(migrationFile, "D4-3 migration must exist")
const migrationSource = fs.readFileSync(
  path.join(root, "supabase", "migrations", migrationFile),
  "utf8"
)

function loadOrderDataModule() {
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const testModule = { exports: {} }
  const productionClient = {
    from() {
      throw new Error("Production privileged client used in a unit test")
    },
  }
  const testRequire = (specifier) => {
    if (specifier === "server-only") return {}
    if (specifier === "@/lib/supabase-server") {
      return {
        createSupabaseServerClient: async () => ({
          auth: { getUser: async () => ({ data: { user: null }, error: null }) },
        }),
        supabaseAdmin: productionClient,
      }
    }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const execute = new Function("require", "exports", "module", compiled)
  execute(testRequire, testModule.exports, testModule)
  return testModule.exports
}

const { createOrderDataAccess } = loadOrderDataModule()

const ids = {
  customerA: "11111111-1111-4111-8111-111111111111",
  customerB: "22222222-2222-4222-8222-222222222222",
  dualUser: "33333333-3333-4333-8333-333333333333",
  vendorA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  vendorB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  order: "44444444-4444-4444-8444-444444444444",
  otherOrder: "55555555-5555-4555-8555-555555555555",
  itemA: "66666666-6666-4666-8666-666666666666",
  itemB: "77777777-7777-4777-8777-777777777777",
  productA: "88888888-8888-4888-8888-888888888888",
  productB: "99999999-9999-4999-8999-999999999999",
}

function customerOrder(overrides = {}) {
  return {
    id: ids.order,
    customer_id: ids.customerA,
    customer_email: "customer-a@example.test",
    status: "confirmed",
    total_amount: "200.00",
    total_amount_kobo: "20000",
    currency: "NGN",
    financial_contract_version: 2,
    created_at: "2026-11-13T08:00:00Z",
    payment_ref: "internal-payment-reference",
    idempotency_key: "internal-idempotency-key",
    checkout_attempt_id: ids.otherOrder,
    order_items: [vendorItem()],
    ...overrides,
  }
}

function vendorItem(overrides = {}) {
  return {
    id: ids.itemA,
    order_id: ids.order,
    product_id: ids.productA,
    vendor_id: ids.vendorA,
    quantity: 2,
    unit_price: "100.00",
    subtotal: "200.00",
    unit_amount_kobo: "10000",
    gross_amount_kobo: "20000",
    platform_fee_bps: 500,
    platform_fee_amount_kobo: "1000",
    vendor_net_amount_kobo: "19000",
    currency: "NGN",
    financial_contract_version: 2,
    product_variant_id: null,
    variant_size_snapshot: null,
    variant_colour_snapshot: null,
    variant_options_snapshot: null,
    products: {
      id: ids.productA,
      name: "Stored product",
      images: ["https://example.test/product.jpg"],
    },
    ...overrides,
  }
}

function orderSummary(status = "confirmed", overrides = {}) {
  return {
    id: ids.order,
    status,
    created_at: "2026-11-13T08:00:00Z",
    total_amount: "9999.00",
    payment_ref: "must-not-leak",
    ...overrides,
  }
}

function fulfillment(status = "confirmed") {
  return {
    id: ids.order,
    status,
    customer_email: "buyer@example.test",
    customer_phone: "+2348000000000",
    shipping_address: {
      address: "1 Test Street",
      city: "Lagos",
      state: "Lagos",
    },
    payment_ref: "must-not-leak",
    total_amount_kobo: "999900",
  }
}

function instrument({ userId = ids.customerA, authError = null, authThrows = false, responder }) {
  const calls = []

  function builder(request) {
    const chain = {
      select(fields, options) {
        request.fields = fields
        request.selectOptions = options
        return chain
      },
      eq(column, value) {
        request.filters.push({ kind: "eq", column, value })
        return chain
      },
      in(column, value) {
        request.filters.push({ kind: "in", column, value })
        return chain
      },
      limit(value) {
        request.limit = value
        return chain
      },
      order(column, options) {
        request.order = { column, options }
        return chain
      },
      range(from, to) {
        request.range = { from, to }
        return chain
      },
      maybeSingle() {
        request.maybeSingle = true
        return Promise.resolve(responder(request))
      },
      then(resolve, reject) {
        return Promise.resolve(responder(request)).then(resolve, reject)
      },
    }
    return chain
  }

  const dependencies = {
    async createAuthenticatedClient() {
      calls.push({ kind: "auth" })
      return {
        auth: {
          async getUser() {
            if (authThrows) throw new Error("auth unavailable")
            return {
              data: { user: userId ? { id: userId } : null },
              error: authError,
            }
          },
        },
      }
    },
    privilegedClient: {
      from(table) {
        const request = { kind: "query", table, filters: [] }
        calls.push(request)
        return builder(request)
      },
    },
  }

  return { access: createOrderDataAccess(dependencies), calls }
}

function standardVendorResponder({ vendorId = ids.vendorA, status = "confirmed" } = {}) {
  return (request) => {
    if (request.table === "vendors") {
      return { data: [{ id: vendorId }], error: null }
    }
    if (request.table === "order_items") {
      return { data: [vendorItem({ vendor_id: vendorId })], error: null }
    }
    if (request.fields === "id, status, created_at") {
      return { data: request.maybeSingle ? orderSummary(status) : [orderSummary(status)], error: null }
    }
    if (String(request.fields).includes("customer_email")) {
      return { data: fulfillment(status), error: null }
    }
    throw new Error(`Unexpected query: ${request.table} ${request.fields}`)
  }
}

test("missing authentication performs no privileged query", async () => {
  const { access, calls } = instrument({
    userId: null,
    responder: () => assert.fail("privileged query should not run"),
  })
  assert.deepEqual(await access.getCustomerOrderHistory({ page: 1, pageSize: 20 }), {
    ok: false,
    code: "AUTH_REQUIRED",
  })
  assert.deepEqual(calls, [{ kind: "auth" }])
})

test("authentication errors and exceptions fail before privileged access", async () => {
  for (const options of [{ authError: { message: "invalid" } }, { authThrows: true }]) {
    const { access, calls } = instrument({
      ...options,
      responder: () => assert.fail("privileged query should not run"),
    })
    assert.deepEqual(await access.getVendorOrderHistory(), {
      ok: false,
      code: "AUTH_REQUIRED",
    })
    assert.equal(calls.length, 1)
  }
})

test("customer history binds the verified identity and strips fee and internal fields", async () => {
  const { access, calls } = instrument({
    responder(request) {
      assert.equal(request.table, "orders")
      return { data: [customerOrder()], error: null, count: 1 }
    },
  })
  const result = await access.getCustomerOrderHistory({ page: 1, pageSize: 20 })
  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].order_items[0].gross_amount_kobo, "20000")
  const serialized = JSON.stringify(result.data)
  for (const forbidden of [
    "platform_fee_bps",
    "platform_fee_amount_kobo",
    "vendor_net_amount_kobo",
    "customer_id",
    "customer_email",
    "payment_ref",
    "idempotency_key",
    "checkout_attempt_id",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden))
  }
  const query = calls.find((call) => call.kind === "query")
  assert.deepEqual(query.filters, [
    { kind: "eq", column: "customer_id", value: ids.customerA },
  ])
  assert.doesNotMatch(query.fields, /platform_fee|vendor_net|payment_ref|idempotency/u)
})

test("customer B cannot select customer A through caller-controlled input", async () => {
  const { access, calls } = instrument({
    userId: ids.customerB,
    responder: () => ({ data: [], error: null, count: 0 }),
  })
  const result = await access.getCustomerOrderHistory({ page: 1, pageSize: 20 })
  assert.deepEqual(result, {
    ok: true,
    data: { orders: [], totalOrders: 0 },
  })
  const query = calls.find((call) => call.kind === "query")
  assert.deepEqual(query.filters, [
    { kind: "eq", column: "customer_id", value: ids.customerB },
  ])
})

test("invalid pagination and customer query failures fail closed", async () => {
  const invalid = instrument({
    responder: () => assert.fail("query should not run"),
  })
  assert.deepEqual(
    await invalid.access.getCustomerOrderHistory({ page: 0, pageSize: 20 }),
    { ok: false, code: "INVALID_REQUEST" }
  )
  assert.equal(invalid.calls.length, 1)

  const failed = instrument({
    responder: () => ({ data: null, error: { message: "denied" } }),
  })
  assert.deepEqual(
    await failed.access.getCustomerOrderHistory({ page: 1, pageSize: 20 }),
    { ok: false, code: "QUERY_FAILED" }
  )
})

test("missing and ambiguous vendor ownership fail closed", async () => {
  for (const vendors of [[], [{ id: ids.vendorA }, { id: ids.vendorB }]]) {
    const { access, calls } = instrument({
      responder: (request) => {
        assert.equal(request.table, "vendors")
        return { data: vendors, error: null }
      },
    })
    assert.deepEqual(await access.getVendorOrderHistory(), {
      ok: false,
      code: "VENDOR_ACCESS_DENIED",
    })
    assert.equal(calls.filter((call) => call.kind === "query").length, 1)
  }
})

test("vendor A history binds vendors.user_id and every item read to vendor A", async () => {
  const { access, calls } = instrument({ responder: standardVendorResponder() })
  const result = await access.getVendorOrderHistory()
  assert.equal(result.ok, true)
  assert.equal(result.data.items[0].vendor_id, ids.vendorA)
  assert.equal(result.data.items[0].vendor_net_amount_kobo, "19000")
  assert.deepEqual(result.data.orders[0], {
    id: ids.order,
    status: "confirmed",
    created_at: "2026-11-13T08:00:00Z",
  })
  assert.doesNotMatch(JSON.stringify(result.data.orders), /total_amount|payment_ref/u)
  const vendorQuery = calls.find((call) => call.table === "vendors")
  assert.deepEqual(vendorQuery.filters, [
    { kind: "eq", column: "user_id", value: ids.customerA },
  ])
  const itemQuery = calls.find((call) => call.table === "order_items")
  assert.deepEqual(itemQuery.filters, [
    { kind: "eq", column: "vendor_id", value: ids.vendorA },
  ])
})

test("vendor B receives only vendor B item financials in a shared order", async () => {
  const { access } = instrument({
    userId: ids.customerB,
    responder: standardVendorResponder({ vendorId: ids.vendorB }),
  })
  const result = await access.getVendorOrderHistory()
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.items.map((item) => item.vendor_id), [ids.vendorB])
})

test("a cross-vendor row returned by the privileged client is rejected", async () => {
  const { access } = instrument({
    responder(request) {
      if (request.table === "vendors") return { data: [{ id: ids.vendorA }], error: null }
      if (request.table === "order_items") {
        return { data: [vendorItem({ vendor_id: ids.vendorB })], error: null }
      }
      assert.fail("parent order query must not run")
    },
  })
  assert.deepEqual(await access.getVendorOrderHistory(), {
    ok: false,
    code: "QUERY_FAILED",
  })
})

test("invalid order identifiers are rejected before vendor or order queries", async () => {
  const { access, calls } = instrument({
    responder: () => assert.fail("privileged query should not run"),
  })
  assert.deepEqual(await access.getVendorOrderDetail("not-a-uuid"), {
    ok: false,
    code: "INVALID_REQUEST",
  })
  assert.deepEqual(calls, [{ kind: "auth" }])
})

test("cross-vendor detail denial never reads the parent order", async () => {
  const { access, calls } = instrument({
    responder(request) {
      if (request.table === "vendors") return { data: [{ id: ids.vendorA }], error: null }
      if (request.table === "order_items") return { data: [], error: null }
      assert.fail("parent order query must not run")
    },
  })
  assert.deepEqual(await access.getVendorOrderDetail(ids.order), {
    ok: false,
    code: "ORDER_NOT_FOUND",
  })
  assert.deepEqual(
    calls.filter((call) => call.kind === "query").map((call) => call.table),
    ["vendors", "order_items"]
  )
})

test("vendor detail proves item ownership before reading its parent", async () => {
  const { access, calls } = instrument({ responder: standardVendorResponder() })
  const result = await access.getVendorOrderDetail(ids.order)
  assert.equal(result.ok, true)
  const queryTables = calls
    .filter((call) => call.kind === "query")
    .map((call) => call.table)
  assert.deepEqual(queryTables, ["vendors", "order_items", "orders", "orders"])
  const itemQuery = calls.find((call) => call.table === "order_items")
  assert.deepEqual(itemQuery.filters, [
    { kind: "eq", column: "order_id", value: ids.order },
    { kind: "eq", column: "vendor_id", value: ids.vendorA },
  ])
})

for (const status of ["pending", "cancelled", "unknown"]) {
  test(`${status} vendor detail never queries or returns fulfillment PII`, async () => {
    const { access, calls } = instrument({
      responder: standardVendorResponder({ status }),
    })
    const result = await access.getVendorOrderDetail(ids.order)
    assert.equal(result.ok, true)
    assert.equal(result.data.order.fulfillment, null)
    assert.equal(
      calls.filter(
        (call) => call.table === "orders" && String(call.fields).includes("customer_email")
      ).length,
      0
    )
  })
}

for (const status of ["confirmed", "fulfilled"]) {
  test(`${status} vendor detail exposes only fulfillment contact fields`, async () => {
    const { access, calls } = instrument({
      responder: standardVendorResponder({ status }),
    })
    const result = await access.getVendorOrderDetail(ids.order)
    assert.equal(result.ok, true)
    assert.equal(result.data.order.fulfillment.customer_email, "buyer@example.test")
    assert.doesNotMatch(
      JSON.stringify(result.data.order.fulfillment),
      /payment_ref|total_amount|checkout_attempt|idempotency/u
    )
    const piiQuery = calls.find(
      (call) => call.table === "orders" && String(call.fields).includes("customer_email")
    )
    assert.deepEqual(piiQuery.filters, [
      { kind: "eq", column: "id", value: ids.order },
      {
        kind: "in",
        column: "status",
        value: ["confirmed", "fulfilled"],
      },
    ])
    assert.doesNotMatch(piiQuery.fields, /payment_ref|total_amount|idempotency/u)
  })
}

test("a fulfillment query error fails closed without returning order data", async () => {
  const responder = standardVendorResponder()
  const { access } = instrument({
    responder(request) {
      if (String(request.fields).includes("customer_email")) {
        return { data: null, error: { message: "unavailable" } }
      }
      return responder(request)
    },
  })
  assert.deepEqual(await access.getVendorOrderDetail(ids.order), {
    ok: false,
    code: "QUERY_FAILED",
  })
})

test("dual customer/vendor identity uses separate projections without widening", async () => {
  const { access, calls } = instrument({
    userId: ids.dualUser,
    responder(request) {
      if (request.table === "vendors") return { data: [{ id: ids.vendorA }], error: null }
      if (request.table === "order_items") return { data: [vendorItem()], error: null }
      if (String(request.fields).includes("order_items")) {
        return { data: [customerOrder()], error: null, count: 1 }
      }
      return { data: [orderSummary()], error: null }
    },
  })
  const customer = await access.getCustomerOrderHistory({ page: 1, pageSize: 20 })
  const vendor = await access.getVendorOrderHistory()
  assert.equal(customer.ok, true)
  assert.equal(vendor.ok, true)
  assert.doesNotMatch(JSON.stringify(customer.data), /platform_fee|vendor_net/u)
  assert.doesNotMatch(JSON.stringify(vendor.data.orders), /total_amount/u)
  const customerQuery = calls.find(
    (call) => call.table === "orders" && String(call.fields).includes("order_items")
  )
  assert.deepEqual(customerQuery.filters, [
    { kind: "eq", column: "customer_id", value: ids.dualUser },
  ])
})

test("the exported API has no caller-controlled identity, table, filter, or projection", () => {
  assert.match(moduleSource, /^import "server-only"/u)
  assert.match(moduleSource, /await client\.auth\.getUser\(\)/u)
  assert.match(moduleSource, /\.eq\("user_id", userId\)/u)
  assert.deepEqual(
    Object.keys(createOrderDataAccess({
      createAuthenticatedClient: async () => ({ auth: {} }),
      privilegedClient: {},
    })).sort(),
    ["getCustomerOrderHistory", "getVendorOrderDetail", "getVendorOrderHistory"]
  )
  assert.match(
    moduleSource,
    /async function getCustomerOrderHistory\(input: \{\s*page: number\s*pageSize: number/u
  )
  assert.match(moduleSource, /async function getVendorOrderHistory\(\):/u)
  assert.match(
    moduleSource,
    /async function getVendorOrderDetail\(\s*orderId: string/u
  )
})

test("the restrictive migration is transactional, fail-closed, and grants no new authority", () => {
  assert.match(migrationSource, /^begin;/u)
  assert.match(migrationSource, /commit;\s*$/u)
  assert.match(
    migrationSource,
    /revoke select\s+on table public\.orders, public\.order_items\s+from authenticated;/u
  )
  assert.match(
    migrationSource,
    /revoke all privileges\s+on table public\.orders, public\.order_items\s+from anon, public;/u
  )
  assert.doesNotMatch(migrationSource, /\bgrant\b/u)
  assert.doesNotMatch(migrationSource, /create\s+(?:or\s+replace\s+)?(?:function|view)/iu)
  assert.match(migrationSource, /actual_columns is distinct from expected_columns/u)
  assert.equal(migrationSource.match(/role\.rolbypassrls/gu)?.length, 4)
  assert.match(migrationSource, /order RLS policy contract changed/u)
  assert.match(migrationSource, /protected order functions are missing/u)
  assert.match(migrationSource, /order RLS policies changed/u)
  assert.match(migrationSource, /protected order functions changed/u)
})

test("both migration guards prove every service-role privilege individually", () => {
  assert.doesNotMatch(
    migrationSource,
    /'service_role'[\s\S]{0,160}'SELECT,INSERT,UPDATE,DELETE/iu
  )
  assert.equal(
    migrationSource.match(/foreach target_privilege in array array\[/gu)?.length,
    2
  )
  for (const privilege of [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    assert.equal(
      migrationSource.match(new RegExp(`'${privilege}'`, "gu"))?.length >= 2,
      true,
      `${privilege} must be checked before and after revocation`
    )
  }
})

test("migration postconditions eliminate effective browser-role table and column SELECT", () => {
  for (const role of ["authenticated", "anon"]) {
    assert.match(
      migrationSource,
      new RegExp(`has_table_privilege\\(\\s*'${role}'[\\s\\S]*?'SELECT'`, "u")
    )
    assert.match(
      migrationSource,
      new RegExp(`has_column_privilege\\(\\s*'${role}'[\\s\\S]*?'SELECT'`, "u")
    )
  }
  assert.match(migrationSource, /acl\.grantee = 0\s+and acl\.privilege_type = 'SELECT'/u)
  assert.match(migrationSource, /class\.relrowsecurity and not class\.relforcerowsecurity/u)
})
