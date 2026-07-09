"use client"

import Link from "next/link"
import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import confetti from "canvas-confetti"
import { motion } from "framer-motion"
import { Check } from "lucide-react"

import { toast } from "@/components/ui/use-toast"

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white px-4 py-20 text-center text-sm text-zinc-500">
          Loading payment confirmation...
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  )
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams()
  const reference = searchParams.get("reference") ?? "Pending reference"

  useEffect(() => {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#f59e0b", "#18181b", "#ffffff", "#10b981"],
    })
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-zinc-100 bg-white p-8 text-center shadow-2xl">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
          className="mx-auto flex size-24 items-center justify-center rounded-full bg-emerald-500"
        >
          <Check className="size-12 text-white" />
        </motion.div>

        <h1 className="mt-6 text-3xl font-bold text-zinc-900">
          Payment Successful!
        </h1>
        <p className="mt-2 font-medium text-emerald-600">Order Confirmed</p>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          Your order is now being processed. You&apos;ll receive an email and
          WhatsApp confirmation with the next delivery steps shortly.
        </p>
        <p className="mt-4 break-all rounded-lg bg-zinc-50 p-3 font-mono text-sm text-zinc-500">
          {reference}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/"
            className="rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
          >
            Continue Shopping
          </Link>
          <button
            type="button"
            onClick={() => toast({ title: "Coming soon!" })}
            className="rounded-lg border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900"
          >
            Track Order
          </button>
        </div>
      </div>

      <div className="mt-10 grid w-full max-w-4xl grid-cols-4 gap-2 text-center text-xs text-zinc-500">
        {[
          "✅ Payment Received",
          "🔄 Processing",
          "📦 Preparing",
          "🚚 Delivery",
        ].map((step, index) => (
          <div key={step} className="relative">
            {index < 3 && (
              <div className="absolute left-1/2 top-4 h-px w-full bg-zinc-200" />
            )}
            <div className="relative mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-amber-500 text-zinc-900">
              {index + 1}
            </div>
            <p className="relative">{step}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
