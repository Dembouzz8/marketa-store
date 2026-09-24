import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const { NextRequest: RealNextRequest, NextResponse: RealNextResponse } =
  require("next/server")
const forgotPageFile = "src/app/(store)/account/password/forgot/page.tsx"
const forgotFormFile =
  "src/app/(store)/account/password/forgot/forgot-password-form.tsx"
const callbackFile = "src/app/(store)/account/auth/recovery/route.ts"
const confirmFile =
  "src/app/(store)/account/auth/recovery/confirm/page.tsx"
const resetPageFile = "src/app/(store)/account/password/reset/page.tsx"
const passwordFormFile =
  "src/app/(store)/account/security/password/password-form.tsx"
const customerLoginFile = "src/app/(store)/account/login/page.tsx"
const vendorLoginFile = "src/app/vendor/login/page.tsx"
const proxyFile = "src/proxy.ts"
const inviteCallbackFile = "src/app/vendor/auth/callback/route.ts"
const finalizationActionFile = "src/app/vendor/onboarding/actions.ts"
const finalizationHelperFile = "src/lib/vendor/finalization.ts"
const provisioningFile = "supabase/functions/initiate-vendor-provisioning/index.ts"
const recoveryRedirectUrl =
  "https://marketa-store.vercel.app/account/auth/recovery"
const failurePath = "/account/password/forgot?recovery_error=1"
const recoveryCookieName = "marketa-password-recovery"
const userId = "11111111-1111-4111-8111-111111111111"
const testPassword = "  example-only-recovery-password  "

function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8")
}

function load(file, mocks, env = {}) {
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const compiledModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: compiledModule,
    exports: compiledModule.exports,
    URL,
    Headers,
    process: { env },
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
    props: { ...node.props, children: materialize(node.props?.children) },
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

class CookieJar {
  constructor(items = [], rejectName = null) {
    this.items = [...items]
    this.rejectName = rejectName
  }

  get(name) {
    return this.items.find((item) => item.name === name)
  }

  getAll() {
    return [...this.items]
  }

  set(name, value, options = {}) {
    if (typeof name === "object") {
      options = name
      value = name.value
      name = name.name
    }
    if (name === this.rejectName) throw new Error("cookie write failed")
    this.items = this.items.filter((item) => item.name !== name)
    this.items.push({ ...options, name, value })
  }
}

function responseClass(rejectCookieName = null) {
  return class MockResponse {
    constructor(url, status = 200) {
      this.url = String(url)
      this.status = status
      this.headers = new Headers()
      this.cookies = new CookieJar([], rejectCookieName)
    }

    static redirect(url, status = 307) {
      const response = new this(url, status)
      response.headers.set("Location", String(url))
      return response
    }

    static next() {
      return new this("https://example.test/", 200)
    }
  }
}

function request(pathname, {
  cookies = [],
  origin,
  fetchSite,
  fetchMode,
  fetchDestination,
  referer,
  body = "",
} = {}) {
  const url = `https://example.test${pathname}`
  const headers = new Headers()
  if (origin !== undefined) headers.set("Origin", origin)
  if (fetchSite !== undefined) headers.set("Sec-Fetch-Site", fetchSite)
  if (fetchMode !== undefined) headers.set("Sec-Fetch-Mode", fetchMode)
  if (fetchDestination !== undefined) headers.set("Sec-Fetch-Dest", fetchDestination)
  if (referer !== undefined) headers.set("Referer", referer)
  return {
    url,
    nextUrl: new URL(url),
    cookies: new CookieJar(cookies),
    headers,
    async text() {
      return body
    },
  }
}

function realRequest(pathname, { method = "GET", cookie, headers = {} } = {}) {
  const requestHeaders = new Headers(headers)
  if (cookie) requestHeaders.set("Cookie", cookie)
  return new RealNextRequest(`https://example.test${pathname}`, {
    method,
    headers: requestHeaders,
  })
}

function destination(response) {
  const location = new URL(response.headers.get("Location"))
  return location.pathname + location.search
}

function forgotPage(siteUrl) {
  return load(forgotPageFile, {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": (props) => jsx("a", props),
    "lucide-react": { KeyRound: (props) => jsx("svg", props) },
    "./forgot-password-form": {
      ForgotPasswordForm: (props) => jsx("forgot-password-form", props),
    },
  }, siteUrl === undefined ? {} : { MARKETA_SITE_URL: siteUrl })
}

function forgotForm(mode = {}) {
  const state = []
  const resetCalls = []
  let cursor = 0
  let client

  function useState(initialValue) {
    const index = cursor++
    if (!(index in state)) state[index] = initialValue
    const setValue = (value) => {
      state[index] = typeof value === "function" ? value(state[index]) : value
    }
    return [state[index], setValue]
  }

  const compiled = load(forgotFormFile, {
    react: {
      useState,
      useMemo(factory) {
        client ??= factory()
        return client
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "lucide-react": {
      CheckCircle2: (props) => jsx("svg", props),
      Loader2: (props) => jsx("svg", props),
      Mail: (props) => jsx("svg", props),
    },
    "@/components/ui/button": { Button: (props) => jsx("button", props) },
    "@/components/ui/input": { Input: (props) => jsx("input", props) },
    "@/components/ui/label": { Label: (props) => jsx("label", props) },
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient() {
        return {
          auth: {
            async resetPasswordForEmail(email, options) {
              resetCalls.push({ email, options })
              if (mode.throwError) throw new Error("RAW_PRIVATE_RECOVERY_ERROR")
              return { data: {}, error: mode.error ?? null }
            },
          },
          from() {
            throw new Error("recovery request must not query account data")
          },
        }
      },
    },
  })

  function render(props = { recoveryRedirectUrl }) {
    cursor = 0
    return materialize(compiled.ForgotPasswordForm(props))
  }

  function enterEmail(value, props) {
    const input = findElements(
      render(props),
      (element) => element.type === "input"
    )[0]
    input.props.onChange({ target: { value } })
    return render(props)
  }

  async function submit(tree = render()) {
    const form = findElements(tree, (element) => element.type === "form")[0]
    let prevented = false
    await form.props.onSubmit({ preventDefault: () => { prevented = true } })
    assert.equal(prevented, true)
    return render()
  }

  return { render, enterEmail, submit, resetCalls }
}

function callback(mode = {}) {
  let clientCreations = 0
  let verifications = 0
  let userChecks = 0
  const NextResponse = mode.realNextResponse
    ? RealNextResponse
    : responseClass(mode.rejectCookieName)
  const handler = load(callbackFile, {
    "next/server": { NextResponse },
    "@supabase/ssr": {
      createServerClient(_url, _key, { cookies }) {
        clientCreations++
        return {
          auth: {
            async verifyOtp(payload) {
              verifications++
              assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
                token_hash: "validhash",
                type: "recovery",
              })
              if (mode.verifyError) {
                return {
                  data: { session: null, user: null },
                  error: new Error("RAW_EXPIRED_TOKEN"),
                }
              }
              if (!mode.noAuthCookie) {
                cookies.setAll(
                  [{
                    name: "sb-auth",
                    value: "session",
                    options: { path: "/", httpOnly: true },
                  }],
                  { "Cache-Control": "private, no-store" }
                )
              }
              return {
                data: {
                  session: mode.noSession ? null : { access_token: "not-exposed" },
                  user: mode.noUser ? null : { id: userId },
                },
                error: null,
              }
            },
            async getUser() {
              userChecks++
              if (mode.userError) {
                return { data: { user: null }, error: new Error("private") }
              }
              return {
                data: {
                  user: {
                    id: mode.mismatch ? "22222222-2222-4222-8222-222222222222" : userId,
                    email: mode.missingEmail ? "" : "seller@example.test",
                    email_confirmed_at: mode.unconfirmed ? null : "confirmed",
                  },
                },
                error: null,
              }
            },
          },
        }
      },
    },
  }, { NODE_ENV: "production" })
  return {
    handler,
    counts: () => ({ clientCreations, verifications, userChecks }),
  }
}

async function transientCookie(handler) {
  const response = await handler.GET(
    request("/account/auth/recovery?token_hash=validhash&type=recovery")
  )
  return { response, cookie: response.cookies.get(recoveryCookieName) }
}

function resetPage(mode = {}) {
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
        email_confirmed_at: "confirmed",
      }
  const page = load(resetPageFile, {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": (props) => jsx("a", props),
    "next/navigation": {
      redirect(value) {
        redirects.push(value)
        throw redirectSignal
      },
    },
    "lucide-react": { KeyRound: (props) => jsx("svg", props) },
    "@/lib/supabase-server": {
      async createSupabaseServerClient() {
        calls.push("createSupabaseServerClient")
        if (mode.clientThrow) throw new Error("private")
        return {
          auth: {
            async getUser() {
              calls.push("getUser")
              if (mode.getUserThrow) throw new Error("private")
              return {
                data: { user: configuredUser },
                error: mode.userError ? new Error("private") : null,
              }
            },
            async getSession() {
              getSessionCalls++
              throw new Error("getSession must not authorize reset")
            },
          },
          from() {
            dataLookups++
            throw new Error("reset must not query public data")
          },
        }
      },
    },
    "../../security/password/password-form": {
      PasswordForm: (props) => jsx("password-form", props),
    },
  })
  return {
    async run() {
      try {
        return materialize(await page.default())
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

function recoveryPasswordForm(mode = {}) {
  const state = []
  const updateCalls = []
  let cursor = 0
  let client
  let getUserCalls = 0
  let signOutCalls = 0

  function useState(initialValue) {
    const index = cursor++
    if (!(index in state)) state[index] = initialValue
    const setValue = (value) => {
      state[index] = typeof value === "function" ? value(state[index]) : value
    }
    return [state[index], setValue]
  }

  const form = load(passwordFormFile, {
    react: {
      useState,
      useMemo(factory) {
        client ??= factory()
        return client
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": (props) => jsx("a", props),
    "lucide-react": {
      CheckCircle2: (props) => jsx("svg", props),
      Loader2: (props) => jsx("svg", props),
    },
    "@/components/ui/button": { Button: (props) => jsx("button", props) },
    "@/components/ui/input": { Input: (props) => jsx("input", props) },
    "@/components/ui/label": { Label: (props) => jsx("label", props) },
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient() {
        return {
          auth: {
            async updateUser(payload) {
              updateCalls.push(payload)
              if (mode.throwError) throw new Error("RAW_PRIVATE")
              return { data: {}, error: mode.error ?? null }
            },
            async getUser() {
              getUserCalls++
            },
            async signOut() {
              signOutCalls++
            },
          },
        }
      },
    },
  })

  function render() {
    cursor = 0
    return materialize(form.PasswordForm({ mode: "recovery" }))
  }

  function enterPasswords(password, confirmation = password) {
    let inputs = findElements(render(), (element) => element.type === "input")
    inputs[0].props.onChange({ target: { value: password } })
    inputs = findElements(render(), (element) => element.type === "input")
    inputs[1].props.onChange({ target: { value: confirmation } })
    return render()
  }

  async function submit(tree) {
    const submitForm = findElements(tree, (element) => element.type === "form")[0]
    await submitForm.props.onSubmit({ preventDefault() {} })
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

test("customer and vendor login link to the shared forgot-password route", () => {
  for (const file of [customerLoginFile, vendorLoginFile]) {
    const loginSource = source(file)
    assert.match(loginSource, /Forgot password\?/)
    assert.match(loginSource, /href="\/account\/password\/forgot"/)
  }
  assert.doesNotMatch(source(vendorLoginFile), /setError\(signInError\.message\)/)
})

for (const [name, siteUrl] of [
  ["missing origin", undefined],
  ["malformed origin", "not-a-url"],
  ["HTTP origin", "http://marketa-store.vercel.app"],
  ["surrounding whitespace", " https://marketa-store.vercel.app "],
  ["normalized backslash", "https:\\marketa-store.vercel.app"],
  ["username", "https://user@marketa-store.vercel.app/"],
  ["password", "https://user:pass@marketa-store.vercel.app/"],
  ["non-root path", "https://marketa-store.vercel.app/app"],
  ["query", "https://marketa-store.vercel.app/?next=/other"],
  ["empty query delimiter", "https://marketa-store.vercel.app/?"],
  ["fragment", "https://marketa-store.vercel.app/#fragment"],
  ["empty fragment delimiter", "https://marketa-store.vercel.app/#"],
]) {
  test(`${name} makes password recovery unavailable`, () => {
    const tree = materialize(forgotPage(siteUrl).default())
    assert.match(textContent(tree), /Password recovery is temporarily unavailable/)
    assert.equal(findElements(tree, (element) => element.type === "forgot-password-form").length, 0)
  })
}

test("valid authoritative HTTPS origin constructs the exact recovery callback", () => {
  const tree = materialize(
    forgotPage("https://marketa-store.vercel.app").default()
  )
  const form = findElements(
    tree,
    (element) => element.type === "forgot-password-form"
  )[0]
  assert.equal(form.props.recoveryRedirectUrl, recoveryRedirectUrl)
})

test("forgot page uses only MARKETA_SITE_URL as redirect authority", () => {
  const pageSource = source(forgotPageFile)
  assert.match(pageSource, /process\.env\.MARKETA_SITE_URL/)
  assert.match(
    pageSource,
    /new URL\("\/account\/auth\/recovery", marketaSiteUrl\)\.toString\(\)/
  )
  for (const forbidden of [
    "NEXT_PUBLIC_MARKETA_SITE_URL",
    "window.location.origin",
    "request.nextUrl.origin",
    "x-forwarded-host",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "searchParams",
  ]) {
    assert.equal(pageSource.includes(forbidden), false, forbidden)
  }
})

test("invalid email is rejected locally without recovery call", async () => {
  for (const email of ["", "missing-at.example.test", "a@b", `${"a".repeat(250)}@x.test`]) {
    const app = forgotForm()
    const tree = await app.submit(app.enterEmail(email))
    assert.match(textContent(tree), /Enter a valid email address/)
    assert.equal(app.resetCalls.length, 0)
  }
})

test("valid email is normalized and sent with the exact fixed redirect", async () => {
  const app = forgotForm()
  await app.submit(app.enterEmail("  Seller@Example.Test  "))
  assert.deepEqual(JSON.parse(JSON.stringify(app.resetCalls)), [{
    email: "seller@example.test",
    options: { redirectTo: recoveryRedirectUrl },
  }])
})

test("provider success, returned error, and thrown error have identical public output", async () => {
  const outputs = []
  for (const mode of [
    {},
    { error: { message: "RAW_USER_NOT_FOUND" } },
    { throwError: true },
  ]) {
    const app = forgotForm(mode)
    const tree = await app.submit(app.enterEmail("person@example.test"))
    outputs.push(textContent(tree))
    assert.equal(app.resetCalls.length, 1)
  }
  assert.equal(new Set(outputs).size, 1)
  assert.match(outputs[0], /If a Marketa account exists/)
  assert.doesNotMatch(outputs[0], /RAW_|not found/i)
})

test("forgot form has no redirect input, origin fallback, lookup, logging, or retry", () => {
  const formSource = source(forgotFormFile)
  assert.match(formSource, /resetPasswordForEmail\(normalizedEmail, \{[\s\S]*redirectTo: recoveryRedirectUrl/)
  for (const forbidden of [
    "window.location",
    "searchParams",
    "request.nextUrl",
    "VERCEL_URL",
    "marketa-store.vercel.app",
    '.from("',
    "console.",
  ]) {
    assert.equal(formSource.includes(forbidden), false, forbidden)
  }
  assert.equal(/name=["'](?:next|redirect|redirectTo|destination)/u.test(formSource), false)
})

test("real scanner GET returns a serialized short-lived HttpOnly cookie", async () => {
  const { handler, counts } = callback({ realNextResponse: true })
  const response = await handler.GET(realRequest(
    "/account/auth/recovery?token_hash=validhash&type=recovery"
  ))
  assert.equal(response.status, 303)
  assert.equal(destination(response), "/account/auth/recovery/confirm")
  const setCookie = response.headers.get("Set-Cookie")
  assert.ok(setCookie)
  assert.match(setCookie, /^marketa-password-recovery=/)
  assert.match(setCookie, /(?:^|; )Path=\/account\/auth\/recovery(?:;|$)/)
  assert.match(setCookie, /(?:^|; )Max-Age=600(?:;|$)/)
  assert.match(setCookie, /(?:^|; )HttpOnly(?:;|$)/)
  assert.match(setCookie, /(?:^|; )Secure(?:;|$)/)
  assert.match(setCookie, /(?:^|; )SameSite=lax(?:;|$)/)
  assert.deepEqual(counts(), { clientCreations: 0, verifications: 0, userChecks: 0 })
})

test("scanner GET removes the token, sets security headers, and never verifies", async () => {
  const { handler, counts } = callback()
  const { response, cookie } = await transientCookie(handler)
  assert.equal(response.status, 303)
  assert.equal(destination(response), "/account/auth/recovery/confirm")
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer")
  assert.equal(response.headers.get("Location").includes("validhash"), false)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.secure, true)
  assert.equal(cookie.sameSite, "lax")
  assert.equal(cookie.path, "/account/auth/recovery")
  assert.equal(cookie.maxAge, 600)
  assert.deepEqual(counts(), { clientCreations: 0, verifications: 0, userChecks: 0 })
})

test("malformed GET queries fail without verification or PKCE exchange", async () => {
  const { handler, counts } = callback()
  for (const query of [
    "type=recovery",
    "token_hash=validhash&type=invite",
    "token_hash=validhash&token_hash=other&type=recovery",
    "token_hash=validhash&type=recovery&next=/",
    "token_hash=%20&type=recovery",
    "token_hash=%00&type=recovery",
  ]) {
    const response = await handler.GET(request(`/account/auth/recovery?${query}`))
    assert.equal(destination(response), failurePath)
    assert.equal(response.cookies.get(recoveryCookieName).maxAge, 0)
  }
  assert.deepEqual(counts(), { clientCreations: 0, verifications: 0, userChecks: 0 })
  assert.equal(source(callbackFile).includes("exchangeCodeForSession"), false)
})

test("confirmation page contains only an explicit token-free POST form", () => {
  const page = load(confirmFile, {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
  })
  const tree = materialize(page.default())
  const forms = findElements(tree, (element) => element.type === "form")
  const hidden = findElements(
    tree,
    (element) => element.type === "input" && element.props.type === "hidden"
  )
  assert.equal(forms.length, 1)
  assert.equal(forms[0].props.method, "post")
  assert.equal(forms[0].props.action, "/account/auth/recovery")
  assert.equal(hidden.length, 0)
  const serialized = JSON.stringify(tree)
  assert.equal(serialized.includes("token_hash"), false)
  assert.equal(serialized.includes("validhash"), false)
  assert.equal(serialized.includes("autoSubmit"), false)
})

test("exact same-origin POST verifies once and reaches password reset", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/account/auth/recovery", {
    cookies: [cookie],
    origin: "https://example.test",
  }))
  assert.equal(response.status, 303)
  assert.equal(destination(response), "/account/password/reset")
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
  assert.equal(response.cookies.get("sb-auth").value, "session")
  assert.equal(response.cookies.get(recoveryCookieName).maxAge, 0)
})

test("same-origin Fetch Metadata and final Referer fallback are accepted", async () => {
  for (const metadata of [
    { fetchSite: "same-origin", fetchMode: "navigate", fetchDestination: "document" },
    { origin: "null", fetchSite: "same-origin" },
    { referer: "https://example.test/account/auth/recovery/confirm" },
  ]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/account/auth/recovery", {
      cookies: [cookie],
      ...metadata,
    }))
    assert.equal(destination(response), "/account/password/reset")
    assert.equal(counts().verifications, 1)
  }
})

test("cross-origin and untrusted source evidence fail before verification", async () => {
  for (const metadata of [
    { origin: "https://attacker.test", fetchSite: "same-origin" },
    { fetchSite: "cross-site" },
    { fetchSite: "same-site" },
    { fetchSite: "same-origin", fetchMode: "cors" },
    { fetchSite: "same-origin", fetchDestination: "iframe" },
    { referer: "https://attacker.test/form" },
    {},
  ]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/account/auth/recovery", {
      cookies: [cookie],
      ...metadata,
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(counts().verifications, 0)
  }
})

test("missing, malformed, expired, and future cookies fail before verification", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  for (const recoveryCookie of [
    undefined,
    { ...cookie, value: "bad-state" },
    { ...cookie, value: `${Date.now() - 601000}:validhash` },
    { ...cookie, value: `${Date.now() + 1000}:validhash` },
  ]) {
    const response = await handler.POST(request("/account/auth/recovery", {
      cookies: recoveryCookie ? [recoveryCookie] : [],
      origin: "https://example.test",
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(response.cookies.get(recoveryCookieName).maxAge, 0)
  }
  assert.equal(counts().verifications, 0)
})

test("POST rejects URL and body fields before verification", async () => {
  for (const [pathname, body] of [
    ["/account/auth/recovery?token_hash=validhash", ""],
    ["/account/auth/recovery", "token_hash=validhash"],
    ["/account/auth/recovery", "next=%2F"],
  ]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request(pathname, {
      cookies: [cookie],
      origin: "https://example.test",
      body,
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(counts().verifications, 0)
  }
})

test("invalid or used token verifies once and returns no Auth cookies", async () => {
  const { handler, counts } = callback({ verifyError: true })
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/account/auth/recovery", {
    cookies: [cookie],
    origin: "https://example.test",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(response.cookies.get("sb-auth"), undefined)
  assert.equal(response.cookies.get(recoveryCookieName).maxAge, 0)
  assert.equal(counts().verifications, 1)
})

test("all post-verification invariants fail without leaking partial Auth cookies", async () => {
  for (const mode of [
    { noSession: true },
    { noUser: true },
    { noAuthCookie: true },
    { userError: true },
    { mismatch: true },
    { missingEmail: true },
    { unconfirmed: true },
  ]) {
    const { handler, counts } = callback(mode)
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/account/auth/recovery", {
      cookies: [cookie],
      origin: "https://example.test",
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(response.cookies.get("sb-auth"), undefined)
    assert.equal(response.cookies.get(recoveryCookieName).maxAge, 0)
    assert.equal(counts().verifications, 1)
  }
})

test("real failure response discards partially written Auth cookies", async () => {
  const { handler, counts } = callback({ mismatch: true, realNextResponse: true })
  const getResponse = await handler.GET(realRequest(
    "/account/auth/recovery?token_hash=validhash&type=recovery"
  ))
  const cookie = getResponse.headers.get("Set-Cookie").split(";", 1)[0]
  const response = await handler.POST(realRequest("/account/auth/recovery", {
    method: "POST",
    cookie,
    headers: { Origin: "https://example.test" },
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(response.headers.get("Set-Cookie")?.includes("sb-auth"), false)
  assert.match(response.headers.get("Set-Cookie") ?? "", /marketa-password-recovery=/)
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
})

test("Auth-cookie write failure fails without a partial session", async () => {
  const { handler, counts } = callback({ rejectCookieName: "sb-auth" })
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/account/auth/recovery", {
    cookies: [cookie],
    origin: "https://example.test",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(response.cookies.get("sb-auth"), undefined)
  assert.equal(counts().verifications, 1)
})

test("signed-out reset page redirects to customer login", async () => {
  const app = resetPage({ user: null })
  await app.run()
  assert.deepEqual(app.redirects, ["/account/login"])
})

test("reset page authorizes with getUser and never queries vendor data", async () => {
  const app = resetPage()
  const tree = await app.run()
  assert.deepEqual(app.calls, ["createSupabaseServerClient", "getUser"])
  assert.equal(app.getSessionCalls(), 0)
  assert.equal(app.dataLookups(), 0)
  const passwordForm = findElements(
    tree,
    (element) => element.type === "password-form"
  )[0]
  assert.equal(passwordForm.props.mode, "recovery")
})

for (const [name, user] of [
  ["invalid UUID", { id: "invalid", email: "person@example.test", email_confirmed_at: "yes" }],
  ["missing email", { id: userId, email: "", email_confirmed_at: "yes" }],
  ["unconfirmed email", { id: userId, email: "person@example.test", email_confirmed_at: null }],
]) {
  test(`reset page fails closed for ${name}`, async () => {
    const tree = await resetPage({ user }).run()
    assert.match(textContent(tree), /Password reset unavailable/)
    assert.equal(findElements(tree, (element) => element.type === "password-form").length, 0)
  })
}

test("reset page uses shared customer and seller account wording", async () => {
  const text = textContent(await resetPage().run())
  assert.match(text, /Reset your Marketa password/)
  assert.match(text, /shared Marketa account/)
  assert.match(text, /customer sign-in/)
  assert.match(text, /seller sign-in/)
})

test("recovery password form preserves validation and exact update authority", async () => {
  const mismatch = recoveryPasswordForm()
  let tree = await mismatch.submit(
    mismatch.enterPasswords("example-password", "different-password")
  )
  assert.match(textContent(tree), /Passwords do not match/)
  assert.equal(mismatch.updateCalls.length, 0)

  const weak = recoveryPasswordForm({
    error: { code: "weak_password", message: "RAW_POLICY" },
  })
  tree = await weak.submit(weak.enterPasswords(testPassword))
  assert.match(textContent(tree), /Choose a stronger password/)
  assert.doesNotMatch(textContent(tree), /RAW_POLICY/)
  assert.equal(weak.updateCalls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(weak.updateCalls[0])), {
    password: testPassword,
  })
})

test("successful recovery update clears secrets and offers fixed login links", async () => {
  const app = recoveryPasswordForm()
  const tree = await app.submit(app.enterPasswords(testPassword))
  const inputs = findElements(tree, (element) => element.type === "input")
  assert.deepEqual(inputs.map((input) => input.props.value), ["", ""])
  assert.match(textContent(tree), /Your Marketa password has been reset/)
  assert.equal(JSON.stringify(tree).includes(testPassword), false)
  assert.deepEqual(
    findElements(tree, (element) => element.type === "a").map(
      (link) => link.props.href
    ),
    ["/account/login", "/vendor/login", "/"]
  )
  assert.equal(app.getUserCalls(), 0)
  assert.equal(app.signOutCalls(), 0)
})

test("reset source has no vendor, service-role, Admin, or extra password fields", () => {
  const combined = `${source(resetPageFile)}\n${source(passwordFormFile)}`
  for (const forbidden of [
    '.from("vendors")',
    "vendor_applications",
    "supabaseAdmin",
    "createAdminClient",
    "SUPABASE_SERVICE_ROLE_KEY",
    "auth.admin",
    "currentPassword",
    "current_password",
    "nonce",
    "reauthenticate",
    "signOut",
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden)
  }
  assert.match(source(passwordFormFile), /auth\.updateUser\(\{ password \}\)/)
})

test("proxy exposes only exact recovery request/callback/confirm routes", async () => {
  const NextResponse = responseClass()
  const { proxy } = load(proxyFile, {
    "next/server": { NextResponse },
    "@supabase/ssr": {
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    },
  })
  for (const route of [
    "/account/password/forgot",
    "/account/auth/recovery",
    "/account/auth/recovery/confirm",
  ]) {
    const response = await proxy(request(route))
    assert.equal(response.status, 200, route)
  }
  for (const route of [
    "/account/password/reset",
    "/account/profile",
    "/account/auth/recovery/confirm-extra",
  ]) {
    assert.equal(destination(await proxy(request(route))), "/account/login")
  }
  assert.equal(destination(await proxy(request("/vendor/dashboard"))), "/vendor/login")
  assert.equal(destination(await proxy(request("/admin/vendor-applications"))), "/admin/login")
})

test("proxy applies recovery no-store and referrer policies", async () => {
  const { proxy } = load(proxyFile, {
    "next/server": { NextResponse: responseClass() },
    "@supabase/ssr": {
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    },
  })
  const callbackResponse = await proxy(request("/account/auth/recovery"))
  assert.equal(callbackResponse.headers.get("Cache-Control"), "private, no-store")
  assert.equal(callbackResponse.headers.get("Referrer-Policy"), "no-referrer")
  const confirmResponse = await proxy(request("/account/auth/recovery/confirm"))
  assert.equal(confirmResponse.headers.get("Cache-Control"), "private, no-store")
  assert.equal(confirmResponse.headers.get("Referrer-Policy"), "same-origin")
})

test("recovery implementation preserves frozen boundaries", () => {
  const recoverySource = [
    forgotPageFile,
    forgotFormFile,
    callbackFile,
    confirmFile,
    resetPageFile,
    passwordFormFile,
    customerLoginFile,
    vendorLoginFile,
    proxyFile,
  ].map(source).join("\n")
  for (const forbidden of [
    "vendor_verifications",
    '.from("products")',
    '.from("orders")',
    '.from("payouts")',
    '.from("refunds")',
    "n8n",
    "inviteUserByEmail",
    "admin.updateUserById",
  ]) {
    assert.equal(recoverySource.includes(forbidden), false, forbidden)
  }
  assert.equal(source(inviteCallbackFile).includes("marketa-password-recovery"), false)
  assert.equal(source(finalizationActionFile).includes("marketa-password-recovery"), false)
  assert.equal(source(finalizationHelperFile).includes("marketa-password-recovery"), false)
  assert.equal(source(provisioningFile).includes("marketa-password-recovery"), false)
})

test("all approved Batch 3F2A files exist", () => {
  for (const file of [
    forgotPageFile,
    forgotFormFile,
    callbackFile,
    confirmFile,
    resetPageFile,
    "tests/account-password-recovery.test.mjs",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file)
  }
})
