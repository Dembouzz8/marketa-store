"use client"

import Link from "next/link"

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6" role="alert">
      <h1 className="text-xl font-semibold">Unable to load admin review</h1>
      <p className="mt-2 text-sm text-zinc-600">Please try again. No automatic review retry will be performed.</p>
      <div className="mt-5 flex gap-4">
        <button onClick={reset} className="rounded-lg bg-zinc-900 px-4 py-2 text-white">Try again</button>
        <Link href="/admin/login" className="px-4 py-2 underline">Return to login</Link>
      </div>
    </section>
  )
}
