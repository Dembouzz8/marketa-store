import Link from "next/link"
import { redirect } from "next/navigation"

import { ProductForm } from "@/components/vendor/product-form"
import { ProductVariantsManager } from "@/components/vendor/product-variants-manager"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { ProductVariant, VendorProduct } from "@/types"

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/vendor/login")

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, is_active")
    .eq("user_id", user.id)
    .single()

  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  if (!vendor.is_active) {
    return (
      <div className="space-y-6">
        <Link
          href="/vendor/products"
          className="inline-flex text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          ← Back to Products
        </Link>
        <section className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-2xl font-semibold text-zinc-900">
            Seller activation required
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            Your seller account is not active yet. Product editing becomes
            available after activation.
          </p>
        </section>
      </div>
    )
  }

  const { data: productData } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("vendor_id", vendor.id)
    .single()

  if (!productData) redirect("/vendor/products")

  const product = productData as VendorProduct
  const { data: variantsData, error: variantsError } = await supabase
    .from("product_variants")
    .select(
      "id, product_id, vendor_id, size, colour, size_normalized, colour_normalized, stock, stock_version, is_active, created_at, updated_at"
    )
    .eq("product_id", product.id)
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: true })

  const variants = (variantsData ?? []) as ProductVariant[]

  async function handleSuccess() {
    "use server"
    redirect("/vendor/products")
  }

  return (
    <div className="space-y-6">
      <Link
        href="/vendor/products"
        className="inline-flex text-sm font-medium text-zinc-500 hover:text-zinc-900"
      >
        ← Back to Products
      </Link>
      <h1 className="text-2xl font-semibold text-zinc-900">Edit Product</h1>
      <ProductForm
        product={product}
        vendorId={vendor.id}
        onSuccess={handleSuccess}
      />
      <ProductVariantsManager
        key={`${product.id}:${product.variant_mode}`}
        product={product}
        initialVariants={variants}
        initialLoadFailed={Boolean(variantsError)}
      />
    </div>
  )
}
