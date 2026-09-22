"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { FunctionsHttpError } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/admin/auth"
import { assertAdminOrigin } from "@/lib/admin/origin"
import { createAdminClient } from "@/lib/admin/supabase-admin"
import { applicationIdPattern, applicationStatuses } from "@/lib/admin/vendor-applications"
import { createSupabaseServerClient } from "@/lib/supabase-server"

export type ReviewResult = { message: string; revision: string }
export type ProvisionResult = { message: string; revision: string }

const messages = {
  review_started: "Application marked under review.",
  approved: "Application approved. Vendor provisioning has not started.",
  rejected: "Application rejected.",
  already_under_review: "Application is already under review. No changes were made.",
  already_approved: "Application is already approved. No changes were made.",
  already_rejected: "Application is already rejected. No changes were made.",
  invalid_input: "Check the review action and note. Notes must not exceed 4,000 characters.",
  invalid_state: "This action is no longer available. Refresh to see the current status.",
  unavailable: "Application unavailable.",
  unauthorized: "You no longer have access to admin review.",
  operation_failed: "We couldn't save the review. Refresh and try again.",
} as const

const provisioningMessages = {
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
  invalid_state:
    "This application is no longer eligible for seller enrollment. Refresh to see its current status.",
  reconciliation_required:
    "Provisioning status is uncertain. Review the application before retrying.",
  invalid_request:
    "The seller enrollment request was rejected. Reload the page and try again.",
  auth_required:
    "Your admin session could not be verified. Sign in again before retrying.",
  access_denied:
    "You no longer have access to initiate seller enrollment.",
  application_unavailable:
    "This application is no longer available.",
  method_not_allowed:
    "Seller enrollment is temporarily unavailable. Review the application before retrying.",
  unsupported_media_type:
    "Seller enrollment is temporarily unavailable. Review the application before retrying.",
  service_unavailable:
    "Seller enrollment is temporarily unavailable. Review the application before retrying.",
} as const

const uncertainProvisioningMessage =
  "Provisioning status is uncertain. Review the application before retrying."

type ProvisioningOutcome = keyof typeof provisioningMessages
const successfulProvisioningOutcomes = new Set<ProvisioningOutcome>([
  "awaiting_enrollment_existing",
  "awaiting_enrollment_invited",
  "already_awaiting_enrollment",
])

function parseProvisioningOutcome(
  data: unknown,
  applicationId: string
): ProvisioningOutcome | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  if (
    typeof record.ok !== "boolean" ||
    typeof record.outcome !== "string" ||
    !Object.hasOwn(provisioningMessages, record.outcome) ||
    (record.application_id !== undefined &&
      record.application_id !== applicationId)
  ) {
    return null
  }
  const outcome = record.outcome as ProvisioningOutcome
  if (
    record.ok !== successfulProvisioningOutcomes.has(outcome) ||
    (record.ok && record.application_id !== applicationId)
  ) {
    return null
  }
  return outcome
}

async function outcomeFromFunctionError(
  error: unknown,
  applicationId: string
): Promise<ProvisioningOutcome | null> {
  if (!(error instanceof FunctionsHttpError)) return null
  try {
    return parseProvisioningOutcome(await error.context.json(), applicationId)
  } catch {
    return null
  }
}

function parseOutcome(data: unknown, applicationId: string): keyof typeof messages | null {
  if (!Array.isArray(data) || data.length !== 1) return null
  const row = data[0]
  if (!row || typeof row !== "object" || row.application_id !== applicationId ||
      typeof row.outcome !== "string" || !Object.hasOwn(messages, row.outcome)) return null
  const outcome = row.outcome as keyof typeof messages
  const nullState = ["unauthorized", "invalid_input", "unavailable", "operation_failed"].includes(outcome)
  if (nullState) {
    if (row.status !== null || row.provisioning_status !== null) return null
  } else {
    if (!applicationStatuses.includes(row.status) ||
        !["not_started", "in_progress", "awaiting_enrollment", "provisioned", "failed"].includes(row.provisioning_status)) return null
    const expectedStatuses: Partial<Record<keyof typeof messages, string>> = {
      review_started: "under_review", already_under_review: "under_review",
      approved: "approved", already_approved: "approved",
      rejected: "rejected", already_rejected: "rejected",
    }
    const expectedStatus = expectedStatuses[outcome]
    if (expectedStatus && row.status !== expectedStatus) return null
    if (["review_started", "approved", "rejected"].includes(outcome) && row.provisioning_status !== "not_started") return null
  }
  return outcome
}

export async function reviewVendorApplication(_previous: ReviewResult, formData: FormData): Promise<ReviewResult> {
  try {
    await assertAdminOrigin()
  } catch {
    return { message: "Invalid request. Reload the page and try again.", revision: "" }
  }
  const admin = await requireAdmin()
  const rawId = formData.get("applicationId")
  const action = formData.get("action")
  const rawNote = formData.get("reviewNote")
  // No browser field is used as reviewer identity (including forged extra fields).
  if (typeof rawId !== "string" || !applicationIdPattern.test(rawId)) {
    revalidatePath("/admin/vendor-applications")
    return { message: messages.invalid_input, revision: "" }
  }
  const applicationId = rawId.toLowerCase()
  const finish = (message: string): ReviewResult => {
    revalidatePath("/admin/vendor-applications")
    revalidatePath(`/admin/vendor-applications/${applicationId}`)
    return { message, revision: crypto.randomUUID() }
  }
  const note = typeof rawNote === "string" ? rawNote.trim() || null : null
  if (
    typeof action !== "string" || !["start_review", "approve", "reject"].includes(action) ||
    (rawNote !== null && typeof rawNote !== "string") ||
    (note !== null && (Array.from(note).length > 4000 || note.includes("\0"))) ||
    ["applicationId", "action", "reviewNote"].some((key) => formData.getAll(key).length > 1)
  ) return finish(messages.invalid_input)

  let outcome: keyof typeof messages | null = null
  try {
    const { data, error } = await createAdminClient().rpc("review_vendor_application", {
      p_application_id: applicationId,
      p_reviewer_id: admin.userId,
      p_action: action,
      p_review_notes: note,
    })
    if (!error) outcome = parseOutcome(data, applicationId)
  } catch {
    // Do not expose/log SQL errors, service credentials or applicant content.
  }
  const result = finish(outcome ? messages[outcome] : messages.operation_failed)
  if (outcome === "unauthorized") redirect("/admin/login?access=denied")
  return result
}

export async function initiateVendorProvisioning(
  _previous: ProvisionResult,
  formData: FormData
): Promise<ProvisionResult> {
  try {
    await assertAdminOrigin()
  } catch {
    return {
      message: "Invalid request. Reload the page and try again.",
      revision: "",
    }
  }

  await requireAdmin()

  const rawId = formData.get("applicationId")
  if (
    typeof rawId !== "string" ||
    !applicationIdPattern.test(rawId) ||
    formData.getAll("applicationId").length !== 1 ||
    Array.from(formData.keys()).some((key) => key !== "applicationId")
  ) {
    return { message: provisioningMessages.invalid_request, revision: "" }
  }
  const applicationId = rawId.toLowerCase()

  let outcome: ProvisioningOutcome | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.functions.invoke(
      "initiate-vendor-provisioning",
      { body: { application_id: applicationId } }
    )
    outcome = error
      ? await outcomeFromFunctionError(error, applicationId)
      : parseProvisioningOutcome(data, applicationId)
  } catch {
    // Invocation state can be uncertain; never retry or expose transport details.
  }

  revalidatePath("/admin/vendor-applications")
  revalidatePath(`/admin/vendor-applications/${applicationId}`)
  return {
    message: outcome
      ? provisioningMessages[outcome]
      : uncertainProvisioningMessage,
    revision: crypto.randomUUID(),
  }
}
