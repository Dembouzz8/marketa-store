import Link from "next/link"
import { ArrowLeft, MapPin } from "lucide-react"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

import { AddressManager } from "./address-manager"

type CustomerAddressRow = {
  id: string
  label: string
  address: string
  city: string
  state: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export default async function CustomerAddressesPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect("/account/login")

  const { data, error } = await supabase
    .from("customer_addresses")
    .select(
      "id, label, address, city, state, is_default, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })

  return (
    <main className="bg-zinc-50 px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href="/account"
          className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to account
        </Link>

        <div className="mt-6 flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <MapPin className="size-7" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Saved Addresses
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Manage delivery addresses for faster checkout.
            </p>
          </div>
        </div>

        {error ? (
          <section className="mt-8 rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <h2 className="text-xl font-semibold text-zinc-900">
              We couldn&apos;t load your saved addresses
            </h2>
            <p role="alert" className="mt-2 text-sm leading-6 text-zinc-600">
              We couldn&apos;t load your saved addresses right now. Please try
              again.
            </p>
            <Link
              href="/account/addresses"
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              Try again
            </Link>
          </section>
        ) : (
          <AddressManager addresses={(data ?? []) as CustomerAddressRow[]} />
        )}
      </div>
    </main>
  )
}
