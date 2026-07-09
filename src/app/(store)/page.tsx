import { Suspense } from "react"

import { Hero } from "@/components/hero"
import { ProductsSection } from "@/components/product-grid"
import ProductSkeleton from "@/components/product-skeleton"
import { supabase } from "@/lib/supabase"
import type { Product } from "@/types"

export const dynamic = "force-dynamic"

async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[products] query failed:', error)
    return []
  }

  console.log('[products] loaded:', data?.length ?? 0)
  return (data ?? []) as Product[]
}

export default async function Home() {
  const products = await getProducts()
  const categories = Array.from(
    new Set(
      products
        .map((product) => product.category)
        .filter((category): category is string => Boolean(category))
    )
  )

  return (
    <>
      <Hero />
      <section id="products" className="bg-white py-10 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-3xl font-semibold text-zinc-900">
                Browse Products
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                Discover hand-picked products from verified Nigerian vendors.
              </p>
            </div>
            <span className="w-fit rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900">
              {products.length} products
            </span>
          </div>
          <Suspense fallback={<ProductSkeleton />}>
            <ProductsSection products={products} categories={categories} />
          </Suspense>
        </div>
      </section>

      <section id="vendors" className="bg-zinc-50 py-10 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold text-zinc-900">
              Built for ambitious vendors
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Marketa helps Nigerian sellers reach more customers with a modern
              storefront, secure checkout, and simple order handoff.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
