"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Minus, Plus, RefreshCw, ShieldCheck, Truck } from "lucide-react"

import { CategoryFilter } from "@/components/category-filter"
import { ProductCard } from "@/components/product-card"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { useCartStore } from "@/lib/store"
import { cn, formatNaira, getProductImage } from "@/lib/utils"
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

export function ProductGallery({ product }: { product: Product }) {
  const images =
    product.images && product.images.length > 0
      ? product.images
      : [getProductImage(product.images)]
  const [selectedImage, setSelectedImage] = useState(images[0])

  return (
    <div className="space-y-4">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-zinc-50">
        <Image
          src={selectedImage}
          alt={product.name}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
        <span
          className={cn(
            "absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-medium text-white",
            product.stock > 5
              ? "bg-emerald-500"
              : product.stock > 0
                ? "bg-amber-500"
                : "bg-red-500"
          )}
        >
          {product.stock > 5
            ? "In Stock"
            : product.stock > 0
              ? "Low Stock"
              : "Out of Stock"}
        </span>
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-3">
          {images.map((image) => (
            <button
              key={image}
              type="button"
              onClick={() => setSelectedImage(image)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-zinc-50",
                selectedImage === image
                  ? "border-amber-500"
                  : "border-zinc-200 hover:border-zinc-400"
              )}
            >
              <Image
                src={image}
                alt={product.name}
                fill
                sizes="20vw"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProductActions({ product }: { product: Product }) {
  const addItem = useCartStore((state) => state.addItem)
  const [quantity, setQuantity] = useState(product.stock > 0 ? 1 : 0)
  const isOutOfStock = product.stock === 0

  const updateQuantity = (nextQuantity: number) => {
    setQuantity(Math.max(1, Math.min(product.stock, nextQuantity)))
  }

  const handleAddToCart = () => {
    if (isOutOfStock) {
      return
    }

    Array.from({ length: quantity }).forEach(() => addItem(product))
    toast({
      title: "Added to cart! 🛒",
      description: `${quantity} ${quantity === 1 ? "item" : "items"} added.`,
    })
  }

  return (
    <div className="space-y-6">
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
        {isOutOfStock ? "Out of stock" : `${product.stock} items available`}
      </p>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-zinc-700">Quantity</span>
        <div className="flex items-center rounded-lg border border-zinc-200">
          <button
            type="button"
            className="flex size-10 items-center justify-center text-zinc-600 transition-colors hover:bg-zinc-50 disabled:text-zinc-300"
            onClick={() => updateQuantity(quantity - 1)}
            disabled={quantity <= 1 || isOutOfStock}
            aria-label="Decrease quantity"
          >
            <Minus className="size-4" />
          </button>
          <span className="w-12 text-center text-sm font-semibold">
            {quantity}
          </span>
          <button
            type="button"
            className="flex size-10 items-center justify-center text-zinc-600 transition-colors hover:bg-zinc-50 disabled:text-zinc-300"
            onClick={() => updateQuantity(quantity + 1)}
            disabled={quantity >= product.stock || isOutOfStock}
            aria-label="Increase quantity"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <Button
        type="button"
        onClick={handleAddToCart}
        disabled={isOutOfStock}
        className="w-full rounded-xl bg-zinc-900 py-4 text-lg font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
      >
        Add to Cart
      </Button>

      <div className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 p-4">
        {[
          { icon: Truck, label: "Fast Delivery" },
          { icon: ShieldCheck, label: "Secure Payment" },
          { icon: RefreshCw, label: "Easy Returns" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex flex-col items-center gap-2 text-center text-xs text-zinc-500"
          >
            <item.icon className="size-5 text-amber-500" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
