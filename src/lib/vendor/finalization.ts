import "server-only"

import { createAdminClient } from "@/lib/admin/supabase-admin"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const APPLICATION_FIELDS =
  "id, email, status, provisioning_status, auth_user_id, vendor_id, provisioned_at"
const VENDOR_FIELDS = "id, user_id, email, is_active"

const provisioningStatuses = new Set([
  "not_started",
  "in_progress",
  "awaiting_enrollment",
  "provisioned",
  "failed",
])

const rpcOutcomes = new Set([
  "provisioned",
  "already_provisioned",
  "invalid_input",
  "unavailable",
  "invalid_state",
  "identity_conflict",
  "identity_mismatch",
  "enrollment_not_verified",
  "vendor_collision",
  "application_data_invalid",
  "invalid_vendor_defaults",
  "operation_failed",
])

export type SellerFinalizationOutcome =
  | "finalized"
  | "already_finalized"
  | "email_unconfirmed"
  | "no_pending_enrollment"
  | "identity_mismatch"
  | "vendor_collision"
  | "invalid_state"
  | "reconciliation_required"
  | "service_unavailable"

export type VerifiedSellerIdentity = {
  userId: string
  normalizedEmail: string
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

type VendorRow = {
  id: string
  user_id: string
  email: string
  is_active: boolean
}

type ReconciliationOutcome =
  | "already_finalized"
  | "not_finalized"
  | "reconciliation_required"
  | "service_unavailable"

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isApplicationRow(value: unknown): value is ApplicationRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    isUuid(row.id) &&
    typeof row.email === "string" &&
    typeof row.status === "string" &&
    typeof row.provisioning_status === "string" &&
    (row.auth_user_id === null || isUuid(row.auth_user_id)) &&
    (row.vendor_id === null || isUuid(row.vendor_id)) &&
    (row.provisioned_at === null || typeof row.provisioned_at === "string")
  )
}

function isVendorRow(value: unknown): value is VendorRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    isUuid(row.id) &&
    isUuid(row.user_id) &&
    typeof row.email === "string" &&
    typeof row.is_active === "boolean"
  )
}

function isValidCandidate(
  candidate: ApplicationRow,
  identity: VerifiedSellerIdentity
): boolean {
  return (
    candidate.auth_user_id === identity.userId &&
    normalizeEmail(candidate.email) === identity.normalizedEmail &&
    candidate.status === "approved" &&
    candidate.provisioning_status === "awaiting_enrollment" &&
    candidate.vendor_id === null &&
    candidate.provisioned_at === null
  )
}

function parseRpcOutcome(
  data: unknown,
  applicationId: string
): string | null {
  if (!Array.isArray(data) || data.length !== 1) return null
  const value = data[0]
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>

  if (
    row.application_id !== applicationId ||
    typeof row.outcome !== "string" ||
    !rpcOutcomes.has(row.outcome) ||
    (row.vendor_id !== null && !isUuid(row.vendor_id)) ||
    (row.provisioning_status !== null &&
      (typeof row.provisioning_status !== "string" ||
        !provisioningStatuses.has(row.provisioning_status)))
  ) {
    return null
  }

  if (
    row.outcome === "provisioned" ||
    row.outcome === "already_provisioned"
  ) {
    return isUuid(row.vendor_id) && row.provisioning_status === "provisioned"
      ? row.outcome
      : null
  }

  if (row.vendor_id !== null) return null

  if (
    [
      "invalid_input",
      "unavailable",
      "invalid_vendor_defaults",
      "operation_failed",
    ].includes(row.outcome)
  ) {
    return row.provisioning_status === null ? row.outcome : null
  }

  if (row.outcome === "invalid_state") {
    return row.provisioning_status !== null ? row.outcome : null
  }

  if (row.outcome === "identity_conflict") {
    return row.provisioning_status === "awaiting_enrollment" ||
      row.provisioning_status === "provisioned"
      ? row.outcome
      : null
  }

  if (
    row.outcome === "identity_mismatch" ||
    row.outcome === "enrollment_not_verified"
  ) {
    return row.provisioning_status === "awaiting_enrollment"
      ? row.outcome
      : null
  }

  if (
    row.outcome === "vendor_collision" ||
    row.outcome === "application_data_invalid"
  ) {
    return row.provisioning_status === null ||
      row.provisioning_status === "awaiting_enrollment"
      ? row.outcome
      : null
  }

  return null
}

async function reconcileFinalizedState(
  client: ReturnType<typeof createAdminClient>,
  identity: VerifiedSellerIdentity
): Promise<ReconciliationOutcome> {
  let applicationsResult
  try {
    applicationsResult = await client
      .from("vendor_applications")
      .select(APPLICATION_FIELDS)
      .eq("auth_user_id", identity.userId)
      .eq("status", "approved")
      .eq("provisioning_status", "provisioned")
      .limit(2)
  } catch {
    return "service_unavailable"
  }

  if (applicationsResult.error) return "service_unavailable"
  if (!Array.isArray(applicationsResult.data)) {
    return "reconciliation_required"
  }
  if (applicationsResult.data.length === 0) return "not_finalized"
  if (applicationsResult.data.length !== 1) {
    return "reconciliation_required"
  }

  const application = applicationsResult.data[0]
  if (
    !isApplicationRow(application) ||
    application.auth_user_id !== identity.userId ||
    normalizeEmail(application.email) !== identity.normalizedEmail ||
    application.status !== "approved" ||
    application.provisioning_status !== "provisioned" ||
    !isUuid(application.vendor_id) ||
    !application.provisioned_at
  ) {
    return "reconciliation_required"
  }

  let vendorsResult
  try {
    vendorsResult = await client
      .from("vendors")
      .select(VENDOR_FIELDS)
      .eq("id", application.vendor_id)
      .limit(2)
  } catch {
    return "service_unavailable"
  }

  if (vendorsResult.error) return "service_unavailable"
  if (!Array.isArray(vendorsResult.data) || vendorsResult.data.length !== 1) {
    return "reconciliation_required"
  }

  const vendor = vendorsResult.data[0]
  return isVendorRow(vendor) &&
    vendor.id === application.vendor_id &&
    vendor.user_id === identity.userId &&
    normalizeEmail(vendor.email) === identity.normalizedEmail &&
    vendor.is_active === false
    ? "already_finalized"
    : "reconciliation_required"
}

export async function finalizeSellerAccount(
  identity: VerifiedSellerIdentity
): Promise<SellerFinalizationOutcome> {
  if (!isUuid(identity.userId) || !identity.normalizedEmail) {
    return "identity_mismatch"
  }

  let client: ReturnType<typeof createAdminClient>
  try {
    client = createAdminClient()
  } catch {
    return "service_unavailable"
  }
  let candidatesResult
  try {
    candidatesResult = await client
      .from("vendor_applications")
      .select(APPLICATION_FIELDS)
      .eq("auth_user_id", identity.userId)
      .eq("status", "approved")
      .eq("provisioning_status", "awaiting_enrollment")
      .is("vendor_id", null)
      .is("provisioned_at", null)
      .limit(2)
  } catch {
    return "service_unavailable"
  }

  if (candidatesResult.error) return "service_unavailable"
  if (!Array.isArray(candidatesResult.data)) {
    return "reconciliation_required"
  }
  if (candidatesResult.data.length > 1) {
    return "reconciliation_required"
  }
  if (candidatesResult.data.length === 0) {
    const reconciliation = await reconcileFinalizedState(client, identity)
    if (reconciliation === "already_finalized") return reconciliation
    if (reconciliation === "not_finalized") return "no_pending_enrollment"
    return reconciliation
  }

  const candidate = candidatesResult.data[0]
  if (!isApplicationRow(candidate) || !isValidCandidate(candidate, identity)) {
    return "identity_mismatch"
  }

  let rpcResult
  try {
    rpcResult = await client.rpc("finalize_vendor_application_provisioning", {
      p_application_id: candidate.id,
      p_auth_user_id: identity.userId,
    })
  } catch {
    const reconciliation = await reconcileFinalizedState(client, identity)
    return reconciliation === "already_finalized"
      ? reconciliation
      : "reconciliation_required"
  }

  if (rpcResult.error) {
    const reconciliation = await reconcileFinalizedState(client, identity)
    return reconciliation === "already_finalized"
      ? reconciliation
      : "reconciliation_required"
  }

  const outcome = parseRpcOutcome(rpcResult.data, candidate.id)
  if (!outcome) {
    const reconciliation = await reconcileFinalizedState(client, identity)
    return reconciliation === "already_finalized"
      ? reconciliation
      : "reconciliation_required"
  }

  if (outcome === "provisioned") return "finalized"
  if (outcome === "already_provisioned") return "already_finalized"
  if (outcome === "enrollment_not_verified") return "email_unconfirmed"
  if (outcome === "identity_conflict" || outcome === "identity_mismatch") {
    return "identity_mismatch"
  }
  if (outcome === "vendor_collision") return "vendor_collision"
  if (outcome === "operation_failed") return "service_unavailable"
  if (
    outcome === "invalid_input" ||
    outcome === "unavailable" ||
    outcome === "invalid_state" ||
    outcome === "application_data_invalid" ||
    outcome === "invalid_vendor_defaults"
  ) {
    return "invalid_state"
  }

  return "reconciliation_required"
}
