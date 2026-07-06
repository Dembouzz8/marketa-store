"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { useCartStore } from "@/lib/store"
import { cn, formatNaira, getProductImage } from "@/lib/utils"
import type { Product } from "@/types"

interface ProductCardProps {
  product: Product
  index: number
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

export function ProductCard({ product, index }: ProductCardProps) {
  const router = useRouter()
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
      onClick={() => router.push(`/product/${product.id}`)}
      className="cursor-pointer overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm transition-shadow"
      role="link"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          router.push(`/product/${product.id}`)
        }
      }}
    >
      <div className="relative aspect-square overflow-hidden">
        <Image
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
      <div className="p-4">
        <h3 className="line-clamp-1 text-base font-semibold text-zinc-900">
          {product.name}
        </h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
          {product.description ?? "Premium product from a verified vendor"}
        </p>
        <p className="mt-2 text-lg font-bold text-amber-600">
          {formatNaira(product.price)}
        </p>
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
