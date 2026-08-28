import Link from "next/link"
import { ArrowLeft, UserRound } from "lucide-react"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

import { ProfileForm } from "./profile-form"

type CustomerProfile = {
  full_name: string | null
  phone: string | null
}

export default async function CustomerProfilePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/account/login")

  const { data, error } = await supabase
    .from("customer_profiles")
    .select("full_name, phone")
    .eq("user_id", user.id)
    .maybeSingle()

  const profile = data as CustomerProfile | null

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <Link
          href="/account"
          className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to account
        </Link>

        <span className="mt-6 flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <UserRound className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
          Customer Profile
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Add the contact details you want associated with your account.
        </p>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Account email
          </p>
          <p className="mt-1 break-words text-base font-medium text-zinc-900">
            {user.email ?? "Email unavailable"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Email changes are not available here.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
          >
            We couldn&apos;t load your profile right now. Please try again.
          </div>
        ) : (
          <ProfileForm
            initialFullName={profile?.full_name ?? ""}
            initialPhone={profile?.phone ?? ""}
          />
        )}
      </section>
    </main>
  )
}
