"use client"

import confetti from "canvas-confetti"
import { motion } from "framer-motion"
import {
  Check,
  CircleHelp,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { Button } from "@/components/ui/button"
import {
  createCartFingerprint,
  getPaymentStatus,
  isOrderId,
  isPaymentReference,
  readPendingCheckout,
  removeCheckoutAttemptForCart,
  removePendingCheckout,
} from "@/lib/payment-recovery"
import { useCartStore } from "@/lib/store"

type PaymentView = "verifying" | "confirmed" | "processing" | "unknown"

const MAX_PROCESSING_POLLS = 12
const DEFAULT_RETRY_DELAY_MS = 2000

function subscribeToCartHydration(onStoreChange: () => void) {
  const unsubscribeHydrate = useCartStore.persist.onHydrate(onStoreChange)
  const unsubscribeFinish =
    useCartStore.persist.onFinishHydration(onStoreChange)

  return () => {
    unsubscribeHydrate()
    unsubscribeFinish()
  }
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <PaymentStateShell>
          <StatusIcon tone="neutral">
            <Loader2 className="size-10 animate-spin" aria-hidden="true" />
          </StatusIcon>
          <h1 className="mt-6 text-3xl font-bold text-zinc-900">
            Checking payment status
          </h1>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            Please wait while we check for a confirmed payment.
          </p>
        </PaymentStateShell>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  )
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get("order") ?? ""
  const reference = searchParams.get("reference") ?? ""
  const callbackIsValid =
    isOrderId(orderId) && isPaymentReference(reference)
  const [view, setView] = useState<PaymentView>(
    callbackIsValid ? "verifying" : "unknown"
  )
  const [verificationRun, setVerificationRun] = useState(0)
  const items = useCartStore((state) => state.items)
  const clearCart = useCartStore((state) => state.clearCart)
  const hasHydratedCart = useSyncExternalStore(
    subscribeToCartHydration,
    () => useCartStore.persist.hasHydrated(),
    () => false
  )
  const completedCheckoutRef = useRef<string | null>(null)

  useEffect(() => {
    if (!callbackIsValid) return

    const controller = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let processingPolls = 0

    const verify = async () => {
      try {
        const result = await getPaymentStatus(
          orderId,
          reference,
          controller.signal
        )

        if (controller.signal.aborted) return

        if (result.status === "confirmed") {
          setView("confirmed")
          return
        }

        if (result.status === "unknown") {
          setView("unknown")
          return
        }

        if (processingPolls >= MAX_PROCESSING_POLLS) {
          setView("processing")
          return
        }

        processingPolls += 1
        const retryDelay =
          result.retry_after_ms === DEFAULT_RETRY_DELAY_MS
            ? result.retry_after_ms
            : DEFAULT_RETRY_DELAY_MS
        retryTimer = setTimeout(verify, retryDelay)
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setView("unknown")
        }
      }
    }

    void verify()

    return () => {
      controller.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [callbackIsValid, orderId, reference, verificationRun])

  useEffect(() => {
    if (view !== "confirmed" || !hasHydratedCart) return

    const checkoutKey = `${orderId}:${reference}`
    if (completedCheckoutRef.current === checkoutKey) return
    completedCheckoutRef.current = checkoutKey

    const pendingCheckout = readPendingCheckout(orderId, reference)
    if (
      pendingCheckout &&
      pendingCheckout.cart_fingerprint === createCartFingerprint(items)
    ) {
      clearCart()
    }
    if (pendingCheckout) {
      removeCheckoutAttemptForCart(pendingCheckout.cart_fingerprint)
    }
    removePendingCheckout(orderId, reference)

    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#f59e0b", "#18181b", "#ffffff", "#10b981"],
    })
  }, [
    clearCart,
    hasHydratedCart,
    items,
    orderId,
    reference,
    view,
  ])

  const checkAgain = () => {
    if (!callbackIsValid) return
    setView("verifying")
    setVerificationRun((current) => current + 1)
  }

  if (view === "confirmed") {
    return (
      <PaymentStateShell>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
          className="mx-auto flex size-24 items-center justify-center rounded-full bg-emerald-500 text-white"
        >
          <Check className="size-12" aria-hidden="true" />
        </motion.div>
        <h1 className="mt-6 text-3xl font-bold text-zinc-900">
          Payment confirmed
        </h1>
        <p className="mt-2 font-medium text-emerald-600">
          Your order has been confirmed
        </p>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          Your order is now ready for the next stage of processing.
        </p>
        <Reference reference={reference} />
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-6 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
        >
          Continue Shopping
        </Link>
      </PaymentStateShell>
    )
  }

  if (view === "processing") {
    return (
      <PaymentStateShell>
        <StatusIcon tone="amber">
          <Clock3 className="size-10" aria-hidden="true" />
        </StatusIcon>
        <h1 className="mt-6 text-3xl font-bold text-zinc-900">
          Confirmation is still processing
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          We have not received final confirmation yet. You do not need to pay
          again. Check again shortly or keep this reference for support.
        </p>
        <Reference reference={reference} />
        <RecoveryActions onCheckAgain={checkAgain} />
      </PaymentStateShell>
    )
  }

  if (view === "unknown") {
    return (
      <PaymentStateShell>
        <StatusIcon tone="neutral">
          <CircleHelp className="size-10" aria-hidden="true" />
        </StatusIcon>
        <h1 className="mt-6 text-3xl font-bold text-zinc-900">
          Payment could not yet be confirmed
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          Check that you used the return link from Paystack, then try again. If
          you need help, keep your payment reference and contact support. Your
          cart has not been cleared.
        </p>
        {reference && <Reference reference={reference} />}
        <RecoveryActions
          onCheckAgain={checkAgain}
          canCheckAgain={callbackIsValid}
        />
      </PaymentStateShell>
    )
  }

  return (
    <PaymentStateShell>
      <StatusIcon tone="neutral">
        <Loader2 className="size-10 animate-spin" aria-hidden="true" />
      </StatusIcon>
      <h1 className="mt-6 text-3xl font-bold text-zinc-900">
        Checking payment status
      </h1>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Please wait while we check for a confirmed payment. Your cart will
        remain available until confirmation is complete.
      </p>
    </PaymentStateShell>
  )
}

function PaymentStateShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-16"
      aria-live="polite"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-xl">
        {children}
      </div>
    </main>
  )
}

function StatusIcon({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: "neutral" | "amber"
}) {
  return (
    <span
      className={
        tone === "amber"
          ? "mx-auto flex size-20 items-center justify-center rounded-full bg-amber-100 text-amber-700"
          : "mx-auto flex size-20 items-center justify-center rounded-full bg-zinc-100 text-zinc-600"
      }
    >
      {children}
    </span>
  )
}

function Reference({ reference }: { reference: string }) {
  return (
    <p className="mt-5 break-all rounded-lg bg-zinc-50 p-3 font-mono text-sm text-zinc-600">
      Reference: {reference}
    </p>
  )
}

function RecoveryActions({
  onCheckAgain,
  canCheckAgain = true,
}: {
  onCheckAgain: () => void
  canCheckAgain?: boolean
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <Button
        type="button"
        onClick={onCheckAgain}
        disabled={!canCheckAgain}
        className="min-h-11 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700"
      >
        <RefreshCw className="mr-2 size-4" aria-hidden="true" />
        Check Again
      </Button>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900"
      >
        Continue Shopping
      </Link>
    </div>
  )
}
