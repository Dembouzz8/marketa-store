import type { CartItem } from "@/types"

export const PENDING_CHECKOUT_STORAGE_KEY = "marketa-pending-checkout"
export const CHECKOUT_ATTEMPT_STORAGE_KEY = "marketa-checkout-attempt"
export const CHECKOUT_ATTEMPT_REUSE_MS = 30 * 60 * 1000

export const PAYMENT_STATUS_VALUES = [
  "confirmed",
  "processing",
  "unknown",
] as const

export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number]

export interface PendingCheckoutSnapshot {
  order_id: string
  reference: string
  cart_fingerprint: string
  created_at: string
}

export interface CheckoutAttemptSnapshot {
  checkout_attempt_id: string
  cart_fingerprint: string
  created_at: string
}

export interface PaymentStatusResponse {
  status: PaymentStatus
  retry_after_ms?: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFERENCE_PATTERN = /^[A-Za-z0-9._=-]{1,100}$/

export function isOrderId(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function isPaymentReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value)
}

export function createCartFingerprint(
  items: Array<Pick<CartItem, "product" | "quantity">>
): string {
  return JSON.stringify(
    items
      .map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
      }))
      .sort((left, right) => left.product_id.localeCompare(right.product_id))
  )
}

function readStoredCheckoutAttempt(): CheckoutAttemptSnapshot | null {
  try {
    const stored = sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
    if (!stored) return null

    const value = JSON.parse(stored) as Partial<CheckoutAttemptSnapshot>
    const createdAt = Date.parse(value.created_at ?? "")
    if (
      typeof value.checkout_attempt_id !== "string" ||
      !isOrderId(value.checkout_attempt_id) ||
      typeof value.cart_fingerprint !== "string" ||
      !Number.isFinite(createdAt)
    ) {
      return null
    }

    return {
      checkout_attempt_id: value.checkout_attempt_id,
      cart_fingerprint: value.cart_fingerprint,
      created_at: value.created_at as string,
    }
  } catch {
    return null
  }
}

export function obtainCheckoutAttempt(
  cartFingerprint: string
): CheckoutAttemptSnapshot {
  const stored = readStoredCheckoutAttempt()
  const createdAt = stored ? Date.parse(stored.created_at) : 0
  if (
    stored &&
    stored.cart_fingerprint === cartFingerprint &&
    Date.now() - createdAt < CHECKOUT_ATTEMPT_REUSE_MS
  ) {
    return stored
  }

  const snapshot: CheckoutAttemptSnapshot = {
    checkout_attempt_id: crypto.randomUUID(),
    cart_fingerprint: cartFingerprint,
    created_at: new Date().toISOString(),
  }

  try {
    sessionStorage.setItem(
      CHECKOUT_ATTEMPT_STORAGE_KEY,
      JSON.stringify(snapshot)
    )
  } catch {
    // The in-memory value still makes this submission valid.
  }

  return snapshot
}

export function removeCheckoutAttempt(checkoutAttemptId: string): void {
  const stored = readStoredCheckoutAttempt()
  if (!stored || stored.checkout_attempt_id !== checkoutAttemptId) return

  try {
    sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
  } catch {
    // Storage may be unavailable. Server-side idempotency remains authoritative.
  }
}

export function removeCheckoutAttemptForCart(cartFingerprint: string): void {
  const stored = readStoredCheckoutAttempt()
  if (!stored || stored.cart_fingerprint !== cartFingerprint) return

  try {
    sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
  } catch {
    // Storage may be unavailable. Payment confirmation remains unaffected.
  }
}

export function savePendingCheckout(
  snapshot: PendingCheckoutSnapshot
): boolean {
  try {
    sessionStorage.setItem(
      PENDING_CHECKOUT_STORAGE_KEY,
      JSON.stringify(snapshot)
    )
    return true
  } catch {
    return false
  }
}

export function readPendingCheckout(
  orderId: string,
  reference: string
): PendingCheckoutSnapshot | null {
  try {
    const stored = sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)
    if (!stored) return null

    const value = JSON.parse(stored) as Partial<PendingCheckoutSnapshot>
    if (
      value.order_id !== orderId ||
      value.reference !== reference ||
      typeof value.cart_fingerprint !== "string" ||
      typeof value.created_at !== "string"
    ) {
      return null
    }

    return {
      order_id: value.order_id,
      reference: value.reference,
      cart_fingerprint: value.cart_fingerprint,
      created_at: value.created_at,
    }
  } catch {
    return null
  }
}

export function removePendingCheckout(
  orderId: string,
  reference: string
): void {
  if (!readPendingCheckout(orderId, reference)) return

  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY)
  } catch {
    // Storage may be unavailable. The verified payment state is unaffected.
  }
}

export async function getPaymentStatus(
  orderId: string,
  reference: string,
  signal: AbortSignal
): Promise<PaymentStatusResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Payment verification is not configured.")
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/payment-status`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId, reference }),
    cache: "no-store",
    signal,
  })
  const data = (await response.json().catch(() => null)) as
    | Partial<PaymentStatusResponse>
    | null

  if (
    !response.ok ||
    !data ||
    !PAYMENT_STATUS_VALUES.includes(data.status as PaymentStatus)
  ) {
    throw new Error("Unable to verify payment status.")
  }

  return {
    status: data.status as PaymentStatus,
    ...(data.status === "processing" &&
    typeof data.retry_after_ms === "number"
      ? { retry_after_ms: data.retry_after_ms }
      : {}),
  }
}
