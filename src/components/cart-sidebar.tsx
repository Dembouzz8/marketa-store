"use client"

import Image from "next/image"
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react"
import { useState } from "react"

import { CheckoutModal } from "@/components/checkout-modal"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useCartStore } from "@/lib/store"
import { formatNaira, getProductImage } from "@/lib/utils"

export function CartSidebar() {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const items = useCartStore((state) => state.items)
  const isCartOpen = useCartStore((state) => state.isCartOpen)
  const setCartOpen = useCartStore((state) => state.setCartOpen)
  const removeItem = useCartStore((state) => state.removeItem)
  const updateQuantity = useCartStore((state) => state.updateQuantity)
  const totalItems = useCartStore((state) => state.totalItems())
  const totalPrice = useCartStore((state) => state.totalPrice())

  return (
    <>
      <Sheet open={isCartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="h-[100dvh] max-h-[100dvh] w-full gap-0 overflow-hidden bg-white p-0 sm:max-w-[400px]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 p-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="size-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-zinc-900">
                Your Cart
              </h2>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-900">
                {totalItems}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Close cart"
            >
              <X className="size-5" />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain px-6 text-center touch-pan-y [-webkit-overflow-scrolling:touch]">
              <ShoppingBag className="size-20 text-zinc-200" />
              <h3 className="mt-6 text-lg font-semibold text-zinc-900">
                Your cart is empty
              </h3>
              <p className="mt-2 text-sm text-zinc-500">
                Add items from the store to get started
              </p>
              <Button
                type="button"
                onClick={() => setCartOpen(false)}
                className="mt-6 rounded-lg bg-zinc-900 px-5 text-white hover:bg-zinc-700"
              >
                Continue Shopping
              </Button>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 touch-pan-y [-webkit-overflow-scrolling:touch]">
                <div className="space-y-4 py-4 pb-6">
                  {items.map((item) => (
                    <div key={item.product.id}>
                      <div className="flex gap-3">
                        <Image
                          src={getProductImage(item.product.images)}
                          alt={item.product.name}
                          width={48}
                          height={48}
                          className="size-12 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="line-clamp-1 font-medium text-zinc-900">
                                {item.product.name}
                              </p>
                              <p className="text-sm text-amber-600">
                                {formatNaira(item.product.price)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(item.product.id)}
                              className="text-red-400 transition-colors hover:text-red-600"
                              aria-label={`Remove ${item.product.name}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(
                                  item.product.id,
                                  item.quantity - 1
                                )
                              }
                              className="flex size-7 items-center justify-center rounded bg-zinc-100 text-sm font-medium text-zinc-700"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span className="w-8 text-center text-sm font-semibold">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(
                                  item.product.id,
                                  item.quantity + 1
                                )
                              }
                              className="flex size-7 items-center justify-center rounded bg-zinc-100 text-sm font-medium text-zinc-700"
                              aria-label="Increase quantity"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <Separator className="mt-4" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="shrink-0 space-y-4 border-t border-zinc-200 bg-white px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Subtotal</span>
                  <span className="text-lg font-bold text-zinc-900">
                    {formatNaira(totalPrice)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Shipping calculated at checkout
                </p>
                <Separator />
                <Button
                  type="button"
                  onClick={() => setIsCheckoutOpen(true)}
                  className="h-auto w-full rounded-lg bg-amber-500 py-3 font-semibold text-zinc-900 hover:bg-amber-400"
                >
                  Proceed to Checkout
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCartOpen(false)}
                  className="w-full rounded-lg text-zinc-600 hover:text-zinc-900"
                >
                  Continue Shopping
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <CheckoutModal open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} />
    </>
  )
}
