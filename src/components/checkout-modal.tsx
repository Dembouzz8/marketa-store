"use client"

import { useState } from "react"
import {
  Check,
  Loader2,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react"

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
  savePendingCheckout,
} from "@/lib/payment-recovery"
import { useCartStore } from "@/lib/store"
import { cn, formatNaira } from "@/lib/utils"
import type { CheckoutFormData, CheckoutPayload } from "@/types"

interface CheckoutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type CheckoutStep = 1 | 2 | 3

const states = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Federal Capital Territory",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
]

const initialFormData: CheckoutFormData = {
  full_name: "",
  customer_email: "",
  customer_phone: "",
  shipping_address: {
    address: "",
    city: "",
    state: "",
  },
}

export function CheckoutModal({ open, onOpenChange }: CheckoutModalProps) {
  const [step, setStep] = useState<CheckoutStep>(1)
  const [formData, setFormData] =
    useState<CheckoutFormData>(initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = useCartStore((state) => state.items)
  const totalPrice = useCartStore((state) => state.totalPrice())

  const validateContact = () => {
    return (
      formData.full_name.trim() &&
      formData.customer_email.trim() &&
      formData.customer_phone.trim()
    )
  }

  const validateDelivery = () => {
    return (
      formData.shipping_address.address.trim() &&
      formData.shipping_address.city.trim() &&
      formData.shipping_address.state.trim()
    )
  }

  const nextStep = () => {
    setError(null)

    if (step === 1 && !validateContact()) {
      setError("Please enter your full name, email, and phone number.")
      return
    }

    if (step === 2 && !validateDelivery()) {
      setError("Please complete your delivery address.")
      return
    }

    setStep((currentStep) => Math.min(currentStep + 1, 3) as CheckoutStep)
  }

  const updateContactField = (
    field: keyof Pick<
      CheckoutFormData,
      "full_name" | "customer_email" | "customer_phone"
    >,
    value: string
  ) => {
    setFormData((current) => ({ ...current, [field]: value }))
  }

  const updateAddressField = (
    field: keyof CheckoutFormData["shipping_address"],
    value: string
  ) => {
    setFormData((current) => ({
      ...current,
      shipping_address: {
        ...current.shipping_address,
        [field]: value,
      },
    }))
  }

  const handlePayment = async () => {
    setIsLoading(true)
    setError(null)

    const payload: CheckoutPayload = {
      customer_email: formData.customer_email,
      customer_phone: formData.customer_phone,
      items: items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
      })),
      shipping_address: formData.shipping_address,
    }

    try {
      const webhookUrl = process.env.NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL

      if (!webhookUrl || webhookUrl === "your_n8n_checkout_webhook_url") {
        throw new Error("Checkout webhook URL is not configured.")
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to start checkout.")
      }

      if (
        !data.authorization_url ||
        !isOrderId(data.order_id ?? "") ||
        !isPaymentReference(data.reference ?? "")
      ) {
        throw new Error("Checkout response did not include a payment URL.")
      }

      savePendingCheckout({
        order_id: data.order_id,
        reference: data.reference,
        cart_fingerprint: createCartFingerprint(items),
        created_at: new Date().toISOString(),
      })
      window.location.href = data.authorization_url
    } catch (paymentError) {
      const message =
        paymentError instanceof Error
          ? paymentError.message
          : "Unable to start checkout."
      setError(message)
      toast({
        title: "Checkout failed",
        description: message,
        variant: "destructive",
      })
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 shadow-2xl sm:max-w-xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl font-semibold text-zinc-900">
            Checkout
          </DialogTitle>
          <DialogDescription>
            Complete your details to pay securely with Paystack.
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
              <IconInput
                id="full_name"
                label="Full Name"
                icon={User}
                value={formData.full_name}
                onChange={(value) => updateContactField("full_name", value)}
              />
              <IconInput
                id="customer_email"
                label="Email"
                type="email"
                icon={Mail}
                value={formData.customer_email}
                onChange={(value) =>
                  updateContactField("customer_email", value)
                }
              />
              <IconInput
                id="customer_phone"
                label="Phone"
                placeholder="+2348..."
                icon={Phone}
                value={formData.customer_phone}
                onChange={(value) =>
                  updateContactField("customer_phone", value)
                }
              />
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
              <IconInput
                id="address"
                label="Address line"
                icon={MapPin}
                value={formData.shipping_address.address}
                onChange={(value) => updateAddressField("address", value)}
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
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
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
                <Recap title="Contact">
                  <p>{formData.full_name}</p>
                  <p>{formData.customer_email}</p>
                  <p>{formData.customer_phone}</p>
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
    { number: 1, label: "Contact" },
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
