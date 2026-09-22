import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const MAX_BODY_BYTES = 1024
const INVITE_REDIRECT =
  "https://marketa-store.vercel.app/vendor/auth/callback"
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type StableOutcome =
  | "awaiting_enrollment_existing"
  | "awaiting_enrollment_invited"
  | "already_awaiting_enrollment"
  | "invalid_request"
  | "auth_required"
  | "access_denied"
  | "application_unavailable"
  | "method_not_allowed"
  | "manual_existing_unconfirmed"
  | "manual_vendor_collision"
  | "manual_ambiguous_identity"
  | "invalid_state"
  | "reconciliation_required"
  | "unsupported_media_type"
  | "service_unavailable"

type TransitionRow = {
  outcome: string
  application_id: string | null
  vendor_id: string | null
  provisioning_status: string | null
}

type ResolverRow = {
  outcome: string
  auth_user_id: string | null
  email_confirmed: boolean | null
  was_invited: boolean | null
}

type ApplicationRow = {
  id: string
  email: string
  status: string
  provisioning_status: string
  auth_user_id: string | null
  vendor_id: string | null
  provisioned_at: string | null
}

type ApplicationReadResult =
  | { ok: true; row: ApplicationRow | null }
  | { ok: false }

const TRANSITION_OUTCOMES: Record<string, ReadonlySet<string>> = {
  claim_vendor_application_provisioning: new Set([
    "claimed",
    "awaiting_enrollment",
    "already_in_progress",
    "already_provisioned",
    "invalid_state",
    "unavailable",
    "operation_failed",
  ]),
  record_vendor_application_auth_identity: new Set([
    "awaiting_enrollment",
    "already_awaiting_enrollment",
    "invalid_input",
    "unavailable",
    "invalid_state",
    "identity_conflict",
    "identity_mismatch",
    "vendor_collision",
    "operation_failed",
  ]),
  fail_vendor_application_provisioning: new Set([
    "failed",
    "already_failed",
    "invalid_input",
    "unavailable",
    "invalid_state",
    "operation_failed",
  ]),
}

const RESOLVER_OUTCOMES = new Set([
  "existing_confirmed",
  "existing_unconfirmed",
  "not_found",
  "vendor_collision",
  "ambiguous_identity",
  "invalid_state",
  "unavailable",
  "invalid_input",
])

function jsonResponse(
  status: number,
  outcome: StableOutcome,
  applicationId?: string
): Response {
  return new Response(
    JSON.stringify({
      ok: status >= 200 && status < 300,
      outcome,
      ...(applicationId ? { application_id: applicationId } : {}),
    }),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    }
  )
}

function operationalResponse(
  status: number,
  outcome: StableOutcome,
  applicationId: string,
  stage: string
): Response {
  console.info("[initiate-vendor-provisioning]", {
    application_id: applicationId,
    stage,
    outcome,
  })
  return jsonResponse(status, outcome, applicationId)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return (
    prototype === null ||
    Object.prototype.toString.call(value) === "[object Object]"
  )
}

function parseBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")
  if (!authorization) return null
  return /^Bearer ([^\s]+)$/.exec(authorization)?.[1] ?? null
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value)
}

function isNormalizedEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    value === value.trim().toLowerCase() &&
    EMAIL_PATTERN.test(value)
  )
}

async function readBoundedBody(
  request: Request
): Promise<{ ok: true; text: string } | { ok: false }> {
  const contentLength = request.headers.get("content-length")
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (
      !Number.isFinite(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_BODY_BYTES
    ) {
      return { ok: false }
    }
  }

  if (!request.body) return { ok: true, text: "" }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return { ok: false }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false }
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(body),
    }
  } catch {
    return { ok: false }
  }
}

function parseTransitionRow(
  data: unknown,
  applicationId: string,
  rpcName: string,
  outcomes: ReadonlySet<string>
): TransitionRow | null {
  if (!Array.isArray(data) || data.length !== 1 || !isPlainObject(data[0])) {
    return null
  }
  const row = data[0]
  if (
    typeof row.outcome !== "string" ||
    !outcomes.has(row.outcome) ||
    row.application_id !== applicationId ||
    !isNullableUuid(row.vendor_id) ||
    !(
      row.provisioning_status === null ||
      typeof row.provisioning_status === "string"
    )
  ) {
    return null
  }
  const parsed = row as TransitionRow
  const knownStatus =
    parsed.provisioning_status === null ||
    [
      "not_started",
      "in_progress",
      "awaiting_enrollment",
      "provisioned",
      "failed",
    ].includes(parsed.provisioning_status)
  if (!knownStatus) return null

  if (rpcName === "claim_vendor_application_provisioning") {
    if (parsed.outcome === "already_provisioned") {
      return parsed.provisioning_status === "provisioned" &&
        isUuid(parsed.vendor_id)
        ? parsed
        : null
    }
    if (parsed.vendor_id !== null) return null
  } else if (parsed.vendor_id !== null) {
    return null
  }

  return parsed
}

function parseResolverRow(data: unknown): ResolverRow | null {
  if (!Array.isArray(data) || data.length !== 1 || !isPlainObject(data[0])) {
    return null
  }
  const row = data[0]
  if (
    typeof row.outcome !== "string" ||
    !RESOLVER_OUTCOMES.has(row.outcome) ||
    !isNullableUuid(row.auth_user_id) ||
    !(
      row.email_confirmed === null ||
      typeof row.email_confirmed === "boolean"
    ) ||
    !(row.was_invited === null || typeof row.was_invited === "boolean")
  ) {
    return null
  }

  const identityOutcome =
    row.outcome === "existing_confirmed" ||
    row.outcome === "existing_unconfirmed"
  if (
    (identityOutcome &&
      (!isUuid(row.auth_user_id) ||
        typeof row.email_confirmed !== "boolean" ||
        typeof row.was_invited !== "boolean")) ||
    (!identityOutcome &&
      (row.auth_user_id !== null ||
        row.email_confirmed !== null ||
        row.was_invited !== null)) ||
    (row.outcome === "existing_confirmed" && row.email_confirmed !== true) ||
    (row.outcome === "existing_unconfirmed" &&
      row.email_confirmed !== false)
  ) {
    return null
  }
  return row as ResolverRow
}

function parseApplicationRow(data: unknown): ApplicationRow | null {
  if (!isPlainObject(data)) return null
  if (
    !isUuid(data.id) ||
    typeof data.email !== "string" ||
    typeof data.status !== "string" ||
    typeof data.provisioning_status !== "string" ||
    !isNullableUuid(data.auth_user_id) ||
    !isNullableUuid(data.vendor_id) ||
    !(data.provisioned_at === null || typeof data.provisioned_at === "string")
  ) {
    return null
  }
  return data as ApplicationRow
}

async function hasAdminMembership(
  serviceClient: SupabaseClient,
  userId: string
): Promise<"yes" | "no" | "error"> {
  try {
    const { data, error } = await serviceClient
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
    if (error) return "error"
    if (data === null) return "no"
    return isPlainObject(data) && data.user_id === userId ? "yes" : "error"
  } catch {
    return "error"
  }
}

async function callTransitionRpc(
  serviceClient: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
  applicationId: string
): Promise<TransitionRow | null> {
  try {
    const { data, error } = await serviceClient.rpc(name, parameters)
    if (error) return null
    const outcomes = TRANSITION_OUTCOMES[name]
    return outcomes
      ? parseTransitionRow(data, applicationId, name, outcomes)
      : null
  } catch {
    return null
  }
}

async function resolveIdentity(
  serviceClient: SupabaseClient,
  applicationId: string
): Promise<ResolverRow | null> {
  try {
    const { data, error } = await serviceClient.rpc(
      "resolve_vendor_application_auth_identity",
      { p_application_id: applicationId }
    )
    if (error) return null
    return parseResolverRow(data)
  } catch {
    return null
  }
}

async function readApplication(
  serviceClient: SupabaseClient,
  applicationId: string
): Promise<ApplicationReadResult> {
  try {
    const { data, error } = await serviceClient
      .from("vendor_applications")
      .select(
        "id, email, status, provisioning_status, auth_user_id, vendor_id, provisioned_at"
      )
      .eq("id", applicationId)
      .maybeSingle()
    if (error) return { ok: false }
    const row = parseApplicationRow(data)
    return {
      ok: true,
      row: row?.id === applicationId ? row : null,
    }
  } catch {
    return { ok: false }
  }
}

function isFailAbleApplication(
  row: ApplicationRow | null,
  applicationId: string
): boolean {
  return (
    row?.id === applicationId &&
    row.status === "approved" &&
    (row.provisioning_status === "in_progress" ||
      row.provisioning_status === "awaiting_enrollment") &&
    row.vendor_id === null &&
    row.provisioned_at === null
  )
}

function isExpectedAwaiting(
  row: ApplicationRow | null,
  applicationId: string,
  authUserId: string
): boolean {
  return (
    row?.id === applicationId &&
    row.status === "approved" &&
    row.provisioning_status === "awaiting_enrollment" &&
    row.auth_user_id === authUserId &&
    row.vendor_id === null &&
    row.provisioned_at === null
  )
}

async function safelyFail(
  serviceClient: SupabaseClient,
  applicationId: string,
  errorCode: string,
  confirmState = false
): Promise<boolean> {
  if (confirmState) {
    const application = await readApplication(serviceClient, applicationId)
    if (
      !application.ok ||
      !isFailAbleApplication(application.row, applicationId)
    ) {
      return false
    }
  }

  const row = await callTransitionRpc(
    serviceClient,
    "fail_vendor_application_provisioning",
    { p_application_id: applicationId, p_error_code: errorCode },
    applicationId
  )
  return (
    row !== null &&
    (row.outcome === "failed" || row.outcome === "already_failed") &&
    row.vendor_id === null &&
    row.provisioning_status === "failed"
  )
}

async function recordIdentity(
  serviceClient: SupabaseClient,
  applicationId: string,
  authUserId: string,
  invited: boolean
): Promise<boolean> {
  const row = await callTransitionRpc(
    serviceClient,
    "record_vendor_application_auth_identity",
    {
      p_application_id: applicationId,
      p_auth_user_id: authUserId,
      p_invited: invited,
    },
    applicationId
  )
  return (
    row !== null &&
    (row.outcome === "awaiting_enrollment" ||
      row.outcome === "already_awaiting_enrollment") &&
    row.vendor_id === null &&
    row.provisioning_status === "awaiting_enrollment"
  )
}

async function reconcileExistingRecord(
  serviceClient: SupabaseClient,
  applicationId: string,
  authUserId: string
): Promise<"success" | "failed" | "uncertain"> {
  const application = await readApplication(serviceClient, applicationId)
  if (
    application.ok &&
    isExpectedAwaiting(application.row, applicationId, authUserId)
  ) {
    return "success"
  }
  if (
    !application.ok ||
    !isFailAbleApplication(application.row, applicationId)
  ) {
    return "uncertain"
  }
  return (await safelyFail(
    serviceClient,
    applicationId,
    "identity_record_failed"
  ))
    ? "failed"
    : "uncertain"
}

async function reconcileInvitedRecord(
  serviceClient: SupabaseClient,
  applicationId: string,
  authUserId: string
): Promise<boolean> {
  const application = await readApplication(serviceClient, applicationId)
  const identity = await resolveIdentity(serviceClient, applicationId)
  return (
    application.ok &&
    isExpectedAwaiting(application.row, applicationId, authUserId) &&
    identity !== null &&
    (identity.outcome === "existing_unconfirmed" ||
      identity.outcome === "existing_confirmed") &&
    identity.auth_user_id === authUserId
  )
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, "method_not_allowed")
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== "application/json") {
    return jsonResponse(415, "unsupported_media_type")
  }

  const accessToken = parseBearerToken(request)
  if (!accessToken) return jsonResponse(401, "auth_required")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(503, "service_unavailable")
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  let callerId = ""
  try {
    const { data, error } = await authClient.auth.getUser(accessToken)
    if (error || !isUuid(data.user?.id)) {
      return jsonResponse(401, "auth_required")
    }
    callerId = data.user.id
  } catch {
    return jsonResponse(401, "auth_required")
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const membership = await hasAdminMembership(serviceClient, callerId)
  if (membership === "no") return jsonResponse(403, "access_denied")
  if (membership === "error") {
    return jsonResponse(503, "service_unavailable")
  }

  const boundedBody = await readBoundedBody(request)
  if (!boundedBody.ok) return jsonResponse(400, "invalid_request")

  let body: unknown
  try {
    body = JSON.parse(boundedBody.text)
  } catch {
    return jsonResponse(400, "invalid_request")
  }
  if (
    !isPlainObject(body) ||
    Object.keys(body).length !== 1 ||
    Object.keys(body)[0] !== "application_id" ||
    !isUuid(body.application_id)
  ) {
    return jsonResponse(400, "invalid_request")
  }
  const applicationId = body.application_id

  const claim = await callTransitionRpc(
    serviceClient,
    "claim_vendor_application_provisioning",
    { p_application_id: applicationId },
    applicationId
  )
  if (!claim) {
    return operationalResponse(
      503,
      "service_unavailable",
      applicationId,
      "claim"
    )
  }
  if (claim.outcome === "awaiting_enrollment") {
    if (
      claim.vendor_id !== null ||
      claim.provisioning_status !== "awaiting_enrollment"
    ) {
      return operationalResponse(
        503,
        "service_unavailable",
        applicationId,
        "claim"
      )
    }
    return operationalResponse(
      200,
      "already_awaiting_enrollment",
      applicationId,
      "claim"
    )
  }
  if (claim.outcome === "already_in_progress") {
    if (
      claim.vendor_id !== null ||
      claim.provisioning_status !== "in_progress"
    ) {
      return operationalResponse(
        503,
        "service_unavailable",
        applicationId,
        "claim"
      )
    }
    return operationalResponse(
      409,
      "reconciliation_required",
      applicationId,
      "claim"
    )
  }
  if (
    claim.outcome === "already_provisioned" ||
    claim.outcome === "invalid_state"
  ) {
    return operationalResponse(
      409,
      "invalid_state",
      applicationId,
      "claim"
    )
  }
  if (claim.outcome === "unavailable") {
    return operationalResponse(
      404,
      "application_unavailable",
      applicationId,
      "claim"
    )
  }
  if (
    claim.outcome !== "claimed" ||
    claim.vendor_id !== null ||
    claim.provisioning_status !== "in_progress"
  ) {
    return operationalResponse(
      503,
      "service_unavailable",
      applicationId,
      "claim"
    )
  }

  const identity = await resolveIdentity(serviceClient, applicationId)
  if (!identity) {
    await safelyFail(
      serviceClient,
      applicationId,
      "identity_resolution_failed",
      true
    )
    return operationalResponse(
      503,
      "service_unavailable",
      applicationId,
      "resolve_identity"
    )
  }

  if (identity.outcome === "existing_confirmed") {
    const authUserId = identity.auth_user_id
    if (!isUuid(authUserId)) {
      await safelyFail(
        serviceClient,
        applicationId,
        "identity_resolution_failed",
        true
      )
      return operationalResponse(
        503,
        "service_unavailable",
        applicationId,
        "resolve_identity"
      )
    }
    if (await recordIdentity(serviceClient, applicationId, authUserId, false)) {
      return operationalResponse(
        200,
        "awaiting_enrollment_existing",
        applicationId,
        "record_identity"
      )
    }
    const reconciliation = await reconcileExistingRecord(
      serviceClient,
      applicationId,
      authUserId
    )
    if (reconciliation === "success") {
      return operationalResponse(
        200,
        "awaiting_enrollment_existing",
        applicationId,
        "reconcile_record"
      )
    }
    return operationalResponse(
      reconciliation === "failed" ? 503 : 409,
      reconciliation === "failed"
        ? "service_unavailable"
        : "reconciliation_required",
      applicationId,
      "reconcile_record"
    )
  }

  const manualBranches: Partial<
    Record<
      ResolverRow["outcome"],
      { errorCode: string; outcome: StableOutcome }
    >
  > = {
    existing_unconfirmed: {
      errorCode: "existing_unconfirmed",
      outcome: "manual_existing_unconfirmed",
    },
    vendor_collision: {
      errorCode: "vendor_collision",
      outcome: "manual_vendor_collision",
    },
    ambiguous_identity: {
      errorCode: "ambiguous_identity",
      outcome: "manual_ambiguous_identity",
    },
  }
  const manualBranch = manualBranches[identity.outcome]
  if (manualBranch) {
    if (!(await safelyFail(serviceClient, applicationId, manualBranch.errorCode))) {
      return operationalResponse(
        409,
        "reconciliation_required",
        applicationId,
        "fail_manual_branch"
      )
    }
    return operationalResponse(
      409,
      manualBranch.outcome,
      applicationId,
      "manual_branch"
    )
  }

  if (identity.outcome !== "not_found") {
    const failed = await safelyFail(
      serviceClient,
      applicationId,
      "identity_resolution_invalid",
      true
    )
    return operationalResponse(
      409,
      failed ? "invalid_state" : "reconciliation_required",
      applicationId,
      "resolve_identity"
    )
  }

  const applicationRead = await readApplication(serviceClient, applicationId)
  if (!applicationRead.ok) {
    const failed = await safelyFail(
      serviceClient,
      applicationId,
      "application_read_failed"
    )
    return operationalResponse(
      failed ? 503 : 409,
      failed ? "service_unavailable" : "reconciliation_required",
      applicationId,
      "load_application"
    )
  }
  const application = applicationRead.row
  if (
    application?.id !== applicationId ||
    application.status !== "approved" ||
    application.provisioning_status !== "in_progress" ||
    application.auth_user_id !== null ||
    application.vendor_id !== null ||
    application.provisioned_at !== null ||
    !isNormalizedEmail(application.email)
  ) {
    if (isFailAbleApplication(application, applicationId)) {
      const failed = await safelyFail(
        serviceClient,
        applicationId,
        "application_data_invalid"
      )
      return operationalResponse(
        409,
        failed ? "invalid_state" : "reconciliation_required",
        applicationId,
        "load_application"
      )
    }
    return operationalResponse(
      409,
      "reconciliation_required",
      applicationId,
      "load_application"
    )
  }

  const currentMembership = await hasAdminMembership(serviceClient, callerId)
  if (currentMembership === "no") {
    const failed = await safelyFail(
      serviceClient,
      applicationId,
      "admin_access_revoked",
      true
    )
    return operationalResponse(
      failed ? 403 : 409,
      failed ? "access_denied" : "reconciliation_required",
      applicationId,
      "reauthorize_invite"
    )
  }
  if (currentMembership === "error") {
    const failed = await safelyFail(
      serviceClient,
      applicationId,
      "admin_recheck_failed",
      true
    )
    return operationalResponse(
      failed ? 503 : 409,
      failed ? "service_unavailable" : "reconciliation_required",
      applicationId,
      "reauthorize_invite"
    )
  }

  let inviteData: unknown = null
  let inviteSucceeded = false
  try {
    const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(
      application.email,
      { redirectTo: INVITE_REDIRECT }
    )
    inviteData = data
    inviteSucceeded = !error
  } catch {
    inviteSucceeded = false
  }

  if (!inviteSucceeded) {
    await resolveIdentity(serviceClient, applicationId)
    return operationalResponse(
      409,
      "reconciliation_required",
      applicationId,
      "invite_uncertain"
    )
  }

  const invitedUser =
    isPlainObject(inviteData) && isPlainObject(inviteData.user)
      ? inviteData.user
      : null
  const invitedUserId = invitedUser?.id
  const invitedEmail =
    typeof invitedUser?.email === "string"
      ? invitedUser.email.trim().toLowerCase()
      : ""
  if (!isUuid(invitedUserId) || invitedEmail !== application.email) {
    await resolveIdentity(serviceClient, applicationId)
    return operationalResponse(
      409,
      "reconciliation_required",
      applicationId,
      "validate_invite"
    )
  }

  const postInviteIdentity = await resolveIdentity(serviceClient, applicationId)
  if (
    !postInviteIdentity ||
    postInviteIdentity.auth_user_id !== invitedUserId ||
    postInviteIdentity.was_invited !== true ||
    (postInviteIdentity.outcome !== "existing_unconfirmed" &&
      postInviteIdentity.outcome !== "existing_confirmed")
  ) {
    return operationalResponse(
      409,
      "reconciliation_required",
      applicationId,
      "resolve_invited_identity"
    )
  }

  if (
    await recordIdentity(serviceClient, applicationId, invitedUserId, true)
  ) {
    return operationalResponse(
      200,
      "awaiting_enrollment_invited",
      applicationId,
      "record_invited_identity"
    )
  }

  if (
    await reconcileInvitedRecord(
      serviceClient,
      applicationId,
      invitedUserId
    )
  ) {
    return operationalResponse(
      200,
      "awaiting_enrollment_invited",
      applicationId,
      "reconcile_invited_identity"
    )
  }
  return operationalResponse(
    409,
    "reconciliation_required",
    applicationId,
    "reconcile_invited_identity"
  )
}

serve(async (request) => {
  try {
    return await handleRequest(request)
  } catch {
    return jsonResponse(503, "service_unavailable")
  }
})
