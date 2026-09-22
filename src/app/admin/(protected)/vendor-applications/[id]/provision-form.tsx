"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { initiateVendorProvisioning } from "../actions"

type ProvisionControlState = {
  canSubmit: boolean
  buttonLabel?: string
  description: string
}

export function getProvisionControlState({
  status,
  provisioningStatus,
  hasProvisionedVendor,
}: {
  status: string
  provisioningStatus: string
  hasProvisionedVendor: boolean
}): ProvisionControlState {
  if (status !== "approved") {
    return {
      canSubmit: false,
      description: "Approve this application before starting seller enrollment.",
    }
  }
  if (hasProvisionedVendor) {
    return {
      canSubmit: false,
      description:
        "Seller enrollment initiation is no longer available for this application.",
    }
  }
  if (provisioningStatus === "not_started") {
    return {
      canSubmit: true,
      buttonLabel: "Start seller enrollment",
      description:
        "Start enrollment for this approved application. Approval does not activate or verify a seller.",
    }
  }
  if (provisioningStatus === "failed") {
    return {
      canSubmit: true,
      buttonLabel: "Retry seller enrollment",
      description:
        "The previous attempt failed. Review the application before starting an explicit retry.",
    }
  }
  if (provisioningStatus === "in_progress") {
    return {
      canSubmit: false,
      description:
        "Provisioning is in progress or requires manual reconciliation. Review the application before retrying.",
    }
  }
  if (provisioningStatus === "awaiting_enrollment") {
    return {
      canSubmit: false,
      description: "This application is awaiting seller enrollment.",
    }
  }
  return {
    canSubmit: false,
    description:
      "Seller enrollment initiation is unavailable for the current provisioning state.",
  }
}

export function ProvisionForm({
  applicationId,
  status,
  provisioningStatus,
  hasProvisionedVendor,
}: {
  applicationId: string
  status: string
  provisioningStatus: string
  hasProvisionedVendor: boolean
}) {
  const [result, action, pending] = useActionState(
    initiateVendorProvisioning,
    { message: "", revision: "" }
  )
  const router = useRouter()
  useEffect(() => {
    if (result.revision) router.refresh()
  }, [result.revision, router])

  const control = getProvisionControlState({
    status,
    provisioningStatus,
    hasProvisionedVendor,
  })

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Seller enrollment</h2>
      {result.message && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg bg-zinc-100 p-4 text-sm"
        >
          {result.message}
        </p>
      )}
      <p className="mt-3 text-sm text-zinc-600">{control.description}</p>
      {control.canSubmit && (
        <form action={action} className="mt-5">
          <input type="hidden" name="applicationId" value={applicationId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {control.buttonLabel}
          </button>
          {pending && (
            <p role="status" className="mt-3 text-sm text-zinc-500">
              Contacting the seller enrollment service...
            </p>
          )}
        </form>
      )}
    </section>
  )
}
