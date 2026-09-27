"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  activateVendorApplication,
  initialActivationResult,
} from "../actions"
import type { VendorActivationState } from "@/lib/admin/vendor-applications"

type ActivationControlState = {
  canActivate: boolean
  description: string
}

export function getActivationControlState(
  state: VendorActivationState
): ActivationControlState {
  if (state === "not_provisioned") {
    return {
      canActivate: false,
      description:
        "Seller activation is available only after application approval and completed provisioning.",
    }
  }
  if (state === "unavailable") {
    return {
      canActivate: false,
      description:
        "Activation is unavailable. Seller linkage requires reconciliation before activation.",
    }
  }
  if (state === "active") {
    return {
      canActivate: false,
      description: "Seller active",
    }
  }
  return {
    canActivate: true,
    description:
      "This seller completed provisioning and is currently inactive.",
  }
}

export function formatActivationTime(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}

export function ActivationForm({
  applicationId,
  activationState,
  activatedAt,
}: {
  applicationId: string
  activationState: VendorActivationState
  activatedAt: string | null
}) {
  const [result, action, pending] = useActionState(
    activateVendorApplication,
    initialActivationResult
  )
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (result.revision) router.refresh()
  }, [result.revision, router])

  const control = getActivationControlState(activationState)

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Seller activation</h2>
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

      {activationState === "active" && activatedAt && (
        <p className="mt-2 text-sm text-zinc-600">
          Activated at {" "}
          <time dateTime={activatedAt}>{formatActivationTime(activatedAt)} UTC</time>
        </p>
      )}

      {control.canActivate && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900"
        >
          Activate Seller
        </button>
      )}

      {control.canActivate && confirming && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="font-semibold text-zinc-900">Confirm seller activation</h3>
          <p className="mt-3 text-sm text-zinc-700">
            Activation immediately unlocks product creation, editing, and status
            management; product-image upload in this seller&apos;s namespace; public
            vendor visibility; and storefront and checkout eligibility for active
            products.
          </p>
          <p className="mt-3 text-sm font-medium text-zinc-900">
            Existing products whose product status is already active may become
            publicly visible immediately after seller activation.
          </p>
          <p className="mt-3 text-sm text-zinc-700">
            Activation does not verify the seller. Verification remains a separate
            admin and public status.
          </p>
          <form action={action} className="mt-5">
            <input type="hidden" name="application_id" value={applicationId} />
            <fieldset
              disabled={pending}
              className="flex flex-wrap gap-3 disabled:opacity-60"
            >
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed"
              >
                Confirm activation
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900"
              >
                Cancel
              </button>
            </fieldset>
            {pending && (
              <p role="status" className="mt-3 text-sm text-zinc-600">
                Activating seller...
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  )
}
