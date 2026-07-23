"use client"

import { AlertTriangle } from "lucide-react"

export default function ProductsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-[70vh] items-center justify-center bg-white px-4"><div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center"><AlertTriangle className="mx-auto size-10 text-red-500" /><h1 className="mt-4 text-xl font-semibold text-zinc-900">We could not load the catalogue</h1><p className="mt-2 text-sm text-zinc-600">Please try again. Your cart has not been affected.</p><button onClick={reset} className="mt-6 min-h-11 rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white">Try again</button></div></main>
}
