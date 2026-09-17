import Link from "next/link"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

function Unavailable() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">Seller setup is unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          We could not check your account right now. Please try again later.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-amber-700 underline">
          Return to Marketa
        </Link>
      </div>
    </main>
  )
}

export default async function VendorOnboardingPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (!user) redirect("/account/login?vendor_onboarding=1")
  if (userError) return <Unavailable />

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (vendorError) return <Unavailable />
  if (vendor) redirect("/vendor/dashboard")

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Marketa sellers</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-900">Seller enrollment</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          You are signed in{user.email ? ` as ${user.email}` : ""}. Seller enrollment is not yet complete.
          No vendor account has been created for this sign-in.
        </p>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          You can continue shopping while Marketa prepares the next step.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700">
          Continue shopping
        </Link>
      </div>
    </main>
  )
}
