import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ShoppingBag, Store } from "lucide-react"

import { supabase } from "@/lib/supabase"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Vendors | Marketa",
  description: "Discover active sellers on the Marketa marketplace.",
}

interface VendorSummary {
  id: string
  name: string
}

type VendorDirectoryResult =
  | { status: "ready"; vendors: VendorSummary[] }
  | { status: "empty"; vendors: [] }
  | { status: "unavailable"; vendors: [] }

async function getActiveVendors(): Promise<VendorDirectoryResult> {
  try {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true })

    if (error) {
      console.error("[vendors] query failed:", error.message)
      return { status: "unavailable", vendors: [] }
    }

    const vendors = (data ?? []).flatMap((vendor) => {
      if (
        typeof vendor.id !== "string" ||
        typeof vendor.name !== "string" ||
        !vendor.name.trim()
      ) {
        return []
      }

      return [{ id: vendor.id, name: vendor.name.trim() }]
    })

    if (vendors.length === 0) {
      return { status: "empty", vendors: [] }
    }

    return { status: "ready", vendors }
  } catch (error) {
    console.error("[vendors] query failed:", error)
    return { status: "unavailable", vendors: [] }
  }
}

export default async function VendorsPage() {
  const directory = await getActiveVendors()

  return (
    <main className="bg-white">
      <section className="relative overflow-hidden bg-zinc-900 py-16 sm:py-20 lg:py-24">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-0 size-80 -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-400">
              Sellers on Marketa
            </p>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-5xl">
              Meet the businesses behind the marketplace
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
              Discover active sellers on Marketa, then browse the marketplace
              to find products that fit your needs.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/products"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
              >
                Browse products
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/sell-with-us"
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-zinc-500 hover:bg-white/5"
              >
                Sell with us
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">
              Active sellers
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              These seller names come directly from active Marketa profiles.
              Public seller storefronts will be added in a future update.
            </p>
          </div>

          {directory.status === "ready" ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {directory.vendors.map((vendor) => (
                <article
                  key={vendor.id}
                  className="rounded-xl border border-zinc-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                      <Store className="size-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-zinc-900">
                        {vendor.name}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        Active seller on Marketa
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-12 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white text-zinc-400 shadow-sm">
                {directory.status === "unavailable" ? (
                  <ShoppingBag className="size-7" aria-hidden="true" />
                ) : (
                  <Store className="size-7" aria-hidden="true" />
                )}
              </div>
              <h2 className="mt-5 text-xl font-semibold text-zinc-900">
                {directory.status === "unavailable"
                  ? "Seller directory unavailable"
                  : "No active sellers to show yet"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
                {directory.status === "unavailable"
                  ? "We could not load the seller directory right now. You can still explore available products."
                  : "There are no active seller profiles available at the moment. Check back as the marketplace grows."}
              </p>
              <Link
                href="/products"
                className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
              >
                Browse products
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
