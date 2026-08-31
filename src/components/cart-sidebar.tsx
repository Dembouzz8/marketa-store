"use client"

import { Loader2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"

import { CheckoutModal } from "@/components/checkout-modal"
import { ProductImage } from "@/components/product-image"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { useCartStore } from "@/lib/store"
import { formatNaira, getProductImage } from "@/lib/utils"

type CustomerProfileReadiness = {
  full_name: string | null
  phone: string | null
}

function isProfileComplete(profile: CustomerProfileReadiness | null) {
  return Boolean(profile?.full_name?.trim() && profile.phone?.trim())
}

export function CartSidebar() {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [isCheckingCheckoutAccess, setIsCheckingCheckoutAccess] =
    useState(false)
  const [checkoutGateError, setCheckoutGateError] = useState<string | null>(
    null
  )
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const items = useCartStore((state) => state.items)
  const isCartOpen = useCartStore((state) => state.isCartOpen)
  const setCartOpen = useCartStore((state) => state.setCartOpen)
  const removeItem = useCartStore((state) => state.removeItem)
  const updateQuantity = useCartStore((state) => state.updateQuantity)
  const totalItems = useCartStore((state) => state.totalItems())
  const totalPrice = useCartStore((state) => state.totalPrice())

  const handleProceedToCheckout = async () => {
    if (isCheckingCheckoutAccess) return

    setIsCheckingCheckoutAccess(true)
    setCheckoutGateError(null)

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        setCheckoutGateError(
          "We couldn't verify your account right now. Please try again."
        )
        return
      }

      if (!user) {
        setCartOpen(false)
        window.location.assign("/account/login?checkout=1")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("customer_profiles")
        .select("full_name, phone")
        .eq("user_id", user.id)
        .maybeSingle()

      if (profileError) {
        setCheckoutGateError(
          "We couldn't verify your profile right now. Please try again."
        )
        return
      }

      if (!isProfileComplete(profile as CustomerProfileReadiness | null)) {
        setCartOpen(false)
        window.location.assign("/account/profile?setup=1")
        return
      }

      setCartOpen(false)
      setIsCheckoutOpen(true)
    } catch {
      setCheckoutGateError(
        "We couldn't verify your account right now. Please try again."
      )
    } finally {
      setIsCheckingCheckoutAccess(false)
    }
  }

  return (
    <>
      <Sheet open={isCartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="h-[100dvh] max-h-[100dvh] w-full gap-0 overflow-hidden bg-white p-0 sm:max-w-[400px]"
        >
          <SheetHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-zinc-200 p-4 text-left">
            <div className="flex items-center gap-2">
              <ShoppingBag className="size-5 text-amber-500" />
              <SheetTitle className="text-lg font-semibold text-zinc-900">
                Your Cart
              </SheetTitle>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-900">
                {totalItems}
              </span>
              <SheetDescription className="sr-only">
                Review products in your cart and proceed to checkout.
              </SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Close cart"
            >
              <X className="size-5" />
            </button>
          </SheetHeader>

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
                        <ProductImage
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
                              className="flex size-7 items-center justify-center rounded bg-zinc-100 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
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
                              className="flex size-7 items-center justify-center rounded bg-zinc-100 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                              aria-label="Increase quantity"
                              disabled={item.quantity >= item.product.stock}
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
                {checkoutGateError && (
                  <p
                    role="alert"
                    aria-live="assertive"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700"
                  >
                    {checkoutGateError}
                  </p>
                )}
                <Separator />
                <Button
                  type="button"
                  onClick={handleProceedToCheckout}
                  disabled={isCheckingCheckoutAccess}
                  className="h-auto w-full rounded-lg bg-amber-500 py-3 font-semibold text-zinc-900 hover:bg-amber-400"
                >
                  {isCheckingCheckoutAccess ? (
                    <>
                      <Loader2
                        className="mr-2 size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Checking account...
                    </>
                  ) : (
                    "Proceed to Checkout"
                  )}
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
