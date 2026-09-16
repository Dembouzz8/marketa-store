import Link from "next/link"
import { applicationStatuses, listVendorApplications, maxPage, pageSize } from "@/lib/admin/vendor-applications"

export default async function VendorApplicationsPage({ searchParams }: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>
}) {
  const params = await searchParams
  const { applications, count, status, page } = await listVendorApplications(params.status, params.page)
  const pageCount = Math.max(1, Math.ceil(count / pageSize))
  const pageUrl = (number: number) => `/admin/vendor-applications?status=${status}&page=${number}`
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">Vendor applications</h1>
      <p className="mt-3 text-sm text-zinc-600">Review applications only. Approval does not create, activate or verify a vendor account.</p>
      <nav aria-label="Review status" className="mt-6 flex flex-wrap gap-2">
        {applicationStatuses.map((filter) => (
          <Link key={filter} href={`/admin/vendor-applications?status=${filter}`} aria-current={status === filter ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm ${status === filter ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>
            {filter.replaceAll("_", " ")}
          </Link>
        ))}
      </nav>
      <p className="my-5 text-sm text-zinc-600">{count} {status.replaceAll("_", " ")} application{count === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Vendor applications filtered by review status</caption>
          <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-700">
            <tr>{["Business", "Contact", "Email", "Category", "Location", "Review status", "Provisioning status", "Submitted (UTC)", "Reviewed (UTC)", "View"].map((label) => (
              <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-4 font-medium">{application.business_name}</td>
                <td className="px-4 py-4">{application.contact_name}</td>
                <td className="break-all px-4 py-4">{application.email}</td>
                <td className="px-4 py-4">{application.business_category}</td>
                <td className="px-4 py-4">{application.location}</td>
                <td className="px-4 py-4">{application.status.replaceAll("_", " ")}</td>
                <td className="px-4 py-4">{application.provisioning_status.replaceAll("_", " ")}</td>
                <td className="whitespace-nowrap px-4 py-4">{new Date(application.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className="whitespace-nowrap px-4 py-4">{application.reviewed_at ? new Date(application.reviewed_at).toISOString().slice(0, 16).replace("T", " ") : "Not reviewed"}</td>
                <td className="px-4 py-4"><Link href={`/admin/vendor-applications/${application.id}`} className="font-medium text-amber-800 underline" aria-label={`View ${application.business_name}`}>View</Link></td>
              </tr>
            ))}
            {!applications.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-zinc-500">No applications on this page.</td></tr>}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        {page > 1 && <Link href={pageUrl(page - 1)} className="rounded-lg border border-zinc-300 bg-white px-4 py-2">Previous</Link>}
        <span>Page {page} · {pageCount} page{pageCount === 1 ? "" : "s"} total</span>
        {page < Math.min(pageCount, maxPage) && <Link href={pageUrl(page + 1)} className="rounded-lg border border-zinc-300 bg-white px-4 py-2">Next</Link>}
        {page > pageCount && <Link href={pageUrl(1)} className="underline">Return to first page</Link>}
      </nav>
      {pageCount > maxPage && <p className="mt-3 text-sm text-zinc-500">This review surface displays the newest {maxPage * pageSize} applications per status.</p>}
    </section>
  )
}
