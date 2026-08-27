import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, ClipboardCheck, ShieldCheck, Store } from "lucide-react"

import { ApplicationForm } from "./application-form"

export const metadata: Metadata = {
  title: "Apply to Sell | Marketa",
  description:
    "Introduce your business and apply to become a seller on the Marketa marketplace.",
}

export default function VendorApplicationPage() {
  return (
    <main className="bg-zinc-50">
      <section className="relative isolate overflow-hidden bg-zinc-900 text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_25%,rgba(245,158,11,0.18),transparent_35%)]" />
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <Link
            href="/sell-with-us"
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Sell With Us
          </Link>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400">
                <Store className="size-4" aria-hidden="true" />
                Seller application
              </div>
              <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
                Apply to sell on Marketa
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
                Tell us about your business and the products you plan to sell.
                Your information will be used to review your seller application.
              </p>
            </div>

            <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="size-5 text-amber-400" aria-hidden="true" />
                Complete all required fields
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-5 text-emerald-400" aria-hidden="true" />
                Submitted securely for review
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
        <ApplicationForm />
      </section>
    </main>
  )
}
