import Link from "next/link"
import { X } from "lucide-react"

import { catalogueHref, type CatalogueParams } from "@/lib/catalogue"
import { getCategoryName } from "@/lib/storefront"
import { formatNaira } from "@/lib/utils"
import type { CatalogueVendor } from "@/types"

export function CatalogueActiveFilters({ params, vendors }: { params: CatalogueParams; vendors: CatalogueVendor[] }) {
  const filters = [
    params.q ? { key: "q", label: `Search: ${params.q}`, value: "" } : null,
    params.category ? { key: "category", label: getCategoryName(params.category) ?? params.category, value: "" } : null,
    params.vendor ? { key: "vendor", label: vendors.find((vendor) => vendor.id === params.vendor)?.name ?? "Vendor", value: "" } : null,
    params.minPrice !== null ? { key: "minPrice", label: `From ${formatNaira(params.minPrice)}`, value: null } : null,
    params.maxPrice !== null ? { key: "maxPrice", label: `Up to ${formatNaira(params.maxPrice)}`, value: null } : null,
    params.availability !== "all" ? { key: "availability", label: params.availability === "in-stock" ? "In stock" : "Out of stock", value: "all" } : null,
    params.sort !== "newest" ? { key: "sort", label: params.sort === "price-asc" ? "Lowest price" : "Highest price", value: "newest" } : null,
  ].filter(Boolean) as { key: keyof CatalogueParams; label: string; value: string | null }[]

  if (filters.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Active filters</span>
      {filters.map((filter) => (
        <Link key={filter.key} href={catalogueHref(params, { [filter.key]: filter.value, page: 1 })} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-zinc-100 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-200">
          {filter.label}<X className="size-3.5" />
        </Link>
      ))}
      <Link href="/products" className="min-h-9 px-2 py-2 text-xs font-semibold text-amber-700 hover:text-amber-800">Clear all</Link>
    </div>
  )
}
