"use client"

import { Minus, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { buildVariantCartItem } from "@/lib/cart-model"
import {
  getSelectableVariantValueIds,
  getVariantValueAvailability,
  reconcileVariantSelection,
  resolveSelectedVariant,
  type VariantSelectionState,
} from "@/lib/product-variant-selection"
import { useCartStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { PublicProductVariantProjection, StorefrontProduct } from "@/types"

export function ProductVariantSelector({
  projection,
  product,
  cartEnabled,
}: {
  projection: PublicProductVariantProjection | null
  product: StorefrontProduct
  cartEnabled: boolean
}) {
  const [selections, setSelections] = useState<VariantSelectionState>({})
  const [quantity, setQuantity] = useState(1)
  const [cartNotice, setCartNotice] = useState<string | null>(null)
  const addItem = useCartStore((state) => state.addItem)
  const selectedVariant = useMemo(
    () => (projection ? resolveSelectedVariant(projection, selections) : null),
    [projection, selections]
  )
  const selectedQuantity = Math.min(quantity, selectedVariant?.stock ?? 1, 99)

  const handleAddToCart = () => {
    if (!cartEnabled || !projection || !selectedVariant) return
    const item = buildVariantCartItem({
      product,
      projection,
      variantId: selectedVariant.variant_id,
      quantity: selectedQuantity,
    })
    const result = item ? addItem(item) : "invalid"
    setCartNotice(
      result === "applied"
        ? "Added to cart. Variant checkout is not available yet."
        : result === "invalid"
          ? "This combination is unavailable or your cart already has the available stock."
          : "Your saved cart is not ready for safe changes yet."
    )
  }

  if (!projection) {
    return (
      <section className="space-y-4" aria-labelledby="product-options-heading">
        <h2 id="product-options-heading" className="font-semibold text-zinc-900">
          Product options
        </h2>
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        >
          Options are temporarily unavailable. Refresh the product page before
          trying again.
        </p>
        <DisabledVariantPurchase />
      </section>
    )
  }

  const availableCombinationCount = projection.combinations.filter(
    (combination) => combination.stock > 0
  ).length

  return (
    <section className="space-y-5" aria-labelledby="product-options-heading">
      <div>
        <h2 id="product-options-heading" className="font-semibold text-zinc-900">
          Choose your options
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Select one value from each option. Only combinations created by the
          vendor are shown as available.
        </p>
      </div>

      {projection.axes.map((axis) => {
        const selectable = getSelectableVariantValueIds(
          projection,
          selections,
          axis.id
        )

        return (
          <fieldset key={axis.id} className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800">
              {axis.label}
            </legend>
            <div className="flex flex-wrap gap-2">
              {axis.values.map((value) => {
                const isSelected = selections[axis.id] === value.id
                const isAvailable = selectable.has(value.id)
                const availability = getVariantValueAvailability(
                  projection,
                  selections,
                  axis.id,
                  value.id
                )

                return (
                  <button
                    key={value.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={!isAvailable}
                    onClick={() => {
                      setCartNotice(null)
                      setQuantity(1)
                      setSelections((current) =>
                        reconcileVariantSelection(
                          projection,
                          current,
                          axis.id,
                          value.id
                        )
                      )
                    }}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2",
                      isSelected
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500",
                      !isAvailable &&
                        "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through"
                    )}
                  >
                    {value.swatch_hex && (
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded-full border border-black/15"
                        style={{ backgroundColor: value.swatch_hex }}
                      />
                    )}
                    {value.label}
                    {!isAvailable && (
                      <span className="text-xs">
                        {availability === "out_of_stock"
                          ? "Out of stock"
                          : "Unavailable combination"}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}

      <p
        aria-live="polite"
        data-selected-variant-id={selectedVariant?.variant_id}
        className={cn(
          "rounded-lg p-3 text-sm font-medium",
          selectedVariant
            ? "bg-emerald-50 text-emerald-700"
            : "bg-zinc-100 text-zinc-700"
        )}
      >
        {selectedVariant
          ? `${selectedVariant.stock} available in this combination. Quantity is limited to ${selectedVariant.stock}.`
          : availableCombinationCount > 0
            ? "Complete your option selection to see exact availability."
            : "All combinations are currently out of stock."}
      </p>

      {cartEnabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-zinc-700">Quantity</span>
            <div className="flex items-center rounded-lg border border-zinc-200">
              <button
                type="button"
                aria-label="Decrease variant quantity"
                disabled={!selectedVariant || selectedQuantity <= 1}
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                className="flex size-11 items-center justify-center text-zinc-600 disabled:text-zinc-300"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-12 text-center text-sm font-semibold" aria-live="polite">
                {selectedQuantity}
              </span>
              <button
                type="button"
                aria-label="Increase variant quantity"
                disabled={!selectedVariant || selectedQuantity >= Math.min(selectedVariant.stock, 99)}
                onClick={() => setQuantity((current) => current + 1)}
                className="flex size-11 items-center justify-center text-zinc-600 disabled:text-zinc-300"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleAddToCart}
            disabled={!selectedVariant}
            className="h-auto w-full rounded-xl bg-zinc-900 py-4 text-lg font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
          >
            Add Selection to Cart
          </Button>
          <p className="text-xs leading-5 text-zinc-500">
            Variant checkout is not available yet.
          </p>
          {cartNotice && (
            <p role="status" className="text-sm text-zinc-700">
              {cartNotice}
            </p>
          )}
        </div>
      ) : (
        <DisabledVariantPurchase />
      )}
    </section>
  )
}

function DisabledVariantPurchase() {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled
        className="h-auto w-full rounded-xl bg-zinc-200 py-4 text-base font-semibold text-zinc-500"
      >
        Variant purchasing coming soon
      </Button>
      <p className="text-xs leading-5 text-zinc-500">
        Your selection cannot be added to the cart during this preview phase.
      </p>
    </div>
  )
}
