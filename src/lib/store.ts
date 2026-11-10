"use client"

import { useStore } from "zustand"
import { persist } from "zustand/middleware"
import { createStore } from "zustand/vanilla"

import {
  normalizeCartItemsV1,
  normalizeCartUuid,
} from "@/lib/cart-model"
import {
  createCartPersistOptions,
  createCartPersistStorage,
  type CartPersistenceController,
  type CartPersistenceHealth,
  type CartPersistenceStatus,
} from "@/lib/cart-storage"
import type { CartItemV1 } from "@/types"

export const MAX_CART_TOTAL_KOBO = BigInt("999999999999")

const MAX_CART_ITEMS = 50
const MAX_CART_QUANTITY = 99
const MAX_CART_UNIT_PRICE_KOBO =
  MAX_CART_TOTAL_KOBO / BigInt(MAX_CART_QUANTITY)
const EXACT_PRICE_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/

export type CartMutationResult =
  | "applied"
  | "blocked"
  | "invalid"
  | "persistence-failed"

export type CartTotalResult =
  | {
      valid: true
      totalKobo: bigint
      total: number
    }
  | {
      valid: false
      reason:
        | "INVALID_ITEM"
        | "INVALID_PRICE"
        | "INVALID_QUANTITY"
        | "OVER_LIMIT"
    }

export type CartCheckoutBlockReason =
  | "NOT_HYDRATED"
  | "STORAGE_UNSAFE"
  | "EMPTY_CART"
  | "TOO_MANY_ITEMS"
  | "VARIANT_UNSUPPORTED"
  | "UNKNOWN_KIND"
  | "INVALID_ITEM"
  | "DUPLICATE_PRODUCT"
  | "INVALID_TOTAL"

export type CartCheckoutEvaluation =
  | {
      eligible: true
      total: Extract<CartTotalResult, { valid: true }>
    }
  | {
      eligible: false
      reason: CartCheckoutBlockReason
      total: CartTotalResult
    }

export interface CartState {
  items: CartItemV1[]
  isCartOpen: boolean
  addItem: (item: CartItemV1) => CartMutationResult
  removeItem: (cartLineId: string) => CartMutationResult
  updateQuantity: (
    cartLineId: string,
    quantity: number
  ) => CartMutationResult
  clearCart: () => CartMutationResult
  totalItems: () => number
  totalPrice: () => CartTotalResult
}

export interface CartVisibilityState {
  isCartOpen: boolean
  setCartOpen: (open: boolean) => void
}

export interface CreateCartStoreOptions {
  controller?: CartPersistenceController
  skipHydration?: boolean
}

const SERVER_PERSISTENCE_HEALTH: CartPersistenceHealth = Object.freeze({
  status: "unchecked",
  operation: "idle",
  diagnostic: null,
  hasStoredValue: null,
  revision: 0,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePriceToKobo(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }

  const match = EXACT_PRICE_PATTERN.exec(String(value))
  if (!match) return null

  const whole = BigInt(match[1])
  const fractional = BigInt((match[2] ?? "").padEnd(2, "0"))
  const kobo = whole * BigInt(100) + fractional

  return Number(kobo) / 100 === value && kobo <= MAX_CART_UNIT_PRICE_KOBO
    ? kobo
    : null
}

export function calculateCartTotal(items: unknown): CartTotalResult {
  if (!Array.isArray(items)) {
    return { valid: false, reason: "INVALID_ITEM" }
  }

  let totalKobo = BigInt(0)

  for (const candidate of items) {
    if (
      !isRecord(candidate) ||
      (candidate.kind !== "ordinary" && candidate.kind !== "variant") ||
      !isRecord(candidate.product)
    ) {
      return { valid: false, reason: "INVALID_ITEM" }
    }

    const unitPriceKobo = parsePriceToKobo(candidate.product.price)
    if (unitPriceKobo === null) {
      return { valid: false, reason: "INVALID_PRICE" }
    }

    if (
      typeof candidate.quantity !== "number" ||
      !Number.isSafeInteger(candidate.quantity) ||
      candidate.quantity < 1 ||
      candidate.quantity > MAX_CART_QUANTITY
    ) {
      return { valid: false, reason: "INVALID_QUANTITY" }
    }

    const lineTotalKobo = unitPriceKobo * BigInt(candidate.quantity)
    if (lineTotalKobo > MAX_CART_TOTAL_KOBO) {
      return { valid: false, reason: "OVER_LIMIT" }
    }

    totalKobo += lineTotalKobo
    if (totalKobo > MAX_CART_TOTAL_KOBO) {
      return { valid: false, reason: "OVER_LIMIT" }
    }
  }

  return {
    valid: true,
    totalKobo,
    total: Number(totalKobo) / 100,
  }
}

export function evaluateOrdinaryCartCheckout(
  items: unknown,
  hasHydrated: boolean,
  persistenceStatus: CartPersistenceStatus
): CartCheckoutEvaluation {
  const total = calculateCartTotal(items)

  if (!hasHydrated) {
    return { eligible: false, reason: "NOT_HYDRATED", total }
  }

  if (persistenceStatus !== "healthy") {
    return { eligible: false, reason: "STORAGE_UNSAFE", total }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { eligible: false, reason: "EMPTY_CART", total }
  }

  if (items.length > MAX_CART_ITEMS) {
    return { eligible: false, reason: "TOO_MANY_ITEMS", total }
  }

  const productIds = new Set<string>()

  for (const candidate of items) {
    if (!isRecord(candidate)) {
      return { eligible: false, reason: "UNKNOWN_KIND", total }
    }

    if (candidate.kind === "variant") {
      return { eligible: false, reason: "VARIANT_UNSUPPORTED", total }
    }

    if (candidate.kind !== "ordinary") {
      return { eligible: false, reason: "UNKNOWN_KIND", total }
    }

    const normalized = normalizeCartItemsV1([candidate])
    const item = normalized[0]
    const candidateProduct = isRecord(candidate.product)
      ? candidate.product
      : null
    const productId = candidateProduct
      ? normalizeCartUuid(candidateProduct.id)
      : null

    if (
      normalized.length !== 1 ||
      !item ||
      item.kind !== "ordinary" ||
      !productId ||
      candidateProduct?.id !== productId ||
      candidate.cartLineId !== item.cartLineId ||
      candidate.quantity !== item.quantity
    ) {
      return { eligible: false, reason: "INVALID_ITEM", total }
    }

    if (productIds.has(productId)) {
      return { eligible: false, reason: "DUPLICATE_PRODUCT", total }
    }
    productIds.add(productId)
  }

  if (!total.valid) {
    return { eligible: false, reason: "INVALID_TOTAL", total }
  }

  return { eligible: true, total }
}

export function cartCheckoutBlockMessage(
  reason: CartCheckoutBlockReason
): string {
  switch (reason) {
    case "NOT_HYDRATED":
      return "Your saved cart is still loading. Please wait a moment."
    case "STORAGE_UNSAFE":
      return "Checkout is unavailable until this cart can be stored safely."
    case "VARIANT_UNSUPPORTED":
      return "Products with selected options cannot be purchased yet. Remove them to continue."
    case "INVALID_TOTAL":
      return "The cart total cannot be processed safely. Review your cart before checkout."
    case "EMPTY_CART":
      return "Add at least one product before checkout."
    default:
      return "Review the products and quantities in your cart before checkout."
  }
}

export function cartPersistenceMessage(
  hasHydrated: boolean,
  status: CartPersistenceStatus
): string | null {
  if (!hasHydrated || status === "unchecked") {
    return "Your saved cart is still loading."
  }
  if (status === "incompatible") {
    return "This saved cart was created by a newer version of Marketa. Its data is protected, so changes and checkout are disabled."
  }
  if (status === "unavailable") {
    return "Cart storage is unavailable. Changes and checkout are disabled to protect your saved cart."
  }
  if (status === "corrupt") {
    return "Some saved cart data could not be read. Add, update, or clear the cart to repair it before checkout."
  }
  return null
}

function persistenceAllowsMutation(
  controller: CartPersistenceController,
  hasHydrated: () => boolean
): boolean {
  if (!hasHydrated()) return false
  const status = controller.health.getSnapshot().status
  return status === "healthy" || status === "corrupt"
}

function resultAfterMutation(
  controller: CartPersistenceController
): CartMutationResult {
  return controller.health.getSnapshot().status === "healthy"
    ? "applied"
    : "persistence-failed"
}

export function createCartStore({
  controller = createCartPersistStorage(),
  skipHydration = true,
}: CreateCartStoreOptions = {}) {
  let hasHydrated = () => false

  const store = createStore<CartState>()(
    persist(
      (set, get) => ({
        items: [],
        isCartOpen: false,
        addItem: (input) => {
          if (!persistenceAllowsMutation(controller, hasHydrated)) {
            return "blocked"
          }

          const normalized = normalizeCartItemsV1([input])
          const item = normalized[0]
          if (!item || normalized.length !== 1) return "invalid"

          set((state) => ({
            items: normalizeCartItemsV1([...state.items, item]),
          }))
          return resultAfterMutation(controller)
        },
        removeItem: (cartLineId) => {
          if (!persistenceAllowsMutation(controller, hasHydrated)) {
            return "blocked"
          }
          if (typeof cartLineId !== "string" || cartLineId.length === 0) {
            return "invalid"
          }

          const currentItems = get().items
          const items = currentItems.filter(
            (item) => item.cartLineId !== cartLineId
          )
          if (items.length === currentItems.length) return "invalid"

          set({ items })
          return resultAfterMutation(controller)
        },
        updateQuantity: (cartLineId, quantity) => {
          if (!persistenceAllowsMutation(controller, hasHydrated)) {
            return "blocked"
          }
          if (
            typeof cartLineId !== "string" ||
            cartLineId.length === 0 ||
            !Number.isSafeInteger(quantity)
          ) {
            return "invalid"
          }

          const currentItems = get().items
          if (!currentItems.some((item) => item.cartLineId === cartLineId)) {
            return "invalid"
          }

          if (quantity <= 0) {
            set({
              items: currentItems.filter(
                (item) => item.cartLineId !== cartLineId
              ),
            })
          } else {
            const nextQuantity = Math.min(quantity, MAX_CART_QUANTITY)
            set({
              items: normalizeCartItemsV1(
                currentItems.map((item) =>
                  item.cartLineId === cartLineId
                    ? { ...item, quantity: nextQuantity }
                    : item
                )
              ),
            })
          }

          return resultAfterMutation(controller)
        },
        clearCart: () => {
          if (!persistenceAllowsMutation(controller, hasHydrated)) {
            return "blocked"
          }
          set({ items: [] })
          return resultAfterMutation(controller)
        },
        totalItems: () =>
          get().items.reduce((total, item) => total + item.quantity, 0),
        totalPrice: () => calculateCartTotal(get().items),
      }),
      {
        ...createCartPersistOptions<CartState>(controller.storage),
        skipHydration,
      }
    )
  )

  hasHydrated = () => store.persist.hasHydrated()
  return store
}

export const cartPersistenceController = createCartPersistStorage()
const activeCartStore = createCartStore({
  controller: cartPersistenceController,
  skipHydration: true,
})

export function createCartVisibilityStore() {
  return createStore<CartVisibilityState>()((set) => ({
    isCartOpen: false,
    setCartOpen: (open) => set({ isCartOpen: open }),
  }))
}

const activeCartVisibilityStore = createCartVisibilityStore()

type ActiveCartStore = typeof activeCartStore
type UseCartStore = {
  <T>(selector: (state: CartState) => T): T
} & ActiveCartStore

export const useCartStore: UseCartStore = Object.assign(
  <T>(selector: (state: CartState) => T) =>
    useStore(activeCartStore, selector),
  activeCartStore
)

type ActiveCartVisibilityStore = typeof activeCartVisibilityStore
type UseCartVisibilityStore = {
  <T>(selector: (state: CartVisibilityState) => T): T
} & ActiveCartVisibilityStore

export const useCartVisibilityStore: UseCartVisibilityStore = Object.assign(
  <T>(selector: (state: CartVisibilityState) => T) =>
    useStore(activeCartVisibilityStore, selector),
  activeCartVisibilityStore
)

export function subscribeToCartHydration(onStoreChange: () => void) {
  const unsubscribeHydrate = useCartStore.persist.onHydrate(onStoreChange)
  const unsubscribeFinish =
    useCartStore.persist.onFinishHydration(onStoreChange)
  return () => {
    unsubscribeHydrate()
    unsubscribeFinish()
  }
}

export function getCartHydrationSnapshot(): boolean {
  return useCartStore.persist.hasHydrated()
}

export function getServerCartHydrationSnapshot(): boolean {
  return false
}

export function subscribeToCartPersistence(onStoreChange: () => void) {
  return cartPersistenceController.health.subscribe(onStoreChange)
}

export function getCartPersistenceSnapshot(): CartPersistenceHealth {
  return cartPersistenceController.health.getSnapshot()
}

export function getServerCartPersistenceSnapshot(): CartPersistenceHealth {
  return SERVER_PERSISTENCE_HEALTH
}

if (typeof window !== "undefined") {
  void Promise.resolve(useCartStore.persist.rehydrate()).catch(() => {
    // The storage controller exposes read failures through its health store.
  })
}
