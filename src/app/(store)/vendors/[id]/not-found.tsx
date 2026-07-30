import Link from "next/link"
import { Store } from "lucide-react"

export default function VendorStorefrontNotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
          <Store className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-zinc-900">
          Vendor store not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          This vendor storefront is unavailable. Browse the directory to find
          active stores on Marketa.
        </p>
        <Link
          href="/vendors"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          View all vendors
        </Link>
      </div>
    </main>
  )
}
