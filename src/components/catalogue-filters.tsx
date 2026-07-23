import { Filter } from "lucide-react"

import { CatalogueMobileFilters } from "@/components/catalogue-mobile-filters"
import { STORE_CATEGORIES } from "@/lib/storefront"
import type { CatalogueParams } from "@/lib/catalogue"
import type { CatalogueVendor } from "@/types"

export function CatalogueFilters({
  params,
  vendors,
}: {
  params: CatalogueParams
  vendors: CatalogueVendor[]
}) {
  return (
    <>
      <div className="lg:hidden">
        <CatalogueMobileFilters>
          <FilterFields params={params} vendors={vendors} />
        </CatalogueMobileFilters>
      </div>
      <aside className="hidden lg:block" aria-label="Product filters">
        <form action="/products" className="sticky top-24 space-y-5 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-amber-600" />
            <h2 className="font-semibold text-zinc-900">Filters</h2>
          </div>
          <FilterFields params={params} vendors={vendors} />
          <button className="min-h-11 w-full rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700">
            Apply filters
          </button>
          <a href="/products" className="flex min-h-11 items-center justify-center text-sm font-semibold text-zinc-600 hover:text-zinc-900">
            Clear all
          </a>
        </form>
      </aside>
    </>
  )
}

export function FilterFields({ params, vendors }: { params: CatalogueParams; vendors: CatalogueVendor[] }) {
  return (
    <div className="space-y-4">
      {params.q && <input type="hidden" name="q" value={params.q} />}
      <label className="block text-sm font-medium text-zinc-700">
        Category
        <select name="category" defaultValue={params.category} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
          <option value="">All categories</option>
          {STORE_CATEGORIES.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-zinc-700">
        Vendor
        <select name="vendor" defaultValue={params.vendor} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
          <option value="">All vendors</option>
          {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-zinc-700">Min price<input name="minPrice" type="number" min="0" defaultValue={params.minPrice ?? ""} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3" /></label>
        <label className="text-sm font-medium text-zinc-700">Max price<input name="maxPrice" type="number" min="0" defaultValue={params.maxPrice ?? ""} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3" /></label>
      </div>
      <label className="block text-sm font-medium text-zinc-700">
        Availability
        <select name="availability" defaultValue={params.availability} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
          <option value="all">All</option><option value="in-stock">In stock</option><option value="out-of-stock">Out of stock</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-zinc-700">
        Sort by
        <select name="sort" defaultValue={params.sort} className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
          <option value="newest">Newest</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option>
        </select>
      </label>
    </div>
  )
}
