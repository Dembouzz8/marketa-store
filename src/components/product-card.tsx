"use client"

import { motion } from "framer-motion"
import Link from "next/link"

import { ProductImage } from "@/components/product-image"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { useCartStore } from "@/lib/store"
import { cn, formatNaira, getProductImage } from "@/lib/utils"
import type { Product } from "@/types"

interface ProductCardProps {
  product: Product
  index: number
  vendorName?: string
}

function getStockBadge(product: Product) {
  if (product.stock > 5) {
    return {
      label: "In Stock",
      className: "bg-emerald-500 text-white",
    }
  }

  if (product.stock > 0) {
    return {
      label: "Low Stock",
      className: "bg-amber-500 text-white",
    }
  }

  return {
    label: "Out of Stock",
    className: "bg-red-500 text-white",
  }
}

export function ProductCard({ product, index, vendorName }: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem)
  const stockBadge = getStockBadge(product)
  const isOutOfStock = product.stock === 0

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (isOutOfStock) {
      return
    }

    addItem(product)
    toast({ title: "Added to cart! 🛒" })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{
        scale: 1.01,
        boxShadow:
          "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
      }}
      className="overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition-shadow"
    >
      <Link
        href={`/products/${product.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500"
      >
        <div className="relative aspect-square overflow-hidden">
          <ProductImage
            src={getProductImage(product.images)}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="object-cover"
          />
          {product.category && (
            <span className="absolute left-3 top-3 rounded-full bg-zinc-800/80 px-2.5 py-1 text-xs text-white">
              {product.category}
            </span>
          )}
          <span
            className={cn(
              "absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs",
              stockBadge.className
            )}
          >
            {stockBadge.label}
          </span>
          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 text-sm font-semibold text-white">
              Out of Stock
            </div>
          )}
        </div>
        <div className="px-4 pt-4">
          <h3 className="line-clamp-1 text-base font-semibold text-zinc-900">
            {product.name}
          </h3>
          {vendorName && (
            <p className="mt-1 line-clamp-1 text-xs font-medium text-zinc-600">
              Sold by {vendorName}
            </p>
          )}
          <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
            {product.description ?? "Product description not provided"}
          </p>
          <p className="mt-2 text-lg font-bold text-amber-600">
            {formatNaira(product.price)}
          </p>
        </div>
      </Link>
      <div className="p-4 pt-0">
        <Button
          type="button"
          onClick={handleAddToCart}
          disabled={isOutOfStock}
          className={cn(
            "mt-3 w-full rounded-lg",
            isOutOfStock
              ? "cursor-not-allowed bg-zinc-200 text-zinc-400"
              : "bg-zinc-900 text-white hover:bg-zinc-700"
          )}
        >
          Add to Cart
        </Button>
      </div>
    </motion.div>
  )
}
