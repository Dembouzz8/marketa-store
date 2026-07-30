import Link from "next/link"
import { ArrowLeft, PackageOpen, Store } from "lucide-react"
import { notFound } from "next/navigation"

import { ProductCard } from "@/components/product-card"
import {
  getActiveProductsByVendorId,
  getActiveVendorById,
  isUuid,
} from "@/lib/catalogue"

export const dynamic = "force-dynamic"

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

          <div className="mt-8 flex items-center gap-5">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 sm:size-20">
              <Store className="size-8 sm:size-10" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-400">
                Vendor storefront
              </p>
              <h1 className="mt-2 break-words text-3xl font-bold tracking-tight sm:text-5xl">
                {vendor.name}
              </h1>
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
        </div>
      </section>
    </main>
  )
}
