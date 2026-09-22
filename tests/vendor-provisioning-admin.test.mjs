import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const actionsFile =
  "src/app/admin/(protected)/vendor-applications/actions.ts"
const formFile =
  "src/app/admin/(protected)/vendor-applications/[id]/provision-form.tsx"
const pageFile =
  "src/app/admin/(protected)/vendor-applications/[id]/page.tsx"
const applicationsFile = "src/lib/admin/vendor-applications.ts"
const applicationId = "11111111-1111-4111-8111-111111111111"
const expectedProvisioningMessages = {
  awaiting_enrollment_existing:
    "Seller enrollment is ready. The applicant can continue with their existing Marketa account.",
  awaiting_enrollment_invited:
    "Seller enrollment has started. An invitation was sent to the applicant.",
  already_awaiting_enrollment:
    "This application is already awaiting seller enrollment.",
  manual_existing_unconfirmed:
    "An unconfirmed account already exists for this applicant. Manual reconciliation is required.",
  manual_vendor_collision:
    "This application conflicts with an existing seller identity. Manual review is required.",
  manual_ambiguous_identity:
    "Multiple authentication identities require manual review.",
  reconciliation_required:
    "Provisioning status is uncertain. Review the application before retrying.",
  invalid_request:
    "The seller enrollment request was rejected. Reload the page and try again.",
}

class MockFunctionsHttpError extends Error {
  constructor(body) {
    super("Function returned an error")
    this.context = {
      async json() {
        if (body instanceof Error) throw body
        return body
      },
    }
  }
}

function load(file, mocks) {
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
      crypto: globalThis.crypto,
      require(name) {
        if (name in mocks) return mocks[name]
        throw new Error(`Unexpected import: ${name}`)
      },
    },
    { filename: file }
  )
  return compiledModule.exports
}

function actionHarness({ data = null, error = null, invokeThrows = false } = {}) {
  const calls = []
  const revalidated = []
  let invocationCount = 0
  let serviceRoleClientCount = 0
  let invocation

  const actions = load(actionsFile, {
    "next/cache": {
      revalidatePath(value) {
        revalidated.push(value)
      },
    },
    "next/navigation": {
      redirect(value) {
        throw new Error(`redirect:${value}`)
      },
    },
    "@supabase/supabase-js": {
      FunctionsHttpError: MockFunctionsHttpError,
    },
    "@/lib/admin/auth": {
      async requireAdmin() {
        calls.push("requireAdmin")
        return { userId: "admin-user-id", email: "admin@example.com" }
      },
    },
    "@/lib/admin/origin": {
      async assertAdminOrigin() {
        calls.push("assertAdminOrigin")
      },
    },
    "@/lib/admin/supabase-admin": {
      createAdminClient() {
        serviceRoleClientCount++
        throw new Error("Provisioning must not use the service-role client")
      },
    },
    "@/lib/admin/vendor-applications": {
      applicationIdPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      applicationStatuses: [
        "submitted",
        "under_review",
        "approved",
        "rejected",
      ],
    },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        calls.push("createSupabaseServerClient")
        return {
          functions: {
            async invoke(name, options) {
              calls.push("invoke")
              invocationCount++
              invocation = { name, options }
              if (invokeThrows) throw new Error("private transport body")
              return { data, error }
            },
          },
        }
      },
    },
  })

  return {
    actions,
    calls,
    revalidated,
    state: () => ({
      invocation,
      invocationCount,
      serviceRoleClientCount,
    }),
  }
}

function provisioningForm(extraEntries = []) {
  const form = new FormData()
  form.set("applicationId", applicationId)
  for (const [key, value] of extraEntries) form.append(key, value)
  return form
}

async function runAction(harness, form = provisioningForm()) {
  return harness.actions.initiateVendorProvisioning(
    { message: "", revision: "" },
    form
  )
}

test("rejects invalid or expanded form input before invocation", async () => {
  for (const form of [
    provisioningForm([["applicationId", applicationId]]),
    provisioningForm([["email", "applicant@example.com"]]),
    (() => {
      const value = new FormData()
      value.set("applicationId", "not-a-uuid")
      return value
    })(),
  ]) {
    const harness = actionHarness()
    const result = await runAction(harness, form)
    assert.equal(result.message, expectedProvisioningMessages.invalid_request)
    assert.equal(harness.state().invocationCount, 0)
    assert.deepEqual(harness.calls, ["assertAdminOrigin", "requireAdmin"])
  }
})

test("uses origin and admin checks before the cookie-backed invocation", async () => {
  const harness = actionHarness({
    data: {
      ok: true,
      outcome: "awaiting_enrollment_existing",
      application_id: applicationId,
    },
  })
  const result = await runAction(harness)
  assert.equal(
    result.message,
    expectedProvisioningMessages.awaiting_enrollment_existing
  )
  assert.deepEqual(harness.calls, [
    "assertAdminOrigin",
    "requireAdmin",
    "createSupabaseServerClient",
    "invoke",
  ])
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.state().invocation)),
    {
      name: "initiate-vendor-provisioning",
      options: { body: { application_id: applicationId } },
    }
  )
  assert.equal(harness.state().serviceRoleClientCount, 0)
  assert.deepEqual(harness.revalidated, [
    "/admin/vendor-applications",
    `/admin/vendor-applications/${applicationId}`,
  ])
})

test("maps successful function outcomes to approved UI messages", async () => {
  for (const outcome of [
    "awaiting_enrollment_existing",
    "awaiting_enrollment_invited",
    "already_awaiting_enrollment",
  ]) {
    const harness = actionHarness({
      data: { ok: true, outcome, application_id: applicationId },
    })
    const result = await runAction(harness)
    assert.equal(result.message, expectedProvisioningMessages[outcome])
    assert.equal(harness.state().invocationCount, 1)
  }
})

test("maps approved HTTP error outcomes without exposing raw details", async () => {
  for (const outcome of [
    "manual_existing_unconfirmed",
    "manual_vendor_collision",
    "manual_ambiguous_identity",
    "reconciliation_required",
  ]) {
    const harness = actionHarness({
      error: new MockFunctionsHttpError({
        ok: false,
        outcome,
        application_id: applicationId,
        private_provider_detail: "must not escape",
      }),
    })
    const result = await runAction(harness)
    assert.equal(result.message, expectedProvisioningMessages[outcome])
    assert.equal(result.message.includes("must not escape"), false)
    assert.equal(harness.state().invocationCount, 1)
  }
})

test("unknown, malformed, and mismatched responses become uncertain", async () => {
  const uncertain =
    "Provisioning status is uncertain. Review the application before retrying."
  for (const response of [
    { data: { ok: true, outcome: "unknown" } },
    { data: { outcome: "awaiting_enrollment_existing", application_id: applicationId } },
    { data: { ok: true, outcome: "awaiting_enrollment_invited", application_id: "22222222-2222-4222-8222-222222222222" } },
    { data: "not-json" },
    { error: new MockFunctionsHttpError(new Error("malformed response")) },
  ]) {
    const harness = actionHarness(response)
    const result = await runAction(harness)
    assert.equal(result.message, uncertain)
    assert.equal(harness.state().invocationCount, 1)
  }
})

test("transport errors are uncertain and never retried", async () => {
  const harness = actionHarness({ invokeThrows: true })
  const result = await runAction(harness)
  assert.equal(
    result.message,
    "Provisioning status is uncertain. Review the application before retrying."
  )
  assert.equal(harness.state().invocationCount, 1)
})

function loadProvisionForm() {
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  return load(formFile, {
    react: {
      useActionState() {
        return [{ message: "", revision: "" }, () => {}, false]
      },
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/navigation": {
      useRouter() {
        return { refresh() {} }
      },
    },
    "../actions": { initiateVendorProvisioning() {} },
  })
}

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

test("UI eligibility blocks blind retries and allows only explicit safe starts", () => {
  const { ProvisionForm, getProvisionControlState } = loadProvisionForm()
  for (const provisioningStatus of ["in_progress", "awaiting_enrollment", "provisioned"]) {
    const tree = ProvisionForm({
      applicationId,
      status: "approved",
      provisioningStatus,
      hasProvisionedVendor: false,
    })
    assert.equal(findElements(tree, "form").length, 0)
    assert.equal(
      getProvisionControlState({
        status: "approved",
        provisioningStatus,
        hasProvisionedVendor: false,
      }).canSubmit,
      false
    )
  }

  const retryTree = ProvisionForm({
    applicationId,
    status: "approved",
    provisioningStatus: "failed",
    hasProvisionedVendor: false,
  })
  assert.equal(findElements(retryTree, "form").length, 1)
  assert.equal(findElements(retryTree, "button")[0].props.children, "Retry seller enrollment")

  const startTree = ProvisionForm({
    applicationId,
    status: "approved",
    provisioningStatus: "not_started",
    hasProvisionedVendor: false,
  })
  assert.equal(findElements(startTree, "form").length, 1)
  assert.equal(findElements(startTree, "input").length, 1)
  assert.equal(findElements(startTree, "input")[0].props.name, "applicationId")

  const text = collectText(startTree).join(" ").toLowerCase()
  for (const unsupportedClaim of [
    "seller is active",
    "seller is verified",
    "vendor created",
    "provisioning finalized",
  ]) {
    assert.equal(text.includes(unsupportedClaim), false)
  }
})

test("source preserves the server-only invocation and frozen boundaries", () => {
  const actions = fs.readFileSync(path.join(root, actionsFile), "utf8")
  const actionStart = actions.indexOf(
    "export async function initiateVendorProvisioning"
  )
  assert.notEqual(actionStart, -1)
  const provisioningAction = actions.slice(actionStart)
  assert.match(provisioningAction, /await assertAdminOrigin\(\)/)
  assert.match(provisioningAction, /await requireAdmin\(\)/)
  assert.match(
    provisioningAction,
    /functions\.invoke\(\s*"initiate-vendor-provisioning"/
  )
  assert.equal(provisioningAction.includes("createAdminClient"), false)
  assert.equal(provisioningAction.includes("SUPABASE_SERVICE_ROLE_KEY"), false)
  for (const forbiddenField of [
    "admin_id",
    "auth_user_id",
    "vendor_id",
    "redirect_url",
  ]) {
    assert.equal(provisioningAction.includes(forbiddenField), false)
  }
  assert.doesNotMatch(provisioningAction, /\bretry\s*:/)

  const page = fs.readFileSync(path.join(root, pageFile), "utf8")
  const applications = fs.readFileSync(path.join(root, applicationsFile), "utf8")
  assert.match(page, /<ProvisionForm/)
  assert.match(page, /application\.vendor_id !== null/)
  assert.match(page, /application\.provisioned_at !== null/)
  assert.match(applications, /vendor_id,provisioned_at/)
})
