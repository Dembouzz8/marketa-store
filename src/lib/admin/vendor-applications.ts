import "server-only"
import { requireAdmin } from "./auth"
import { createAdminClient } from "./supabase-admin"

export const applicationStatuses = ["submitted", "under_review", "approved", "rejected"] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export const applicationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const pageSize = 25
export const maxPage = 1000

const listFields = "id,business_name,contact_name,email,business_category,location,status,provisioning_status,created_at,reviewed_at"
const detailFields = `${listFields},phone,business_description,product_summary,experience,terms_accepted,review_notes,reviewed_by,updated_at`

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
    const { data, error } = await createAdminClient()
      .from("vendor_applications")
      .select(detailFields)
      .eq("id", id)
      .maybeSingle()
    if (error) throw new Error()
    return data as ApplicationDetail | null
  } catch {
    throw new Error("Unable to load this application.")
  }
}
