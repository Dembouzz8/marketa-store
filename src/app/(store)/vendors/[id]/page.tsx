import Link from "next/link"
import {
  ArrowLeft,
  BadgeCheck,
  MapPin,
  PackageOpen,
  RefreshCw,
  Store,
  Truck,
} from "lucide-react"
import { notFound } from "next/navigation"

import { ProductCard } from "@/components/product-card"
import {
  getActiveProductsByVendorId,
  getActiveVendorById,
  isUuid,
} from "@/lib/catalogue"

export const dynamic = "force-dynamic"

function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

export default async function VendorStorefrontPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (!isUuid(id)) {
    notFound()
  }

  const vendor = await getActiveVendorById(id)

  if (!vendor) {
    notFound()
  }

  const products = await getActiveProductsByVendorId(vendor.id)
  const category = optionalText(vendor.main_category)
  const location = optionalText(vendor.location)
  const description = optionalText(vendor.description)
  const shippingInfo = optionalText(vendor.shipping_info)
  const returnInfo = optionalText(vendor.return_info)

  return (
    <main className="min-h-screen bg-white">
      <section className="border-b border-zinc-800 bg-zinc-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <Link
            href="/vendors"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-900"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to vendors
          </Link>

          <div className="mt-8 flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-zinc-300 sm:size-20">
              <Store className="size-8 sm:size-10" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-400">
                Vendor storefront
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
                <h1 className="min-w-0 break-words text-3xl font-bold tracking-tight sm:text-5xl">
                  {vendor.name}
                </h1>
                {vendor.is_verified === true && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-300">
                    <BadgeCheck className="size-4" aria-hidden="true" />
                    Verified
                  </span>
                )}
              </div>

              {(category || location) && (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-300">
                  {category && (
                    <span className="rounded-full bg-white/10 px-3 py-1.5 break-words">
                      {category}
                    </span>
                  )}
                  {location && (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <MapPin className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
                      <span className="break-words">{location}</span>
                    </span>
                  )}
                </div>
              )}

              {description && (
                <p className="mt-5 max-w-3xl whitespace-pre-line break-words text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="store-products-heading"
        className="py-10 sm:py-16"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2
              id="store-products-heading"
              className="text-2xl font-semibold text-zinc-900 sm:text-3xl"
            >
              Products from {vendor.name}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Browse the active products currently available from this store.
            </p>
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  vendorName={vendor.name}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 text-center">
              <PackageOpen
                className="mx-auto size-12 text-zinc-400"
                aria-hidden="true"
              />
              <h2 className="mt-5 text-xl font-semibold text-zinc-900">
                No products available right now
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
                This store does not currently have active products to display.
                Please check back later.
              </p>
              <Link
                href="/products"
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                Browse all products
              </Link>
            </div>
          )}

          {(shippingInfo || returnInfo) && (
            <div className="mt-12 grid gap-5 border-t border-zinc-200 pt-10 md:grid-cols-2">
              {shippingInfo && (
                <section
                  aria-labelledby="shipping-information-heading"
                  className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <Truck className="size-5" aria-hidden="true" />
                  </span>
                  <h2
                    id="shipping-information-heading"
                    className="mt-4 text-lg font-semibold text-zinc-900"
                  >
                    Shipping Information
                  </h2>
                  <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-zinc-600">
                    {shippingInfo}
                  </p>
                </section>
              )}

              {returnInfo && (
                <section
                  aria-labelledby="return-information-heading"
                  className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <RefreshCw className="size-5" aria-hidden="true" />
                  </span>
                  <h2
                    id="return-information-heading"
                    className="mt-4 text-lg font-semibold text-zinc-900"
                  >
                    Return Information
                  </h2>
                  <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-zinc-600">
                    {returnInfo}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
