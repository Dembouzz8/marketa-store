import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { ProductsTable } from "@/components/vendor/products-table"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { Product } from "@/types"

type ActionResult = {
  error: string | null
}

async function getVendorId() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, vendorId: null }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.id)
    .single()

  return { supabase, vendorId: vendor?.id ?? null }
}

export default async function VendorProductsPage() {
  const { supabase, vendorId } = await getVendorId()

  if (!vendorId) redirect("/vendor/login?error=not_a_vendor")

  const { data: productsData } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })

  const products = (productsData ?? []) as Product[]
  const activeCount = products.filter((product) => product.is_active).length

  async function deleteProduct(productId: string): Promise<ActionResult> {
    "use server"

    const { supabase: actionSupabase, vendorId: actionVendorId } =
      await getVendorId()

    if (!actionVendorId) {
      return { error: "You must be signed in as a vendor." }
    }

    const { error } = await actionSupabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("vendor_id", actionVendorId)

    if (error) return { error: error.message }

    revalidatePath("/vendor/products")
    return { error: null }
  }

  async function toggleProductActive(
    productId: string,
    isActive: boolean
  ): Promise<ActionResult> {
    "use server"

    const { supabase: actionSupabase, vendorId: actionVendorId } =
      await getVendorId()

    if (!actionVendorId) {
      return { error: "You must be signed in as a vendor." }
    }

    const { error } = await actionSupabase
      .from("products")
      .update({ is_active: isActive })
      .eq("id", productId)
      .eq("vendor_id", actionVendorId)

    if (error) return { error: error.message }

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
      <ProductsTable
        products={products}
        onDelete={deleteProduct}
        onToggleActive={toggleProductActive}
      />
    </div>
  )
}
