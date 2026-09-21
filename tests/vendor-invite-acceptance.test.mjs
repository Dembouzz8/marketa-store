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
const { NextRequest: RealNextRequest, NextResponse: RealNextResponse } = require("next/server")
const callbackFile = "src/app/vendor/auth/callback/route.ts"
const failurePath = "/account/login?vendor_onboarding=1&invite_error=1"
const inviteCookieName = "marketa-vendor-invite"

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
  vm.runInNewContext(compiled, {
    module: compiledModule,
    exports: compiledModule.exports,
    URL,
    Headers,
    process: { env: { NODE_ENV: "production" } },
    require(name) {
      if (name in mocks) return mocks[name]
      throw new Error(`Unexpected import: ${name}`)
    },
  }, { filename: file })
  return compiledModule.exports
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
} = {}) {
  const url = `https://example.test${pathname}`
  const headers = new Headers()
  if (origin !== undefined) headers.set("Origin", origin)
  if (fetchSite !== undefined) headers.set("Sec-Fetch-Site", fetchSite)
  if (fetchMode !== undefined) headers.set("Sec-Fetch-Mode", fetchMode)
  if (fetchDestination !== undefined) headers.set("Sec-Fetch-Dest", fetchDestination)
  if (referer !== undefined) headers.set("Referer", referer)
  return { url, nextUrl: new URL(url), cookies: new CookieJar(cookies), headers }
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
            async verifyOtp({ token_hash, type }) {
              verifications++
              assert.equal(token_hash, "validhash")
              assert.equal(type, "invite")
              if (mode.verifyError) {
                return { data: { session: null, user: null }, error: new Error("expired") }
              }
              if (!mode.noAuthCookie) {
                cookies.setAll([
                  { name: "sb-auth", value: "session", options: { path: "/", httpOnly: true } },
                ], { "Cache-Control": "private, no-store" })
              }
              return {
                data: {
                  session: mode.noSession ? null : { access_token: "test-session" },
                  user: mode.noUser ? null : { id: "user-1" },
                },
                error: null,
              }
            },
            async getUser() {
              userChecks++
              return mode.userError
                ? { data: { user: null }, error: new Error("unavailable") }
                : { data: { user: { id: mode.mismatch ? "user-2" : "user-1" } }, error: null }
            },
          },
        }
      },
    },
  })
  return {
    handler,
    counts: () => ({ clientCreations, verifications, userChecks }),
  }
}

async function transientCookie(handler) {
  const response = await handler.GET(
    request("/vendor/auth/callback?token_hash=validhash&type=invite")
  )
  return { response, cookie: response.cookies.get(inviteCookieName) }
}

test("real Next GET serializes and round-trips the transient cookie", async () => {
  const { handler, counts } = callback({ realNextResponse: true })
  const response = await handler.GET(realRequest(
    "/vendor/auth/callback?token_hash=validhash&type=invite"
  ))

  assert.equal(response.status, 303)
  assert.equal(new URL(response.headers.get("Location")).pathname, "/vendor/auth/confirm")
  const setCookie = response.headers.get("Set-Cookie")
  assert.ok(setCookie)
  assert.match(setCookie, /^marketa-vendor-invite=/)
  assert.match(setCookie, /(?:^|; )Path=\/vendor\/auth(?:;|$)/)
  assert.match(setCookie, /(?:^|; )Max-Age=600(?:;|$)/)
  assert.match(setCookie, /(?:^|; )HttpOnly(?:;|$)/)
  assert.match(setCookie, /(?:^|; )Secure(?:;|$)/)
  assert.match(setCookie, /(?:^|; )SameSite=lax(?:;|$)/)
  assert.deepEqual(counts(), { clientCreations: 0, verifications: 0, userChecks: 0 })

  const cookie = setCookie.split(";", 1)[0]
  const postRequest = realRequest("/vendor/auth/callback", {
    method: "POST",
    cookie,
    headers: { Origin: "https://example.test" },
  })
  assert.match(postRequest.cookies.get(inviteCookieName)?.value ?? "", /:validhash$/)

  const postResponse = await handler.POST(postRequest)
  assert.equal(new URL(postResponse.headers.get("Location")).pathname, "/vendor/onboarding")
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
})

test("scanner GET sets only a transient cookie and never verifies", async () => {
  const { handler, counts } = callback()
  const { response, cookie } = await transientCookie(handler)
  assert.equal(destination(response), "/vendor/auth/confirm")
  assert.equal(response.status, 303)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer")
  assert.equal(response.headers.get("Location").includes("validhash"), false)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.secure, true)
  assert.equal(cookie.sameSite, "lax")
  assert.equal(cookie.path, "/vendor/auth")
  assert.equal(cookie.maxAge, 600)
  assert.deepEqual(counts(), { clientCreations: 0, verifications: 0, userChecks: 0 })
})

test("malformed and unexpected callback queries fail without verification", async () => {
  const { handler, counts } = callback()
  for (const query of [
    "type=invite",
    "token_hash=validhash&type=magiclink",
    "token_hash=validhash&token_hash=validhash&type=invite",
    "token_hash=validhash&type=invite&next=%2Fvendor%2Fdashboard",
    "token_hash=%20&type=invite",
    "token_hash=%00&type=invite",
  ]) {
    const response = await handler.GET(request(`/vendor/auth/callback?${query}`))
    assert.equal(destination(response), failurePath)
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer")
  }
  assert.equal(counts().verifications, 0)
})

test("confirmation GET renders an explicit POST without exposing the token", () => {
  const jsx = (_type, props) => ({ type: _type, props })
  const page = load("src/app/vendor/auth/confirm/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
  })
  const tree = page.default()
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /Continue seller enrollment/)
  assert.match(serialized, /"method":"post"/)
  assert.match(serialized, /"action":"\/vendor\/auth\/callback"/)
  assert.equal(serialized.includes("token_hash"), false)
  assert.equal(serialized.includes("validhash"), false)
})

test("explicit same-origin POST verifies exactly once and reaches onboarding", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback", {
    cookies: [cookie],
    origin: "https://example.test",
  }))
  assert.equal(destination(response), "/vendor/onboarding")
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
  assert.equal(response.cookies.get("sb-auth").value, "session")
  assert.equal(response.cookies.get("sb-auth").httpOnly, true)
  assert.equal(response.cookies.get(inviteCookieName).maxAge, 0)
  assert.equal(response.cookies.get(inviteCookieName).value, "")
})

test("same-origin Fetch Metadata accepts unusable Origin values", async () => {
  for (const source of [
    { fetchSite: "same-origin" },
    {
      origin: "",
      fetchSite: "same-origin",
      fetchMode: "navigate",
      fetchDestination: "document",
    },
    {
      origin: "null",
      fetchSite: "same-origin",
      fetchMode: "navigate",
      fetchDestination: "document",
    },
  ]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/vendor/auth/callback", {
      cookies: [cookie],
      ...source,
    }))
    assert.equal(destination(response), "/vendor/onboarding")
    assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
  }
})

test("same-origin Referer is the final source fallback", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback", {
    cookies: [cookie],
    referer: "https://example.test/vendor/auth/confirm",
  }))
  assert.equal(destination(response), "/vendor/onboarding")
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
})

test("explicit cross-origin Origin cannot be overridden by Fetch Metadata", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback", {
    cookies: [cookie],
    origin: "https://attacker.test",
    fetchSite: "same-origin",
    fetchMode: "navigate",
    fetchDestination: "document",
    referer: "https://example.test/vendor/auth/confirm",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(counts().verifications, 0)
})

test("untrusted or malformed Fetch Metadata fails closed", async () => {
  for (const metadata of [
    { fetchSite: "same-site" },
    { fetchSite: "cross-site" },
    { fetchSite: "none" },
    { fetchSite: "unknown" },
    { fetchSite: "" },
    { fetchSite: "same-origin", fetchMode: "cors" },
    { fetchSite: "same-origin", fetchDestination: "iframe" },
  ]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/vendor/auth/callback", {
      cookies: [cookie],
      ...metadata,
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(counts().verifications, 0)
  }
})

test("malformed, cross-origin, or missing Referer fails closed", async () => {
  for (const referer of ["not a URL", "https://attacker.test/form", undefined]) {
    const { handler, counts } = callback()
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/vendor/auth/callback", {
      cookies: [cookie],
      referer,
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(counts().verifications, 0)
  }
})

test("missing, expired, malformed, and cross-origin state never verifies", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const expired = { ...cookie, value: `${Date.now() - 601000}:validhash` }
  const future = { ...cookie, value: `${Date.now() + 1000}:validhash` }
  const malformed = { ...cookie, value: "bad-state" }
  for (const options of [
    { cookies: [], origin: "https://example.test" },
    { cookies: [expired], origin: "https://example.test" },
    { cookies: [future], origin: "https://example.test" },
    { cookies: [malformed], origin: "https://example.test" },
    { cookies: [cookie], origin: "https://attacker.test" },
    { cookies: [cookie] },
  ]) {
    const response = await handler.POST(request("/vendor/auth/callback", options))
    assert.equal(destination(response), failurePath)
    assert.equal(response.cookies.get("sb-auth"), undefined)
  }
  assert.equal(counts().verifications, 0)
})

test("POST query parameters fail before verification", async () => {
  const { handler, counts } = callback()
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback?next=%2Fvendor", {
    cookies: [cookie],
    origin: "https://example.test",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(counts().verifications, 0)
})

test("invalid or reused token fails without returning Auth cookies", async () => {
  const { handler, counts } = callback({ verifyError: true })
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback", {
    cookies: [cookie], origin: "https://example.test",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(response.cookies.get("sb-auth"), undefined)
  assert.equal(response.cookies.get(inviteCookieName).maxAge, 0)
  assert.equal(counts().verifications, 1)
})

test("later verification failures discard partially written Auth cookies", async () => {
  for (const mode of [{ mismatch: true }, { userError: true }, { noSession: true }, { noUser: true }]) {
    const { handler } = callback(mode)
    const { cookie } = await transientCookie(handler)
    const response = await handler.POST(request("/vendor/auth/callback", {
      cookies: [cookie], origin: "https://example.test",
    }))
    assert.equal(destination(response), failurePath)
    assert.equal(response.cookies.get("sb-auth"), undefined)
  }
})

test("real Next failure response does not serialize partial Auth cookies", async () => {
  const { handler, counts } = callback({ mismatch: true, realNextResponse: true })
  const getResponse = await handler.GET(realRequest(
    "/vendor/auth/callback?token_hash=validhash&type=invite"
  ))
  const cookie = getResponse.headers.get("Set-Cookie").split(";", 1)[0]
  const response = await handler.POST(realRequest("/vendor/auth/callback", {
    method: "POST",
    cookie,
    headers: { Origin: "https://example.test" },
  }))

  assert.equal(new URL(response.headers.get("Location")).pathname, "/account/login")
  assert.equal(response.headers.get("Set-Cookie")?.includes("sb-auth"), false)
  assert.match(response.headers.get("Set-Cookie") ?? "", /marketa-vendor-invite=/)
  assert.deepEqual(counts(), { clientCreations: 1, verifications: 1, userChecks: 1 })
})

test("Auth-cookie write failure fails safely without returning a partial session", async () => {
  const { handler, counts } = callback({ rejectCookieName: "sb-auth" })
  const { cookie } = await transientCookie(handler)
  const response = await handler.POST(request("/vendor/auth/callback", {
    cookies: [cookie], origin: "https://example.test",
  }))
  assert.equal(destination(response), failurePath)
  assert.equal(response.cookies.get("sb-auth"), undefined)
  assert.equal(counts().verifications, 1)
})

test("proxy allows only the exact two signed-out Auth paths", async () => {
  const NextResponse = responseClass()
  const { proxy } = load("src/proxy.ts", {
    "next/server": { NextResponse },
    "@supabase/ssr": {
      createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    },
  })
  const callbackResponse = await proxy(request("/vendor/auth/callback"))
  assert.equal(callbackResponse.status, 200)
  assert.equal(callbackResponse.headers.get("Cache-Control"), "private, no-store")
  assert.equal(callbackResponse.headers.get("Referrer-Policy"), "no-referrer")

  const confirmResponse = await proxy(request("/vendor/auth/confirm"))
  assert.equal(confirmResponse.status, 200)
  assert.equal(confirmResponse.headers.get("Cache-Control"), "private, no-store")
  assert.equal(confirmResponse.headers.get("Referrer-Policy"), "same-origin")
  for (const route of ["/vendor/dashboard", "/vendor/orders", "/vendor/products", "/vendor/auth/confirm-extra"]) {
    const response = await proxy(request(route))
    assert.equal(destination(response), "/vendor/login")
  }
})
