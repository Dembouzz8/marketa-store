"use client"

import Link from "next/link"
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useMemo, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
import { cn, formatNaira, getProductImage } from "@/lib/utils"
import type { Product } from "@/types"

type ActionResult = {
  error: string | null
}

interface ProductsTableProps {
  products: Product[]
  onDelete: (productId: string) => Promise<ActionResult>
  onToggleActive: (
    productId: string,
    isActive: boolean
  ) => Promise<ActionResult>
}

export function ProductsTable({
  products,
  onDelete,
  onToggleActive,
}: ProductsTableProps) {
  const [localProducts, setLocalProducts] = useState(products)
  const [query, setQuery] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [editingStockId, setEditingStockId] = useState<string | null>(null)
  const [stockDraft, setStockDraft] = useState("")
  const [isPending, startTransition] = useTransition()

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase()

    return localProducts.filter((product) => {
      if (!search) return true

      return (
        product.name.toLowerCase().includes(search) ||
        (product.category ?? "").toLowerCase().includes(search)
      )
    })
  }, [localProducts, query])

  const handleToggleActive = (product: Product) => {
    const nextActive = !product.is_active
    setLocalProducts((items) =>
      items.map((item) =>
        item.id === product.id ? { ...item, is_active: nextActive } : item
      )
    )

    startTransition(async () => {
      const result = await onToggleActive(product.id, nextActive)
      if (result.error) {
        setLocalProducts((items) =>
          items.map((item) =>
            item.id === product.id
              ? { ...item, is_active: product.is_active }
              : item
          )
        )
        toast({
          title: "Could not update product",
          description: result.error,
          variant: "destructive",
        })
      }
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return

    const product = deleteTarget
    startTransition(async () => {
      const result = await onDelete(product.id)
      if (result.error) {
        toast({
          title: "Could not delete product",
          description: result.error,
          variant: "destructive",
        })
        return
      }

      setLocalProducts((items) => items.filter((item) => item.id !== product.id))
      setDeleteTarget(null)
      toast({ title: "Product deleted" })
    })
  }

  const handleStockSave = async (product: Product) => {
    const nextStock = Number(stockDraft)
    setEditingStockId(null)

    if (!Number.isFinite(nextStock) || nextStock < 0) {
      toast({
        title: "Invalid stock quantity",
        description: "Stock must be zero or greater.",
        variant: "destructive",
      })
      return
    }

    const { error } = await supabase
      .from("products")
      .update({ stock: nextStock })
      .eq("id", product.id)

    if (error) {
      toast({
        title: "Could not update stock",
        description: error.message,
        variant: "destructive",
      })
      return
    }

    setLocalProducts((items) =>
      items.map((item) =>
        item.id === product.id ? { ...item, stock: nextStock } : item
      )
    )
    toast({ title: "Stock updated" })
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products or categories"
            className="h-10 rounded-lg border-zinc-200 pl-10"
          />
        </div>
        <Link
          href="/vendor/products/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
        >
          <Plus className="size-4" />
          Add Product
        </Link>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="size-16 text-zinc-200" />
          <h2 className="mt-4 text-lg font-medium text-zinc-900">
            No products yet
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Add your first product to start selling.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Product
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Category
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Price
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Stock
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Status
                </th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id} className="border-b border-zinc-100">
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={getProductImage(product.images)}
                        alt={product.name}
                        className="size-10 rounded-lg object-cover"
                      />
                      <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                        {product.name}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-4 text-sm text-zinc-900">
                    {product.category ?? "Others"}
                  </td>
                  <td className="px-3 py-4 text-sm font-semibold text-zinc-900">
                    {formatNaira(product.price)}
                  </td>
                  <td className="px-3 py-4">
                    {editingStockId === product.id ? (
                      <Input
                        type="number"
                        value={stockDraft}
                        min={0}
                        autoFocus
                        onChange={(event) => setStockDraft(event.target.value)}
                        onBlur={() => handleStockSave(product)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur()
                          }
                          if (event.key === "Escape") {
                            setEditingStockId(null)
                          }
                        }}
                        className="h-8 w-20 rounded-lg border-zinc-200"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStockId(product.id)
                          setStockDraft(String(product.stock))
                        }}
                        className={cn(
                          "text-sm font-semibold",
                          product.stock < 5
                            ? "text-red-600"
                            : "text-emerald-600"
                        )}
                      >
                        {product.stock}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleToggleActive(product)}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        product.is_active ? "bg-emerald-500" : "bg-zinc-300"
                      )}
                      aria-label="Toggle product status"
                    >
                      <span
                        className={cn(
                          "absolute top-1 size-4 rounded-full bg-white transition-transform",
                          product.is_active
                            ? "translate-x-5"
                            : "translate-x-1"
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/vendor/products/${product.id}/edit`}
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900"
                        aria-label={`Edit ${product.name}`}
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(product)}
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-200 text-red-500 transition-colors hover:border-red-200 hover:bg-red-50"
                        aria-label={`Delete ${product.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="bg-white shadow-2xl">
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>
              This removes {deleteTarget?.name} from your catalog.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-white">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border-zinc-200"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-red-500 text-white hover:bg-red-600"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
