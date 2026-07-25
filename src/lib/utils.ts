import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export const PRODUCT_IMAGE_FALLBACK = "/product-placeholder.svg"

export function getProductImage(images: string[], index = 0): string {
  if (images && images.length > index && images[index]) {
    return images[index]
  }
  return PRODUCT_IMAGE_FALLBACK
}
