import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BadgeCheck, MapPin, Store } from "lucide-react"

import { getActiveVendors } from "@/lib/catalogue"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Vendors | Marketa",
  description: "Discover active sellers on the Marketa marketplace.",
}

function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

export default async function VendorsPage() {
  const vendors = await getActiveVendors()

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
              and visit their stores to find products that fit your needs.
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
              Visit a store to browse the active products it currently offers.
            </p>
          </div>

          {vendors.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {vendors.map((vendor) => {
                const category = optionalText(vendor.main_category)
                const location = optionalText(vendor.location)
                const description = optionalText(vendor.description)

                return (
                  <Link
                    key={vendor.id}
                    href={`/vendors/${vendor.id}`}
                    className="group flex h-full min-w-0 flex-col rounded-xl border border-zinc-100 bg-white p-5 shadow-sm transition-all hover:border-zinc-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                  >
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
                        <Store className="size-6" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-words text-base font-semibold text-zinc-900">
                            {vendor.name}
                          </h3>
                          {vendor.is_verified === true && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <BadgeCheck className="size-3.5" aria-hidden="true" />
                              Verified
                            </span>
                          )}
                        </div>
                        {(category || location) && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
                            {category && <span className="break-words">{category}</span>}
                            {location && (
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="break-words">{location}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {description && (
                      <p className="mt-4 line-clamp-3 break-words text-sm leading-6 text-zinc-600">
                        {description}
                      </p>
                    )}

                    <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-zinc-900">
                      Visit Store
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-12 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white text-zinc-400 shadow-sm">
                <Store className="size-7" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-zinc-900">
                No active sellers to show yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
                There are no active seller profiles available at the moment.
                Check back as the marketplace grows.
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
