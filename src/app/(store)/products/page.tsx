import type { Metadata } from "next"
import Link from "next/link"
import { Search, SearchX } from "lucide-react"

import { ProductCard } from "@/components/product-card"
import {
  categoryMatchesSlug,
  getCategoryName,
  STORE_CATEGORIES,
} from "@/lib/storefront"
import { supabase } from "@/lib/supabase"
import type { Product } from "@/types"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Products | Marketa",
  description: "Search products available from vendors on Marketa.",
}

interface VendorName {
  id: string
  name: string
}

interface ProductsPageProps {
  searchParams: Promise<{
    q?: string | string[]
    category?: string | string[]
  }>
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function productsHref({
  query,
  category,
}: {
  query?: string
  category?: string
} = {}): string {
  const params = new URLSearchParams()

  if (query) {
    params.set("q", query)
  }

  if (category) {
    params.set("category", category)
  }

  const search = params.toString()
  return search ? `/products?${search}` : "/products"
}

async function getCatalogueData(): Promise<{
  products: Product[]
  vendors: VendorName[]
  hasError: boolean
}> {
  const [productsResult, vendorsResult] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase.from("vendors").select("id, name").eq("is_active", true),
  ])

  if (productsResult.error) {
    console.error("[catalogue products] query failed:", productsResult.error)
  }

  if (vendorsResult.error) {
    console.error("[catalogue vendors] query failed:", vendorsResult.error)
  }

  return {
    products: (productsResult.data ?? []) as Product[],
    vendors: (vendorsResult.data ?? []) as VendorName[],
    hasError: Boolean(productsResult.error),
  }
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams
  const query = firstParam(params.q).trim()
  const category = firstParam(params.category).trim().toLowerCase()
  const { products, vendors, hasError } = await getCatalogueData()
  const vendorNames = new Map(
    vendors.map((vendor) => [vendor.id, vendor.name.toLowerCase()])
  )
  const normalizedQuery = query.toLowerCase()

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !category ||
      (product.category
        ? categoryMatchesSlug(product.category, category)
        : false)

    if (!matchesCategory) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const searchableText = [
      product.name,
      product.description ?? "",
      product.category ?? "",
      vendorNames.get(product.vendor_id) ?? "",
    ]
      .join(" ")
      .toLowerCase()

    return searchableText.includes(normalizedQuery)
  })

  const activeCategoryName =
    getCategoryName(category) ??
    products.find(
      (product) =>
        product.category && categoryMatchesSlug(product.category, category)
    )?.category ??
    null

  return (
    <main className="min-h-screen bg-white">
      <section className="border-b border-zinc-200 bg-zinc-950 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
            Marketa catalogue
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {query ? `Search results for “${query}”` : "Find your next purchase"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
            Search by product, description, category, or vendor name.
          </p>

          <form
            action="/products"
            className="mt-7 flex max-w-2xl flex-col gap-3 sm:flex-row"
          >
            <label className="relative flex-1">
              <span className="sr-only">Search products</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search products, categories, or vendors"
                className="min-h-12 w-full rounded-lg border border-white/10 bg-white py-3 pl-12 pr-4 text-base text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
              />
            </label>
            {category && <input type="hidden" name="category" value={category} />}
            <button
              type="submit"
              className="min-h-12 rounded-lg bg-amber-500 px-7 font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <section id="categories" className="border-b border-zinc-200 bg-zinc-50 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">
            <Link
              href={productsHref({ query })}
              className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors ${
                !category
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              }`}
            >
              All categories
            </Link>
            {STORE_CATEGORIES.map((item) => (
              <Link
                key={item.slug}
                href={productsHref({ query, category: item.slug })}
                className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors ${
                  category === item.slug
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
                }`}
              >
                <span className="mr-2" aria-hidden="true">
                  {item.icon}
                </span>
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-900">
                {activeCategoryName ?? (query ? "Matching products" : "All Products")}
              </h2>
              {(query || category) && (
                <p className="mt-2 text-sm text-zinc-600">
                  Showing products that match your current search.
                </p>
              )}
            </div>
            {(query || category) && (
              <Link
                href="/products"
                className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-amber-700 hover:text-amber-800"
              >
                Clear search and category
              </Link>
            )}
          </div>

          {hasError ? (
            <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-6 py-14 text-center">
              <h3 className="font-semibold text-zinc-900">
                We could not load the catalogue
              </h3>
              <p className="mt-2 text-sm text-zinc-600">
                Please try again. Your cart has not been affected.
              </p>
              <Link
                href={productsHref({ query, category })}
                className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-700"
              >
                Try Again
              </Link>
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {filteredProducts.map((product, index) => (
                <ProductCard key={product.id} product={product} index={index} />
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 text-center">
              <SearchX className="mx-auto size-10 text-zinc-400" />
              <h3 className="mt-4 font-semibold text-zinc-900">
                No products matched your search
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
                Try a shorter search term, choose another category, or browse the
                full catalogue.
              </p>
              <Link
                href="/products"
                className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-700"
              >
                Browse All Products
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
