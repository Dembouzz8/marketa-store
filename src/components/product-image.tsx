"use client"

import Image, { type ImageProps } from "next/image"
import { useState } from "react"

import { PRODUCT_IMAGE_FALLBACK } from "@/lib/utils"

type ProductImageProps = Omit<ImageProps, "src" | "onError"> & {
  src: string
}

export function ProductImage({ src, alt, ...props }: ProductImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const imageSource = failedSource === src ? PRODUCT_IMAGE_FALLBACK : src

  return (
    <Image
      {...props}
      src={imageSource}
      alt={alt}
      onError={() => {
        if (imageSource !== PRODUCT_IMAGE_FALLBACK) {
          setFailedSource(src)
        }
      }}
    />
  )
}
