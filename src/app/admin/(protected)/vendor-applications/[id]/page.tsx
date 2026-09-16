import Link from "next/link"
import { notFound } from "next/navigation"
import { getVendorApplication } from "@/lib/admin/vendor-applications"
import { ReviewForm } from "./review-form"

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const application = await getVendorApplication(id)
  if (!application) notFound()
  const fields = [
    ["Contact", application.contact_name],
    ["Email", application.email],
    ["Phone", application.phone],
    ["Category", application.business_category],
    ["Location", application.location],
    ["Review status", application.status.replaceAll("_", " ")],
    ["Provisioning status (read-only)", application.provisioning_status.replaceAll("_", " ")],
    ["Terms accepted", application.terms_accepted ? "Yes" : "No"],
    ["Submitted (UTC)", new Date(application.created_at).toISOString()],
    ["Reviewed (UTC)", application.reviewed_at ? new Date(application.reviewed_at).toISOString() : "Not reviewed"],
    ["Last updated (UTC)", new Date(application.updated_at).toISOString()],
    // Do not send internal reviewer UUIDs to the browser.
    ["Reviewer recorded", application.reviewed_by ? "Yes" : "No"],
    ["Business description", application.business_description],
    ["Product summary", application.product_summary],
    ["Experience", application.experience ?? "Not provided"],
  ]
  return (
    <article>
      <Link href="/admin/vendor-applications" className="text-sm underline underline-offset-4">Back to vendor applications</Link>
      <h1 className="mt-5 break-words text-3xl font-semibold">{application.business_name}</h1>
      <p className="mt-3 text-sm text-zinc-600">Approval and provisioning are separate. This surface cannot create, activate or verify vendors.</p>
      <dl className="mt-6 grid gap-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:grid-cols-2">
        {fields.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-sm font-medium text-zinc-500">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-900">{value}</dd>
        </div>)}
      </dl>
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Existing review note</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-700">{application.review_notes ?? "No review note recorded."}</p>
      </section>
      <ReviewForm applicationId={application.id} status={application.status} provisioningStatus={application.provisioning_status} />
    </article>
  )
}
