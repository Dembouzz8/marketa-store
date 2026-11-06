import type {
  PublicProductVariantAxis,
  PublicProductVariantCombination,
  PublicProductVariantMode,
  PublicProductVariantProjection,
  PublicProductVariantSelection,
  PublicProductVariantValue,
} from "@/types"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SWATCH_PATTERN = /^#[0-9A-Fa-f]{6}$/
const PUBLIC_VARIANT_MODES = [
  "size",
  "colour",
  "size_colour",
  "options",
] as const satisfies readonly PublicProductVariantMode[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null
  return value.toLowerCase()
}

function isDisplayLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 80 &&
    value === value.trim()
  )
}

function isPosition(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function isStock(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647
}

function isMode(value: unknown): value is PublicProductVariantMode {
  return PUBLIC_VARIANT_MODES.includes(value as PublicProductVariantMode)
}

function parseValue(input: unknown): PublicProductVariantValue | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["id", "label", "position", "swatch_hex"]) ||
    !isDisplayLabel(input.label) ||
    !isPosition(input.position, 0, 2_147_483_647) ||
    (input.swatch_hex !== null &&
      (typeof input.swatch_hex !== "string" || !SWATCH_PATTERN.test(input.swatch_hex)))
  ) {
    return null
  }

  const id = normalizeUuid(input.id)
  if (!id) return null

  return {
    id,
    label: input.label,
    position: input.position,
    swatch_hex: input.swatch_hex,
  }
}

function parseAxis(input: unknown): PublicProductVariantAxis | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["id", "label", "position", "values"]) ||
    !isDisplayLabel(input.label) ||
    !isPosition(input.position, 1, 3) ||
    !Array.isArray(input.values) ||
    input.values.length < 1 ||
    input.values.length > 100
  ) {
    return null
  }

  const id = normalizeUuid(input.id)
  if (!id) return null

  const values: PublicProductVariantValue[] = []
  const valueIds = new Set<string>()
  let previousPosition = -1
  for (const candidate of input.values) {
    const value = parseValue(candidate)
    if (
      !value ||
      valueIds.has(value.id) ||
      value.position <= previousPosition
    ) {
      return null
    }
    valueIds.add(value.id)
    previousPosition = value.position
    values.push(value)
  }

  return { id, label: input.label, position: input.position, values }
}

function parseSelection(input: unknown): PublicProductVariantSelection | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["axis_id", "value_id"]) ||
    typeof input.axis_id !== "string" ||
    typeof input.value_id !== "string"
  ) {
    return null
  }
  return { axis_id: input.axis_id, value_id: input.value_id }
}

function parseCombination(
  input: unknown,
  axes: readonly PublicProductVariantAxis[]
): PublicProductVariantCombination | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["variant_id", "stock", "selections"]) ||
    !isStock(input.stock) ||
    !Array.isArray(input.selections) ||
    input.selections.length !== axes.length
  ) {
    return null
  }

  const variantId = normalizeUuid(input.variant_id)
  if (!variantId) return null

  const selections: PublicProductVariantSelection[] = []
  for (let index = 0; index < axes.length; index += 1) {
    const selection = parseSelection(input.selections[index])
    const axis = axes[index]
    if (!selection || !axis) return null

    const normalizedAxisId = normalizeUuid(selection.axis_id)
    const normalizedValueId = normalizeUuid(selection.value_id)
    if (
      !normalizedAxisId ||
      !normalizedValueId ||
      normalizedAxisId !== axis.id ||
      !axis.values.some((value) => value.id === normalizedValueId)
    ) {
      return null
    }
    selections.push({ axis_id: normalizedAxisId, value_id: normalizedValueId })
  }

  return { variant_id: variantId, stock: input.stock, selections }
}

function hasExpectedLegacyAxes(
  mode: PublicProductVariantMode,
  axes: readonly PublicProductVariantAxis[]
): boolean {
  if (mode === "options") return true
  if (mode === "size") {
    return axes.length === 1 && axes[0]?.label === "Size" && axes[0]?.position === 1
  }
  if (mode === "colour") {
    return axes.length === 1 && axes[0]?.label === "Colour" && axes[0]?.position === 1
  }
  return (
    axes.length === 2 &&
    axes[0]?.label === "Size" &&
    axes[0]?.position === 1 &&
    axes[1]?.label === "Colour" &&
    axes[1]?.position === 2
  )
}

/**
 * Parses the D3-A1 public JSONB contract. Any unexpected field, identity,
 * ordering, relationship, or duplicate causes a fail-closed null result.
 */
export function parsePublicProductVariantProjection(
  input: unknown,
  expectedProductId?: string
): PublicProductVariantProjection | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["product_id", "variant_mode", "axes", "combinations"]) ||
    !isMode(input.variant_mode) ||
    !Array.isArray(input.axes) ||
    input.axes.length < 1 ||
    input.axes.length > 3 ||
    !Array.isArray(input.combinations) ||
    input.combinations.length < 1 ||
    input.combinations.length > 100
  ) {
    return null
  }

  const productId = normalizeUuid(input.product_id)
  const expectedId = expectedProductId ? normalizeUuid(expectedProductId) : null
  if (!productId || (expectedProductId !== undefined && expectedId !== productId)) {
    return null
  }

  const axes: PublicProductVariantAxis[] = []
  const axisIds = new Set<string>()
  const valueOwners = new Map<string, string>()
  let previousPosition = 0
  for (const candidate of input.axes) {
    const axis = parseAxis(candidate)
    if (
      !axis ||
      axisIds.has(axis.id) ||
      axis.position <= previousPosition
    ) {
      return null
    }
    axisIds.add(axis.id)
    previousPosition = axis.position
    for (const value of axis.values) {
      const existingOwner = valueOwners.get(value.id)
      if (existingOwner && existingOwner !== axis.id) return null
      valueOwners.set(value.id, axis.id)
    }
    axes.push(axis)
  }
  if (!hasExpectedLegacyAxes(input.variant_mode, axes)) return null

  const combinations: PublicProductVariantCombination[] = []
  const variantIds = new Set<string>()
  const combinationIdentities = new Set<string>()
  for (const candidate of input.combinations) {
    const combination = parseCombination(candidate, axes)
    if (!combination || variantIds.has(combination.variant_id)) return null

    const identity = combination.selections
      .map((selection) => `${selection.axis_id}=${selection.value_id}`)
      .join("|")
    if (combinationIdentities.has(identity)) return null

    variantIds.add(combination.variant_id)
    combinationIdentities.add(identity)
    combinations.push(combination)
  }

  return {
    product_id: productId,
    variant_mode: input.variant_mode,
    axes,
    combinations,
  }
}
