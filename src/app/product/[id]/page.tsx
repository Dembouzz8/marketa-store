import Link from "next/link"
import { notFound } from "next/navigation"

import { ProductActions, ProductGallery } from "@/components/product-grid"
import { Separator } from "@/components/ui/separator"
import { supabase } from "@/lib/supabase"
import { cn, formatNaira } from "@/lib/utils"
import type { Product } from "@/types"

export const dynamic = "force-dynamic"

async function getProduct(id: string) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL === "your_supabase_project_url") {
    return null
  }

  try {
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single()

    return product as Product | null
  } catch {
    return null
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await getProduct(id)

  if (!product) {
    notFound()
  }

  return (
    <div className="bg-white py-10 md:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="mb-8 inline-flex text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          ← Back to products
        </Link>

        <div className="grid gap-10 lg:grid-cols-2">
          <ProductGallery product={product} />

          <div className="space-y-6">
            <div className="text-sm text-zinc-500">
              <Link href="/" className="hover:text-zinc-900">
                Home
              </Link>
              <span className="mx-2">›</span>
              <span>{product.category ?? "Products"}</span>
              <span className="mx-2">›</span>
              <span className="text-zinc-700">{product.name}</span>
            </div>

            {product.category && (
              <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-600">
                {product.category}
              </span>
            )}

            <div>
              <h1 className="text-3xl font-bold text-zinc-900">
                {product.name}
              </h1>
              <p className="mt-4 text-4xl font-bold text-amber-600">
                {formatNaira(product.price)}
              </p>
            </div>

            <Separator />

            <div>
              <h2 className="mb-3 font-semibold text-zinc-900">
                Description
              </h2>
              <p className="leading-relaxed text-zinc-600">
                {product.description ??
                  "This verified vendor product is ready for checkout and delivery across Nigeria."}
              </p>
            </div>

            <p
              className={cn(
                "text-sm font-medium",
                product.stock > 5
                  ? "text-emerald-600"
                  : product.stock > 0
                    ? "text-amber-600"
                    : "text-red-500"
              )}
            >
              {product.stock > 0
                ? `${product.stock} items in stock`
                : "Out of stock"}
            </p>

            <ProductActions product={product} />
          </div>
        </div>
      </div>
    </div>
  )
}
