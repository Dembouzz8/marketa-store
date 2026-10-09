"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react"
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import type { Product } from "@/types"

function usableImages(images: string[]): string[] {
  return Array.from(
    new Set((images ?? []).map((image) => image.trim()).filter(Boolean))
  ).slice(0, 6)
}

export function ProductGallery({ product }: { product: Product }) {
  return <ProductGalleryContent key={product.id} product={product} />
}

function ProductGalleryContent({ product }: { product: Product }) {
  const images = useMemo(() => usableImages(product.images), [product.images])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [brokenImages, setBrokenImages] = useState<string[]>([])
  const selectedImage = images[selectedIndex] ?? images[0] ?? ""
  const selectedIsBroken = !selectedImage || brokenImages.includes(selectedImage)

  const markBroken = (image: string) => {
    setBrokenImages((current) =>
      current.includes(image) ? current : [...current, image]
    )
  }

  const showPreviousImage = () => {
    setSelectedIndex((current) => (current - 1 + images.length) % images.length)
  }

  const showNextImage = () => {
    setSelectedIndex((current) => (current + 1) % images.length)
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="relative h-[clamp(20rem,75vw,40rem)] w-full overflow-hidden rounded-xl bg-zinc-100 lg:h-[min(70vh,40rem)]">
        {selectedIsBroken ? (
          <ImageFallback />
        ) : (
          <Image
            src={selectedImage}
            alt={
              images.length > 1
                ? `${product.name}, image ${selectedIndex + 1} of ${images.length}`
                : product.name
            }
            fill
            priority
            unoptimized
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-contain"
            onError={() => markBroken(selectedImage)}
          />
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={showPreviousImage}
              className="absolute left-3 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              aria-label="View previous product image"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={showNextImage}
              className="absolute right-3 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              aria-label="View next product image"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
        <StockBadge stock={product.stock} />
      </div>

      {images.length > 1 && (
        <div className="flex max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-2 touch-pan-x [-webkit-overflow-scrolling:touch] sm:flex-wrap">
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={cn(
                "relative size-20 shrink-0 overflow-hidden rounded-lg border bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:size-24",
                selectedIndex === index
                  ? "border-amber-500 ring-2 ring-amber-500/20"
                  : "border-zinc-200 hover:border-zinc-400"
              )}
              aria-label={`View image ${index + 1} of ${images.length}`}
              aria-current={selectedIndex === index ? "true" : undefined}
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
