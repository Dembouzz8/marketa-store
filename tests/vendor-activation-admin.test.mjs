import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const originFile = "src/lib/admin/origin.ts"
const applicationsFile = "src/lib/admin/vendor-applications.ts"
const errorFile = "src/app/admin/(protected)/error.tsx"
const actionsFile =
  "src/app/admin/(protected)/vendor-applications/actions.ts"
const pageFile =
  "src/app/admin/(protected)/vendor-applications/[id]/page.tsx"
const formFile =
  "src/app/admin/(protected)/vendor-applications/[id]/activation-form.tsx"
const applicationId = "11111111-1111-4111-8111-111111111111"
const vendorId = "22222222-2222-4222-8222-222222222222"
const adminId = "33333333-3333-4333-8333-333333333333"
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const compiledModule = { exports: {} }
  vm.runInNewContext(
    compiled,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      FormData,
      URL,
      crypto: globalThis.crypto,
      ...globals,
      require(name) {
        if (name in mocks) return mocks[name]
        throw new Error(`Unexpected import: ${name}`)
      },
    },
    { filename: file }
  )
  return compiledModule.exports
}

function originHarness({
  origin,
  host,
  forwardedHost,
  forwardedProto,
  vercel = false,
}) {
  const requestHeaders = new Headers()
  if (origin !== undefined) requestHeaders.set("origin", origin)
  if (host !== undefined) requestHeaders.set("host", host)
  if (forwardedHost !== undefined) {
    requestHeaders.set("x-forwarded-host", forwardedHost)
  }
  if (forwardedProto !== undefined) {
    requestHeaders.set("x-forwarded-proto", forwardedProto)
  }
  return load(
    originFile,
    {
      "server-only": {},
      "next/headers": { async headers() { return requestHeaders } },
    },
    { process: { env: { VERCEL: vercel ? "1" : undefined } } }
  ).assertAdminOrigin
}

test("admin origin rejects explicit cross-origin requests", async () => {
  const assertOrigin = originHarness({
    origin: "https://attacker.example",
    host: "admin.marketa.example",
  })
  await assert.rejects(assertOrigin(), /Invalid admin request origin/)
})

test("Vercel rejects HTTP Origin for the exact production host", async () => {
  const assertOrigin = originHarness({
    origin: "http://marketa-store.vercel.app",
    host: "internal.vercel",
    forwardedHost: "marketa-store.vercel.app",
    forwardedProto: "https",
    vercel: true,
  })
  await assert.rejects(assertOrigin(), /Invalid admin request origin/)
})

test("Vercel accepts only the matching HTTPS production origin", async () => {
  const assertOrigin = originHarness({
    origin: "https://marketa-store.vercel.app",
    host: "internal.vercel",
    forwardedHost: "marketa-store.vercel.app",
    forwardedProto: "https",
    vercel: true,
  })
  await assert.doesNotReject(assertOrigin())
})

test("Vercel rejects missing, multiple, malformed, and non-HTTPS forwarded protocols", async () => {
  for (const forwardedProto of [undefined, "https,http", "HTTPS", "ftp", "http"]) {
    const assertOrigin = originHarness({
      origin: "https://marketa-store.vercel.app",
      host: "internal.vercel",
      forwardedHost: "marketa-store.vercel.app",
      forwardedProto,
      vercel: true,
    })
    await assert.rejects(assertOrigin(), /Invalid admin request origin/)
  }
})

test("Vercel rejects malformed or mismatched host and Origin evidence", async () => {
  for (const [origin, forwardedHost] of [
    ["https://other.example", "marketa-store.vercel.app"],
    ["https://marketa-store.vercel.app", "other.example"],
    ["https://marketa-store.vercel.app,https://other.example", "marketa-store.vercel.app"],
    ["https://marketa-store.vercel.app", "marketa-store.vercel.app,other.example"],
  ]) {
    const assertOrigin = originHarness({
      origin,
      host: "internal.vercel",
      forwardedHost,
      forwardedProto: "https",
      vercel: true,
    })
    await assert.rejects(assertOrigin(), /Invalid admin request origin/)
  }
})

test("localhost HTTP behavior remains available outside Vercel", async () => {
  const assertOrigin = originHarness({
    origin: "http://localhost:3000",
    host: "localhost:3000",
    forwardedHost: "attacker.example",
    forwardedProto: "http,https",
  })
  await assert.doesNotReject(assertOrigin())
})

function rpcRow(outcome, overrides = {}) {
  const successful = outcome === "activated" || outcome === "already_active"
  return {
    outcome,
    application_id: applicationId,
    vendor_id: successful ? vendorId : null,
    is_active: successful ? true : null,
    activated_at:
      outcome === "activated" ? "2026-09-27T12:00:00.000Z" : null,
    ...overrides,
  }
}

function actionHarness({
  originThrows = false,
  adminUserId = adminId,
  adminFailure = null,
  clientThrows = false,
  rpcData = [rpcRow("activated")],
  rpcError = null,
  rpcThrows = false,
  reconciliationState = "inactive",
  reconciliationThrows = false,
  reconciliationRedirects = false,
} = {}) {
  const calls = []
  const diagnostics = []
  const revalidated = []
  const redirectSignal = Symbol("framework redirect")
  let rpcCount = 0
  let reconciliationCount = 0
  let rpcInvocation = null

  class MockFunctionsHttpError extends Error {}

  const actions = load(actionsFile, {
    "next/cache": {
      revalidatePath(value) { revalidated.push(value) },
    },
    "next/navigation": {
      redirect(value) { throw new Error(`redirect:${value}`) },
      unstable_rethrow(error) {
        if (error === redirectSignal) throw error
      },
    },
    "@supabase/supabase-js": { FunctionsHttpError: MockFunctionsHttpError },
    "@/lib/admin/auth": {
      async requireAdmin() {
        calls.push("requireAdmin")
        if (adminFailure === "ordinary") {
          throw new Error("private admin detail")
        }
        if (adminFailure === "redirect") throw redirectSignal
        return { userId: adminUserId, email: "admin@example.com" }
      },
    },
    "@/lib/admin/origin": {
      async assertAdminOrigin() {
        calls.push("assertAdminOrigin")
        if (originThrows) throw new Error("private origin detail")
      },
    },
    "@/lib/admin/supabase-admin": {
      createAdminClient() {
        calls.push("createAdminClient")
        if (clientThrows) throw new Error("private client detail")
        return {
          async rpc(name, parameters) {
            calls.push("rpc")
            rpcCount++
            rpcInvocation = { name, parameters }
            if (rpcThrows) throw new Error("private transport detail")
            return { data: rpcData, error: rpcError }
          },
        }
      },
    },
    "@/lib/admin/vendor-applications": {
      applicationIdPattern: uuidPattern,
      applicationStatuses: ["submitted", "under_review", "approved", "rejected"],
      async reconcileVendorApplicationActivation(id) {
        calls.push("reconcileVendorApplicationActivation")
        reconciliationCount++
        assert.equal(id, applicationId)
        if (reconciliationRedirects) throw redirectSignal
        if (reconciliationThrows) throw new Error("private read detail")
        return reconciliationState
      },
    },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        throw new Error("Activation must not use the session client")
      },
    },
  }, {
    console: {
      error(value) { diagnostics.push(String(value)) },
    },
  })

  return {
    actions,
    calls,
    diagnostics,
    redirectSignal,
    revalidated,
    state: () => ({ rpcCount, reconciliationCount, rpcInvocation }),
  }
}

function reconciliationHarness({
  adminThrows = false,
  clientThrows = false,
  application = null,
  applicationError = null,
  vendor = null,
} = {}) {
  const calls = []
  const diagnostics = []
  const adminError = new Error("admin denied")

  const applications = load(applicationsFile, {
    "server-only": {},
    "./auth": {
      async requireAdmin() {
        calls.push("requireAdmin")
        if (adminThrows) throw adminError
        return { userId: adminId, email: "admin@example.com" }
      },
    },
    "./supabase-admin": {
      createAdminClient() {
        calls.push("createAdminClient")
        if (clientThrows) throw new Error("private client detail")
        return {
          from(table) {
            calls.push(`from:${table}`)
            const row = table === "vendor_applications" ? application : vendor
            const query = {
              select() {
                calls.push(`select:${table}`)
                return query
              },
              eq() {
                calls.push(`eq:${table}`)
                return query
              },
              async maybeSingle() {
                calls.push(`maybeSingle:${table}`)
                return {
                  data: row,
                  error: table === "vendor_applications" ? applicationError : null,
                }
              },
            }
            return query
          },
        }
      },
    },
  }, {
    console: {
      error(value) { diagnostics.push(String(value)) },
    },
  })

  return { applications, calls, diagnostics, adminError }
}

function activationForm(entries = [["application_id", applicationId]]) {
  const form = new FormData()
  for (const [key, value] of entries) form.append(key, value)
  return form
}

async function runActivation(harness, form = activationForm()) {
  return harness.actions.activateVendorApplication(
    { outcome: "idle", message: "", revision: "" },
    form
  )
}

test("activation validates origin before form parsing or privileged work", async () => {
  const harness = actionHarness({ originThrows: true })
  const result = await runActivation(harness)
  assert.equal(result.outcome, "invalid_request")
  assert.deepEqual(harness.calls, ["assertAdminOrigin"])
  assert.equal(result.message.includes("private"), false)
})

test("activation accepts exactly one application_id and no browser authority fields", async () => {
  for (const entries of [
    [["application_id", "not-a-uuid"]],
    [["application_id", applicationId], ["application_id", applicationId]],
    [["application_id", applicationId], ["vendor_id", vendorId]],
    [["application_id", applicationId], ["admin_id", adminId]],
    [["application_id", applicationId], ["is_active", "true"]],
    [["application_id", applicationId], ["activated_at", "now"]],
    [["application_id", applicationId], ["activated_by", adminId]],
    [["application_id", applicationId], ["verification", "verified"]],
  ]) {
    const harness = actionHarness()
    const result = await runActivation(harness, activationForm(entries))
    assert.equal(result.outcome, "invalid_request")
    assert.deepEqual(harness.calls, ["assertAdminOrigin"])
    assert.equal(harness.state().rpcCount, 0)
  }
})

test("activation derives the current admin and invokes the service-role RPC once", async () => {
  const harness = actionHarness()
  const result = await runActivation(harness)
  assert.equal(result.outcome, "activated")
  assert.deepEqual(harness.calls, [
    "assertAdminOrigin",
    "requireAdmin",
    "createAdminClient",
    "rpc",
  ])
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.state().rpcInvocation)),
    {
      name: "activate_vendor_application",
      parameters: {
        p_application_id: applicationId,
        p_admin_user_id: adminId,
      },
    }
  )
  assert.equal(harness.state().rpcCount, 1)
  assert.deepEqual(harness.revalidated, [
    "/admin/vendor-applications",
    `/admin/vendor-applications/${applicationId}`,
  ])
})

test("ordinary main authorization failure is controlled before client creation", async () => {
  const harness = actionHarness({ adminFailure: "ordinary" })
  const result = await runActivation(harness)
  assert.equal(result.outcome, "operation_failed")
  assert.equal(result.message.includes("private"), false)
  assert.deepEqual(harness.calls, ["assertAdminOrigin", "requireAdmin"])
  assert.equal(harness.state().rpcCount, 0)
  assert.equal(harness.state().reconciliationCount, 0)
  assert.deepEqual(harness.diagnostics, [
    "MARKETA_ADMIN_VENDOR_ACTIVATION_AUTH_FAILED",
  ])
})

test("main authorization framework redirect propagates without becoming an action result", async () => {
  const harness = actionHarness({ adminFailure: "redirect" })
  await assert.rejects(
    runActivation(harness),
    (error) => error === harness.redirectSignal
  )
  assert.deepEqual(harness.calls, ["assertAdminOrigin", "requireAdmin"])
  assert.equal(harness.state().rpcCount, 0)
  assert.equal(harness.state().reconciliationCount, 0)
  assert.deepEqual(harness.diagnostics, [])
})

test("all bounded RPC outcomes map to controlled action results", async () => {
  for (const outcome of [
    "activated",
    "already_active",
    "unauthorized",
    "invalid_input",
    "unavailable",
    "invalid_state",
    "operation_failed",
  ]) {
    const harness = actionHarness({ rpcData: [rpcRow(outcome)] })
    const result = await runActivation(harness)
    assert.equal(result.outcome, outcome)
    assert.equal(harness.state().rpcCount, 1)
    assert.equal(harness.state().reconciliationCount, 0)
    assert.equal(result.message.includes("private"), false)
  }
})

test("malformed responses reconcile once and never replay activation", async () => {
  for (const rpcData of [
    null,
    [],
    [rpcRow("activated"), rpcRow("activated")],
    [rpcRow("activated", { application_id: vendorId })],
    [rpcRow("activated", { private_detail: "must not escape" })],
    [rpcRow("activated", { is_active: false })],
    [rpcRow("unknown")],
  ]) {
    const harness = actionHarness({ rpcData, reconciliationState: "active" })
    const result = await runActivation(harness)
    assert.equal(result.outcome, "reconciled_active")
    assert.equal(harness.state().rpcCount, 1)
    assert.equal(harness.state().reconciliationCount, 1)
  }
})

test("transport uncertainty reconciles once and fails neutrally when active state is unproved", async () => {
  for (const options of [
    { rpcThrows: true, reconciliationState: "inactive" },
    { rpcError: { message: "private database detail" }, reconciliationState: "unavailable" },
    { rpcThrows: true, reconciliationThrows: true },
  ]) {
    const harness = actionHarness(options)
    const result = await runActivation(harness)
    assert.equal(result.outcome, "uncertain")
    assert.equal(result.message.includes("private"), false)
    assert.equal(harness.state().rpcCount, 1)
    assert.equal(harness.state().reconciliationCount, 1)
  }
})

test("reconciliation framework redirect propagates without replaying activation", async () => {
  const harness = actionHarness({
    rpcThrows: true,
    reconciliationRedirects: true,
  })
  await assert.rejects(
    runActivation(harness),
    (error) => error === harness.redirectSignal
  )
  assert.equal(harness.state().rpcCount, 1)
  assert.equal(harness.state().reconciliationCount, 1)
  assert.deepEqual(harness.diagnostics, [
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RPC_TRANSPORT_FAILED",
  ])
})

test("ordinary reconciliation failure remains uncertain without RPC replay", async () => {
  const harness = actionHarness({
    rpcThrows: true,
    reconciliationThrows: true,
  })
  const result = await runActivation(harness)
  assert.equal(result.outcome, "uncertain")
  assert.equal(harness.state().rpcCount, 1)
  assert.equal(harness.state().reconciliationCount, 1)
  assert.deepEqual(harness.diagnostics, [
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RPC_TRANSPORT_FAILED",
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RECONCILIATION_FAILED",
  ])
})

test("service-role initialization failure is controlled and performs no mutation or reconciliation", async () => {
  const harness = actionHarness({ clientThrows: true })
  const result = await runActivation(harness)
  assert.equal(result.outcome, "operation_failed")
  assert.equal(result.message.includes("private"), false)
  assert.equal(harness.state().rpcCount, 0)
  assert.equal(harness.state().reconciliationCount, 0)
})

test("reconciliation independently authorizes before malformed-ID handling or privileged loading", async () => {
  const denied = reconciliationHarness({ adminThrows: true })
  await assert.rejects(
    denied.applications.reconcileVendorApplicationActivation("not-a-uuid"),
    (error) => error === denied.adminError
  )
  assert.deepEqual(denied.calls, ["requireAdmin"])

  const allowed = reconciliationHarness()
  assert.equal(
    await allowed.applications.reconcileVendorApplicationActivation("not-a-uuid"),
    "unavailable"
  )
  assert.deepEqual(allowed.calls, ["requireAdmin"])
})

test("authorized reconciliation performs one read-only application/vendor lookup", async () => {
  const authUserId = "44444444-4444-4444-8444-444444444444"
  const harness = reconciliationHarness({
    application: {
      id: applicationId,
      status: "approved",
      provisioning_status: "provisioned",
      vendor_id: vendorId,
      auth_user_id: authUserId,
      provisioned_at: "2026-09-27T11:00:00.000Z",
    },
    vendor: {
      id: vendorId,
      user_id: authUserId,
      is_active: true,
      activated_at: "2026-09-27T12:00:00.000Z",
    },
  })

  assert.equal(
    await harness.applications.reconcileVendorApplicationActivation(applicationId),
    "active"
  )
  assert.deepEqual(harness.calls, [
    "requireAdmin",
    "createAdminClient",
    "from:vendor_applications",
    "select:vendor_applications",
    "eq:vendor_applications",
    "maybeSingle:vendor_applications",
    "from:vendors",
    "select:vendors",
    "eq:vendors",
    "maybeSingle:vendors",
  ])
})

test("admin loader derives activation from the exact application and vendor linkage", () => {
  const source = fs.readFileSync(path.join(root, applicationsFile), "utf8")
  assert.match(source, /vendor_id,provisioned_at,auth_user_id/)
  assert.match(source, /select\("id,user_id,is_active,activated_at"\)/)
  assert.match(source, /data\.id !== application\.vendor_id/)
  assert.match(source, /data\.user_id !== application\.auth_user_id/)
  assert.match(source, /state: data\.is_active \? "active" : "inactive"/)
  assert.match(source, /auth_user_id: _authUserId/)
  assert.equal(source.includes("activated_by"), false)
  assert.match(source, /reconcileVendorApplicationActivation/)
})

test("admin loader diagnostics expose only fixed labels and bounded database codes", async () => {
  const readFailure = reconciliationHarness({
    applicationError: {
      code: "PGRST123",
      message: "private database message",
      details: applicationId,
    },
  })
  await assert.rejects(
    readFailure.applications.getVendorApplication(applicationId),
    /Unable to load this application\./
  )
  assert.deepEqual(readFailure.diagnostics, [
    "MARKETA_ADMIN_VENDOR_APPLICATION_READ_FAILED code=PGRST123",
  ])

  const unexpectedFailure = reconciliationHarness({ clientThrows: true })
  await assert.rejects(
    unexpectedFailure.applications.getVendorApplication(applicationId),
    /Unable to load this application\./
  )
  assert.deepEqual(unexpectedFailure.diagnostics, [
    "MARKETA_ADMIN_VENDOR_APPLICATION_LOAD_FAILED",
  ])

  const diagnostics = [
    ...readFailure.diagnostics,
    ...unexpectedFailure.diagnostics,
  ].join(" ")
  for (const forbidden of [
    applicationId,
    vendorId,
    adminId,
    "private",
    "@",
  ]) {
    assert.equal(diagnostics.includes(forbidden), false, forbidden)
  }

  const source = fs.readFileSync(path.join(root, applicationsFile), "utf8")
  assert.match(source, /MARKETA_ADMIN_VENDOR_APPLICATION_READ_FAILED/)
  assert.match(source, /MARKETA_ADMIN_VENDOR_APPLICATION_LOAD_FAILED/)
  assert.doesNotMatch(source, /console\.error\(error\)/)
})

function findElements(node, type, found = []) {
  if (!node || typeof node !== "object") return found
  if (node.type === type) found.push(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    findElements(child, type, found)
  }
  return found
}

function collectText(node, values = []) {
  if (typeof node === "string") values.push(node)
  if (!node || typeof node !== "object") return values
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    collectText(child, values)
  }
  return values
}

function loadAdminError(error, reset = () => {}) {
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const { default: AdminError } = load(errorFile, {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": { default: "a" },
  })
  return AdminError({ error, reset })
}

test("admin error boundary renders only safe copy and a bounded digest", () => {
  let resetCalls = 0
  const privateMessage = "private database failure"
  const privateStack = "private stack and UUID"
  const privateCause = "private cause and email"
  const tree = loadAdminError(
    {
      message: privateMessage,
      stack: privateStack,
      cause: privateCause,
      digest: "safe_digest-123",
    },
    () => { resetCalls++ }
  )
  const text = collectText(tree).join(" ")
  assert.match(text, /Unable to load admin review/)
  assert.match(text, /Please try again\. No automatic review retry will be performed\./)
  assert.match(text, /Try again/)
  assert.match(text, /Return to login/)
  assert.match(text, /Reference:\s+safe_digest-123/)
  assert.equal(text.includes(privateMessage), false)
  assert.equal(text.includes(privateStack), false)
  assert.equal(text.includes(privateCause), false)

  findElements(tree, "button")[0].props.onClick()
  assert.equal(resetCalls, 1)

  const invalidDigestText = collectText(
    loadAdminError({ message: privateMessage, digest: "unsafe digest" })
  ).join(" ")
  assert.equal(invalidDigestText.includes("Reference:"), false)
  assert.equal(invalidDigestText.includes("unsafe digest"), false)
})

function loadActivationForm({ confirming = false, pending = false } = {}) {
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  return load(formFile, {
    react: {
      useActionState() {
        return [
          { outcome: "idle", message: "", revision: "" },
          () => {},
          pending,
        ]
      },
      useEffect() {},
      useState() { return [confirming, () => {}] },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/navigation": {
      useRouter() { return { refresh() {} } },
    },
    "../actions": {
      activateVendorApplication() {},
    },
    "@/lib/admin/vendor-applications": {},
  })
}

test("activation UI renders no button for unprovisioned or invalid linkage", () => {
  const { ActivationForm } = loadActivationForm()
  for (const state of ["not_provisioned", "unavailable"]) {
    const tree = ActivationForm({
      applicationId,
      activationState: state,
      activatedAt: null,
    })
    assert.equal(findElements(tree, "form").length, 0)
    assert.equal(findElements(tree, "button").length, 0)
  }
})

test("inactive provisioned seller receives only the activation control", () => {
  const { ActivationForm } = loadActivationForm()
  const tree = ActivationForm({
    applicationId,
    activationState: "inactive",
    activatedAt: null,
  })
  const buttons = findElements(tree, "button")
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props.children, "Activate Seller")
  assert.equal(findElements(tree, "form").length, 0)
})

test("active seller renders stable state and human-readable activation time", () => {
  const { ActivationForm } = loadActivationForm()
  const activatedAt = "2026-09-27T12:00:00.000Z"
  const tree = ActivationForm({
    applicationId,
    activationState: "active",
    activatedAt,
  })
  assert.equal(findElements(tree, "button").length, 0)
  assert.equal(findElements(tree, "form").length, 0)
  assert.equal(findElements(tree, "time")[0].props.dateTime, activatedAt)
  assert.match(collectText(tree).join(" "), /Seller active/)
})

test("confirmation states immediate selling effects and preserves verification separation", () => {
  const { ActivationForm } = loadActivationForm({ confirming: true, pending: true })
  const tree = ActivationForm({
    applicationId,
    activationState: "inactive",
    activatedAt: null,
  })
  const text = collectText(tree).join(" ").replace(/\s+/g, " ").toLowerCase()
  for (const expected of [
    "product creation",
    "editing",
    "status management",
    "product-image upload",
    "public vendor visibility",
    "storefront",
    "checkout eligibility",
    "may become publicly visible immediately",
    "activation does not verify the seller",
  ]) {
    assert.equal(text.includes(expected), true, expected)
  }
  const form = findElements(tree, "form")[0]
  const inputs = findElements(form, "input")
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].props.name, "application_id")
  assert.equal(inputs[0].props.value, applicationId)
  assert.equal(findElements(form, "fieldset")[0].props.disabled, true)
  assert.equal(fs.readFileSync(path.join(root, formFile), "utf8").includes("activated_by"), false)
})

test("detail page integrates activation state without rendering internal actor identity", () => {
  const page = fs.readFileSync(path.join(root, pageFile), "utf8")
  assert.match(page, /<ActivationForm/)
  assert.match(page, /activationState=\{application\.activation\.state\}/)
  assert.match(page, /activatedAt=\{application\.activation\.activatedAt\}/)
  assert.equal(page.includes("activated_by"), false)
  assert.match(page, /Activation never verifies a seller/)
})

test('the "use server" module exports only async runtime functions and the form owns initial state', () => {
  const actions = fs.readFileSync(path.join(root, actionsFile), "utf8")
  const form = fs.readFileSync(path.join(root, formFile), "utf8")

  assert.match(actions, /^"use server"/)
  assert.doesNotMatch(actions, /export\s+const\s+initialActivationResult\b/)
  assert.deepEqual(
    [...actions.matchAll(
      /^\s*export\s+(?!async\s+function\b)(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm
    )].map((match) => match[1]),
    []
  )

  assert.match(
    form,
    /import\s+\{\s*activateVendorApplication\s*\}\s+from\s+["']\.\.\/actions["']/
  )
  assert.match(
    form,
    /import\s+type\s+\{\s*ActivationResult\s*\}\s+from\s+["']\.\.\/actions["']/
  )
  assert.match(
    form,
    /const\s+initialActivationResult:\s*ActivationResult\s*=\s*\{[\s\S]*?outcome:\s*["']idle["'][\s\S]*?\}/
  )
  assert.match(
    form,
    /useActionState\(\s*activateVendorApplication,\s*initialActivationResult\s*\)/
  )
  assert.doesNotMatch(form, /export\s+const\s+initialActivationResult\b/)
})

test("activation source preserves all frozen boundaries", () => {
  const actions = fs.readFileSync(path.join(root, actionsFile), "utf8")
  const actionStart = actions.indexOf(
    "export async function activateVendorApplication"
  )
  assert.notEqual(actionStart, -1)
  const actionEnd = actions.indexOf(
    "export async function initiateVendorProvisioning",
    actionStart
  )
  assert.notEqual(actionEnd, -1)
  const activationAction = actions.slice(actionStart, actionEnd)
  assert.match(activationAction, /await assertAdminOrigin\(\)/)
  assert.match(activationAction, /admin = await requireAdmin\(\)/)
  assert.match(activationAction, /unstable_rethrow\(error\)/)
  assert.match(activationAction, /createAdminClient\(\)/)
  assert.match(activationAction, /rpc\("activate_vendor_application"/)
  assert.doesNotMatch(activationAction, /createSupabaseServerClient/)
  assert.doesNotMatch(activationAction, /vendor_verifications|products|storage|orders|payout|checkout/i)
  assert.doesNotMatch(activationAction, /deactiv|suspend|reactivat/i)
  assert.equal((activationAction.match(/rpc\("activate_vendor_application"/g) ?? []).length, 1)
  for (const marker of [
    "MARKETA_ADMIN_VENDOR_ACTIVATION_AUTH_FAILED",
    "MARKETA_ADMIN_VENDOR_ACTIVATION_CLIENT_INIT_FAILED",
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RPC_TRANSPORT_FAILED",
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RPC_RETURNED_ERROR",
    "MARKETA_ADMIN_VENDOR_ACTIVATION_RPC_RESPONSE_INVALID",
  ]) {
    assert.equal(activationAction.includes(marker), true, marker)
  }
  assert.match(actions, /MARKETA_ADMIN_VENDOR_ACTIVATION_RECONCILIATION_FAILED/)
})
