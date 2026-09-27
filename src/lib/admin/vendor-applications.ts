import "server-only"
import { requireAdmin } from "./auth"
import { createAdminClient } from "./supabase-admin"

export const applicationStatuses = ["submitted", "under_review", "approved", "rejected"] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export const applicationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const pageSize = 25
export const maxPage = 1000

const listFields = "id,business_name,contact_name,email,business_category,location,status,provisioning_status,created_at,reviewed_at"
const detailFields = `${listFields},phone,business_description,product_summary,experience,terms_accepted,review_notes,reviewed_by,updated_at,vendor_id,provisioned_at,auth_user_id`

export type VendorActivationState =
  | "not_provisioned"
  | "unavailable"
  | "inactive"
  | "active"

export interface VendorActivationInfo {
  state: VendorActivationState
  isActive: boolean | null
  activatedAt: string | null
}

export interface ApplicationSummary {
  id: string
  business_name: string
  contact_name: string
  email: string
  business_category: string
  location: string
  status: ApplicationStatus
  provisioning_status: string
  created_at: string
  reviewed_at: string | null
}

export interface ApplicationDetail extends ApplicationSummary {
  phone: string
  business_description: string
  product_summary: string
  experience: string | null
  terms_accepted: boolean
  review_notes: string | null
  reviewed_by: string | null
  updated_at: string
  vendor_id: string | null
  provisioned_at: string | null
  activation: VendorActivationInfo
}

interface InternalApplicationDetail extends Omit<ApplicationDetail, "activation"> {
  auth_user_id: string | null
}

async function loadActivationInfo(
  client: ReturnType<typeof createAdminClient>,
  application: InternalApplicationDetail
): Promise<VendorActivationInfo> {
  if (
    application.status !== "approved" ||
    application.provisioning_status !== "provisioned"
  ) {
    return { state: "not_provisioned", isActive: null, activatedAt: null }
  }

  if (
    !application.vendor_id ||
    !application.auth_user_id ||
    !application.provisioned_at
  ) {
    return { state: "unavailable", isActive: null, activatedAt: null }
  }

  try {
    const { data, error } = await client
      .from("vendors")
      .select("id,user_id,is_active,activated_at")
      .eq("id", application.vendor_id)
      .maybeSingle()

    if (
      error ||
      !data ||
      data.id !== application.vendor_id ||
      data.user_id !== application.auth_user_id ||
      typeof data.is_active !== "boolean" ||
      (data.activated_at !== null && typeof data.activated_at !== "string")
    ) {
      return { state: "unavailable", isActive: null, activatedAt: null }
    }

    return {
      state: data.is_active ? "active" : "inactive",
      isActive: data.is_active,
      activatedAt: data.activated_at,
    }
  } catch {
    return { state: "unavailable", isActive: null, activatedAt: null }
  }
}

async function loadVendorApplication(id: string): Promise<ApplicationDetail | null> {
  const client = createAdminClient()
  const { data, error } = await client
    .from("vendor_applications")
    .select(detailFields)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error()
  if (!data) return null

  const application = data as InternalApplicationDetail
  const activation = await loadActivationInfo(client, application)
  const { auth_user_id: _authUserId, ...detail } = application
  void _authUserId
  return { ...detail, activation }
}

export async function listVendorApplications(statusInput: unknown, pageInput: unknown) {
  await requireAdmin()
  const status: ApplicationStatus = applicationStatuses.includes(statusInput as ApplicationStatus)
    ? statusInput as ApplicationStatus : "submitted"
  const parsedPage = typeof pageInput === "string" && /^[1-9]\d{0,3}$/.test(pageInput)
    ? Number(pageInput) : 1
  const page = Math.min(parsedPage, maxPage)
  try {
    const { data, count, error } = await createAdminClient()
      .from("vendor_applications")
      .select(listFields, { count: "exact" })
      .eq("status", status)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error || data === null || count === null) throw new Error()
    return { applications: data as ApplicationSummary[], count, status, page }
  } catch {
    throw new Error("Unable to load vendor applications.")
  }
}

export async function getVendorApplication(id: string) {
  await requireAdmin()
  // Authorization precedes even malformed-ID/not-found responses.
  if (!applicationIdPattern.test(id)) return null
  try {
    return await loadVendorApplication(id)
  } catch {
    throw new Error("Unable to load this application.")
  }
}

export async function reconcileVendorApplicationActivation(
  id: string
): Promise<VendorActivationState> {
  await requireAdmin()

  if (!applicationIdPattern.test(id)) return "unavailable"
  try {
    return (await loadVendorApplication(id))?.activation.state ?? "unavailable"
  } catch {
    return "unavailable"
  }
}
