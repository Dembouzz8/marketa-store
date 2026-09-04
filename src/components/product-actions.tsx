"use client"

import { Minus, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useCartStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { Product } from "@/types"

export function ProductActions({ product }: { product: Product }) {
  const addItem = useCartStore((state) => state.addItem)
  const [quantity, setQuantity] = useState(1)
  const isOutOfStock = product.stock <= 0

  const handleAddToCart = () => {
    if (isOutOfStock) return

    for (let item = 0; item < quantity; item += 1) {
      addItem(product)
    }
  }

  return (
    <div className="space-y-5">
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

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-medium text-zinc-700">Quantity</span>
        <div className="flex items-center rounded-lg border border-zinc-200">
          <button
            type="button"
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}
            disabled={isOutOfStock || quantity <= 1}
            className="flex size-11 items-center justify-center text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
            aria-label="Decrease quantity"
          >
            <Minus className="size-4" />
          </button>
          <span className="w-12 text-center text-sm font-semibold" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((current) => Math.min(product.stock, current + 1))}
            disabled={isOutOfStock || quantity >= product.stock}
            className="flex size-11 items-center justify-center text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
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
        className="h-auto w-full rounded-xl bg-zinc-900 py-4 text-lg font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
      >
        {isOutOfStock ? "Out of Stock" : "Add to Cart"}
      </Button>
    </div>
  )
}
