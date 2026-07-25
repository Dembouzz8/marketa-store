"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function StorefrontError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-zinc-900">
          We could not load the storefront
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          There was a problem reaching the marketplace. Please try again.
        </p>
        <Button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700"
        >
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </main>
  )
}
