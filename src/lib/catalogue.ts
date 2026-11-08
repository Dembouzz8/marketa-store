import { getCategoryDatabaseValues, STORE_CATEGORIES } from "@/lib/storefront"
import { supabase } from "@/lib/supabase"
import type {
  CatalogueProduct,
  CatalogueVendor,
  PublicVendor,
  StorefrontProduct,
} from "@/types"

export const CATALOGUE_PAGE_SIZE = 24
const MAX_CATALOGUE_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / CATALOGUE_PAGE_SIZE)

const PUBLIC_VENDOR_FIELDS =
  "id, name, slug, description, main_category, location, shipping_info, return_info, is_verified"

export const PUBLIC_STOREFRONT_PRODUCT_FIELDS =
  "id, vendor_id, name, description, price, stock, category, images, is_active, created_at, variant_mode, available_stock, has_in_stock_combination"

export const AVAILABILITY_VALUES = ["all", "in-stock", "out-of-stock"] as const
export const SORT_VALUES = ["newest", "price-asc", "price-desc"] as const

export type Availability = (typeof AVAILABILITY_VALUES)[number]
export type CatalogueSort = (typeof SORT_VALUES)[number]

export interface CatalogueParams {
  q: string
  category: string
  vendor: string
  minPrice: number | null
  maxPrice: number | null
  availability: Availability
  sort: CatalogueSort
  page: number
}

export type RawCatalogueParams = Record<string, string | string[] | undefined>

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function price(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function uuid(value: string): string {
  const normalized = value.trim().toLowerCase()
  return isUuid(normalized) ? normalized : ""
}

export function parseCataloguePage(value: string): number {
  const normalized = value.trim()
  if (!/^\d+$/u.test(normalized)) return 1

  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_CATALOGUE_PAGE
    ? parsed
    : 1
}

export function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
}

function escapePostgresLikeLiteral(value: string): string {
  return value.replace(/[\\%_*]/g, "\\$&")
}

function quotePostgrestFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export function buildCatalogueSearchFilter(
  searchTerm: string,
  matchingVendorIds: string[] = []
): string {
  // The first escape layer makes customer punctuation literal to PostgreSQL
  // ILIKE. The second protects the quoted operand in PostgREST's OR grammar.
  const pattern = quotePostgrestFilterValue(`%${escapePostgresLikeLiteral(searchTerm)}%`)
  const filters = [
    `name.ilike.${pattern}`,
    `description.ilike.${pattern}`,
    `category.ilike.${pattern}`,
  ]

  if (matchingVendorIds.length > 0) {
    filters.push(`vendor_id.in.(${matchingVendorIds.join(",")})`)
  }

  return filters.join(",")
}

export function parseCatalogueParams(raw: RawCatalogueParams): CatalogueParams {
  const categoryValue = first(raw.category).trim().toLowerCase()
  const category = STORE_CATEGORIES.some((item) => item.slug === categoryValue)
    ? categoryValue
    : ""
  const availabilityValue = first(raw.availability)
  const sortValue = first(raw.sort)
  let minPrice = price(first(raw.minPrice))
  let maxPrice = price(first(raw.maxPrice))

  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    ;[minPrice, maxPrice] = [maxPrice, minPrice]
  }

  return {
    q: normalizeSearchTerm(first(raw.q)),
    category,
    vendor: uuid(first(raw.vendor)),
    minPrice,
    maxPrice,
    availability: AVAILABILITY_VALUES.includes(availabilityValue as Availability)
      ? (availabilityValue as Availability)
      : "all",
    sort: SORT_VALUES.includes(sortValue as CatalogueSort)
      ? (sortValue as CatalogueSort)
      : "newest",
    page: parseCataloguePage(first(raw.page)),
  }
}

export function catalogueHref(
  params: CatalogueParams,
  changes: Partial<Record<keyof CatalogueParams, string | number | null>> = {}
): string {
  const next = { ...params, ...changes }
  const search = new URLSearchParams()

  if (next.q) search.set("q", String(next.q))
  if (next.category) search.set("category", String(next.category))
  if (next.vendor) search.set("vendor", String(next.vendor))
  if (next.minPrice !== null) search.set("minPrice", String(next.minPrice))
  if (next.maxPrice !== null) search.set("maxPrice", String(next.maxPrice))
  if (next.availability !== "all") search.set("availability", String(next.availability))
  if (next.sort !== "newest") search.set("sort", String(next.sort))
  if (Number(next.page) > 1) search.set("page", String(next.page))

  const query = search.toString()
  return query ? `/products?${query}` : "/products"
}

export async function getActiveVendors(): Promise<PublicVendor[]> {
  const { data, error } = await supabase
    .from("public_active_vendors")
    .select(PUBLIC_VENDOR_FIELDS)
    .order("name", { ascending: true })

  if (error) {
    console.error("[catalogue vendor projection] query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error(`Unable to load vendors: ${error.message}`)
  }
  return (data ?? []) as PublicVendor[]
}

export async function getActiveVendorById(
  vendorId: string
): Promise<PublicVendor | null> {
  const { data, error } = await supabase
    .from("public_active_vendors")
    .select(PUBLIC_VENDOR_FIELDS)
    .eq("id", vendorId)
    .maybeSingle()

  if (error) {
    console.error("[public vendor storefront] vendor query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error("Unable to load the vendor storefront.")
  }

  return data as PublicVendor | null
}

export async function getActiveProductsByVendorId(
  vendorId: string
): Promise<StorefrontProduct[]> {
  const { data, error } = await supabase
    .from("public_storefront_products")
    .select(PUBLIC_STOREFRONT_PRODUCT_FIELDS)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })

  if (error) {
    console.error("[public vendor storefront] products query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error("Unable to load products for this vendor storefront.")
  }

  return (data ?? []) as StorefrontProduct[]
}

export async function getCatalogue(
  params: CatalogueParams,
  vendors: CatalogueVendor[]
): Promise<{ products: CatalogueProduct[]; total: number; page: number; totalPages: number }> {
  const activeVendorIds = vendors.map((vendor) => vendor.id)
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]))

  if (activeVendorIds.length === 0) {
    return { products: [], total: 0, page: 1, totalPages: 1 }
  }

  const matchingVendorIds = params.q
    ? vendors
        .filter((vendor) => vendor.name.toLocaleLowerCase().includes(params.q.toLocaleLowerCase()))
        .map((vendor) => vendor.id)
    : []

  const categoryValues = getCategoryDatabaseValues(params.category)
  const createFilteredCatalogueQuery = (head: boolean) => {
    const table = supabase.from("public_storefront_products")
    let filteredQuery = (
      head
        ? table.select("id", { count: "exact", head: true })
        : table.select(PUBLIC_STOREFRONT_PRODUCT_FIELDS, { count: "exact" })
    ).in("vendor_id", activeVendorIds)

    if (params.q) {
      filteredQuery = filteredQuery.or(buildCatalogueSearchFilter(params.q, matchingVendorIds))
    }
    if (categoryValues.length > 0) {
      filteredQuery = filteredQuery.or(
        categoryValues.map((value) => `category.ilike.${value}`).join(",")
      )
    }
    if (params.vendor) filteredQuery = filteredQuery.eq("vendor_id", params.vendor)
    if (params.minPrice !== null) filteredQuery = filteredQuery.gte("price", params.minPrice)
    if (params.maxPrice !== null) filteredQuery = filteredQuery.lte("price", params.maxPrice)
    if (params.availability === "in-stock") filteredQuery = filteredQuery.gt("available_stock", 0)
    if (params.availability === "out-of-stock") filteredQuery = filteredQuery.eq("available_stock", 0)

    return filteredQuery
  }

  let query = createFilteredCatalogueQuery(false)

  if (params.sort === "price-asc") query = query.order("price", { ascending: true })
  else if (params.sort === "price-desc") query = query.order("price", { ascending: false })
  else query = query.order("created_at", { ascending: false })
  query = query.order("id", { ascending: true })

  const requestedFrom = (params.page - 1) * CATALOGUE_PAGE_SIZE
  const rangeResult = await query.range(
    requestedFrom,
    requestedFrom + CATALOGUE_PAGE_SIZE - 1
  )
  let { data, error, count } = rangeResult

  if (error?.code === "PGRST103") {
    const countResult = await createFilteredCatalogueQuery(true)
    if (
      !countResult.error &&
      typeof countResult.count === "number" &&
      requestedFrom >= countResult.count
    ) {
      data = []
      error = null
      count = countResult.count
    }
  }

  if (error) {
    console.error("[catalogue products] query failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error(`Unable to load catalogue: ${error.message}`)
  }

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / CATALOGUE_PAGE_SIZE))
  const page = Math.min(params.page, totalPages)
  const rows = (data ?? []) as StorefrontProduct[]
  return {
    products: rows.map((product) => {
      const vendorName = vendorNames.get(product.vendor_id)
      if (!vendorName) {
        throw new Error(`Active vendor projection missing for product ${product.id}`)
      }
      return {
        product,
        vendor: { id: product.vendor_id, name: vendorName },
      }
    }),
    total,
    page,
    totalPages,
  }
}
