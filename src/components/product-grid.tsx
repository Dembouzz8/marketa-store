"use client"

import { useMemo, useState } from "react"
import { motion } from "framer-motion"

import { CategoryFilter } from "@/components/category-filter"
import { ProductCard } from "@/components/product-card"
import type { Product } from "@/types"

interface ProductsSectionProps {
  products: Product[]
  categories: string[]
}

export function ProductsSection({
  products,
  categories,
}: ProductsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState("All")

  const filteredProducts = useMemo(() => {
    if (selectedCategory === "All") {
      return products
    }

    return products.filter((product) => product.category === selectedCategory)
  }, [products, selectedCategory])

  return (
    <div className="space-y-8">
      <CategoryFilter
        categories={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />

      {filteredProducts.length > 0 ? (
        <motion.div
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4"
        >
          {filteredProducts.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </motion.div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
          <p className="font-semibold text-zinc-900">No products found</p>
          <p className="mt-2 text-sm text-zinc-500">
            Try another category or check back soon.
          </p>
        </div>
      )}
    </div>
  )
}
