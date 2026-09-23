"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"

import {
  finalizeSellerEnrollment,
  type FinalizationResult,
} from "./actions"

const initialState: FinalizationResult = {
  outcome: "no_pending_enrollment",
  message: "",
  revision: "",
}

export function FinalizationForm() {
  const [result, action, pending] = useActionState(
    finalizeSellerEnrollment,
    initialState
  )
  const router = useRouter()

  useEffect(() => {
    if (
      result.revision &&
      (result.outcome === "finalized" || result.outcome === "already_finalized")
    ) {
      router.replace("/vendor/dashboard")
      router.refresh()
    }
  }, [result.outcome, result.revision, router])

  return (
    <form action={action} className="mt-6">
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating your seller account..." : "Create my seller account"}
      </button>
      {result.message && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg bg-zinc-100 p-4 text-sm leading-6 text-zinc-700"
        >
          {result.message}
        </p>
      )}
    </form>
  )
}
