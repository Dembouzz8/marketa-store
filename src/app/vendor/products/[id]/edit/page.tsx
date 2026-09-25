import Link from "next/link"
import { redirect } from "next/navigation"

import { ProductForm } from "@/components/vendor/product-form"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { Product } from "@/types"

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
        product={productData as Product}
        vendorId={vendor.id}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
