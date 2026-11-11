import { normalizeCartItemsV1 } from "@/lib/cart-model"
import type {
  CheckoutIdentity,
  OrdinaryCheckoutIdentity,
  OrdinaryCheckoutRequestItem,
} from "@/types"

const MAX_CHECKOUT_LINES = 50

export type CheckoutContainmentReason =
  | "EMPTY_CART"
  | "TOO_MANY_ITEMS"
  | "INVALID_ITEM"
  | "UNKNOWN_KIND"
  | "DUPLICATE_IDENTITY"
  | "VARIANT_CART"
  | "MIXED_CART"

export type CheckoutSeparationResult =
  | {
      status: "ordinary"
      identities: OrdinaryCheckoutIdentity[]
      requestItems: OrdinaryCheckoutRequestItem[]
      fingerprint: string
    }
  | {
      status: "contained"
      reason: CheckoutContainmentReason
      identities: CheckoutIdentity[]
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fingerprintOrdinaryItems(
  items: readonly OrdinaryCheckoutRequestItem[]
): string {
  return JSON.stringify(
    [...items].sort((left, right) =>
      left.product_id.localeCompare(right.product_id)
    )
  )
}

function contained(
  reason: CheckoutContainmentReason,
  identities: CheckoutIdentity[] = []
): CheckoutSeparationResult {
  return { status: "contained", reason, identities }
}

/**
 * Classifies every cart line and prepares the existing ordinary checkout
 * request without granting payment authority to persisted display snapshots.
 */
export function prepareCheckoutSeparation(
  value: unknown
): CheckoutSeparationResult {
  if (!Array.isArray(value) || value.length === 0) {
    return contained("EMPTY_CART")
  }
  if (value.length > MAX_CHECKOUT_LINES) {
    return contained("TOO_MANY_ITEMS")
  }

  const identities: CheckoutIdentity[] = []
  const identityKeys = new Set<string>()
  let hasOrdinary = false
  let hasVariant = false

  for (const candidate of value) {
    if (!isRecord(candidate)) return contained("INVALID_ITEM")
    if (candidate.kind !== "ordinary" && candidate.kind !== "variant") {
      return contained("UNKNOWN_KIND")
    }

    const normalizedItems = normalizeCartItemsV1([candidate])
    const item = normalizedItems[0]
    if (
      normalizedItems.length !== 1 ||
      !item ||
      item.kind !== candidate.kind ||
      candidate.cartLineId !== item.cartLineId ||
      candidate.quantity !== item.quantity
    ) {
      return contained("INVALID_ITEM")
    }

    let identity: CheckoutIdentity
    let identityKey: string

    if (item.kind === "ordinary") {
      hasOrdinary = true
      identity = {
        kind: "ordinary",
        product_id: item.product.id,
        quantity: item.quantity,
      }
      identityKey = `ordinary:${item.product.id}`
    } else {
      hasVariant = true
      identity = {
        kind: "variant",
        product_id: item.variant.product_id,
        product_variant_id: item.variant.variant_id,
        quantity: item.quantity,
      }
      identityKey = `variant:${item.variant.product_id}:${item.variant.variant_id}`
    }

    if (identityKeys.has(identityKey)) {
      return contained("DUPLICATE_IDENTITY")
    }
    identityKeys.add(identityKey)
    identities.push(identity)
  }

  if (hasVariant) {
    return contained(hasOrdinary ? "MIXED_CART" : "VARIANT_CART", identities)
  }

  const ordinaryIdentities = identities as OrdinaryCheckoutIdentity[]
  const requestItems = ordinaryIdentities.map(({ product_id, quantity }) => ({
    product_id,
    quantity,
  }))

  return {
    status: "ordinary",
    identities: ordinaryIdentities,
    requestItems,
    fingerprint: fingerprintOrdinaryItems(requestItems),
  }
}

/** Preserves the established ordinary-cart fingerprint and fail-closed API. */
export function createOrdinaryCartFingerprint(value: unknown): string | null {
  // The established function returns the JSON fingerprint for an empty array.
  // Checkout eligibility still rejects empty carts before request preparation.
  if (Array.isArray(value) && value.length === 0) return "[]"

  const result = prepareCheckoutSeparation(value)
  return result.status === "ordinary" ? result.fingerprint : null
}
