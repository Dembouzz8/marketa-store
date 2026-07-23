import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Search, SearchX, Store } from "lucide-react"

import { CatalogueActiveFilters } from "@/components/catalogue-active-filters"
import { CatalogueFilters } from "@/components/catalogue-filters"
import { CataloguePagination } from "@/components/catalogue-pagination"
import { ProductCard } from "@/components/product-card"
import { catalogueHref, getActiveVendors, getCatalogue, parseCatalogueParams, type RawCatalogueParams } from "@/lib/catalogue"
import { getCategoryName } from "@/lib/storefront"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Products | Marketa",
  description: "Search products available from vendors on Marketa.",
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<RawCatalogueParams> }) {
  const params = parseCatalogueParams(await searchParams)
  const vendors = await getActiveVendors()
  const result = await getCatalogue(params, vendors)
  if (result.total > 0 && params.page > result.totalPages) {
    redirect(catalogueHref(params, { page: result.totalPages }))
  }
  const hasFilters = Boolean(params.q || params.category || params.vendor || params.minPrice !== null || params.maxPrice !== null || params.availability !== "all")

  return (
    <main className="min-h-screen bg-white">
      <section className="border-b border-zinc-200 bg-zinc-950 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">Marketa catalogue</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{params.q ? `Search results for “${params.q}”` : "Find your next purchase"}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">Search by product, description, category, or vendor name.</p>
          <form action="/products" className="mt-7 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <label className="relative flex-1"><span className="sr-only">Search products</span><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-zinc-500" /><input type="search" name="q" defaultValue={params.q} maxLength={100} placeholder="Search products, categories, or vendors" className="min-h-12 w-full rounded-lg border border-white/10 bg-white py-3 pl-12 pr-4 text-base text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30" /></label>
            {params.category && <input type="hidden" name="category" value={params.category} />}
            {params.vendor && <input type="hidden" name="vendor" value={params.vendor} />}
            {params.minPrice !== null && <input type="hidden" name="minPrice" value={params.minPrice} />}
            {params.maxPrice !== null && <input type="hidden" name="maxPrice" value={params.maxPrice} />}
            {params.availability !== "all" && <input type="hidden" name="availability" value={params.availability} />}
            {params.sort !== "newest" && <input type="hidden" name="sort" value={params.sort} />}
            <button type="submit" className="min-h-12 rounded-lg bg-amber-500 px-7 font-semibold text-zinc-950 hover:bg-amber-400">Search</button>
          </form>
        </div>
      </section>

      <section className="py-8 sm:py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div><h2 className="text-2xl font-semibold text-zinc-900">{getCategoryName(params.category) ?? (params.q ? "Matching products" : "All Products")}</h2><p className="mt-1 text-sm text-zinc-500">Browse active products from active Marketa vendors.</p></div>
          </div>
          <CatalogueActiveFilters params={params} vendors={vendors} />

          <div className="mt-7 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <CatalogueFilters params={params} vendors={vendors} />
            <div>
              {vendors.length === 0 ? (
                <EmptyState icon="store" title="The marketplace is currently empty" description="Active products from active vendors will appear here when they become available." />
              ) : result.products.length > 0 ? (
                <><div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3"><>{result.products.map(({ product, vendor }, index) => <ProductCard key={product.id} product={product} vendorName={vendor.name} index={index} />)}</></div><CataloguePagination params={params} page={result.page} totalPages={result.totalPages} /></>
              ) : (
                <EmptyState icon="search" title={hasFilters ? "No products match these filters" : "No active products are available"} description={hasFilters ? "Try removing a filter, changing your price range, or using a shorter search term." : "Please check back when active vendors have added products to the catalogue."} />
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function EmptyState({ icon, title, description }: { icon: "search" | "store"; title: string; description: string }) {
  const Icon = icon === "search" ? SearchX : Store
  return <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 text-center"><Icon className="mx-auto size-10 text-zinc-400" /><h3 className="mt-4 font-semibold text-zinc-900">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">{description}</p><Link href="/products" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white">Clear all filters</Link></div>
}
