import { getActiveVendors } from "@/lib/catalogue"
import {
  categoryMatchesSlug,
  getCategoryDatabaseValues,
  STORE_CATEGORIES,
} from "@/lib/storefront"
import { supabase } from "@/lib/supabase"
import type { CatalogueProduct, Product } from "@/types"

const PRODUCT_FIELDS =
  "id, vendor_id, name, description, price, stock, category, images, is_active, created_at"

export function isProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function logQueryError(
  operation: string,
  error: { message: string; code?: string; details?: string; hint?: string }
) {
  console.error(`[product detail ${operation}] query failed`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  })
}

function attachVendors(
  products: Product[],
  vendorNames: Map<string, string>
): CatalogueProduct[] {
  return products.map((product) => {
    const name = vendorNames.get(product.vendor_id)
    if (!name) {
      throw new Error(`Public vendor missing for product ${product.id}`)
    }
    return { product, vendor: { id: product.vendor_id, name } }
  })
}

export async function getProductDetail(id: string): Promise<{
  current: CatalogueProduct | null
  related: CatalogueProduct[]
  sameVendor: CatalogueProduct[]
}> {
  const productResult = await supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle()

  if (productResult.error) {
    logQueryError("product", productResult.error)
    throw new Error(`Unable to load product: ${productResult.error.message}`)
  }
  if (!productResult.data) {
    return { current: null, related: [], sameVendor: [] }
  }

  const product = productResult.data as Product
  const vendors = await getActiveVendors()
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]))
  const activeVendorIds = vendors.map((vendor) => vendor.id)
  const currentVendorName = vendorNames.get(product.vendor_id)

  if (!currentVendorName) {
    return { current: null, related: [], sameVendor: [] }
  }

  let related: CatalogueProduct[] = []
  if (product.category) {
    const categorySlug = STORE_CATEGORIES.find((category) =>
      categoryMatchesSlug(product.category!, category.slug)
    )?.slug
    const categoryValues = categorySlug
      ? getCategoryDatabaseValues(categorySlug)
      : [product.category]

    const relatedResult = await supabase
      .from("products")
      .select(PRODUCT_FIELDS)
      .eq("is_active", true)
      .or(categoryValues.map((value) => `category.ilike.${value}`).join(","))
      .in("vendor_id", activeVendorIds)
      .neq("id", product.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(4)

    if (relatedResult.error) {
      logQueryError("related products", relatedResult.error)
      throw new Error(
        `Unable to load related products: ${relatedResult.error.message}`
      )
    }
    related = attachVendors((relatedResult.data ?? []) as Product[], vendorNames)
  }

  let sameVendorQuery = supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("is_active", true)
    .eq("vendor_id", product.vendor_id)
    .neq("id", product.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(4)

  const relatedIds = related.map((item) => item.product.id)
  if (relatedIds.length > 0) {
    sameVendorQuery = sameVendorQuery.not("id", "in", `(${relatedIds.join(",")})`)
  }

  const sameVendorResult = await sameVendorQuery
  if (sameVendorResult.error) {
    logQueryError("same-vendor products", sameVendorResult.error)
    throw new Error(
      `Unable to load vendor products: ${sameVendorResult.error.message}`
    )
  }

  return {
    current: {
      product,
      vendor: { id: product.vendor_id, name: currentVendorName },
    },
    related,
    sameVendor: attachVendors(
      (sameVendorResult.data ?? []) as Product[],
      vendorNames
    ),
  }
}
