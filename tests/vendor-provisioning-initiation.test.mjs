import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const functionFile =
  "supabase/functions/initiate-vendor-provisioning/index.ts"
const configFile = "supabase/config.toml"
const applicationId = "11111111-1111-4111-8111-111111111111"
const adminId = "22222222-2222-4222-8222-222222222222"
const authUserId = "33333333-3333-4333-8333-333333333333"
const otherAuthUserId = "44444444-4444-4444-8444-444444444444"
const applicationEmail = "seller@example.com"
const accessToken = "private.admin.jwt"
const serviceRoleKey = "private-service-role-key"
const redirectTo =
  "https://marketa-store.vercel.app/vendor/auth/callback"

const claimRow = (outcome = "claimed", provisioningStatus = "in_progress", vendorId = null) => ({
  outcome,
  application_id: applicationId,
  vendor_id: vendorId,
  provisioning_status: provisioningStatus,
})

const resolverRow = (
  outcome,
  id = null,
  emailConfirmed = null,
  wasInvited = null
) => ({
  outcome,
  auth_user_id: id,
  email_confirmed: emailConfirmed,
  was_invited: wasInvited,
})

const recordRow = (outcome = "awaiting_enrollment") => ({
  outcome,
  application_id: applicationId,
  vendor_id: null,
  provisioning_status: "awaiting_enrollment",
})

const failRow = () => ({
  outcome: "failed",
  application_id: applicationId,
  vendor_id: null,
  provisioning_status: "failed",
})

const applicationRow = (overrides = {}) => ({
  id: applicationId,
  email: applicationEmail,
  status: "approved",
  provisioning_status: "in_progress",
  auth_user_id: null,
  vendor_id: null,
  provisioned_at: null,
  ...overrides,
})

function loadHandler(mode) {
  const source = fs.readFileSync(path.join(root, functionFile), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiledModule = { exports: {} }
  let servedHandler

  vm.runInNewContext(
    compiled,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      Request,
      Response,
      Headers,
      URL,
      TextDecoder,
      TextEncoder,
      Deno: {
        env: {
          get(name) {
            return {
              SUPABASE_URL: "https://example.supabase.co",
              SUPABASE_ANON_KEY: "public-anon-key",
              SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
            }[name]
          },
        },
      },
      console: {
        info(...values) {
          mode.logs.push(values)
        },
        error(...values) {
          mode.logs.push(values)
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
          return { createClient: mode.createClient }
        }
        throw new Error(`Unexpected import: ${name}`)
      },
    },
    { filename: functionFile }
  )

  assert.equal(typeof servedHandler, "function")
  return compiledModule.exports.handleRequest
}

function makeThenable(result) {
  const builder = {
    select() {
      return builder
    },
    eq() {
      return builder
    },
    maybeSingle() {
      return Promise.resolve(result)
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return builder
}

function createMode(overrides = {}) {
  const mode = {
    logs: [],
    clientCreations: [],
    rpcCalls: [],
    tableCalls: [],
    inviteCalls: [],
    membershipCalls: 0,
    applicationReads: 0,
    authResult: {
      data: { user: { id: adminId } },
      error: null,
    },
    memberships: [{ data: { user_id: adminId }, error: null }],
    applications: [],
    rpcs: {},
    inviteResult: {
      data: { user: { id: authUserId, email: applicationEmail } },
      error: null,
    },
    ...overrides,
  }

  const authClient = {
    auth: {
      async getUser(token) {
        mode.getUserToken = token
        if (mode.authThrows) throw new Error("auth failed")
        return mode.authResult
      },
    },
  }

  const serviceClient = {
    auth: {
      admin: {
        async inviteUserByEmail(email, options) {
          mode.inviteCalls.push({ email, options })
          if (mode.inviteThrows) throw new Error("provider secret body")
          return mode.inviteResult
        },
      },
    },
    from(table) {
      mode.tableCalls.push(table)
      if (table === "admin_users") {
        const result =
          mode.memberships[mode.membershipCalls++] ??
          mode.memberships.at(-1)
        return makeThenable(result)
      }
      if (table === "vendor_applications") {
        const result =
          mode.applications[mode.applicationReads++] ?? {
            data: null,
            error: { code: "missing-test-result" },
          }
        return makeThenable(result)
      }
      throw new Error(`Frozen table accessed: ${table}`)
    },
    async rpc(name, parameters) {
      mode.rpcCalls.push({ name, parameters })
      const responses = mode.rpcs[name]
      if (!responses?.length) {
        throw new Error(`Unexpected RPC: ${name}`)
      }
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    },
  }

  mode.createClient = (url, key, options) => {
    mode.clientCreations.push({ url, key, options })
    if (key === "public-anon-key") return authClient
    if (key === serviceRoleKey) return serviceClient
    throw new Error("Unexpected client key")
  }
  return mode
}

function request({
  method = "POST",
  authorization = `Bearer ${accessToken}`,
  contentType = "application/json",
  body = JSON.stringify({ application_id: applicationId }),
  headers = {},
} = {}) {
  const requestHeaders = new Headers(headers)
  if (authorization !== null) requestHeaders.set("Authorization", authorization)
  if (contentType !== null) requestHeaders.set("Content-Type", contentType)
  return new Request("https://functions.example.test/initiate", {
    method,
    headers: requestHeaders,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  })
}

async function invoke(mode, requestOptions) {
  const handler = loadHandler(mode)
  const response = await handler(request(requestOptions))
  return { response, body: await response.json(), mode }
}

function existingConfirmedMode(overrides = {}) {
  return createMode({
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        {
          data: [resolverRow("existing_confirmed", authUserId, true, false)],
          error: null,
        },
      ],
      record_vendor_application_auth_identity: [
        { data: [recordRow()], error: null },
      ],
    },
    ...overrides,
  })
}

function invitationMode({ fastConfirmation = false, ...overrides } = {}) {
  return createMode({
    memberships: [
      { data: { user_id: adminId }, error: null },
      { data: { user_id: adminId }, error: null },
    ],
    applications: [{ data: applicationRow(), error: null }],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        {
          data: [
            resolverRow(
              fastConfirmation ? "existing_confirmed" : "existing_unconfirmed",
              authUserId,
              fastConfirmation,
              true
            ),
          ],
          error: null,
        },
      ],
      record_vendor_application_auth_identity: [
        { data: [recordRow()], error: null },
      ],
    },
    ...overrides,
  })
}

test("rejects unsupported methods and media types before creating clients", async () => {
  for (const [options, status, outcome] of [
    [{ method: "GET" }, 405, "method_not_allowed"],
    [{ method: "OPTIONS" }, 405, "method_not_allowed"],
    [{ contentType: "text/plain" }, 415, "unsupported_media_type"],
  ]) {
    const mode = createMode()
    const result = await invoke(mode, options)
    assert.equal(result.response.status, status)
    assert.equal(result.body.outcome, outcome)
    assert.equal(mode.clientCreations.length, 0)
  }
})

test("requires exactly one non-whitespace Bearer token", async () => {
  for (const authorization of [
    null,
    "Basic token",
    "Bearer",
    "Bearer ",
    "bearer token",
    "Bearer one two",
    "Bearer token, Bearer second",
  ]) {
    const mode = createMode()
    const result = await invoke(mode, { authorization })
    assert.equal(result.response.status, 401)
    assert.equal(result.body.outcome, "auth_required")
  }
})

test("validates the caller with the nonprivileged client", async () => {
  const mode = createMode({
    authResult: { data: { user: null }, error: { message: "bad token" } },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 401)
  assert.equal(result.body.outcome, "auth_required")
  assert.equal(mode.getUserToken, accessToken)
  assert.equal(mode.clientCreations.length, 1)
  assert.equal(mode.clientCreations[0].key, "public-anon-key")
})

test("denies non-admins and treats admin lookup errors as unavailable", async () => {
  for (const [membership, status, outcome] of [
    [{ data: null, error: null }, 403, "access_denied"],
    [{ data: null, error: { message: "database private body" } }, 503, "service_unavailable"],
  ]) {
    const mode = createMode({ memberships: [membership] })
    const result = await invoke(mode)
    assert.equal(result.response.status, status)
    assert.equal(result.body.outcome, outcome)
    assert.equal(mode.rpcCalls.length, 0)
  }
})

test("uses isolated sessionless clients and never attaches the caller token to service options", async () => {
  const mode = existingConfirmedMode()
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(mode.clientCreations.length, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(mode.clientCreations[1].options.auth)),
    {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    }
  )
  assert.equal(JSON.stringify(mode.clientCreations[1]).includes(accessToken), false)
})

test("enforces the exact bounded JSON request contract", async () => {
  const invalidBodies = [
    "{",
    "null",
    "[]",
    "1",
    JSON.stringify({ application_id: "not-a-uuid" }),
    JSON.stringify({ application_id: "AAAAAAAA-1111-4111-8111-111111111111" }),
    JSON.stringify({ application_id: applicationId, email: applicationEmail }),
    JSON.stringify({ email: applicationEmail }),
  ]
  for (const body of invalidBodies) {
    const mode = createMode()
    const result = await invoke(mode, { body })
    assert.equal(result.response.status, 400, body)
    assert.equal(result.body.outcome, "invalid_request")
    assert.equal(mode.rpcCalls.length, 0)
  }

  const oversizedMode = createMode()
  const oversized = await invoke(oversizedMode, {
    body: JSON.stringify({ application_id: applicationId, padding: "x".repeat(1100) }),
  })
  assert.equal(oversized.response.status, 400)
  assert.equal(oversized.body.outcome, "invalid_request")
  assert.equal(oversizedMode.rpcCalls.length, 0)
})

test("maps stable claim outcomes without doing later work", async () => {
  const cases = [
    [claimRow("already_in_progress", "in_progress"), 409, "reconciliation_required"],
    [claimRow("awaiting_enrollment", "awaiting_enrollment"), 200, "already_awaiting_enrollment"],
    [claimRow("invalid_state", "not_started"), 409, "invalid_state"],
    [claimRow("already_provisioned", "provisioned", authUserId), 409, "invalid_state"],
    [claimRow("unavailable", null), 404, "application_unavailable"],
  ]
  for (const [row, status, outcome] of cases) {
    const mode = createMode({
      rpcs: {
        claim_vendor_application_provisioning: [{ data: [row], error: null }],
      },
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, status)
    assert.equal(result.body.outcome, outcome)
    assert.equal(mode.rpcCalls.length, 1)
    assert.equal(mode.inviteCalls.length, 0)
  }
})

test("rejects malformed claim contracts safely", async () => {
  for (const data of [[], [claimRow(), claimRow()], [{ ...claimRow(), application_id: otherAuthUserId }]]) {
    const mode = createMode({
      rpcs: {
        claim_vendor_application_provisioning: [{ data, error: null }],
      },
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 503)
    assert.equal(result.body.outcome, "service_unavailable")
    assert.equal(mode.inviteCalls.length, 0)
  }
})

test("records an existing confirmed identity without inviting or finalizing", async () => {
  const mode = existingConfirmedMode()
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, {
    ok: true,
    outcome: "awaiting_enrollment_existing",
    application_id: applicationId,
  })
  assert.equal(mode.inviteCalls.length, 0)
  const record = mode.rpcCalls.find(
    (call) => call.name === "record_vendor_application_auth_identity"
  )
  assert.deepEqual(JSON.parse(JSON.stringify(record.parameters)), {
    p_application_id: applicationId,
    p_auth_user_id: authUserId,
    p_invited: false,
  })
})

test("reconciles an uncertain existing-identity record without inviting", async () => {
  const mode = createMode({
    applications: [
      {
        data: applicationRow({
          provisioning_status: "awaiting_enrollment",
          auth_user_id: authUserId,
        }),
        error: null,
      },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        {
          data: [resolverRow("existing_confirmed", authUserId, true, false)],
          error: null,
        },
      ],
      record_vendor_application_auth_identity: [
        { data: null, error: { message: "response lost" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(result.body.outcome, "awaiting_enrollment_existing")
  assert.equal(mode.inviteCalls.length, 0)
})

test("invites exactly once from the application email with the fixed redirect", async () => {
  const mode = invitationMode()
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(result.body.outcome, "awaiting_enrollment_invited")
  assert.deepEqual(JSON.parse(JSON.stringify(mode.inviteCalls)), [
    { email: applicationEmail, options: { redirectTo } },
  ])
  assert.equal(mode.membershipCalls, 2)
  const record = mode.rpcCalls.find(
    (call) => call.name === "record_vendor_application_auth_identity"
  )
  assert.equal(record.parameters.p_invited, true)
  assert.equal(record.parameters.p_auth_user_id, authUserId)
})

test("accepts the same invited identity if it confirms unusually quickly", async () => {
  const mode = invitationMode({ fastConfirmation: true })
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(result.body.outcome, "awaiting_enrollment_invited")
  assert.equal(mode.inviteCalls.length, 1)
})

test("rechecks admin membership immediately before invitation", async () => {
  const mode = invitationMode({
    memberships: [
      { data: { user_id: adminId }, error: null },
      { data: null, error: null },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: [failRow()], error: null },
      ],
    },
    applications: [
      { data: applicationRow(), error: null },
      { data: applicationRow(), error: null },
    ],
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 403)
  assert.equal(result.body.outcome, "access_denied")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(mode.rpcCalls.at(-1).name, "fail_vendor_application_provisioning")
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "admin_access_revoked"
  )
})

test("admin recheck errors use a neutral failure code", async () => {
  const mode = invitationMode({
    memberships: [
      { data: { user_id: adminId }, error: null },
      { data: null, error: { message: "membership lookup failed" } },
    ],
    applications: [
      { data: applicationRow(), error: null },
      { data: applicationRow(), error: null },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: [failRow()], error: null },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 503)
  assert.equal(result.body.outcome, "service_unavailable")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "admin_recheck_failed"
  )
  assert.equal(
    mode.rpcCalls.some(
      (call) => call.parameters.p_error_code === "admin_access_revoked"
    ),
    false
  )
})

test("admin recheck errors require reconciliation when failure is uncertain", async () => {
  const mode = invitationMode({
    memberships: [
      { data: { user_id: adminId }, error: null },
      { data: null, error: { message: "membership lookup failed" } },
    ],
    applications: [
      { data: applicationRow(), error: null },
      { data: applicationRow(), error: null },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: null, error: { message: "failure transition uncertain" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "reconciliation_required")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "admin_recheck_failed"
  )
})

test("application lookup errors safely fail before returning unavailable", async () => {
  const mode = invitationMode({
    applications: [
      { data: null, error: { message: "database private body" } },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: [failRow()], error: null },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 503)
  assert.equal(result.body.outcome, "service_unavailable")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "application_read_failed"
  )
})

test("application lookup errors require reconciliation when failure is uncertain", async () => {
  const mode = invitationMode({
    applications: [
      { data: null, error: { message: "database private body" } },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: null, error: { message: "failure transition uncertain" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "reconciliation_required")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "application_read_failed"
  )
})

test("invalid application data returns invalid state after safe failure", async () => {
  const mode = invitationMode({
    applications: [
      {
        data: applicationRow({ email: "Seller@example.com" }),
        error: null,
      },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: [failRow()], error: null },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "invalid_state")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "application_data_invalid"
  )
})

test("invalid application data requires reconciliation when failure is uncertain", async () => {
  const mode = invitationMode({
    applications: [
      {
        data: applicationRow({ email: "Seller@example.com" }),
        error: null,
      },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
      ],
      fail_vendor_application_provisioning: [
        { data: null, error: { message: "failure transition uncertain" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "reconciliation_required")
  assert.equal(mode.inviteCalls.length, 0)
  assert.equal(
    mode.rpcCalls.at(-1).parameters.p_error_code,
    "application_data_invalid"
  )
})

test("manual identity branches never invite and use safe failure codes", async () => {
  const cases = [
    ["existing_unconfirmed", authUserId, false, true, "existing_unconfirmed", "manual_existing_unconfirmed"],
    ["vendor_collision", null, null, null, "vendor_collision", "manual_vendor_collision"],
    ["ambiguous_identity", null, null, null, "ambiguous_identity", "manual_ambiguous_identity"],
  ]
  for (const [resolverOutcome, id, confirmed, invited, errorCode, expected] of cases) {
    const mode = createMode({
      rpcs: {
        claim_vendor_application_provisioning: [
          { data: [claimRow()], error: null },
        ],
        resolve_vendor_application_auth_identity: [
          {
            data: [resolverRow(resolverOutcome, id, confirmed, invited)],
            error: null,
          },
        ],
        fail_vendor_application_provisioning: [
          { data: [failRow()], error: null },
        ],
      },
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 409)
    assert.equal(result.body.outcome, expected)
    assert.equal(mode.inviteCalls.length, 0)
    assert.equal(
      mode.rpcCalls.at(-1).parameters.p_error_code,
      errorCode
    )
  }
})

test("invite throws or returns an error without retrying, recording, or failing", async () => {
  for (const inviteOverride of [
    { inviteThrows: true },
    {
      inviteResult: {
        data: null,
        error: { message: "provider private body", status: 500 },
      },
    },
  ]) {
    const mode = invitationMode({
      ...inviteOverride,
      rpcs: {
        claim_vendor_application_provisioning: [
          { data: [claimRow()], error: null },
        ],
        resolve_vendor_application_auth_identity: [
          { data: [resolverRow("not_found")], error: null },
          { data: [resolverRow("not_found")], error: null },
        ],
      },
    })
    const result = await invoke(mode)
    assert.equal(result.response.status, 409)
    assert.equal(result.body.outcome, "reconciliation_required")
    assert.equal(mode.inviteCalls.length, 1)
    assert.equal(
      mode.rpcCalls.filter((call) => call.name === "resolve_vendor_application_auth_identity").length,
      2
    )
    assert.equal(
      mode.rpcCalls.some((call) => call.name === "record_vendor_application_auth_identity"),
      false
    )
    assert.equal(
      mode.rpcCalls.some((call) => call.name === "fail_vendor_application_provisioning"),
      false
    )
  }
})

test("invite error remains reconciliation-required when the resolver now sees an identity", async () => {
  const mode = invitationMode({
    inviteResult: { data: null, error: { message: "uncertain" } },
    rpcs: {
      claim_vendor_application_provisioning: [
        { data: [claimRow()], error: null },
      ],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        {
          data: [resolverRow("existing_unconfirmed", authUserId, false, true)],
          error: null,
        },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "reconciliation_required")
  assert.equal(mode.inviteCalls.length, 1)
})

test("malformed invite users and post-invite identity mismatches require reconciliation", async () => {
  const malformed = invitationMode({
    inviteResult: { data: { user: { id: "bad", email: applicationEmail } }, error: null },
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        { data: [resolverRow("not_found")], error: null },
      ],
    },
  })
  const malformedResult = await invoke(malformed)
  assert.equal(malformedResult.body.outcome, "reconciliation_required")
  assert.equal(malformed.inviteCalls.length, 1)

  const wrongEmail = invitationMode({
    inviteResult: {
      data: { user: { id: authUserId, email: "different@example.com" } },
      error: null,
    },
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        { data: [resolverRow("not_found")], error: null },
      ],
    },
  })
  const wrongEmailResult = await invoke(wrongEmail)
  assert.equal(wrongEmailResult.body.outcome, "reconciliation_required")
  assert.equal(wrongEmail.inviteCalls.length, 1)

  const mismatch = invitationMode({
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        {
          data: [resolverRow("existing_unconfirmed", otherAuthUserId, false, true)],
          error: null,
        },
      ],
    },
  })
  const mismatchResult = await invoke(mismatch)
  assert.equal(mismatchResult.body.outcome, "reconciliation_required")
  assert.equal(mismatch.inviteCalls.length, 1)
})

test("invite record errors never fail or reinvite", async () => {
  const mode = invitationMode({
    applications: [
      { data: applicationRow(), error: null },
      { data: applicationRow(), error: null },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        {
          data: [resolverRow("existing_unconfirmed", authUserId, false, true)],
          error: null,
        },
        {
          data: [resolverRow("existing_unconfirmed", authUserId, false, true)],
          error: null,
        },
      ],
      record_vendor_application_auth_identity: [
        { data: null, error: { message: "uncertain" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 409)
  assert.equal(result.body.outcome, "reconciliation_required")
  assert.equal(mode.inviteCalls.length, 1)
  assert.equal(
    mode.rpcCalls.some((call) => call.name === "fail_vendor_application_provisioning"),
    false
  )
})

test("an uncertain invited record returns stable success when database state proves commit", async () => {
  const mode = invitationMode({
    applications: [
      { data: applicationRow(), error: null },
      {
        data: applicationRow({
          provisioning_status: "awaiting_enrollment",
          auth_user_id: authUserId,
        }),
        error: null,
      },
    ],
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        {
          data: [resolverRow("existing_unconfirmed", authUserId, false, true)],
          error: null,
        },
        {
          data: [resolverRow("existing_unconfirmed", authUserId, false, true)],
          error: null,
        },
      ],
      record_vendor_application_auth_identity: [
        { data: null, error: { message: "response lost" } },
      ],
    },
  })
  const result = await invoke(mode)
  assert.equal(result.response.status, 200)
  assert.equal(result.body.outcome, "awaiting_enrollment_invited")
  assert.equal(mode.inviteCalls.length, 1)
})

test("a second invocation in progress or awaiting performs no identity work", async () => {
  for (const row of [
    claimRow("already_in_progress", "in_progress"),
    claimRow("awaiting_enrollment", "awaiting_enrollment"),
  ]) {
    const mode = createMode({
      rpcs: {
        claim_vendor_application_provisioning: [{ data: [row], error: null }],
      },
    })
    await invoke(mode)
    assert.equal(mode.rpcCalls.length, 1)
    assert.equal(mode.inviteCalls.length, 0)
  }
})

test("responses and logs do not expose provider, identity, email, or credential data", async () => {
  const providerBody = "private provider response body"
  const mode = invitationMode({
    inviteResult: { data: null, error: { message: providerBody } },
    rpcs: {
      claim_vendor_application_provisioning: [{ data: [claimRow()], error: null }],
      resolve_vendor_application_auth_identity: [
        { data: [resolverRow("not_found")], error: null },
        { data: [resolverRow("not_found")], error: null },
      ],
    },
  })
  const result = await invoke(mode)
  const output = JSON.stringify({ body: result.body, logs: mode.logs })
  for (const secret of [
    providerBody,
    accessToken,
    serviceRoleKey,
    authUserId,
    applicationEmail,
  ]) {
    assert.equal(output.includes(secret), false)
  }
})

test("configuration and source preserve all frozen boundaries", () => {
  const source = fs.readFileSync(path.join(root, functionFile), "utf8")
  const config = fs.readFileSync(path.join(root, configFile), "utf8")
  assert.match(
    config,
    /\[functions\.initiate-vendor-provisioning\][\s\S]*?enabled = true[\s\S]*?verify_jwt = true[\s\S]*?import_map = "\.\/functions\/initiate-vendor-provisioning\/deno\.json"[\s\S]*?entrypoint = "\.\/functions\/initiate-vendor-provisioning\/index\.ts"/
  )
  assert.equal(source.includes("finalize_vendor_application_provisioning"), false)
  assert.equal(source.includes('.from("vendors")'), false)
  assert.equal(source.includes('.from("vendor_verifications")'), false)
  assert.equal(source.includes("Access-Control-Allow-Origin"), false)
  assert.equal((source.match(/auth\.admin\.inviteUserByEmail/g) ?? []).length, 1)
  assert.equal((source.match(/https:\/\/marketa-store\.vercel\.app\/vendor\/auth\/callback/g) ?? []).length, 1)
  for (const forbidden of [
    "payment",
    "payout",
    "refund",
    "order",
    "product",
    "is_active",
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden), false)
  }
})
