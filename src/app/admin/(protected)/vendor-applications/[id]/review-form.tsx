"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { reviewVendorApplication } from "../actions"

export function ReviewForm({ applicationId, status, provisioningStatus }: {
  applicationId: string; status: string; provisioningStatus: string
}) {
  const [state, action, pending] = useActionState(reviewVendorApplication, { message: "", revision: "" })
  const router = useRouter()
  useEffect(() => {
    if (state.revision) router.refresh()
  }, [state.revision, router])
  const canReview = provisioningStatus === "not_started" && ["submitted", "under_review"].includes(status)
  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Review decision</h2>
      {state.message && <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-zinc-100 p-4 text-sm">{state.message}</p>}
      {canReview ? (
        <form action={action} className="mt-5">
          <input type="hidden" name="applicationId" value={applicationId} />
          <fieldset disabled={pending} className="disabled:opacity-60">
            <label htmlFor="reviewNote" className="block text-sm font-medium">Replacement review note (optional)</label>
            <p id="note-help" className="mt-2 text-sm text-zinc-600">Leaving it blank keeps the existing note. Maximum 4,000 Unicode characters. Notes are admin-only.</p>
            <textarea id="reviewNote" name="reviewNote" rows={5} aria-describedby="note-help" defaultValue=""
              className="mt-3 w-full rounded-lg border border-zinc-300 p-3 text-sm" />
            <p className="mt-3 text-sm text-zinc-600">Approval only records a review decision. Vendor provisioning has not started and will not be started by this action.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {status === "submitted" && <button name="action" value="start_review" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium">Start Review</button>}
              <button name="action" value="approve" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900">Approve</button>
              <button name="action" value="reject" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Reject</button>
            </div>
            {pending && <p role="status" className="mt-3 text-sm text-zinc-500">Saving review...</p>}
          </fieldset>
        </form>
      ) : <p className="mt-3 text-sm text-zinc-600">No review actions are available for this application&apos;s current state.</p>}
    </section>
  )
}
