import Link from "next/link"
import { requireAdmin } from "@/lib/admin/auth"
import { logoutAdmin } from "../auth-actions"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-800 bg-zinc-900 text-white">
        <nav aria-label="Admin" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <Link href="/admin/vendor-applications" className="font-semibold">Marketa Admin · Vendor Applications</Link>
          <form action={logoutAdmin}><button className="rounded-lg border border-zinc-600 px-4 py-2 text-sm">Logout</button></form>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
