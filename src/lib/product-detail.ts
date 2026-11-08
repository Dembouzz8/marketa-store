import {
  getActiveVendors,
  PUBLIC_STOREFRONT_PRODUCT_FIELDS,
} from "@/lib/catalogue"
import { parsePublicProductVariantProjection } from "@/lib/public-product-variants"
import {
  categoryMatchesSlug,
  getCategoryDatabaseValues,
  STORE_CATEGORIES,
} from "@/lib/storefront"
import { supabase } from "@/lib/supabase"
import type {
  CatalogueProduct,
  PublicProductVariantProjection,
  StorefrontProduct,
} from "@/types"

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
  products: StorefrontProduct[],
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
  variantProjection: PublicProductVariantProjection | null
}> {
  const productResult = await supabase
    .from("public_storefront_products")
    .select(PUBLIC_STOREFRONT_PRODUCT_FIELDS)
    .eq("id", id)
    .maybeSingle()

  if (productResult.error) {
    logQueryError("product", productResult.error)
    throw new Error(`Unable to load product: ${productResult.error.message}`)
  }
  if (!productResult.data) {
    return {
      current: null,
      related: [],
      sameVendor: [],
      variantProjection: null,
    }
  }

  const product = productResult.data as StorefrontProduct
  const vendors = await getActiveVendors()
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]))
  const activeVendorIds = vendors.map((vendor) => vendor.id)
  const currentVendorName = vendorNames.get(product.vendor_id)

  if (!currentVendorName) {
    return {
      current: null,
      related: [],
      sameVendor: [],
      variantProjection: null,
    }
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
      .from("public_storefront_products")
      .select(PUBLIC_STOREFRONT_PRODUCT_FIELDS)
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
    related = attachVendors(
      (relatedResult.data ?? []) as StorefrontProduct[],
      vendorNames
    )
  }

  let sameVendorQuery = supabase
    .from("public_storefront_products")
    .select(PUBLIC_STOREFRONT_PRODUCT_FIELDS)
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

  let variantProjection: PublicProductVariantProjection | null = null
  if (product.variant_mode !== "none") {
    const projectionResult = await supabase.rpc(
      "get_public_product_variant_projection",
      { p_product_id: product.id }
    )

    if (projectionResult.error) {
      logQueryError("variant projection", projectionResult.error)
    } else {
      const parsed = parsePublicProductVariantProjection(
        projectionResult.data,
        product.id
      )
      if (parsed?.variant_mode === product.variant_mode) {
        variantProjection = parsed
      }
    }
  }

  return {
    current: {
      product,
      vendor: { id: product.vendor_id, name: currentVendorName },
    },
    related,
    sameVendor: attachVendors(
      (sameVendorResult.data ?? []) as StorefrontProduct[],
      vendorNames
    ),
    variantProjection,
  }
}
