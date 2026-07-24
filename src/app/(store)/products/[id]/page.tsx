import Link from "next/link"
import { notFound } from "next/navigation"
import { PackageCheck, RefreshCw, Store, Truck } from "lucide-react"

import { ProductActions } from "@/components/product-actions"
import { ProductCard } from "@/components/product-card"
import { ProductGallery } from "@/components/product-gallery"
import { Separator } from "@/components/ui/separator"
import { getProductDetail, isProductId } from "@/lib/product-detail"
import {
  categoryMatchesSlug,
  STORE_CATEGORIES,
  toCategorySlug,
} from "@/lib/storefront"
import { formatNaira } from "@/lib/utils"
import type { CatalogueProduct } from "@/types"

export const dynamic = "force-dynamic"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isProductId(id)) notFound()

  const detail = await getProductDetail(id)
  if (!detail.current) notFound()

  const { product, vendor } = detail.current
  const categoryName = getCanonicalCategoryName(product.category)

  return (
    <main className="min-w-0 bg-white py-8 sm:py-12 lg:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/products"
          className="mb-7 inline-flex min-h-11 items-center text-sm font-semibold text-zinc-600 hover:text-zinc-900"
        >
          ← Back to products
        </Link>

        <div className="grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
          <ProductGallery product={product} />

          <div className="min-w-0 space-y-6">
            <nav className="flex flex-wrap gap-2 text-sm text-zinc-500" aria-label="Breadcrumb">
              <Link href="/" className="hover:text-zinc-900">Home</Link>
              <span aria-hidden="true">›</span>
              <Link
                href={product.category ? `/products?category=${toCategorySlug(categoryName)}` : "/products"}
                className="hover:text-zinc-900"
              >
                {categoryName}
              </Link>
              <span aria-hidden="true">›</span>
              <span className="min-w-0 break-words text-zinc-700">{product.name}</span>
            </nav>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-600">
                  {categoryName}
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600">
                  <Store className="size-4 text-amber-600" />
                  Sold by {vendor.name}
                </span>
              </div>
              <h1 className="mt-4 break-words text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
                {product.name}
              </h1>
              <p className="mt-4 text-3xl font-bold text-amber-600 sm:text-4xl">
                {formatNaira(product.price)}
              </p>
            </div>

            <Separator />

            <section aria-labelledby="description-heading">
              <h2 id="description-heading" className="font-semibold text-zinc-900">Description</h2>
              <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-zinc-600">
                {product.description?.trim() || "The vendor has not provided a description for this product."}
              </p>
            </section>

            <ProductActions product={product} />

            <div className="grid gap-3 sm:grid-cols-2">
              <GuidanceCard icon={Truck} title="Delivery guidance">
                Delivery arrangements and any applicable cost are confirmed during order fulfilment. Check your contact and delivery details before payment.
              </GuidanceCard>
              <GuidanceCard icon={RefreshCw} title="Return guidance">
                If there is a problem with your order, contact Marketa support with your order details so the available next steps can be reviewed.
              </GuidanceCard>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
              <PackageCheck className="size-5 shrink-0" />
              Payment is completed through the existing secure checkout flow.
            </div>
          </div>
        </div>

        <RecommendationSection title="Related Products" products={detail.related} />
        <RecommendationSection title={`More from ${vendor.name}`} products={detail.sameVendor} />
      </div>
    </main>
  )
}

function getCanonicalCategoryName(category: string | null): string {
  if (!category) return "Other"
  return (
    STORE_CATEGORIES.find((item) => categoryMatchesSlug(category, item.slug))
      ?.name ?? category
  )
}

function GuidanceCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <Icon className="size-5 text-amber-600" />
      <h2 className="mt-3 font-semibold text-zinc-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{children}</p>
    </section>
  )
}

function RecommendationSection({
  title,
  products,
}: {
  title: string
  products: CatalogueProduct[]
}) {
  if (products.length === 0) return null
  return (
    <section className="mt-14 border-t border-zinc-200 pt-10 sm:mt-16" aria-label={title}>
      <h2 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">{title}</h2>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {products.map(({ product, vendor }, index) => (
          <ProductCard
            key={product.id}
            product={product}
            vendorName={vendor.name}
            index={index}
          />
        ))}
      </div>
    </section>
  )
}
