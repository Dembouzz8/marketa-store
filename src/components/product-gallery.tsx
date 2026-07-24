"use client"

import Image from "next/image"
import { ImageOff } from "lucide-react"
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import type { Product } from "@/types"

function usableImages(images: string[]): string[] {
  return Array.from(
    new Set((images ?? []).map((image) => image.trim()).filter(Boolean))
  )
}

export function ProductGallery({ product }: { product: Product }) {
  const images = useMemo(() => usableImages(product.images), [product.images])
  const [selectedImage, setSelectedImage] = useState(images[0] ?? "")
  const [brokenImages, setBrokenImages] = useState<string[]>([])
  const selectedIsBroken = !selectedImage || brokenImages.includes(selectedImage)

  const markBroken = (image: string) => {
    setBrokenImages((current) =>
      current.includes(image) ? current : [...current, image]
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
        {selectedIsBroken ? (
          <ImageFallback />
        ) : (
          <Image
            src={selectedImage}
            alt={product.name}
            fill
            priority
            unoptimized
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
            onError={() => markBroken(selectedImage)}
          />
        )}
        <StockBadge stock={product.stock} />
      </div>

      {images.length > 1 && (
        <div className="flex max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-2 touch-pan-x [-webkit-overflow-scrolling:touch] sm:flex-wrap">
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setSelectedImage(image)}
              className={cn(
                "relative size-20 shrink-0 overflow-hidden rounded-lg border bg-zinc-100 sm:size-24",
                selectedImage === image
                  ? "border-amber-500 ring-2 ring-amber-500/20"
                  : "border-zinc-200 hover:border-zinc-400"
              )}
              aria-label={`View image ${index + 1} of ${images.length}`}
            >
              {brokenImages.includes(image) ? (
                <ImageOff className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-zinc-400" />
              ) : (
                <Image
                  src={image}
                  alt=""
                  fill
                  unoptimized
                  sizes="96px"
                  className="object-cover"
                  onError={() => markBroken(image)}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ImageFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
      <ImageOff className="size-12" />
      <span className="text-sm font-medium">Image unavailable</span>
    </div>
  )
}

function StockBadge({ stock }: { stock: number }) {
  const label = stock > 5 ? "In Stock" : stock > 0 ? "Low Stock" : "Out of Stock"
  return (
    <span
      className={cn(
        "absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-medium text-white",
        stock > 5 ? "bg-emerald-500" : stock > 0 ? "bg-amber-500" : "bg-red-500"
      )}
    >
      {label}
    </span>
  )
}
