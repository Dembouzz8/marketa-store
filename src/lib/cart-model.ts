import { parsePublicProductVariantProjection } from "@/lib/public-product-variants"
import type {
  CartItemV1,
  CartProductSnapshot,
  OrdinaryCartItem,
  PublicProductVariantMode,
  PublicProductVariantProjection,
  SelectedOptionSnapshot,
  StorefrontProduct,
  VariantCartItem,
} from "@/types"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLIC_VARIANT_MODES = [
  "size",
  "colour",
  "size_colour",
  "options",
] as const satisfies readonly PublicProductVariantMode[]
const MAX_QUANTITY = 99
const MAX_STOCK_SNAPSHOT = 2_147_483_647
const EXACT_PRICE_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/
const MAX_NUMERIC_12_2_KOBO = BigInt("999999999999")
const MAX_LINE_UNIT_PRICE_KOBO =
  MAX_NUMERIC_12_2_KOBO / BigInt(MAX_QUANTITY)

export interface BuildOrdinaryCartItemInput {
  product: StorefrontProduct
  quantity: number
}

export interface BuildVariantCartItemInput {
  product: StorefrontProduct
  projection: PublicProductVariantProjection
  variantId: string
  quantity: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isVariantMode(value: unknown): value is PublicProductVariantMode {
  return PUBLIC_VARIANT_MODES.includes(value as PublicProductVariantMode)
}

function isDisplayLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 80 &&
    value === value.trim()
  )
}

function isProductName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    value === value.trim()
  )
}

function parseDisplayPriceToKobo(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }

  const match = EXACT_PRICE_PATTERN.exec(String(value))
  if (!match) return null

  const whole = BigInt(match[1])
  const fractional = BigInt((match[2] ?? "").padEnd(2, "0"))
  const kobo = whole * BigInt(100) + fractional

  // Checkout totals use numeric(12,2). A single line must remain
  // representable at every supported quantity from 1 through 99.
  if (
    kobo > MAX_LINE_UNIT_PRICE_KOBO ||
    Number(kobo) / 100 !== value
  ) {
    return null
  }

  return kobo
}

function isDisplayPrice(value: unknown): value is number {
  return parseDisplayPriceToKobo(value) !== null
}

function isStockSnapshot(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_STOCK_SNAPSHOT
  )
}

function normalizeImages(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((image) => typeof image !== "string")) {
    return null
  }
  return [...value]
}

function normalizeRequestedQuantity(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return null
  }
  return Math.min(value, MAX_QUANTITY)
}

function normalizeProductSnapshot(value: unknown): CartProductSnapshot | null {
  if (!isRecord(value) || !isProductName(value.name) || !isDisplayPrice(value.price)) {
    return null
  }

  const id = normalizeCartUuid(value.id)
  const images = normalizeImages(value.images)
  if (!id || !images) return null

  return { id, name: value.name, price: value.price, images }
}

function expectedAxisCount(mode: PublicProductVariantMode): number | null {
  if (mode === "size" || mode === "colour") return 1
  if (mode === "size_colour") return 2
  return null
}

function hasValidAxisCount(
  mode: PublicProductVariantMode,
  count: number
): boolean {
  const expected = expectedAxisCount(mode)
  return expected === null ? count >= 1 && count <= 3 : count === expected
}

function compareSelectedOptions(
  left: SelectedOptionSnapshot,
  right: SelectedOptionSnapshot
): number {
  if (left.axis_id < right.axis_id) return -1
  if (left.axis_id > right.axis_id) return 1
  return 0
}

function normalizeSelectedOptions(
  value: unknown,
  mode: PublicProductVariantMode
): SelectedOptionSnapshot[] | null {
  if (!Array.isArray(value) || !hasValidAxisCount(mode, value.length)) {
    return null
  }

  const selectedOptions: SelectedOptionSnapshot[] = []
  const axisIds = new Set<string>()
  const valueIds = new Set<string>()

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isDisplayLabel(candidate.axis_label) ||
      !isDisplayLabel(candidate.value_label)
    ) {
      return null
    }

    const axisId = normalizeCartUuid(candidate.axis_id)
    const valueId = normalizeCartUuid(candidate.value_id)
    if (
      !axisId ||
      !valueId ||
      axisIds.has(axisId) ||
      valueIds.has(valueId)
    ) {
      return null
    }

    axisIds.add(axisId)
    valueIds.add(valueId)
    selectedOptions.push({
      axis_id: axisId,
      value_id: valueId,
      axis_label: candidate.axis_label,
      value_label: candidate.value_label,
    })
  }

  return selectedOptions.sort(compareSelectedOptions)
}

function selectedOptionIdentity(options: SelectedOptionSnapshot[]): string {
  return options
    .map((option) => `${option.axis_id}:${option.value_id}`)
    .join("|")
}

function variantSnapshotsAgree(
  left: VariantCartItem,
  right: VariantCartItem
): boolean {
  return (
    left.variant.variant_mode === right.variant.variant_mode &&
    selectedOptionIdentity(left.variant.selected_options) ===
      selectedOptionIdentity(right.variant.selected_options)
  )
}

function mergeNormalizedItems(items: CartItemV1[]): CartItemV1[] {
  const merged: CartItemV1[] = []
  const indices = new Map<string, number>()

  for (const item of items) {
    const existingIndex = indices.get(item.cartLineId)
    if (existingIndex === undefined) {
      indices.set(item.cartLineId, merged.length)
      merged.push(item)
      continue
    }

    const existing = merged[existingIndex]
    if (
      !existing ||
      existing.kind !== item.kind ||
      (existing.kind === "variant" &&
        item.kind === "variant" &&
        !variantSnapshotsAgree(existing, item))
    ) {
      continue
    }

    merged[existingIndex] = {
      ...existing,
      quantity: Math.min(existing.quantity + item.quantity, MAX_QUANTITY),
    }
  }

  return merged
}

function normalizeOrdinaryV1(value: Record<string, unknown>): OrdinaryCartItem | null {
  const product = normalizeProductSnapshot(value.product)
  const quantity = normalizeRequestedQuantity(value.quantity)
  if (!product || !quantity || !isStockSnapshot(value.stock_snapshot)) {
    return null
  }

  const cartLineId = ordinaryCartLineId(product.id)
  if (!cartLineId) return null

  return {
    kind: "ordinary",
    cartLineId,
    product,
    quantity,
    stock_snapshot: value.stock_snapshot,
  }
}

function normalizeVariantV1(value: Record<string, unknown>): VariantCartItem | null {
  const product = normalizeProductSnapshot(value.product)
  const quantity = normalizeRequestedQuantity(value.quantity)
  if (!product || !quantity || !isRecord(value.variant)) return null

  const productId = normalizeCartUuid(value.variant.product_id)
  const variantId = normalizeCartUuid(value.variant.variant_id)
  const mode = value.variant.variant_mode
  if (
    !productId ||
    !variantId ||
    productId !== product.id ||
    !isVariantMode(mode) ||
    !isStockSnapshot(value.variant.stock_snapshot)
  ) {
    return null
  }

  const selectedOptions = normalizeSelectedOptions(
    value.variant.selected_options,
    mode
  )
  const cartLineId = variantCartLineId(productId, variantId)
  if (!selectedOptions || !cartLineId) return null

  return {
    kind: "variant",
    cartLineId,
    product,
    quantity,
    variant: {
      product_id: productId,
      variant_id: variantId,
      variant_mode: mode,
      stock_snapshot: value.variant.stock_snapshot,
      selected_options: selectedOptions,
    },
  }
}

/** Returns a lowercase UUID or null using the D3-A1 UUID syntax. */
export function normalizeCartUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null
  return value.toLowerCase()
}

export function ordinaryCartLineId(productId: unknown): string | null {
  const normalizedProductId = normalizeCartUuid(productId)
  return normalizedProductId ? `ordinary:${normalizedProductId}` : null
}

export function variantCartLineId(
  productId: unknown,
  variantId: unknown
): string | null {
  const normalizedProductId = normalizeCartUuid(productId)
  const normalizedVariantId = normalizeCartUuid(variantId)
  return normalizedProductId && normalizedVariantId
    ? `variant:${normalizedProductId}:${normalizedVariantId}`
    : null
}

export function buildOrdinaryCartItem(
  input: BuildOrdinaryCartItemInput
): OrdinaryCartItem | null
export function buildOrdinaryCartItem(input: unknown): OrdinaryCartItem | null {
  if (!isRecord(input) || !isRecord(input.product)) return null

  const product = input.product
  const quantity = input.quantity
  if (product.variant_mode !== "none") return null

  const productSnapshot = normalizeProductSnapshot(product)
  const normalizedQuantity = normalizeRequestedQuantity(quantity)
  if (
    !productSnapshot ||
    !normalizedQuantity ||
    !isStockSnapshot(product.stock)
  ) {
    return null
  }

  const cartLineId = ordinaryCartLineId(productSnapshot.id)
  if (!cartLineId) return null

  return {
    kind: "ordinary",
    cartLineId,
    product: productSnapshot,
    quantity: normalizedQuantity,
    stock_snapshot: product.stock,
  }
}

export function buildVariantCartItem(
  input: BuildVariantCartItemInput
): VariantCartItem | null
export function buildVariantCartItem(input: unknown): VariantCartItem | null {
  if (!isRecord(input) || !isRecord(input.product)) return null

  const product = input.product
  const productSnapshot = normalizeProductSnapshot(product)
  const productId = normalizeCartUuid(product.id)
  const normalizedVariantId = normalizeCartUuid(input.variantId)
  const normalizedQuantity = normalizeRequestedQuantity(input.quantity)

  if (
    !productSnapshot ||
    !productId ||
    product.variant_mode === "none" ||
    !isVariantMode(product.variant_mode) ||
    !normalizedVariantId ||
    !normalizedQuantity
  ) {
    return null
  }

  const projection = parsePublicProductVariantProjection(
    input.projection,
    productId
  )
  if (!projection || projection.variant_mode !== product.variant_mode) return null

  const combination = projection.combinations.find(
    (candidate) => candidate.variant_id === normalizedVariantId
  )
  if (
    !combination ||
    combination.stock <= 0
  ) {
    return null
  }

  const selectedOptions: SelectedOptionSnapshot[] = []
  for (const selection of combination.selections) {
    const axis = projection.axes.find(
      (candidate) => candidate.id === selection.axis_id
    )
    const value = axis?.values.find(
      (candidate) => candidate.id === selection.value_id
    )
    if (!axis || !value) return null

    selectedOptions.push({
      axis_id: axis.id,
      value_id: value.id,
      axis_label: axis.label,
      value_label: value.label,
    })
  }
  selectedOptions.sort(compareSelectedOptions)

  const cartLineId = variantCartLineId(productId, normalizedVariantId)
  if (!cartLineId) return null

  return {
    kind: "variant",
    cartLineId,
    product: productSnapshot,
    quantity: normalizedQuantity,
    variant: {
      product_id: productId,
      variant_id: normalizedVariantId,
      variant_mode: product.variant_mode,
      stock_snapshot: combination.stock,
      selected_options: selectedOptions,
    },
  }
}

/** Converts untrusted version-0 `{ product, quantity }` entries. */
export function normalizeLegacyCartItems(value: unknown): OrdinaryCartItem[] {
  if (!Array.isArray(value)) return []

  const normalized: OrdinaryCartItem[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || !isRecord(candidate.product)) continue

    const legacyMode = candidate.product.variant_mode
    if (legacyMode !== undefined && legacyMode !== "none") continue

    const product = normalizeProductSnapshot(candidate.product)
    const quantity = normalizeRequestedQuantity(candidate.quantity)
    if (!product || !quantity || !isStockSnapshot(candidate.product.stock)) {
      continue
    }

    const cartLineId = ordinaryCartLineId(product.id)
    if (!cartLineId) continue

    normalized.push({
      kind: "ordinary",
      cartLineId,
      product,
      quantity,
      stock_snapshot: candidate.product.stock,
    })
  }

  return mergeNormalizedItems(normalized).filter(
    (item): item is OrdinaryCartItem => item.kind === "ordinary"
  )
}

/** Validates untrusted version-1 entries without granting purchase authority. */
export function normalizeCartItemsV1(value: unknown): CartItemV1[] {
  if (!Array.isArray(value)) return []

  const normalized: CartItemV1[] = []
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    if (candidate.kind === "ordinary") {
      const item = normalizeOrdinaryV1(candidate)
      if (item) normalized.push(item)
    } else if (candidate.kind === "variant") {
      const item = normalizeVariantV1(candidate)
      if (item) normalized.push(item)
    }
  }

  return mergeNormalizedItems(normalized)
}
