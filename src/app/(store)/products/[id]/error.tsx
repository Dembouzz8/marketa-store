"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"

export default function ProductDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-white px-4">
      <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <AlertTriangle className="mx-auto size-10 text-red-500" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">We could not load this product</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Please try again. Your cart has not been affected.</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button onClick={reset} className="min-h-11 rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white">Try again</button>
          <Link href="/products" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-700">Browse products</Link>
        </div>
      </div>
    </main>
  )
}
