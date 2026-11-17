const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const DECIMAL_PATTERN = /^(0|[1-9][0-9]{0,11})(?:[.]([0-9]{1,6}))?$/
const STORED_NAIRA_PATTERN = /^(0|[1-9][0-9]*)(?:[.]([0-9]{1,2}))?$/
const MAX_KOBO = BigInt("999999999999")
const ZERO = BigInt(0)
const ONE_HUNDRED = BigInt(100)

const SNAPSHOT_KEYS = [
  "schema_version",
  "variant_id",
  "product_id",
  "vendor_id",
  "combination_signature",
  "options",
] as const

const OPTION_KEYS = [
  "axis_id",
  "axis_position",
  "axis_display_name",
  "option_code",
  "value_kind",
  "value_id",
  "value_display_label",
  "numeric_value",
  "unit_code",
  "unit_name",
  "unit_symbol",
  "size_system_code",
  "size_system_name",
] as const

export type OrderItemSnapshotInput = Readonly<{
  quantity: unknown
  product_id?: unknown
  vendor_id?: unknown
  product_variant_id?: unknown
  variant_size_snapshot?: unknown
  variant_colour_snapshot?: unknown
  variant_options_snapshot?: unknown
  unit_price?: unknown
  subtotal?: unknown
  unit_amount_kobo?: unknown
  gross_amount_kobo?: unknown
  platform_fee_bps?: unknown
  platform_fee_amount_kobo?: unknown
  vendor_net_amount_kobo?: unknown
  currency?: unknown
  financial_contract_version?: unknown
}>

export type VariantOptionPresentation = Readonly<{
  axisPosition: number
  axisLabel: string
  valueLabel: string
  valueKind: "label" | "measurement" | "colour"
  numericValue: string | null
  unitCode: string | null
  unitName: string | null
  unitSymbol: string | null
  sizeSystemCode: string | null
  sizeSystemName: string | null
}>

export type VariantPresentation = Readonly<{
  kind: "ordinary" | "legacy" | "generalized" | "unavailable"
  options: readonly VariantOptionPresentation[]
  fallback: string | null
}>

export type FinancialPresentation = Readonly<{
  contract: "legacy" | "versioned" | "unavailable"
  version: 1 | 2 | null
  unitAmountKobo: bigint | null
  grossAmountKobo: bigint | null
  platformFeeBps: number | null
  platformFeeAmountKobo: bigint | null
  vendorNetAmountKobo: bigint | null
}>

export type OrderItemPresentation = Readonly<{
  quantity: number | null
  variant: VariantPresentation
  financial: FinancialPresentation
}>

export type FinancialAggregation = Readonly<{
  grossAmountKobo: bigint | null
  platformFeeAmountKobo: bigint | null
  vendorNetAmountKobo: bigint | null
}>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function validTrimmedString(value: unknown, maximum: number) {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    [...value.trim()].length <= maximum
  )
}

function nullableString(
  value: unknown,
  maximum: number,
  pattern?: RegExp
): value is string | null {
  return (
    value === null ||
    (validTrimmedString(value, maximum) &&
      (!pattern || pattern.test(value as string)))
  )
}

function parseQuantity(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 99
    ? value
    : null
}

function parseKobo(value: unknown, allowZero: boolean): bigint | null {
  let amount: bigint

  try {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) return null
      amount = BigInt(value)
    } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
      amount = BigInt(value)
    } else {
      return null
    }
  } catch {
    return null
  }

  if (amount < ZERO || amount > MAX_KOBO || (!allowZero && amount === ZERO)) {
    return null
  }

  return amount
}

function parseStoredNaira(value: unknown): bigint | null {
  if (typeof value !== "number" && typeof value !== "string") return null

  const text = String(value)
  const match = STORED_NAIRA_PATTERN.exec(text)
  if (!match) return null

  try {
    const amount =
      BigInt(match[1]) * ONE_HUNDRED +
      BigInt((match[2] ?? "").padEnd(2, "0"))
    return amount > ZERO && amount <= MAX_KOBO ? amount : null
  } catch {
    return null
  }
}

function unavailableVariant(): VariantPresentation {
  return {
    kind: "unavailable",
    options: [],
    fallback: "Variant details unavailable",
  }
}

function parseGeneralizedVariant(
  value: unknown,
  input: OrderItemSnapshotInput
): VariantPresentation | null {
  if (!isPlainObject(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return null

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }

  if (byteLength(serialized) > 16_384) return null
  if (
    value.schema_version !== 1 ||
    typeof value.variant_id !== "string" ||
    !UUID_PATTERN.test(value.variant_id) ||
    typeof value.product_id !== "string" ||
    !UUID_PATTERN.test(value.product_id) ||
    typeof value.vendor_id !== "string" ||
    !UUID_PATTERN.test(value.vendor_id) ||
    typeof value.combination_signature !== "string" ||
    byteLength(value.combination_signature) < 73 ||
    byteLength(value.combination_signature) > 221 ||
    !Array.isArray(value.options) ||
    value.options.length < 1 ||
    value.options.length > 3 ||
    value.variant_id !== input.product_variant_id ||
    value.product_id !== input.product_id ||
    value.vendor_id !== input.vendor_id
  ) {
    return null
  }

  const axisIds = new Set<string>()
  const axisPositions = new Set<number>()
  const valueIds = new Set<string>()
  const options: VariantOptionPresentation[] = []
  let previousPosition = 0

  for (const rawOption of value.options) {
    if (!isPlainObject(rawOption) || !hasExactKeys(rawOption, OPTION_KEYS)) {
      return null
    }

    const axisId = rawOption.axis_id
    const axisPosition = rawOption.axis_position
    const valueId = rawOption.value_id
    const valueKind = rawOption.value_kind

    if (
      typeof axisId !== "string" ||
      !UUID_PATTERN.test(axisId) ||
      typeof valueId !== "string" ||
      !UUID_PATTERN.test(valueId) ||
      typeof axisPosition !== "number" ||
      !Number.isInteger(axisPosition) ||
      axisPosition < 1 ||
      axisPosition > 3 ||
      axisPosition <= previousPosition ||
      axisIds.has(axisId) ||
      axisPositions.has(axisPosition) ||
      valueIds.has(valueId) ||
      !validTrimmedString(rawOption.axis_display_name, 80) ||
      typeof rawOption.option_code !== "string" ||
      byteLength(rawOption.option_code) > 80 ||
      !CODE_PATTERN.test(rawOption.option_code) ||
      (valueKind !== "label" &&
        valueKind !== "measurement" &&
        valueKind !== "colour") ||
      !validTrimmedString(rawOption.value_display_label, 80)
    ) {
      return null
    }

    const numericValue = rawOption.numeric_value
    const unitCode = rawOption.unit_code
    const unitName = rawOption.unit_name
    const unitSymbol = rawOption.unit_symbol
    const sizeSystemCode = rawOption.size_system_code
    const sizeSystemName = rawOption.size_system_name

    if (
      !nullableString(unitCode, 80, CODE_PATTERN) ||
      !nullableString(unitName, 80) ||
      !nullableString(unitSymbol, 20) ||
      !nullableString(sizeSystemCode, 80, CODE_PATTERN) ||
      !nullableString(sizeSystemName, 80) ||
      (unitCode === null) !== (unitName === null) ||
      (unitCode === null) !== (unitSymbol === null) ||
      (sizeSystemCode === null) !== (sizeSystemName === null)
    ) {
      return null
    }

    if (
      numericValue !== null &&
      (typeof numericValue !== "string" ||
        byteLength(numericValue) > 19 ||
        !DECIMAL_PATTERN.test(numericValue) ||
        Number(numericValue) <= 0)
    ) {
      return null
    }

    if (
      (valueKind === "measurement" &&
        (numericValue === null || unitCode === null || sizeSystemCode !== null)) ||
      (valueKind === "label" &&
        (numericValue !== null || unitCode !== null)) ||
      (valueKind === "colour" &&
        (numericValue !== null || unitCode !== null || sizeSystemCode !== null))
    ) {
      return null
    }

    axisIds.add(axisId)
    axisPositions.add(axisPosition)
    valueIds.add(valueId)
    previousPosition = axisPosition
    options.push({
      axisPosition,
      axisLabel: (rawOption.axis_display_name as string).trim(),
      valueLabel: (rawOption.value_display_label as string).trim(),
      valueKind,
      numericValue,
      unitCode,
      unitName,
      unitSymbol,
      sizeSystemCode,
      sizeSystemName,
    })
  }

  const expectedSignature = [...value.options]
    .sort((left, right) => {
      if (!isPlainObject(left) || !isPlainObject(right)) return 0
      return String(left.axis_id).localeCompare(String(right.axis_id))
    })
    .map((option) => {
      if (!isPlainObject(option)) return ""
      return `${String(option.axis_id)}=${String(option.value_id)}`
    })
    .join("|")

  if (value.combination_signature !== expectedSignature) return null

  return {
    kind: "generalized",
    options: [...options].sort(
      (left, right) => left.axisPosition - right.axisPosition
    ),
    fallback: null,
  }
}

function presentVariant(input: OrderItemSnapshotInput): VariantPresentation {
  const variantId = input.product_variant_id
  const size = input.variant_size_snapshot
  const colour = input.variant_colour_snapshot
  const generalized = input.variant_options_snapshot

  if (
    (variantId === null || variantId === undefined) &&
    (size === null || size === undefined) &&
    (colour === null || colour === undefined) &&
    (generalized === null || generalized === undefined)
  ) {
    return { kind: "ordinary", options: [], fallback: null }
  }

  if (typeof variantId !== "string" || !UUID_PATTERN.test(variantId)) {
    return unavailableVariant()
  }

  if (generalized !== null && generalized !== undefined) {
    if (size !== null && size !== undefined) return unavailableVariant()
    if (colour !== null && colour !== undefined) return unavailableVariant()
    return parseGeneralizedVariant(generalized, input) ?? unavailableVariant()
  }

  const options: VariantOptionPresentation[] = []
  if (size !== null && size !== undefined) {
    if (!validTrimmedString(size, 80)) return unavailableVariant()
    options.push({
      axisPosition: 1,
      axisLabel: "Size",
      valueLabel: (size as string).trim(),
      valueKind: "label",
      numericValue: null,
      unitCode: null,
      unitName: null,
      unitSymbol: null,
      sizeSystemCode: null,
      sizeSystemName: null,
    })
  }
  if (colour !== null && colour !== undefined) {
    if (!validTrimmedString(colour, 80)) return unavailableVariant()
    options.push({
      axisPosition: options.length + 1,
      axisLabel: "Colour",
      valueLabel: (colour as string).trim(),
      valueKind: "colour",
      numericValue: null,
      unitCode: null,
      unitName: null,
      unitSymbol: null,
      sizeSystemCode: null,
      sizeSystemName: null,
    })
  }

  return options.length > 0
    ? { kind: "legacy", options, fallback: null }
    : unavailableVariant()
}

function unavailableFinancial(): FinancialPresentation {
  return {
    contract: "unavailable",
    version: null,
    unitAmountKobo: null,
    grossAmountKobo: null,
    platformFeeBps: null,
    platformFeeAmountKobo: null,
    vendorNetAmountKobo: null,
  }
}

function presentFinancial(
  input: OrderItemSnapshotInput,
  quantity: number | null
): FinancialPresentation {
  if (quantity === null) return unavailableFinancial()

  const version = input.financial_contract_version
  if (version === null || version === undefined) {
    const hasVersionedValue = [
      input.unit_amount_kobo,
      input.gross_amount_kobo,
      input.platform_fee_bps,
      input.platform_fee_amount_kobo,
      input.vendor_net_amount_kobo,
      input.currency,
    ].some((value) => value !== null && value !== undefined)
    if (hasVersionedValue) return unavailableFinancial()

    const unit = parseStoredNaira(input.unit_price)
    const gross = parseStoredNaira(input.subtotal)
    if (unit === null || gross === null || gross !== unit * BigInt(quantity)) {
      return unavailableFinancial()
    }

    return {
      contract: "legacy",
      version: null,
      unitAmountKobo: unit,
      grossAmountKobo: gross,
      platformFeeBps: null,
      platformFeeAmountKobo: null,
      vendorNetAmountKobo: null,
    }
  }

  if (version !== 1 && version !== 2) return unavailableFinancial()

  const unit = parseKobo(input.unit_amount_kobo, false)
  const gross = parseKobo(input.gross_amount_kobo, false)
  if (
    input.currency !== "NGN" ||
    unit === null ||
    gross === null ||
    gross !== unit * BigInt(quantity)
  ) {
    return unavailableFinancial()
  }

  const feeValues = [
    input.platform_fee_bps,
    input.platform_fee_amount_kobo,
    input.vendor_net_amount_kobo,
  ]
  const hasAnyFee = feeValues.some(
    (value) => value !== null && value !== undefined
  )
  const hasFee =
    input.platform_fee_bps !== null &&
    input.platform_fee_bps !== undefined &&
    input.platform_fee_amount_kobo !== null &&
    input.platform_fee_amount_kobo !== undefined &&
    input.vendor_net_amount_kobo !== null &&
    input.vendor_net_amount_kobo !== undefined

  if (hasAnyFee && !hasFee) return unavailableFinancial()

  let platformFeeBps: number | null = null
  let platformFeeAmountKobo: bigint | null = null
  let vendorNetAmountKobo: bigint | null = null

  if (hasFee) {
    platformFeeBps =
      typeof input.platform_fee_bps === "number" &&
      Number.isInteger(input.platform_fee_bps) &&
      input.platform_fee_bps >= 0 &&
      input.platform_fee_bps <= 10_000
        ? input.platform_fee_bps
        : null
    platformFeeAmountKobo = parseKobo(
      input.platform_fee_amount_kobo,
      true
    )
    vendorNetAmountKobo = parseKobo(input.vendor_net_amount_kobo, true)

    if (
      platformFeeBps === null ||
      platformFeeAmountKobo === null ||
      vendorNetAmountKobo === null ||
      gross !== platformFeeAmountKobo + vendorNetAmountKobo
    ) {
      return unavailableFinancial()
    }
  }

  return {
    contract: "versioned",
    version,
    unitAmountKobo: unit,
    grossAmountKobo: gross,
    platformFeeBps,
    platformFeeAmountKobo,
    vendorNetAmountKobo,
  }
}

export function presentOrderItemSnapshot(
  input: OrderItemSnapshotInput
): OrderItemPresentation {
  const quantity = parseQuantity(input.quantity)
  return {
    quantity,
    variant: presentVariant(input),
    financial: presentFinancial(input, quantity),
  }
}

function aggregateField(
  presentations: readonly OrderItemPresentation[],
  field:
    | "grossAmountKobo"
    | "platformFeeAmountKobo"
    | "vendorNetAmountKobo"
): bigint | null {
  if (presentations.length === 0) return null

  let total = ZERO
  for (const presentation of presentations) {
    const value = presentation.financial[field]
    if (value === null) return null
    total += value
  }
  return total
}

export function aggregateOrderItemFinancials(
  inputs: readonly OrderItemSnapshotInput[]
): FinancialAggregation {
  const presentations = inputs.map(presentOrderItemSnapshot)
  return {
    grossAmountKobo: aggregateField(presentations, "grossAmountKobo"),
    platformFeeAmountKobo: aggregateField(
      presentations,
      "platformFeeAmountKobo"
    ),
    vendorNetAmountKobo: aggregateField(
      presentations,
      "vendorNetAmountKobo"
    ),
  }
}

export function resolveStoredOrderTotalKobo(input: Readonly<{
  total_amount: unknown
  total_amount_kobo?: unknown
  currency?: unknown
  financial_contract_version?: unknown
}>): bigint | null {
  const version = input.financial_contract_version
  if (version === null || version === undefined) {
    return parseStoredNaira(input.total_amount)
  }
  if (version !== 1 && version !== 2) return null
  if (input.currency !== "NGN") return null
  return parseKobo(input.total_amount_kobo, false)
}

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatNairaFromKobo(value: bigint | null): string | null {
  if (value === null || value < ZERO || value > MAX_KOBO) return null
  return nairaFormatter.format(Number(value) / 100)
}

