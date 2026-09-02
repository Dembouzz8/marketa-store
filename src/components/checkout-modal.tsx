"use client"

import { Check, Loader2, MapPin } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/use-toast"
import {
  createCartFingerprint,
  isOrderId,
  isPaymentReference,
  obtainCheckoutAttempt,
  removeCheckoutAttempt,
  savePendingCheckout,
} from "@/lib/payment-recovery"
import { NIGERIAN_STATES } from "@/lib/nigerian-states"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { useCartStore } from "@/lib/store"
import { cn, formatNaira } from "@/lib/utils"
import type {
  CheckoutErrorResponse,
  CheckoutFormData,
  CheckoutPayload,
  CheckoutSuccessResponse,
} from "@/types"

interface CheckoutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type CheckoutStep = 1 | 2 | 3

type SavedAddress = {
  id: string
  label: string
  address: string
  city: string
  state: string
  is_default: boolean
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class CheckoutUiError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0
  ) {
    super(message)
  }
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeShippingAddress(formData: CheckoutFormData) {
  return {
    address: normalizeWhitespace(formData.shipping_address.address),
    city: normalizeWhitespace(formData.shipping_address.city),
    state: formData.shipping_address.state.trim(),
  }
}

function isShippingDraftBlank(
  shippingAddress: CheckoutFormData["shipping_address"]
) {
  return (
    !shippingAddress.address.trim() &&
    !shippingAddress.city.trim() &&
    !shippingAddress.state.trim()
  )
}

function savedAddressSnapshot(savedAddress: SavedAddress) {
  return {
    address: savedAddress.address,
    city: savedAddress.city,
    state: savedAddress.state,
  }
}

function isValidShippingAddress(formData: CheckoutFormData) {
  const address = normalizeShippingAddress(formData)
  return (
    address.address.length >= 5 &&
    address.address.length <= 300 &&
    address.city.length >= 2 &&
    address.city.length <= 100 &&
    (NIGERIAN_STATES as readonly string[]).includes(address.state)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCheckoutErrorResponse(value: unknown): value is CheckoutErrorResponse {
  return (
    isRecord(value) &&
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  )
}

function isCheckoutSuccessResponse(
  value: unknown
): value is CheckoutSuccessResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isRecord(value.data) &&
    typeof value.data.order_id === "string" &&
    typeof value.data.reference === "string" &&
    typeof value.data.authorization_url === "string" &&
    typeof value.data.checkout_attempt_id === "string" &&
    typeof value.data.reused === "boolean"
  )
}

function safeAuthorizationUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function checkoutErrorMessage(code: string): string {
  switch (code) {
    case "INSUFFICIENT_STOCK":
      return "One or more products no longer have enough stock. Review your cart and try again."
    case "PRODUCT_UNAVAILABLE":
      return "One or more products are no longer available."
    case "VENDOR_UNAVAILABLE":
      return "One or more sellers are currently unavailable."
    case "INVALID_SHIPPING_ADDRESS":
      return "Check your delivery address and state."
    case "INVALID_ITEMS":
    case "DUPLICATE_PRODUCT":
      return "Review the products and quantities in your cart."
    case "CHECKOUT_INITIALIZING":
      return "Checkout is still being prepared. Please wait a moment and try again."
    case "CHECKOUT_ATTEMPT_CONFLICT":
      return "Your checkout details changed. Please try again to start a new checkout."
    case "CHECKOUT_EXPIRED":
      return "This checkout session expired. Please try again to start a new checkout."
    case "CHECKOUT_ALREADY_CONFIRMED":
      return "This checkout has already been confirmed."
    case "INVALID_CHECKOUT_ATTEMPT":
      return "Checkout could not be started. Please try again."
    case "PAYMENT_INITIALIZATION_FAILED":
    case "AUTH_SERVICE_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
      return "Checkout is temporarily unavailable. Please try again."
    case "UNSUPPORTED_MEDIA_TYPE":
    case "PAYLOAD_TOO_LARGE":
    case "INVALID_REQUEST":
    case "INVALID_PRODUCT_PRICE":
      return "Checkout could not be started. Review your order and try again."
    default:
      return "Checkout is temporarily unavailable. Please try again."
  }
}

const initialFormData: CheckoutFormData = {
  shipping_address: {
    address: "",
    city: "",
    state: "",
  },
}

export function CheckoutModal({ open, onOpenChange }: CheckoutModalProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [step, setStep] = useState<CheckoutStep>(1)
  const [formData, setFormData] =
    useState<CheckoutFormData>(initialFormData)
  const shippingDraftRef = useRef(formData.shipping_address)
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null
  )
  const [isLoadingSavedAddresses, setIsLoadingSavedAddresses] =
    useState(true)
  const [savedAddressError, setSavedAddressError] = useState<string | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = useCartStore((state) => state.items)
  const totalPrice = useCartStore((state) => state.totalPrice())

  useEffect(() => {
    if (!open) return

    let isActive = true

    const loadSavedAddresses = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (!isActive) return

        if (userError || !user) {
          setSavedAddressError(
            "Saved addresses aren't available right now. Enter your delivery address manually."
          )
          return
        }

        const { data, error: addressError } = await supabase
          .from("customer_addresses")
          .select("id, label, address, city, state, is_default")
          .eq("user_id", user.id)
          .order("is_default", { ascending: false })
          .order("label", { ascending: true })
          .order("id", { ascending: true })

        if (!isActive) return

        if (addressError) {
          setSavedAddressError(
            "Saved addresses aren't available right now. Enter your delivery address manually."
          )
          return
        }

        const addresses = (data ?? []) as SavedAddress[]
        setSavedAddresses(addresses)

        const defaultAddress = addresses.find(
          (address) => address.is_default
        )

        if (
          defaultAddress &&
          isShippingDraftBlank(shippingDraftRef.current)
        ) {
          const snapshot = savedAddressSnapshot(defaultAddress)
          shippingDraftRef.current = snapshot
          setFormData((current) => ({
            ...current,
            shipping_address: snapshot,
          }))
          setSelectedAddressId(defaultAddress.id)
        }
      } catch {
        if (isActive) {
          setSavedAddressError(
            "Saved addresses aren't available right now. Enter your delivery address manually."
          )
        }
      } finally {
        if (isActive) setIsLoadingSavedAddresses(false)
      }
    }

    void loadSavedAddresses()

    return () => {
      isActive = false
    }
  }, [open, supabase])

  const nextStep = () => {
    setError(null)

    if (step === 2 && !isValidShippingAddress(formData)) {
      setError("Check your delivery address and state.")
      return
    }

    setStep((currentStep) => Math.min(currentStep + 1, 3) as CheckoutStep)
  }

  const updateAddressField = (
    field: keyof CheckoutFormData["shipping_address"],
    value: string
  ) => {
    const shippingAddress = {
      ...shippingDraftRef.current,
      [field]: value,
    }
    shippingDraftRef.current = shippingAddress
    setFormData((current) => ({
      ...current,
      shipping_address: shippingAddress,
    }))
  }

  const selectSavedAddress = (savedAddress: SavedAddress) => {
    const snapshot = savedAddressSnapshot(savedAddress)
    shippingDraftRef.current = snapshot
    setFormData((current) => ({
      ...current,
      shipping_address: snapshot,
    }))
    setSelectedAddressId(savedAddress.id)
    setError(null)
  }

  const useManualAddress = () => {
    setSelectedAddressId(null)
    setError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSavedAddresses([])
      setSelectedAddressId(null)
      setSavedAddressError(null)
      setIsLoadingSavedAddresses(true)
    }

    onOpenChange(nextOpen)
  }

  const handlePayment = async () => {
    if (!isValidShippingAddress(formData)) {
      setError("Check your delivery address and state.")
      return
    }

    const itemIds = items.map((item) => item.product.id.toLowerCase())
    if (
      items.length < 1 ||
      items.length > 50 ||
      new Set(itemIds).size !== itemIds.length ||
      items.some(
        (item) =>
          !UUID_PATTERN.test(item.product.id) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 99
      )
    ) {
      setError("Review the products and quantities in your cart.")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const webhookUrl = process.env.NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL

      if (!webhookUrl || webhookUrl === "your_n8n_checkout_webhook_url") {
        throw new Error("Checkout webhook URL is not configured.")
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        throw new CheckoutUiError(
          "We couldn't verify your account right now. Please try again."
        )
      }

      const accessToken = session?.access_token?.trim()
      if (!accessToken) {
        setIsLoading(false)
        onOpenChange(false)
        window.location.assign("/account/login?checkout=1")
        return
      }

      const cartFingerprint = createCartFingerprint(items)
      const checkoutAttempt = obtainCheckoutAttempt(cartFingerprint)
      const payload: CheckoutPayload = {
        checkout_attempt_id: checkoutAttempt.checkout_attempt_id,
        items: items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
        shipping_address: normalizeShippingAddress(formData),
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const data: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        if (isCheckoutErrorResponse(data)) {
          if (data.error.code === "AUTH_REQUIRED") {
            setIsLoading(false)
            onOpenChange(false)
            window.location.assign("/account/login?checkout=1")
            return
          }

          if (data.error.code === "PROFILE_INCOMPLETE") {
            setIsLoading(false)
            onOpenChange(false)
            window.location.assign("/account/profile?setup=1")
            return
          }

          if (
            data.error.code === "CHECKOUT_ATTEMPT_CONFLICT" ||
            data.error.code === "CHECKOUT_EXPIRED" ||
            data.error.code === "INVALID_CHECKOUT_ATTEMPT"
          ) {
            removeCheckoutAttempt(checkoutAttempt.checkout_attempt_id)
          }

          if (data.error.code === "CHECKOUT_ALREADY_CONFIRMED") {
            const order = data.order
            if (
              order &&
              isOrderId(order.order_id) &&
              isPaymentReference(order.reference)
            ) {
              savePendingCheckout({
                order_id: order.order_id,
                reference: order.reference,
                cart_fingerprint: cartFingerprint,
                created_at: new Date().toISOString(),
              })
              window.location.href = `/payment-success?${new URLSearchParams({
                order: order.order_id,
                reference: order.reference,
              }).toString()}`
              return
            }
          }

          throw new CheckoutUiError(
            checkoutErrorMessage(data.error.code),
            data.error.code === "CHECKOUT_INITIALIZING" &&
              data.retry_after_ms === 2000
              ? data.retry_after_ms
              : 0
          )
        }

        throw new CheckoutUiError(
          "Checkout is temporarily unavailable. Please try again."
        )
      }

      if (
        !isCheckoutSuccessResponse(data) ||
        !isOrderId(data.data.order_id) ||
        !isPaymentReference(data.data.reference) ||
        !safeAuthorizationUrl(data.data.authorization_url) ||
        data.data.checkout_attempt_id !==
          checkoutAttempt.checkout_attempt_id
      ) {
        throw new CheckoutUiError(
          "Checkout is temporarily unavailable. Please try again."
        )
      }

      savePendingCheckout({
        order_id: data.data.order_id,
        reference: data.data.reference,
        cart_fingerprint: cartFingerprint,
        created_at: new Date().toISOString(),
      })
      window.location.href = data.data.authorization_url
    } catch (paymentError) {
      const message =
        paymentError instanceof CheckoutUiError
          ? paymentError.message
          : "Checkout is temporarily unavailable. Please try again."
      setError(message)
      toast({
        title: "Checkout failed",
        description: message,
        variant: "destructive",
      })
      if (
        paymentError instanceof CheckoutUiError &&
        paymentError.retryAfterMs > 0
      ) {
        window.setTimeout(() => setIsLoading(false), paymentError.retryAfterMs)
      } else {
        setIsLoading(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 shadow-2xl sm:max-w-xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl font-semibold text-zinc-900">
            Checkout
          </DialogTitle>
          <DialogDescription>
            Confirm your delivery details to pay securely with Paystack.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6">
          <StepIndicator step={step} />
        </div>

        <ScrollArea className="max-h-[64vh] px-6 pb-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <h3 className="font-semibold text-zinc-900">
                  Account contact details
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Marketa will use the verified name, email address and phone
                  number saved to your customer account for this order.
                </p>
              </div>
              <Button
                type="button"
                onClick={nextStep}
                className="h-auto w-full rounded-lg bg-amber-500 py-3 font-semibold text-zinc-900 hover:bg-amber-400"
              >
                Continue →
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div aria-live="polite" className="space-y-3">
                {isLoadingSavedAddresses && (
                  <p className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Loading saved addresses...
                  </p>
                )}

                {savedAddressError && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800">
                    {savedAddressError}
                  </p>
                )}

                {savedAddresses.length > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-zinc-900">
                      Saved addresses
                    </legend>
                    {savedAddresses.map((savedAddress) => {
                      const isSelected =
                        selectedAddressId === savedAddress.id

                      return (
                        <label key={savedAddress.id} className="block">
                          <input
                            type="radio"
                            name="checkout-address-mode"
                            value={savedAddress.id}
                            checked={isSelected}
                            onChange={() =>
                              selectSavedAddress(savedAddress)
                            }
                            className="peer sr-only"
                          />
                          <span
                            className={cn(
                              "block cursor-pointer rounded-xl border bg-white p-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 peer-focus-visible:ring-offset-2",
                              isSelected
                                ? "border-amber-400 bg-amber-50/60"
                                : "border-zinc-200 hover:border-zinc-400"
                            )}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2 font-semibold text-zinc-900">
                                  <span className="break-words">
                                    {savedAddress.label}
                                  </span>
                                  {savedAddress.is_default && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                      Default
                                    </span>
                                  )}
                                </span>
                                <span className="mt-1 block break-words leading-5 text-zinc-600">
                                  {savedAddress.address}
                                </span>
                                <span className="block break-words leading-5 text-zinc-600">
                                  {savedAddress.city}, {savedAddress.state}
                                </span>
                              </span>
                              {isSelected && (
                                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-800">
                                  <Check
                                    className="size-3.5"
                                    aria-hidden="true"
                                  />
                                  Selected
                                </span>
                              )}
                            </span>
                          </span>
                        </label>
                      )
                    })}

                    <label className="block">
                      <input
                        type="radio"
                        name="checkout-address-mode"
                        value="manual"
                        checked={selectedAddressId === null}
                        onChange={useManualAddress}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "block cursor-pointer rounded-xl border bg-white p-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 peer-focus-visible:ring-offset-2",
                          selectedAddressId === null
                            ? "border-amber-400 bg-amber-50/60"
                            : "border-zinc-200 hover:border-zinc-400"
                        )}
                      >
                        <span className="font-semibold text-zinc-900">
                          Enter address manually
                        </span>
                        <span className="mt-1 block text-zinc-600">
                          Use or adjust a one-off delivery address.
                        </span>
                        {selectedAddressId === null && (
                          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
                            <Check className="size-3.5" aria-hidden="true" />
                            Selected
                          </span>
                        )}
                      </span>
                    </label>
                  </fieldset>
                )}
              </div>

              {selectedAddressId === null && (
                <div className="space-y-4">
                  <IconInput
                    id="address"
                    label="Address line"
                    icon={MapPin}
                    value={formData.shipping_address.address}
                    onChange={(value) =>
                      updateAddressField("address", value)
                    }
                  />
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={formData.shipping_address.city}
                      onChange={(event) =>
                        updateAddressField("city", event.target.value)
                      }
                      className="rounded-lg"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <select
                      id="state"
                      value={formData.shipping_address.state}
                      onChange={(event) =>
                        updateAddressField("state", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    >
                      <option value="">Select state</option>
                      {NIGERIAN_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="h-auto rounded-lg py-3"
                >
                  ← Back
                </Button>
                <Button
                  type="button"
                  onClick={nextStep}
                  className="h-auto rounded-lg bg-amber-500 py-3 font-semibold text-zinc-900 hover:bg-amber-400"
                >
                  Continue →
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-zinc-50 p-4">
                <h3 className="font-semibold text-zinc-900">Order Summary</h3>
                <div className="mt-3 max-h-40 space-y-3 overflow-y-auto">
                  {items.map((item) => (
                    <div
                      key={item.product.id}
                      className="flex items-center justify-between gap-4 text-sm"
                    >
                      <div>
                        <p className="font-medium text-zinc-900">
                          {item.product.name}
                        </p>
                        <p className="text-zinc-500">Qty {item.quantity}</p>
                      </div>
                      <p className="font-semibold text-zinc-900">
                        {formatNaira(item.product.price * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Recap title="Account contact">
                  <p>
                    Your verified account contact details will be saved with
                    this order.
                  </p>
                </Recap>
                <Recap title="Delivery">
                  <p>{formData.shipping_address.address}</p>
                  <p>
                    {formData.shipping_address.city},{" "}
                    {formData.shipping_address.state}
                  </p>
                </Recap>
              </div>

              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-500">Total</span>
                <span className="text-3xl font-bold text-amber-600">
                  {formatNaira(totalPrice)}
                </span>
              </div>
              <div className="rounded-full bg-emerald-50 px-4 py-2 text-center text-sm font-medium text-emerald-600">
                🔒 Secured by Paystack
              </div>
              <Button
                type="button"
                onClick={handlePayment}
                disabled={isLoading || items.length === 0}
                className="h-auto w-full rounded-xl bg-amber-500 py-4 text-lg font-bold text-zinc-900 hover:bg-amber-400"
              >
                {isLoading && <Loader2 className="mr-2 size-5 animate-spin" />}
                Pay {formatNaira(totalPrice)} Now
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(2)}
                className="h-auto w-full rounded-lg py-3"
              >
                ← Back
              </Button>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function StepIndicator({ step }: { step: CheckoutStep }) {
  const steps = [
    { number: 1, label: "Account" },
    { number: 2, label: "Delivery" },
    { number: 3, label: "Summary" },
  ] as const

  return (
    <div className="mb-6 flex items-center">
      {steps.map((item, index) => {
        const isCompleted = step > item.number
        const isActive = step === item.number

        return (
          <div key={item.number} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-sm font-bold",
                  isCompleted && "bg-emerald-500 text-white",
                  isActive && "bg-amber-500 text-zinc-900",
                  !isCompleted && !isActive && "bg-zinc-200 text-zinc-500"
                )}
              >
                {isCompleted ? <Check className="size-4" /> : item.number}
              </div>
              <span className="text-xs font-medium text-zinc-500">
                {item.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="mx-3 h-px flex-1 bg-zinc-200" />
            )}
          </div>
        )
      })}
    </div>
  )
}

function IconInput({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-lg pl-9"
        />
      </div>
    </div>
  )
}

function Recap({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <div className="space-y-1 text-sm text-zinc-600">{children}</div>
    </div>
  )
}
