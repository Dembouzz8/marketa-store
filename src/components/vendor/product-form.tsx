"use client"

import { useMemo, useState, useTransition } from "react"
import { ImagePlus, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
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

export function ProductForm({ product, vendorId, onSuccess }: ProductFormProps) {
  const [name, setName] = useState(product?.name ?? "")
  const [description, setDescription] = useState(product?.description ?? "")
  const [price, setPrice] = useState(
    product ? String(Number(product.price)) : ""
  )
  const [stock, setStock] = useState(product ? String(product.stock) : "")
  const [category, setCategory] = useState(product?.category ?? categories[0])
  const [isActive, setIsActive] = useState(product?.is_active ?? true)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [isPending, startTransition] = useTransition()

  const existingImages = product?.images ?? []
  const selectedPreviews = useMemo(
    () =>
      selectedFiles.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [selectedFiles]
  )

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
    if (existingImages.length + selectedFiles.length > 4) {
      nextErrors.images = "You can upload a maximum of 4 images."
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    const allowedFiles = files.filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )

    if (allowedFiles.length !== files.length) {
      setErrors((current) => ({
        ...current,
        images: "Only JPEG, PNG, and WebP images are supported.",
      }))
      return
    }

    if (existingImages.length + allowedFiles.length > 4) {
      setErrors((current) => ({
        ...current,
        images: "You can upload a maximum of 4 images.",
      }))
      return
    }

    setErrors((current) => ({ ...current, images: undefined }))
    setSelectedFiles(allowedFiles)
  }

  const uploadImages = async () => {
    return await Promise.all(
      selectedFiles.map(async (file) => {
        const path = `${vendorId}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage
          .from("product-images")
          .upload(path, file)

        if (error) throw error

        const { data } = supabase.storage
          .from("product-images")
          .getPublicUrl(path)

        return data.publicUrl
      })
    )
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!validate()) return

    startTransition(async () => {
      setErrors({})

      try {
        const uploadedImages = await uploadImages()
        const imageUrls = product
          ? [...existingImages, ...uploadedImages].slice(0, 4)
          : uploadedImages

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
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Something went wrong."
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
            JPEG, PNG, or WebP. Maximum 4 images.
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
        {errors.images && (
          <p className="mt-2 text-xs text-red-500">{errors.images}</p>
        )}

        {(existingImages.length > 0 || selectedPreviews.length > 0) && (
          <div className="mt-4 grid grid-cols-4 gap-3">
            {existingImages.map((image) => (
              <img
                key={image}
                src={image}
                alt="Existing product"
                className="aspect-square rounded-lg object-cover"
              />
            ))}
            {selectedPreviews.map((preview) => (
              <img
                key={preview.url}
                src={preview.url}
                alt={preview.name}
                className="aspect-square rounded-lg object-cover"
              />
            ))}
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
