"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import type { Product } from "@/types"

interface ProductFormProps {
  product?: Product
  vendorId: string
  onSuccess: () => Promise<void>
}

type FormErrors = Partial<
  Record<"name" | "price" | "stock" | "images" | "form", string>
>

const categories = [
  "Fashion",
  "Electronics",
  "Food & Drinks",
  "Beauty",
  "Home & Living",
  "Sports",
  "Others",
]

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_PRODUCT_IMAGES = 6

const imageExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

function getImageExtension(mimeType: string) {
  return imageExtensions[mimeType as keyof typeof imageExtensions] ?? null
}

type ProductImageItem =
  | {
      id: string
      kind: "existing"
      url: string
    }
  | {
      id: string
      kind: "new"
      file: File
      previewUrl: string
    }

export function ProductForm({ product, vendorId, onSuccess }: ProductFormProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [name, setName] = useState(product?.name ?? "")
  const [description, setDescription] = useState(product?.description ?? "")
  const [price, setPrice] = useState(
    product ? String(Number(product.price)) : ""
  )
  const [stock, setStock] = useState(product ? String(product.stock) : "")
  const [category, setCategory] = useState(product?.category ?? categories[0])
  const [isActive, setIsActive] = useState(product?.is_active ?? false)
  const [imageItems, setImageItems] = useState<ProductImageItem[]>(() =>
    (product?.images ?? []).map((url, index) => ({
      id: `existing-${product?.id ?? "new"}-${index}`,
      kind: "existing",
      url,
    }))
  )
  const [errors, setErrors] = useState<FormErrors>({})
  const [isPending, startTransition] = useTransition()
  const previewUrls = useRef(new Set<string>())
  const remainingImageSlots = Math.max(0, MAX_PRODUCT_IMAGES - imageItems.length)

  useEffect(() => {
    const urls = previewUrls.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  const validate = () => {
    const nextErrors: FormErrors = {}
    const numericPrice = Number(price)
    const numericStock = Number(stock)

    if (name.trim().length < 3) {
      nextErrors.name = "Product name must be at least 3 characters."
    }
    if (!price || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      nextErrors.price = "Price must be greater than zero."
    }
    if (!stock || !Number.isFinite(numericStock) || numericStock < 0) {
      nextErrors.stock = "Stock must be zero or greater."
    }
    if (imageItems.length > MAX_PRODUCT_IMAGES) {
      nextErrors.images = "You can upload a maximum of 6 images."
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    const allowedFiles = files.filter((file) => getImageExtension(file.type))
    event.target.value = ""

    if (allowedFiles.length !== files.length) {
      setErrors((current) => ({
        ...current,
        images: "Only JPEG, PNG, and WebP images are supported.",
      }))
      return
    }

    if (allowedFiles.some((file) => file.size > MAX_IMAGE_SIZE_BYTES)) {
      setErrors((current) => ({
        ...current,
        images: "Each image must be 5 MiB or smaller.",
      }))
      return
    }

    if (allowedFiles.length > remainingImageSlots) {
      setErrors((current) => ({
        ...current,
        images: `You can add ${remainingImageSlots} more image${
          remainingImageSlots === 1 ? "" : "s"
        }. Products support a maximum of 6 images.`,
      }))
      return
    }

    const newItems = allowedFiles.map((file) => {
      const previewUrl = URL.createObjectURL(file)
      previewUrls.current.add(previewUrl)
      return {
        id: `new-${crypto.randomUUID()}`,
        kind: "new" as const,
        file,
        previewUrl,
      }
    })

    setErrors((current) => ({ ...current, images: undefined }))
    setImageItems((current) => [...current, ...newItems])
  }

  const moveImage = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= imageItems.length) {
      return
    }

    setImageItems((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  const removeImage = (id: string) => {
    const item = imageItems.find((candidate) => candidate.id === id)
    if (item?.kind === "new") {
      URL.revokeObjectURL(item.previewUrl)
      previewUrls.current.delete(item.previewUrl)
    }
    setImageItems((current) =>
      current.filter((candidate) => candidate.id !== id)
    )
    setErrors((current) => ({ ...current, images: undefined }))
  }

  const uploadImages = async (items: ProductImageItem[]) => {
    const uploadedImages = await Promise.all(
      items
        .filter(
          (item): item is Extract<ProductImageItem, { kind: "new" }> =>
            item.kind === "new"
        )
        .map(async (item) => {
          const extension = getImageExtension(item.file.type)
          if (!extension) throw new Error("Unsupported image type.")

          const path = `${vendorId}/${crypto.randomUUID()}.${extension}`
          const { error } = await supabase.storage
            .from("product-images")
            .upload(path, item.file)

          if (error) throw error

          const { data } = supabase.storage
            .from("product-images")
            .getPublicUrl(path)

          return [item.id, data.publicUrl] as const
        })
    )

    return new Map(uploadedImages)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!validate()) return

    startTransition(async () => {
      setErrors({})
      let saveStage: "upload" | "product" = "upload"

      try {
        const uploadedImages = await uploadImages(imageItems)
        const imageUrls = imageItems.map((item) =>
          item.kind === "existing" ? item.url : uploadedImages.get(item.id) ?? ""
        )

        if (
          imageUrls.length > MAX_PRODUCT_IMAGES ||
          imageUrls.some((url) => !url)
        ) {
          throw new Error("Invalid product image state.")
        }

        const payload = {
          vendor_id: vendorId,
          name: name.trim(),
          description: description.trim() || null,
          price: Number(price),
          stock: Number(stock),
          category,
          images: imageUrls,
          is_active: isActive,
        }

        saveStage = "product"
        const { error } = product
          ? await supabase
              .from("products")
              .update(payload)
              .eq("id", product.id)
              .eq("vendor_id", vendorId)
          : await supabase.from("products").insert(payload)

        if (error) throw error

        toast({ title: product ? "Product updated" : "Product created" })
        await onSuccess()
      } catch {
        const message =
          saveStage === "upload"
            ? "We couldn't upload the product images. Please try again."
            : "We couldn't save the product. Please try again."
        setErrors({ form: message })
        toast({
          title: "Could not save product",
          description: message,
          variant: "destructive",
        })
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-3xl space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      {errors.form && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {errors.form}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Product Name
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-11 rounded-lg border-zinc-200"
            required
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-500">{errors.name}</p>
          )}
        </label>

        <label className="sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Description
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500"
          />
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Price in Naira
          </span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-500">
              ₦
            </span>
            <Input
              type="number"
              value={price}
              min={1}
              onChange={(event) => setPrice(event.target.value)}
              className="h-11 rounded-lg border-zinc-200 pl-8"
              required
            />
          </div>
          {errors.price && (
            <p className="mt-1 text-xs text-red-500">{errors.price}</p>
          )}
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Stock Quantity
          </span>
          <Input
            type="number"
            value={stock}
            min={0}
            onChange={(event) => setStock(event.target.value)}
            className="h-11 rounded-lg border-zinc-200"
            required
          />
          {errors.stock && (
            <p className="mt-1 text-xs text-red-500">{errors.stock}</p>
          )}
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Category
          </span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-amber-500"
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            Status
          </span>
          <button
            type="button"
            onClick={() => setIsActive((value) => !value)}
            className={cn(
              "flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium",
              isActive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-500"
            )}
          >
            <span>{isActive ? "Active" : "Inactive"}</span>
            <span
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
                isActive ? "bg-emerald-500" : "bg-zinc-300"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1 size-4 rounded-full bg-white transition-transform",
                  isActive ? "translate-x-6" : "translate-x-1"
                )}
              />
            </span>
          </button>
        </label>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-zinc-700">
          Images
        </span>
        <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center transition-colors hover:border-amber-500 hover:bg-amber-50">
          <ImagePlus className="size-8 text-zinc-400" />
          <span className="mt-2 text-sm font-medium text-zinc-700">
            Upload product images
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            JPEG, PNG, or WebP. Maximum 6 images. {remainingImageSlots} slot
            {remainingImageSlots === 1 ? "" : "s"} remaining.
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={isPending}
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
        {errors.images && (
          <p className="mt-2 text-xs text-red-500">{errors.images}</p>
        )}

        {imageItems.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {imageItems.map((item, index) => {
              const previewUrl =
                item.kind === "existing" ? item.url : item.previewUrl
              const previewAlt =
                item.kind === "existing"
                  ? `Product image ${index + 1}`
                  : item.file.name

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-zinc-200 bg-white p-2"
                >
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-zinc-100">
                    <img
                      src={previewUrl}
                      alt={previewAlt}
                      className="size-full object-cover"
                    />
                    {index === 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-1 text-xs font-semibold text-zinc-900">
                        Primary
                      </span>
                    )}
                    {item.kind === "new" && (
                      <span className="absolute right-2 top-2 rounded-full bg-zinc-900/80 px-2 py-1 text-xs font-medium text-white">
                        New
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => moveImage(index, 0)}
                      disabled={isPending || index === 0}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Make image ${index + 1} primary`}
                    >
                      <Star className="size-3.5" />
                      Primary
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, index - 1)}
                      disabled={isPending || index === 0}
                      className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Move image ${index + 1} left`}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, index + 1)}
                      disabled={isPending || index === imageItems.length - 1}
                      className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Move image ${index + 1} right`}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(item.id)}
                      disabled={isPending}
                      className="inline-flex size-9 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Remove image ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 pt-5 sm:flex-row sm:justify-end">
        <Button
          type="submit"
          disabled={isPending}
          className="h-11 rounded-lg bg-amber-500 px-6 font-semibold text-zinc-900 hover:bg-amber-400"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving
            </>
          ) : product ? (
            "Save Changes"
          ) : (
            "Create Product"
          )}
        </Button>
      </div>
    </form>
  )
}
