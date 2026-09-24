import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pageFile = "src/app/(store)/account/security/password/page.tsx"
const formFile =
  "src/app/(store)/account/security/password/password-form.tsx"
const pageSource = fs.readFileSync(path.join(root, pageFile), "utf8")
const formSource = fs.readFileSync(path.join(root, formFile), "utf8")
const userId = "11111111-1111-4111-8111-111111111111"
const testPassword = "  example-only-password  "
const compiledCache = new Map()

function compile(file, mocks) {
  let output = compiledCache.get(file)
  if (!output) {
    output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
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
    process: { env: {} },
    require(name) {
      if (name in mocks) return mocks[name]
      throw new Error(`Unexpected import: ${name}`)
    },
  }, { filename: file })
  return compiledModule.exports
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
  let getSessionCalls = 0
  let dataLookups = 0
  const redirectSignal = Symbol("redirect")
  const configuredUser = Object.hasOwn(mode, "user")
    ? mode.user
    : {
        id: userId,
        email: "seller@example.test",
        email_confirmed_at: "2026-09-23T08:00:00.000Z",
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
    "lucide-react": {
      KeyRound: (props) => jsx("svg", props),
    },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        calls.push("createSupabaseServerClient")
        if (mode.clientThrow) throw new Error("private client error")
        return {
          auth: {
            async getUser() {
              calls.push("getUser")
              if (mode.getUserThrow) throw new Error("private Auth error")
              return {
                data: { user: configuredUser },
                error: mode.userError ? new Error("private Auth error") : null,
              }
            },
            async getSession() {
              getSessionCalls++
              throw new Error("getSession must not authorize password setup")
            },
          },
          from() {
            dataLookups++
            throw new Error("password setup must not query application data")
          },
        }
      },
    },
    "./password-form": {
      PasswordForm: () => jsx("password-form", {}),
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
    getSessionCalls: () => getSessionCalls,
    dataLookups: () => dataLookups,
  }
}

function formHarness(mode = {}) {
  const state = []
  const updateCalls = []
  let stateCursor = 0
  let memoizedClient
  let getUserCalls = 0
  let signOutCalls = 0

  function useState(initialValue) {
    const index = stateCursor++
    if (!(index in state)) state[index] = initialValue
    const setValue = (value) => {
      state[index] = typeof value === "function" ? value(state[index]) : value
    }
    return [state[index], setValue]
  }

  const client = {
    auth: {
      async updateUser(payload) {
        updateCalls.push(payload)
        if (mode.updateThrow) throw new Error("RAW_PRIVATE_THROWN_ERROR")
        return {
          data: { user: { id: userId } },
          error: mode.updateError ?? null,
        }
      },
      async getUser() {
        getUserCalls++
        throw new Error("post-update getUser must not be required")
      },
      async signOut() {
        signOutCalls++
        throw new Error("password setup must not sign out")
      },
    },
  }

  const compiledExports = compile(formFile, {
    react: {
      useState,
      useMemo(factory) {
        memoizedClient ??= factory()
        return memoizedClient
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": (props) => jsx("a", props),
    "lucide-react": {
      CheckCircle2: (props) => jsx("svg", props),
      Loader2: (props) => jsx("svg", props),
    },
    "@/components/ui/button": {
      Button: (props) => jsx("button", props),
    },
    "@/components/ui/input": {
      Input: (props) => jsx("input", props),
    },
    "@/components/ui/label": {
      Label: (props) => jsx("label", props),
    },
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient() {
        return client
      },
    },
  })

  function render() {
    stateCursor = 0
    return materialize(compiledExports.PasswordForm())
  }

  function enterPasswords(password, confirmation = password) {
    let tree = render()
    let inputs = findElements(tree, (element) => element.type === "input")
    inputs[0].props.onChange({ target: { value: password } })
    tree = render()
    inputs = findElements(tree, (element) => element.type === "input")
    inputs[1].props.onChange({ target: { value: confirmation } })
    return render()
  }

  async function submit(tree = render()) {
    const form = findElements(tree, (element) => element.type === "form")[0]
    let prevented = false
    await form.props.onSubmit({ preventDefault: () => { prevented = true } })
    assert.equal(prevented, true)
    return render()
  }

  return {
    render,
    enterPasswords,
    submit,
    updateCalls,
    getUserCalls: () => getUserCalls,
    signOutCalls: () => signOutCalls,
  }
}

test("signed-out users are redirected to customer login", async () => {
  const app = pageHarness({ user: null })
  await app.run()
  assert.deepEqual(app.redirects, ["/account/login"])
})

test("server page authorizes with getUser and never getSession", async () => {
  const app = pageHarness()
  await app.run()
  assert.deepEqual(app.calls, ["createSupabaseServerClient", "getUser"])
  assert.equal(app.getSessionCalls(), 0)
  assert.equal(pageSource.includes("getSession"), false)
})

for (const [name, user] of [
  ["invalid UUID", { id: "not-a-uuid", email: "seller@example.test", email_confirmed_at: "confirmed" }],
  ["missing email", { id: userId, email: "", email_confirmed_at: "confirmed" }],
  ["blank email", { id: userId, email: "   ", email_confirmed_at: "confirmed" }],
  ["unconfirmed email", { id: userId, email: "seller@example.test", email_confirmed_at: null }],
]) {
  test(`${name} fails closed without rendering the password form`, async () => {
    const tree = await pageHarness({ user }).run()
    assert.match(textContent(tree), /Password setup unavailable/)
    assert.equal(findElements(tree, (element) => element.type === "password-form").length, 0)
  })
}

test("Auth errors and exceptions fail closed with controlled UI", async () => {
  for (const mode of [{ userError: true }, { getUserThrow: true }, { clientThrow: true }]) {
    const tree = await pageHarness(mode).run()
    assert.match(textContent(tree), /Password setup unavailable/)
    assert.doesNotMatch(textContent(tree), /private/i)
  }
})

test("valid shared identity renders the password form without data lookups", async () => {
  const app = pageHarness()
  const tree = await app.run()
  assert.equal(findElements(tree, (element) => element.type === "password-form").length, 1)
  assert.equal(app.dataLookups(), 0)
})

test("server page uses account wording and a fixed dashboard continuation", async () => {
  const tree = await pageHarness().run()
  const text = textContent(tree)
  assert.match(text, /Set your Marketa password/)
  assert.match(text, /belongs to your Marketa account/)
  assert.match(text, /same password for customer and seller sign-in/)
  assert.match(text, /never chosen a password/)
  assert.match(text, /already know your Marketa password/)
  const links = findElements(tree, (element) => element.type === "a")
  assert.ok(links.some((link) => link.props.href === "/vendor/dashboard"))
  assert.equal(links.some((link) => /[?&](next|redirect)=/u.test(link.props.href)), false)
})

test("server page has no vendor lookup, privileged client, or sensitive markup", async () => {
  const serialized = JSON.stringify(await pageHarness().run())
  assert.equal(serialized.includes(testPassword), false)
  for (const forbidden of [
    '.from("vendors")',
    "vendor_applications",
    "supabaseAdmin",
    "createAdminClient",
    "SUPABASE_SERVICE_ROLE_KEY",
    "auth.admin",
  ]) {
    assert.equal(pageSource.includes(forbidden), false, forbidden)
  }
})

test("form provides two new-password fields", () => {
  const tree = formHarness().render()
  const inputs = findElements(tree, (element) => element.type === "input")
  assert.equal(inputs.length, 2)
  assert.deepEqual(inputs.map((input) => input.props.type), ["password", "password"])
  assert.deepEqual(
    inputs.map((input) => input.props.autoComplete),
    ["new-password", "new-password"]
  )
})

test("empty password is rejected locally without calling updateUser", async () => {
  const app = formHarness()
  const tree = await app.submit()
  assert.match(textContent(tree), /Enter a new password/)
  assert.equal(app.updateCalls.length, 0)
})

test("passwords shorter than eight characters are rejected locally", async () => {
  const app = formHarness()
  const tree = await app.submit(app.enterPasswords("short7"))
  assert.match(textContent(tree), /Use at least 8 characters/)
  assert.equal(app.updateCalls.length, 0)
})

test("mismatched passwords are rejected locally", async () => {
  const app = formHarness()
  const tree = await app.submit(
    app.enterPasswords("example-password", "different-password")
  )
  assert.match(textContent(tree), /Passwords do not match/)
  assert.equal(app.updateCalls.length, 0)
})

test("valid submission calls updateUser once with the exact unmodified password", async () => {
  const app = formHarness()
  await app.submit(app.enterPasswords(testPassword))
  assert.equal(app.updateCalls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(app.updateCalls[0])), {
    password: testPassword,
  })
  assert.deepEqual(Object.keys(app.updateCalls[0]), ["password"])
})

test("weak-password provider errors become controlled messages", async () => {
  const rawMessage = "RAW_PROVIDER_POLICY_DETAIL"
  const app = formHarness({
    updateError: { code: "weak_password", message: rawMessage },
  })
  const tree = await app.submit(app.enterPasswords(testPassword))
  assert.match(textContent(tree), /Choose a stronger password/)
  assert.doesNotMatch(textContent(tree), new RegExp(rawMessage))
  assert.equal(app.updateCalls.length, 1)
})

test("other returned provider errors are controlled and remain on the page", async () => {
  const rawMessage = "RAW_PROVIDER_SESSION_DETAIL"
  const app = formHarness({
    updateError: { code: "unexpected", message: rawMessage },
  })
  const tree = await app.submit(app.enterPasswords(testPassword))
  assert.match(textContent(tree), /couldn't update your password from this session/)
  assert.doesNotMatch(textContent(tree), new RegExp(rawMessage))
  assert.equal(app.updateCalls.length, 1)
})

test("thrown update errors are controlled without retry or sign-out", async () => {
  const app = formHarness({ updateThrow: true })
  const tree = await app.submit(app.enterPasswords(testPassword))
  assert.match(textContent(tree), /couldn't update your password from this session/)
  assert.doesNotMatch(textContent(tree), /RAW_PRIVATE_THROWN_ERROR/)
  assert.equal(app.updateCalls.length, 1)
  assert.equal(app.signOutCalls(), 0)
})

test("successful update clears inputs and renders shared-account success", async () => {
  const app = formHarness()
  const tree = await app.submit(app.enterPasswords(testPassword))
  const inputs = findElements(tree, (element) => element.type === "input")
  assert.deepEqual(inputs.map((input) => input.props.value), ["", ""])
  assert.match(textContent(tree), /Your Marketa password has been set/)
  assert.match(textContent(tree), /both customer and seller sign-in/)
  assert.equal(JSON.stringify(tree).includes(testPassword), false)
})

test("success does not depend on post-update getUser or automatically sign out", async () => {
  const app = formHarness()
  await app.submit(app.enterPasswords(testPassword))
  assert.equal(app.getUserCalls(), 0)
  assert.equal(app.signOutCalls(), 0)
})

test("successful navigation choices are fixed internal links", async () => {
  const app = formHarness()
  const tree = await app.submit(app.enterPasswords(testPassword))
  const hrefs = findElements(tree, (element) => element.type === "a").map(
    (link) => link.props.href
  )
  assert.deepEqual(hrefs, ["/vendor/dashboard", "/"])
})

test("password form source preserves the narrow Auth update contract", () => {
  assert.match(formSource, /auth\.updateUser\(\{ password \}\)/)
  for (const forbidden of [
    "currentPassword",
    "current_password",
    "nonce",
    "reauthenticate",
    "resetPasswordForEmail",
    "admin.updateUserById",
    "signUp",
    "inviteUserByEmail",
    "getUser",
    "getSession",
    "signOut",
    "console.",
    "window.location",
    "useRouter",
    "SUPABASE_SERVICE_ROLE_KEY",
    "auth.admin",
  ]) {
    assert.equal(formSource.includes(forbidden), false, forbidden)
  }
})

test("new Batch 3F1 files preserve frozen data boundaries", () => {
  const combined = `${pageSource}\n${formSource}`
  for (const forbidden of [
    "vendor_verifications",
    '.from("products")',
    '.from("orders")',
    '.from("payouts")',
    '.from("refunds")',
    "n8n",
    "vendor_applications",
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden)
  }
})

test("all approved Batch 3F1 password files exist", () => {
  for (const file of [pageFile, formFile, "tests/account-password-setup.test.mjs"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true)
  }
})
