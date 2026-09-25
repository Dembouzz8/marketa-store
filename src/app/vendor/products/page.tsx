import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { ProductsTable } from "@/components/vendor/products-table"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { Product } from "@/types"

type ActionResult = {
  error: string | null
}

async function getVendorContext() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, vendor: null }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, is_active")
    .eq("user_id", user.id)
    .single()

  return { supabase, vendor: vendor ?? null }
}

export default async function VendorProductsPage() {
  const { supabase, vendor } = await getVendorContext()

  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  const { data: productsData } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false })

  const products = (productsData ?? []) as Product[]
  const activeCount = products.filter((product) => product.is_active).length

  async function deleteProduct(productId: string): Promise<ActionResult> {
    "use server"

    const { supabase: actionSupabase, vendor: actionVendor } =
      await getVendorContext()

    if (!actionVendor) {
      return { error: "You must be signed in as a vendor." }
    }
    if (!actionVendor.is_active) {
      return { error: "Product management becomes available after seller activation." }
    }

    const { error } = await actionSupabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("vendor_id", actionVendor.id)

    if (error) {
      return { error: "Unable to delete the product. Please try again." }
    }

    revalidatePath("/vendor/products")
    return { error: null }
  }

  async function toggleProductActive(
    productId: string,
    isActive: boolean
  ): Promise<ActionResult> {
    "use server"

    const { supabase: actionSupabase, vendor: actionVendor } =
      await getVendorContext()

    if (!actionVendor) {
      return { error: "You must be signed in as a vendor." }
    }
    if (!actionVendor.is_active) {
      return { error: "Product management becomes available after seller activation." }
    }

    const { error } = await actionSupabase
      .from("products")
      .update({ is_active: isActive })
      .eq("id", productId)
      .eq("vendor_id", actionVendor.id)

    if (error) {
      return { error: "Unable to update the product. Please try again." }
    }

    revalidatePath("/vendor/products")
    return { error: null }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Products</h1>
        <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-900">
          {activeCount} active
        </span>
      </div>
      {!vendor.is_active && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your seller account is not active yet. You can review your products,
          but product management becomes available after activation.
        </p>
      )}
      {vendor.is_active ? (
        <ProductsTable
          products={products}
          canManage
          onDelete={deleteProduct}
          onToggleActive={toggleProductActive}
        />
      ) : (
        <ProductsTable products={products} canManage={false} />
      )}
    </div>
  )
}
