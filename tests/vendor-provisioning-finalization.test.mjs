import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const helperFile = "src/lib/vendor/finalization.ts"
const actionFile = "src/app/vendor/onboarding/actions.ts"
const pageFile = "src/app/vendor/onboarding/page.tsx"
const formFile = "src/app/vendor/onboarding/finalization-form.tsx"
const inviteCallbackFile = "src/app/vendor/auth/callback/route.ts"
const helperSource = fs.readFileSync(path.join(root, helperFile), "utf8")
const actionSource = fs.readFileSync(path.join(root, actionFile), "utf8")
const pageSource = fs.readFileSync(path.join(root, pageFile), "utf8")
const formSource = fs.readFileSync(path.join(root, formFile), "utf8")
const inviteCallbackSource = fs.readFileSync(
  path.join(root, inviteCallbackFile),
  "utf8"
)

const userId = "11111111-1111-4111-8111-111111111111"
const otherUserId = "22222222-2222-4222-8222-222222222222"
const applicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const otherApplicationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const vendorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const email = "seller@example.test"
const compiledCache = new Map()

function compile(file, mocks, globals = {}) {
  let output = compiledCache.get(file)
  if (!output) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    compiledCache.set(file, output)
  }
  const compiledModule = { exports: {} }
  vm.runInNewContext(output, {
    module: compiledModule,
    exports: compiledModule.exports,
    URL,
    process: { env: {} },
    crypto: { randomUUID: () => "test-revision" },
    require(name) {
      if (name in mocks) return mocks[name]
      throw new Error(`Unexpected import: ${name}`)
    },
    ...globals,
  }, { filename: file })
  return compiledModule.exports
}

function awaitingApplication(overrides = {}) {
  return {
    id: applicationId,
    email,
    status: "approved",
    provisioning_status: "awaiting_enrollment",
    auth_user_id: userId,
    vendor_id: null,
    provisioned_at: null,
    ...overrides,
  }
}

function provisionedApplication(overrides = {}) {
  return {
    ...awaitingApplication(),
    provisioning_status: "provisioned",
    vendor_id: vendorId,
    provisioned_at: "2026-09-22T12:00:00.000Z",
    ...overrides,
  }
}

function inactiveVendor(overrides = {}) {
  return {
    id: vendorId,
    user_id: userId,
    email,
    is_active: false,
    ...overrides,
  }
}

function rpcRow(outcome = "provisioned", overrides = {}) {
  const successful = outcome === "provisioned" || outcome === "already_provisioned"
  const nullState = [
    "invalid_input",
    "unavailable",
    "invalid_vendor_defaults",
    "operation_failed",
  ].includes(outcome)
  return {
    outcome,
    application_id: applicationId,
    vendor_id: successful ? vendorId : null,
    provisioning_status: successful
      ? "provisioned"
      : nullState
        ? null
        : "awaiting_enrollment",
    ...overrides,
  }
}

function helperHarness(mode = {}) {
  const queries = []
  const rpcCalls = []
  let clientCreations = 0

  const state = {
    awaitingRows: [awaitingApplication()],
    provisionedRows: [],
    vendorRows: [],
    rpcData: [rpcRow()],
    rpcError: null,
    ...mode,
  }

  function query(table) {
    const record = { table, fields: "", filters: [], limit: null }
    queries.push(record)
    const builder = {
      select(fields) {
        record.fields = fields
        return builder
      },
      eq(column, value) {
        record.filters.push(["eq", column, value])
        return builder
      },
      is(column, value) {
        record.filters.push(["is", column, value])
        return builder
      },
      async limit(value) {
        record.limit = value
        if (table === "vendors") {
          if (state.vendorThrow) throw new Error("private vendor transport")
          return { data: state.vendorRows, error: state.vendorError ?? null }
        }
        const provisioningFilter = record.filters.find(
          ([kind, column]) => kind === "eq" && column === "provisioning_status"
        )
        if (provisioningFilter?.[2] === "provisioned") {
          if (state.provisionedThrow) throw new Error("private reconciliation transport")
          return {
            data: state.provisionedRows,
            error: state.provisionedError ?? null,
          }
        }
        if (state.awaitingThrow) throw new Error("private application transport")
        return { data: state.awaitingRows, error: state.awaitingError ?? null }
      },
    }
    return builder
  }

  const client = {
    from: query,
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters })
      if (state.rpcThrow) throw new Error("private RPC transport")
      return { data: state.rpcData, error: state.rpcError }
    },
  }

  const compiledExports = compile(helperFile, {
    "server-only": {},
    "@/lib/admin/supabase-admin": {
      createAdminClient() {
        clientCreations++
        if (state.clientCreationThrow) {
          throw new Error("private admin client initialization error")
        }
        return client
      },
    },
  })

  return {
    finalize: () => compiledExports.finalizeSellerAccount({ userId, normalizedEmail: email }),
    finalizeAs: (identity) => compiledExports.finalizeSellerAccount(identity),
    enrollmentState: () =>
      compiledExports.getSellerEnrollmentState({ userId, normalizedEmail: email }),
    enrollmentStateAs: (identity) =>
      compiledExports.getSellerEnrollmentState(identity),
    queries,
    rpcCalls,
    clientCreations: () => clientCreations,
  }
}

function actionHarness(mode = {}) {
  const calls = []
  const finalizationCalls = []
  let serverClientCreations = 0
  let getUserCalls = 0
  let getSessionCalls = 0
  const configuredUser = Object.hasOwn(mode, "user")
    ? mode.user
    : {
        id: userId,
        email: "  Seller@Example.Test  ",
        email_confirmed_at: "2026-09-22T12:00:00.000Z",
        user_metadata: { auth_user_id: otherUserId, email: "attacker@example.test" },
      }
  const requestHeaders = new Map([
    ["origin", mode.origin === undefined ? "https://example.test" : mode.origin],
    ["host", mode.host === undefined ? "example.test" : mode.host],
  ].filter(([, value]) => value !== null))
  if (mode.forwardedHost !== undefined) {
    requestHeaders.set("x-forwarded-host", mode.forwardedHost)
  }
  if (mode.forwardedProto !== undefined) {
    requestHeaders.set("x-forwarded-proto", mode.forwardedProto)
  }

  const compiledExports = compile(actionFile, {
    "next/headers": {
      async headers() {
        calls.push("headers")
        return { get: (name) => requestHeaders.get(name) ?? null }
      },
    },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        calls.push("createSupabaseServerClient")
        serverClientCreations++
        if (mode.clientThrow) throw new Error("private client error")
        return {
          auth: {
            async getUser() {
              calls.push("getUser")
              getUserCalls++
              if (mode.getUserThrow) throw new Error("private Auth error")
              return {
                data: { user: configuredUser },
                error: mode.userError ? new Error("private Auth error") : null,
              }
            },
            async getSession() {
              getSessionCalls++
              throw new Error("getSession must not authorize finalization")
            },
          },
        }
      },
    },
    "@/lib/vendor/finalization": {
      async finalizeSellerAccount(identity) {
        calls.push("finalizeSellerAccount")
        finalizationCalls.push(identity)
        if (mode.finalizationThrow) throw new Error("private service error")
        return mode.outcome ?? "finalized"
      },
    },
  }, {
    process: { env: { VERCEL: mode.vercel ? "1" : undefined } },
  })

  return {
    run: (formData = new FormData()) =>
      compiledExports.finalizeSellerEnrollment(
        { outcome: "no_pending_enrollment", message: "", revision: "" },
        formData
      ),
    calls,
    finalizationCalls,
    counts: () => ({ serverClientCreations, getUserCalls, getSessionCalls }),
  }
}

function jsx(type, props, key) {
  return { type, props: props ?? {}, key }
}

function materialize(node) {
  if (Array.isArray(node)) return node.map(materialize)
  if (!node || typeof node !== "object") return node
  if (typeof node.type === "function") return materialize(node.type(node.props))
  return {
    ...node,
    props: {
      ...node.props,
      children: materialize(node.props?.children),
    },
  }
}

function findElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found)
    return found
  }
  if (!node || typeof node !== "object") return found
  if (predicate(node)) found.push(node)
  findElements(node.props?.children, predicate, found)
  return found
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("")
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (!node || typeof node !== "object") return ""
  return textContent(node.props?.children)
}

function pageHarness(mode = {}) {
  const calls = []
  const redirects = []
  const enrollmentCalls = []
  let getSessionCalls = 0
  const user = Object.hasOwn(mode, "user")
    ? mode.user
    : {
        id: userId,
        email: "  Seller@Example.Test  ",
        email_confirmed_at: "2026-09-23T08:00:00.000Z",
        user_metadata: { application_id: otherApplicationId },
      }
  const redirectSignal = Symbol("redirect")
  const client = {
    auth: {
      async getUser() {
        calls.push("getUser")
        return {
          data: { user },
          error: mode.userError ? new Error("private Auth error") : null,
        }
      },
      async getSession() {
        getSessionCalls++
        throw new Error("getSession must not authorize onboarding")
      },
    },
    from(table) {
      calls.push(`from:${table}`)
      const query = {
        select(fields) {
          calls.push(`select:${fields}`)
          return query
        },
        eq(column, value) {
          calls.push(`eq:${column}:${value}`)
          return query
        },
        async maybeSingle() {
          calls.push("maybeSingle")
          return {
            data: mode.vendor ?? null,
            error: mode.vendorError ? new Error("private vendor error") : null,
          }
        },
      }
      return query
    },
  }

  const compiledExports = compile(pageFile, {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": (props) => jsx("a", props),
    "next/navigation": {
      redirect(destination) {
        redirects.push(destination)
        throw redirectSignal
      },
    },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        calls.push("createSupabaseServerClient")
        if (mode.clientThrow) throw new Error("private client error")
        return client
      },
    },
    "@/lib/vendor/finalization": {
      async getSellerEnrollmentState(identity) {
        calls.push("getSellerEnrollmentState")
        enrollmentCalls.push(identity)
        return mode.enrollmentState ?? "ready"
      },
      async finalizeSellerAccount() {
        calls.push("finalizeSellerAccount")
        throw new Error("GET must not finalize")
      },
    },
    "./finalization-form": {
      FinalizationForm: () => jsx("finalization-form", {}),
    },
  })

  return {
    async run() {
      try {
        return materialize(await compiledExports.default())
      } catch (error) {
        if (error === redirectSignal) return null
        throw error
      }
    },
    calls,
    redirects,
    enrollmentCalls,
    getSessionCalls: () => getSessionCalls,
  }
}

function formHarness(mode = {}) {
  const navigations = []
  const refreshes = []
  const action = () => {
    throw new Error("Server Action must not run during render")
  }
  const dispatch = () => {}
  const router = {
    replace(destination) {
      navigations.push(destination)
    },
    refresh() {
      refreshes.push(true)
    },
  }
  let receivedAction
  const compiledExports = compile(formFile, {
    react: {
      useActionState(serverAction, initialState) {
        receivedAction = serverAction
        return [mode.result ?? initialState, dispatch, mode.pending ?? false]
      },
      useEffect(callback) {
        callback()
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/navigation": { useRouter: () => router },
    "./actions": { finalizeSellerEnrollment: action },
  })

  return {
    render: () => materialize(compiledExports.FinalizationForm()),
    action,
    dispatch,
    receivedAction: () => receivedAction,
    navigations,
    refreshes,
  }
}

test("cross-origin action is rejected before Auth or privileged work", async () => {
  const app = actionHarness({ origin: "https://attacker.test" })
  const result = await app.run()
  assert.equal(result.outcome, "invalid_request")
  assert.deepEqual(app.calls, ["headers"])
})

test("missing origin is rejected before Auth or privileged work", async () => {
  const app = actionHarness({ origin: null })
  assert.equal((await app.run()).outcome, "invalid_request")
  assert.deepEqual(app.calls, ["headers"])
})

test("Vercel ingress accepts matching HTTPS forwarded origin metadata", async () => {
  const app = actionHarness({
    vercel: true,
    host: "internal.test",
    forwardedHost: "example.test",
    forwardedProto: "https",
  })
  assert.equal((await app.run()).outcome, "finalized")
})

for (const [name, mode] of [
  [
    "HTTP Origin with HTTPS forwarded protocol",
    {
      origin: "http://example.test",
      forwardedHost: "example.test",
      forwardedProto: "https",
    },
  ],
  ["missing forwarded protocol", { forwardedHost: "example.test" }],
  [
    "multiple forwarded protocols",
    { forwardedHost: "example.test", forwardedProto: "https,http" },
  ],
  [
    "mismatched forwarded host",
    { forwardedHost: "other.test", forwardedProto: "https" },
  ],
]) {
  test(`Vercel ingress rejects ${name} before Auth or privileged work`, async () => {
    const app = actionHarness({ vercel: true, ...mode })
    assert.equal((await app.run()).outcome, "invalid_request")
    assert.deepEqual(app.calls, ["headers"])
  })
}

for (const [name, mode] of [
  ["missing user", { user: null }],
  ["Auth error", { userError: true }],
  ["getUser throw", { getUserThrow: true }],
  ["server-client failure", { clientThrow: true }],
  ["invalid Auth UUID", { user: { id: "not-a-uuid", email, email_confirmed_at: "confirmed" } }],
]) {
  test(`${name} cannot reach privileged finalization`, async () => {
    const app = actionHarness(mode)
    assert.equal((await app.run()).outcome, "auth_required")
    assert.equal(app.finalizationCalls.length, 0)
  })
}

test("action authorizes with auth.getUser and never getSession", async () => {
  const app = actionHarness()
  await app.run()
  assert.equal(app.counts().getUserCalls, 1)
  assert.equal(app.counts().getSessionCalls, 0)
  assert.deepEqual(app.calls, [
    "headers",
    "createSupabaseServerClient",
    "getUser",
    "finalizeSellerAccount",
  ])
})

test("user_metadata is never used as seller identity", async () => {
  const app = actionHarness()
  await app.run()
  assert.deepEqual(JSON.parse(JSON.stringify(app.finalizationCalls)), [
    { userId, normalizedEmail: email },
  ])
  assert.equal(actionSource.includes("user_metadata"), false)
})

test("missing Auth email is rejected", async () => {
  const app = actionHarness({ user: { id: userId, email_confirmed_at: "confirmed" } })
  assert.equal((await app.run()).outcome, "identity_mismatch")
  assert.equal(app.finalizationCalls.length, 0)
})

test("unconfirmed Auth email is rejected without confirmed_at fallback", async () => {
  const app = actionHarness({ user: { id: userId, email, confirmed_at: "confirmed" } })
  assert.equal((await app.run()).outcome, "email_unconfirmed")
  assert.equal(app.finalizationCalls.length, 0)
  assert.equal(actionSource.includes("user.confirmed_at"), false)
})

test("action works without application identifier input", async () => {
  const app = actionHarness()
  assert.equal((await app.run(new FormData())).outcome, "finalized")
  assert.deepEqual(JSON.parse(JSON.stringify(app.finalizationCalls)), [
    { userId, normalizedEmail: email },
  ])
})

for (const field of [
  "application_id",
  "applicationId",
  "auth_user_id",
  "email",
  "vendor_id",
]) {
  test(`client field ${field} cannot influence authority`, async () => {
    const data = new FormData()
    data.set(field, field === "email" ? "attacker@example.test" : otherApplicationId)
    const app = actionHarness()
    assert.equal((await app.run(data)).outcome, "finalized")
    assert.deepEqual(JSON.parse(JSON.stringify(app.finalizationCalls)), [
      { userId, normalizedEmail: email },
    ])
  })
}

test("read-only eligibility returns ready for exactly one valid awaiting candidate", async () => {
  const app = helperHarness()
  assert.equal(await app.enrollmentState(), "ready")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility reports no pending enrollment when no state is finalized", async () => {
  const app = helperHarness({ awaitingRows: [], provisionedRows: [] })
  assert.equal(await app.enrollmentState(), "no_pending_enrollment")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility proves an existing consistent finalized tuple", async () => {
  const app = helperHarness({
    awaitingRows: [],
    provisionedRows: [provisionedApplication()],
    vendorRows: [inactiveVendor()],
  })
  assert.equal(await app.enrollmentState(), "already_finalized")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility fails closed for ambiguous awaiting applications", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication(), awaitingApplication({ id: otherApplicationId })],
  })
  assert.equal(await app.enrollmentState(), "reconciliation_required")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility rejects candidate UUID mismatch", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication({ auth_user_id: otherUserId })],
  })
  assert.equal(await app.enrollmentState(), "identity_mismatch")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility rejects normalized email mismatch", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication({ email: "other@example.test" })],
  })
  assert.equal(await app.enrollmentState(), "identity_mismatch")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility rejects malformed candidate data", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication({ id: "malformed" })],
  })
  assert.equal(await app.enrollmentState(), "identity_mismatch")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility maps lookup failure to service_unavailable", async () => {
  const app = helperHarness({ awaitingError: new Error("private read error") })
  assert.equal(await app.enrollmentState(), "service_unavailable")
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility maps admin-client initialization failure safely", async () => {
  const app = helperHarness({ clientCreationThrow: true })
  assert.equal(await app.enrollmentState(), "service_unavailable")
  assert.equal(app.queries.length, 0)
  assert.equal(app.rpcCalls.length, 0)
})

test("read-only eligibility uses minimal fields, exact filters, limit two, and no RPC", async () => {
  const app = helperHarness()
  assert.equal(await app.enrollmentState(), "ready")
  assert.deepEqual(JSON.parse(JSON.stringify(app.queries[0])), {
    table: "vendor_applications",
    fields: "id, email, status, provisioning_status, auth_user_id, vendor_id, provisioned_at",
    filters: [
      ["eq", "auth_user_id", userId],
      ["eq", "status", "approved"],
      ["eq", "provisioning_status", "awaiting_enrollment"],
      ["is", "vendor_id", null],
      ["is", "provisioned_at", null],
    ],
    limit: 2,
  })
  assert.equal(helperSource.includes("invited_at"), false)
  assert.equal(app.rpcCalls.length, 0)
})

test("exactly one awaiting application reaches finalization", async () => {
  const app = helperHarness()
  assert.equal(await app.finalize(), "finalized")
  assert.equal(app.rpcCalls.length, 1)
})

test("zero awaiting and zero provisioned applications reports no pending enrollment", async () => {
  const app = helperHarness({ awaitingRows: [], provisionedRows: [] })
  assert.equal(await app.finalize(), "no_pending_enrollment")
  assert.equal(app.rpcCalls.length, 0)
})

test("two awaiting applications fail closed without choosing one", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication(), awaitingApplication({ id: otherApplicationId })],
  })
  assert.equal(await app.finalize(), "reconciliation_required")
  assert.equal(app.rpcCalls.length, 0)
})

test("candidate linked to another Auth UUID cannot be selected", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication({ auth_user_id: otherUserId })],
  })
  assert.equal(await app.finalize(), "identity_mismatch")
  assert.equal(app.rpcCalls.length, 0)
})

test("normalized candidate email must match verified Auth email", async () => {
  const app = helperHarness({
    awaitingRows: [awaitingApplication({ email: "other@example.test" })],
  })
  assert.equal(await app.finalize(), "identity_mismatch")
  assert.equal(app.rpcCalls.length, 0)
})

test("candidate lookup uses only minimum fields and exact filters with limit two", async () => {
  const app = helperHarness()
  await app.finalize()
  const query = app.queries[0]
  assert.equal(
    query.fields,
    "id, email, status, provisioning_status, auth_user_id, vendor_id, provisioned_at"
  )
  assert.equal(query.limit, 2)
  assert.deepEqual(query.filters, [
    ["eq", "auth_user_id", userId],
    ["eq", "status", "approved"],
    ["eq", "provisioning_status", "awaiting_enrollment"],
    ["is", "vendor_id", null],
    ["is", "provisioned_at", null],
  ])
  assert.equal(query.fields.includes("review_notes"), false)
  assert.equal(query.fields.includes("provisioning_error_code"), false)
})

test("RPC is invoked exactly once with derived application and verified Auth UUID", async () => {
  const app = helperHarness()
  await app.finalize()
  assert.deepEqual(JSON.parse(JSON.stringify(app.rpcCalls)), [{
    name: "finalize_vendor_application_provisioning",
    parameters: {
      p_application_id: applicationId,
      p_auth_user_id: userId,
    },
  }])
})

test("provisioned maps to finalized only with valid vendor and provisioned state", async () => {
  assert.equal(await helperHarness().finalize(), "finalized")
  for (const row of [
    rpcRow("provisioned", { vendor_id: null }),
    rpcRow("provisioned", { vendor_id: "bad" }),
    rpcRow("provisioned", { provisioning_status: "awaiting_enrollment" }),
  ]) {
    assert.equal(
      await helperHarness({ rpcData: [row] }).finalize(),
      "reconciliation_required"
    )
  }
})

test("already_provisioned maps to already_finalized only with a consistent row", async () => {
  const app = helperHarness({ rpcData: [rpcRow("already_provisioned")] })
  assert.equal(await app.finalize(), "already_finalized")
})

for (const outcome of ["identity_conflict", "identity_mismatch"]) {
  test(`${outcome} maps to identity_mismatch`, async () => {
    const app = helperHarness({ rpcData: [rpcRow(outcome)] })
    assert.equal(await app.finalize(), "identity_mismatch")
  })
}

test("enrollment_not_verified maps to email_unconfirmed", async () => {
  const app = helperHarness({ rpcData: [rpcRow("enrollment_not_verified")] })
  assert.equal(await app.finalize(), "email_unconfirmed")
})

test("vendor_collision maps without exposing identifiers", async () => {
  const app = helperHarness({ rpcData: [rpcRow("vendor_collision")] })
  assert.equal(await app.finalize(), "vendor_collision")
})

for (const outcome of [
  "invalid_input",
  "unavailable",
  "invalid_state",
  "application_data_invalid",
  "invalid_vendor_defaults",
]) {
  test(`${outcome} maps to invalid_state`, async () => {
    const app = helperHarness({ rpcData: [rpcRow(outcome)] })
    assert.equal(await app.finalize(), "invalid_state")
  })
}

test("operation_failed maps to service_unavailable", async () => {
  const app = helperHarness({ rpcData: [rpcRow("operation_failed")] })
  assert.equal(await app.finalize(), "service_unavailable")
})

test("malformed RPC results require reconciliation without retry", async () => {
  for (const rpcData of [
    null,
    [],
    [rpcRow(), rpcRow()],
    [{ ...rpcRow(), application_id: otherApplicationId }],
    [{ ...rpcRow(), outcome: "unknown" }],
    [{ ...rpcRow("invalid_state"), vendor_id: vendorId }],
    [{ ...rpcRow("invalid_state"), provisioning_status: "unknown" }],
    [{ ...rpcRow("identity_mismatch"), provisioning_status: "provisioned" }],
    [{ ...rpcRow("enrollment_not_verified"), provisioning_status: null }],
    [{ ...rpcRow("vendor_collision"), provisioning_status: "provisioned" }],
    [{ ...rpcRow("application_data_invalid"), provisioning_status: "failed" }],
  ]) {
    const app = helperHarness({ rpcData })
    assert.equal(await app.finalize(), "reconciliation_required")
    assert.equal(app.rpcCalls.length, 1)
  }
})

test("malformed RPC data reconciles a consistent finalized tuple without retry", async () => {
  const app = helperHarness({
    rpcData: null,
    provisionedRows: [provisionedApplication()],
    vendorRows: [inactiveVendor()],
  })
  assert.equal(await app.finalize(), "already_finalized")
  assert.equal(app.rpcCalls.length, 1)
})

test("malformed RPC data without provable finalization requires reconciliation", async () => {
  for (const mode of [
    { rpcData: null },
    { rpcData: null, provisionedError: new Error("private read error") },
  ]) {
    const app = helperHarness(mode)
    assert.equal(await app.finalize(), "reconciliation_required")
    assert.equal(app.rpcCalls.length, 1)
  }
})

test("RPC throw performs one reconciliation and never retries", async () => {
  const app = helperHarness({ rpcThrow: true })
  assert.equal(await app.finalize(), "reconciliation_required")
  assert.equal(app.rpcCalls.length, 1)
  assert.equal(
    app.queries.filter((query) =>
      query.filters.some((filter) => filter[1] === "provisioning_status" && filter[2] === "provisioned")
    ).length,
    1
  )
})

test("uncertain RPC plus consistent provisioned reread maps to already_finalized", async () => {
  const app = helperHarness({
    rpcError: new Error("private transport"),
    provisionedRows: [provisionedApplication()],
    vendorRows: [inactiveVendor()],
  })
  assert.equal(await app.finalize(), "already_finalized")
  assert.equal(app.rpcCalls.length, 1)
})

test("uncertain RPC plus still-awaiting state requires reconciliation", async () => {
  const app = helperHarness({ rpcError: new Error("private transport") })
  assert.equal(await app.finalize(), "reconciliation_required")
  assert.equal(app.rpcCalls.length, 1)
})

test("existing consistent finalized state resolves without another RPC", async () => {
  const app = helperHarness({
    awaitingRows: [],
    provisionedRows: [provisionedApplication()],
    vendorRows: [inactiveVendor()],
  })
  assert.equal(await app.finalize(), "already_finalized")
  assert.equal(app.rpcCalls.length, 0)
})

for (const [name, application, vendor] of [
  ["missing provisioned timestamp", provisionedApplication({ provisioned_at: null }), inactiveVendor()],
  ["wrong application email", provisionedApplication({ email: "other@example.test" }), inactiveVendor()],
  ["missing vendor", provisionedApplication(), null],
  ["wrong vendor owner", provisionedApplication(), inactiveVendor({ user_id: otherUserId })],
  ["wrong vendor email", provisionedApplication(), inactiveVendor({ email: "other@example.test" })],
  ["active vendor", provisionedApplication(), inactiveVendor({ is_active: true })],
]) {
  test(`inconsistent finalized state fails closed: ${name}`, async () => {
    const app = helperHarness({
      awaitingRows: [],
      provisionedRows: [application],
      vendorRows: vendor ? [vendor] : [],
    })
    assert.equal(await app.finalize(), "reconciliation_required")
    assert.equal(app.rpcCalls.length, 0)
  })
}

test("application lookup failure never invokes finalization", async () => {
  const app = helperHarness({ awaitingError: new Error("private database error") })
  assert.equal(await app.finalize(), "service_unavailable")
  assert.equal(app.rpcCalls.length, 0)
})

test("admin-client creation failure returns service_unavailable before queries or RPC", async () => {
  const app = helperHarness({ clientCreationThrow: true })
  assert.equal(await app.finalize(), "service_unavailable")
  assert.equal(app.clientCreations(), 1)
  assert.equal(app.queries.length, 0)
  assert.equal(app.rpcCalls.length, 0)
})

test("action returns stable messages and no database identifiers", async () => {
  for (const outcome of [
    "finalized",
    "already_finalized",
    "email_unconfirmed",
    "no_pending_enrollment",
    "identity_mismatch",
    "vendor_collision",
    "invalid_state",
    "reconciliation_required",
    "service_unavailable",
  ]) {
    const result = await actionHarness({ outcome }).run()
    assert.equal(result.outcome, outcome)
    assert.equal(typeof result.message, "string")
    assert.ok(result.message.length > 0)
    assert.equal(result.revision, "test-revision")
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes(applicationId), false)
    assert.equal(serialized.includes(vendorId), false)
    assert.equal(serialized.includes(userId), false)
    assert.equal(serialized.includes(email), false)
  }
})

test("signed-out onboarding redirects to the customer login return path", async () => {
  const app = pageHarness({ user: null })
  await app.run()
  assert.deepEqual(app.redirects, ["/account/login?vendor_onboarding=1"])
  assert.equal(app.calls.includes("getSellerEnrollmentState"), false)
})

test("onboarding page authorizes with getUser and passes only normalized live identity", async () => {
  const app = pageHarness()
  await app.run()
  assert.equal(app.calls.filter((call) => call === "getUser").length, 1)
  assert.equal(app.getSessionCalls(), 0)
  assert.deepEqual(JSON.parse(JSON.stringify(app.enrollmentCalls)), [
    { userId, normalizedEmail: email },
  ])
  assert.equal(pageSource.includes("user_metadata"), false)
  assert.equal(pageSource.includes("getSession"), false)
})

test("existing vendor redirects to the dashboard before eligibility lookup", async () => {
  const app = pageHarness({ vendor: { id: vendorId } })
  await app.run()
  assert.deepEqual(app.redirects, ["/vendor/dashboard"])
  assert.equal(app.calls.includes("getSellerEnrollmentState"), false)
})

test("unconfirmed email renders a controlled state without finalization form", async () => {
  const app = pageHarness({
    user: { id: userId, email, email_confirmed_at: null },
  })
  const tree = await app.run()
  assert.match(textContent(tree), /Confirm your account email/)
  assert.equal(findElements(tree, (element) => element.type === "finalization-form").length, 0)
  assert.equal(app.calls.includes("getSellerEnrollmentState"), false)
})

test("ready onboarding renders the explicit finalization form without mutating on GET", async () => {
  const app = pageHarness({ enrollmentState: "ready" })
  const tree = await app.run()
  assert.equal(findElements(tree, (element) => element.type === "finalization-form").length, 1)
  assert.equal(app.calls.includes("finalizeSellerAccount"), false)
  assert.equal(app.calls.includes("getSellerEnrollmentState"), true)
})

for (const state of [
  "email_unconfirmed",
  "no_pending_enrollment",
  "identity_mismatch",
  "reconciliation_required",
  "service_unavailable",
]) {
  test(`non-ready onboarding state ${state} never renders finalization form`, async () => {
    const app = pageHarness({ enrollmentState: state })
    const tree = await app.run()
    assert.equal(findElements(tree, (element) => element.type === "finalization-form").length, 0)
    assert.ok(textContent(tree).length > 0)
  })
}

test("already-finalized eligibility redirects to the vendor dashboard", async () => {
  const app = pageHarness({ enrollmentState: "already_finalized" })
  await app.run()
  assert.deepEqual(app.redirects, ["/vendor/dashboard"])
})

test("onboarding render exposes no database identifiers or seller email", async () => {
  const app = pageHarness({ enrollmentState: "ready" })
  const serialized = JSON.stringify(await app.run())
  for (const privateValue of [applicationId, vendorId, userId, email]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test("finalization form has no trusted hidden identifiers and binds the approved action", () => {
  const app = formHarness()
  const tree = app.render()
  const forms = findElements(tree, (element) => element.type === "form")
  const hiddenInputs = findElements(
    tree,
    (element) => element.type === "input" && element.props.type === "hidden"
  )
  assert.equal(forms.length, 1)
  assert.equal(forms[0].props.action, app.dispatch)
  assert.equal(app.receivedAction(), app.action)
  assert.equal(hiddenInputs.length, 0)
  for (const field of ["applicationId", "application_id", "auth_user_id", "email", "vendor_id"]) {
    assert.equal(formSource.includes(`name=\"${field}\"`), false)
  }
})

test("finalization form disables submission and uses controlled pending wording", () => {
  const tree = formHarness({ pending: true }).render()
  const button = findElements(tree, (element) => element.type === "button")[0]
  assert.equal(button.props.disabled, true)
  assert.equal(textContent(button), "Creating your seller account...")
})

test("finalization form uses the approved explicit button wording", () => {
  const tree = formHarness().render()
  const button = findElements(tree, (element) => element.type === "button")[0]
  assert.equal(textContent(button), "Create my seller account")
})

for (const outcome of ["finalized", "already_finalized"]) {
  test(`${outcome} replaces onboarding history with the account password prompt`, () => {
    const app = formHarness({
      result: { outcome, message: "controlled", revision: "revision" },
    })
    app.render()
    assert.deepEqual(app.navigations, ["/account/security/password"])
    assert.equal(app.refreshes.length, 1)
  })
}

for (const outcome of [
  "identity_mismatch",
  "vendor_collision",
  "invalid_state",
  "reconciliation_required",
  "service_unavailable",
  "invalid_request",
  "email_unconfirmed",
  "no_pending_enrollment",
  "auth_required",
]) {
  test(`${outcome} remains on onboarding and renders the controlled action message`, () => {
    const message = `controlled ${outcome}`
    const app = formHarness({
      result: { outcome, message, revision: "revision" },
    })
    const tree = app.render()
    assert.deepEqual(app.navigations, [])
    assert.match(textContent(tree), new RegExp(message))
  })
}

test("initial finalization-form render cannot invoke finalization or navigate", () => {
  const app = formHarness()
  app.render()
  assert.equal(app.receivedAction(), app.action)
  assert.deepEqual(app.navigations, [])
})

test("password-like form input is ignored by the unchanged finalization action", async () => {
  const app = actionHarness()
  const formData = new FormData()
  formData.set("password", "not-a-real-credential")
  assert.equal((await app.run(formData)).outcome, "finalized")
  assert.deepEqual(JSON.parse(JSON.stringify(app.finalizationCalls)), [
    { userId, normalizedEmail: email },
  ])
})

test("seller consent wording preserves inactive, activation, verification, and purchase boundaries", () => {
  assert.match(pageSource, /store begins inactive/i)
  assert.match(pageSource, /activation happens separately/i)
  assert.match(pageSource, /verification happens separately/i)
  assert.match(pageSource, /not eligible for normal marketplace purchase until your[\s\S]*store is activated/i)
  assert.equal(pageSource.includes("store is active"), false)
  assert.equal(pageSource.includes("seller is verified"), false)
  assert.equal(pageSource.includes("immediately available for sale"), false)
})

test("server-only and frozen-boundary static assertions", () => {
  assert.match(helperSource, /^import "server-only"/)
  assert.equal(actionSource.includes("assertAdminOrigin"), false)
  assert.equal(actionSource.includes("getSession"), false)
  assert.equal(actionSource.includes("formData.get"), false)
  assert.equal(actionSource.includes("_formData.get"), false)
  assert.equal(helperSource.includes("invited_at"), false)
  assert.equal(helperSource.includes("platform_fee_pct"), false)
  assert.equal(pageSource.includes("finalizeSellerAccount"), false)
  assert.equal(pageSource.includes("finalize_vendor_application_provisioning"), false)
  assert.equal(formSource.includes("finalize_vendor_application_provisioning"), false)
  assert.match(formSource, /finalizeSellerEnrollment/)
  assert.match(formSource, /router\.replace\("\/account\/security\/password"\)/)
  assert.equal(actionSource.includes("password"), false)
  assert.equal(helperSource.includes("password"), false)
  assert.equal(inviteCallbackSource.includes("/account/security/password"), false)
  assert.equal(inviteCallbackSource.includes("updateUser"), false)

  const combined = `${helperSource}\n${actionSource}\n${pageSource}\n${formSource}`
  for (const forbidden of [
    "inviteUserByEmail",
    "createUser",
    '.from("vendor_verifications")',
    '.from("products")',
    '.from("orders")',
    '.from("payouts")',
    '.from("refunds")',
    "is_active: true",
    "n8n",
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden)
  }
})

test("all approved Batch 3E2 files exist", () => {
  const expected = new Set([
    helperFile,
    actionFile,
    pageFile,
    formFile,
    inviteCallbackFile,
    "tests/vendor-provisioning-finalization.test.mjs",
  ])
  for (const file of expected) assert.equal(fs.existsSync(path.join(root, file)), true)
})
