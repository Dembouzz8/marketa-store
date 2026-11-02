"use client"

import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import type {
  ProductOptionValueKind,
  VendorOptionCategory,
  VendorOptionDefinition,
  VendorOptionReferenceData,
  VendorOptionSizeSystem,
  VendorOptionTemplate,
  VendorOptionUnit,
  VendorProduct,
  VendorProductOptionAxis,
  VendorProductOptionConfiguration,
  VendorProductOptionValue,
  VendorProductOptionVariant,
} from "@/types"

interface ProductOptionsManagerProps {
  product: VendorProduct
  initialReferenceRows: unknown
  initialConfigurationRows: unknown
  initialLoadFailed: boolean
}

type Feedback = {
  tone: "success" | "error" | "info"
  message: string
}

type RpcOutcome = {
  outcome: string
  row: Record<string, unknown>
}

type DeleteTarget =
  | { kind: "axis"; id: string; label: string }
  | { kind: "value"; id: string; label: string }
  | { kind: "variant"; variant: VendorProductOptionVariant; label: string }

type SupabaseRpcResponse = PromiseLike<{ data: unknown; error: unknown }>

const MAX_LABEL_LENGTH = 80
const MAX_POSTGRES_INTEGER = 2_147_483_647
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i

const outcomeMessages: Record<string, string> = {
  access_denied:
    "Your seller session cannot manage these options. Sign in again if your session expired.",
  invalid_input: "Review the entered values and try again.",
  invalid_state:
    "This product is no longer an eligible inactive, zero-stock option draft.",
  not_found: "The requested product option record no longer exists.",
  order_history_exists:
    "Products with order history cannot be converted to universal options.",
  duplicate_axis: "That option axis is already configured for this product.",
  duplicate_value: "That value already exists on this option axis.",
  duplicate_combination: "That exact option combination already exists.",
  limit_reached: "This product has reached the configured option limit.",
  unsafe_state:
    "This structure cannot change while variant combinations depend on it.",
  value_in_use:
    "This value is used by a variant combination and cannot be changed or deleted.",
  historical_reference:
    "This variant is preserved because it is referenced by order history.",
  conflict:
    "This variant changed elsewhere. The authoritative configuration has been refreshed.",
  operation_failed: "The operation could not be completed. Please try again.",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

function isNonnegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function parseArray<T>(
  value: unknown,
  parser: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value)) return null
  const parsed: T[] = []
  for (const item of value) {
    const result = parser(item)
    if (!result) return null
    parsed.push(result)
  }
  return parsed
}

function parseCategory(value: unknown): VendorOptionCategory | null {
  if (
    !isRecord(value) ||
    !isString(value.code) ||
    !isString(value.name) ||
    !isNonnegativeInteger(value.sort_order)
  ) {
    return null
  }
  return { code: value.code, name: value.name, sort_order: value.sort_order }
}

function parseOptionDefinition(
  value: unknown
): VendorOptionDefinition | null {
  if (!isRecord(value)) return null
  const valueKind = value.value_kind
  if (
    !isString(value.code) ||
    !isString(value.name) ||
    !["label", "measurement", "colour"].includes(String(valueKind)) ||
    !isNullableString(value.dimension_code) ||
    !isBoolean(value.requires_unit) ||
    !isBoolean(value.requires_size_system) ||
    !isNonnegativeInteger(value.sort_order)
  ) {
    return null
  }
  return {
    code: value.code,
    name: value.name,
    value_kind: valueKind as ProductOptionValueKind,
    dimension_code: value.dimension_code,
    requires_unit: value.requires_unit,
    requires_size_system: value.requires_size_system,
    sort_order: value.sort_order,
  }
}

function parseUnit(value: unknown): VendorOptionUnit | null {
  if (
    !isRecord(value) ||
    !isString(value.code) ||
    !isString(value.name) ||
    !isString(value.symbol) ||
    !isString(value.dimension_code) ||
    !isNonnegativeInteger(value.sort_order)
  ) {
    return null
  }
  return {
    code: value.code,
    name: value.name,
    symbol: value.symbol,
    dimension_code: value.dimension_code,
    sort_order: value.sort_order,
  }
}

function parseSizeSystem(value: unknown): VendorOptionSizeSystem | null {
  if (
    !isRecord(value) ||
    !isString(value.code) ||
    !isString(value.name) ||
    !isNonnegativeInteger(value.sort_order)
  ) {
    return null
  }
  return { code: value.code, name: value.name, sort_order: value.sort_order }
}

function parseTemplate(value: unknown): VendorOptionTemplate | null {
  if (
    !isRecord(value) ||
    !isString(value.category_code) ||
    !isString(value.option_code) ||
    !isNonnegativeInteger(value.sort_order) ||
    !isNullableString(value.default_unit_code) ||
    !isNullableString(value.default_size_system_code)
  ) {
    return null
  }
  return {
    category_code: value.category_code,
    option_code: value.option_code,
    sort_order: value.sort_order,
    default_unit_code: value.default_unit_code,
    default_size_system_code: value.default_size_system_code,
  }
}

function parseReferenceData(value: unknown): VendorOptionReferenceData | null {
  if (!isRecord(value)) return null
  const categories = parseArray(value.categories, parseCategory)
  const options = parseArray(value.options, parseOptionDefinition)
  const units = parseArray(value.units, parseUnit)
  const sizeSystems = parseArray(value.size_systems, parseSizeSystem)
  const templates = parseArray(value.templates, parseTemplate)
  if (!categories || !options || !units || !sizeSystems || !templates) {
    return null
  }
  return { categories, options, units, size_systems: sizeSystems, templates }
}

function parseOptionValue(value: unknown): VendorProductOptionValue | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isString(value.display_label) ||
    !isNullableNumber(value.numeric_value) ||
    !isNullableString(value.swatch_hex) ||
    !isNonnegativeInteger(value.sort_order)
  ) {
    return null
  }
  return {
    id: value.id,
    display_label: value.display_label,
    numeric_value: value.numeric_value,
    swatch_hex: value.swatch_hex,
    sort_order: value.sort_order,
  }
}

function parseAxis(value: unknown): VendorProductOptionAxis | null {
  if (!isRecord(value)) return null
  const values = parseArray(value.values, parseOptionValue)
  if (
    !isUuid(value.id) ||
    !isString(value.option_code) ||
    !isString(value.display_name) ||
    !isInteger(value.position) ||
    !isNullableString(value.unit_code) ||
    !isNullableString(value.size_system_code) ||
    !values
  ) {
    return null
  }
  return {
    id: value.id,
    option_code: value.option_code,
    display_name: value.display_name,
    position: value.position,
    unit_code: value.unit_code,
    size_system_code: value.size_system_code,
    values,
  }
}

function parseVariant(value: unknown): VendorProductOptionVariant | null {
  if (!isRecord(value)) return null
  const selectedValueIds = parseArray(value.selected_value_ids, (item) =>
    isUuid(item) ? item : null
  )
  if (
    !isUuid(value.id) ||
    !isNonnegativeInteger(value.stock) ||
    !isNonnegativeInteger(value.stock_version) ||
    !isBoolean(value.is_active) ||
    !selectedValueIds
  ) {
    return null
  }
  return {
    id: value.id,
    stock: value.stock,
    stock_version: value.stock_version,
    is_active: value.is_active,
    selected_value_ids: selectedValueIds,
  }
}

function parseConfiguration(
  value: unknown
): VendorProductOptionConfiguration | null {
  if (!isRecord(value)) return null
  const axes = parseArray(value.axes, parseAxis)
  const variants = parseArray(value.variants, parseVariant)
  const variantMode = value.variant_mode
  if (
    !isUuid(value.product_id) ||
    !isNullableString(value.category_code) ||
    !["none", "size", "colour", "size_colour", "options"].includes(
      String(variantMode)
    ) ||
    !isBoolean(value.is_active) ||
    !isNonnegativeInteger(value.parent_stock) ||
    !axes ||
    !variants
  ) {
    return null
  }
  return {
    product_id: value.product_id,
    category_code: value.category_code,
    variant_mode:
      variantMode as VendorProductOptionConfiguration["variant_mode"],
    is_active: value.is_active,
    parent_stock: value.parent_stock,
    axes,
    variants,
  }
}

function firstRpcRecord(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return null
  }
  return data[0]
}

function parseReferenceRows(data: unknown): VendorOptionReferenceData | null {
  const row = firstRpcRecord(data)
  if (!row || row.outcome !== "ok") return null
  return parseReferenceData(row.reference_data)
}

function parseConfigurationRows(
  data: unknown
): VendorProductOptionConfiguration | null {
  const row = firstRpcRecord(data)
  if (!row || row.outcome !== "ok") return null
  return parseConfiguration(row.configuration)
}

function parseOutcome(data: unknown): RpcOutcome | null {
  const row = firstRpcRecord(data)
  return row && isString(row.outcome) ? { outcome: row.outcome, row } : null
}

function hasValidMutationIdentity(key: string, result: RpcOutcome) {
  if (key.startsWith("axis:")) return isUuid(result.row.axis_id)
  if (key.startsWith("value:")) return isUuid(result.row.value_id)
  if (key === "variant:create" || key.startsWith("variant:stock:")) {
    return (
      isUuid(result.row.variant_id) &&
      isNonnegativeInteger(result.row.result_stock_version)
    )
  }
  if (key.startsWith("variant:delete:")) return isUuid(result.row.variant_id)
  return false
}

function parseWholeNumber(value: string, maximum = MAX_POSTGRES_INTEGER) {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number <= maximum ? number : null
}

function feedbackClass(tone: Feedback["tone"]) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (tone === "error") return "border-red-200 bg-red-50 text-red-700"
  return "border-blue-200 bg-blue-50 text-blue-800"
}

function controlledMessage(outcome: string, fallback: string) {
  return outcomeMessages[outcome] ?? fallback
}

export function ProductOptionsManager({
  product,
  initialReferenceRows,
  initialConfigurationRows,
  initialLoadFailed,
}: ProductOptionsManagerProps) {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const parsedReference = parseReferenceRows(initialReferenceRows)
  const parsedConfiguration = parseConfigurationRows(initialConfigurationRows)
  const [referenceData, setReferenceData] = useState(parsedReference)
  const [configuration, setConfiguration] = useState(parsedConfiguration)
  const [pendingOperation, setPendingOperation] = useState<string | null>(null)
  const [requiresRefresh, setRequiresRefresh] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(
    initialLoadFailed || !parsedReference || !parsedConfiguration
      ? {
          tone: "error",
          message:
            "Universal option data could not be loaded safely. Reload it before making changes.",
        }
      : null
  )
  const initialCategory =
    parsedConfiguration?.category_code ?? parsedReference?.categories[0]?.code ?? ""
  const [categoryCode, setCategoryCode] = useState(initialCategory)
  const [configurationConfirmed, setConfigurationConfirmed] = useState(false)
  const [newOptionCode, setNewOptionCode] = useState("")
  const [axisDisplayName, setAxisDisplayName] = useState("")
  const [axisPosition, setAxisPosition] = useState("1")
  const [axisUnitCode, setAxisUnitCode] = useState("")
  const [axisSizeSystemCode, setAxisSizeSystemCode] = useState("")
  const [editingAxisId, setEditingAxisId] = useState<string | null>(null)
  const [editAxisDisplayName, setEditAxisDisplayName] = useState("")
  const [editAxisPosition, setEditAxisPosition] = useState("1")
  const [editAxisUnitCode, setEditAxisUnitCode] = useState("")
  const [editAxisSizeSystemCode, setEditAxisSizeSystemCode] = useState("")
  const [valueAxisId, setValueAxisId] = useState<string | null>(null)
  const [editingValueId, setEditingValueId] = useState<string | null>(null)
  const [valueLabel, setValueLabel] = useState("")
  const [valueNumeric, setValueNumeric] = useState("")
  const [valueSwatch, setValueSwatch] = useState("")
  const [valueSortOrder, setValueSortOrder] = useState("0")
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const [variantStock, setVariantStock] = useState("0")
  const [editingStockId, setEditingStockId] = useState<string | null>(null)
  const [stockDraft, setStockDraft] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const optionByCode = useMemo(
    () => new Map(referenceData?.options.map((option) => [option.code, option])),
    [referenceData]
  )
  const unitByCode = useMemo(
    () => new Map(referenceData?.units.map((unit) => [unit.code, unit])),
    [referenceData]
  )
  const valueById = useMemo(() => {
    const entries =
      configuration?.axes.flatMap((axis) =>
        axis.values.map((value) => [value.id, { axis, value }] as const)
      ) ?? []
    return new Map(entries)
  }, [configuration])
  const configuredOptionCodes = useMemo(
    () => new Set(configuration?.axes.map((axis) => axis.option_code) ?? []),
    [configuration]
  )
  const categoryTemplates = useMemo(
    () =>
      (referenceData?.templates ?? []).filter(
        (template) => template.category_code === categoryCode
      ),
    [categoryCode, referenceData]
  )
  const availableTemplates = categoryTemplates.filter(
    (template) => !configuredOptionCodes.has(template.option_code)
  )
  const selectedDefinition = optionByCode.get(newOptionCode) ?? null
  const selectedTemplate =
    categoryTemplates.find((template) => template.option_code === newOptionCode) ??
    null
  const matchingUnits = (referenceData?.units ?? []).filter(
    (unit) => unit.dimension_code === selectedDefinition?.dimension_code
  )
  const categoryName =
    referenceData?.categories.find((category) => category.code === categoryCode)
      ?.name ?? categoryCode
  const visibleMode = configuration?.variant_mode ?? product.variant_mode
  const eligibleByVisibleState =
    visibleMode === "none" &&
    product.is_active === false &&
    product.stock === 0

  const setUncertain = (message: string) => {
    setRequiresRefresh(true)
    setFeedback({
      tone: "info",
      message: `${message} The operation may have completed. Reload authoritative data before trying again.`,
    })
  }

  const reloadAuthoritativeData = async () => {
    if (pendingOperation) return
    setPendingOperation("reload")
    setFeedback(null)
    try {
      const [referenceResponse, configurationResponse] = await Promise.all([
        supabase.rpc("get_vendor_option_reference_data"),
        supabase.rpc("get_vendor_product_option_configuration", {
          p_product_id: product.id,
        }),
      ])
      const nextReference = parseReferenceRows(referenceResponse.data)
      const nextConfiguration = parseConfigurationRows(configurationResponse.data)
      if (
        referenceResponse.error ||
        configurationResponse.error ||
        !nextReference ||
        !nextConfiguration ||
        nextConfiguration.product_id !== product.id
      ) {
        setFeedback({
          tone: "error",
          message: "Authoritative option data could not be reloaded. Try again later.",
        })
        return
      }
      setReferenceData(nextReference)
      setConfiguration(nextConfiguration)
      setCategoryCode(
        nextConfiguration.category_code ?? nextReference.categories[0]?.code ?? ""
      )
      setSelectedValues({})
      setEditingAxisId(null)
      setEditingValueId(null)
      setValueAxisId(null)
      setEditingStockId(null)
      setDeleteTarget(null)
      setRequiresRefresh(false)
      setFeedback({ tone: "success", message: "Authoritative option data reloaded." })
      router.refresh()
    } catch {
      setFeedback({
        tone: "error",
        message: "Authoritative option data could not be reloaded. Try again later.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  const refreshConfiguration = async () => {
    const { data, error } = await supabase.rpc(
      "get_vendor_product_option_configuration",
      { p_product_id: product.id }
    )
    const nextConfiguration = parseConfigurationRows(data)
    if (
      error ||
      !nextConfiguration ||
      nextConfiguration.product_id !== product.id
    ) {
      setRequiresRefresh(true)
      setFeedback({
        tone: "error",
        message:
          "The operation completed, but authoritative option data could not be refreshed. Reload before making another change.",
      })
      return false
    }
    setConfiguration(nextConfiguration)
    setSelectedValues({})
    return true
  }

  const runMutation = async (
    key: string,
    request: () => SupabaseRpcResponse,
    successOutcome: string | string[],
    successMessage: string,
    onSuccess?: () => void,
    onConflict?: () => void
  ) => {
    if (pendingOperation || requiresRefresh) return false
    setPendingOperation(key)
    setFeedback(null)
    try {
      const { data, error } = await request()
      const result = parseOutcome(data)
      if (error || !result) {
        setUncertain("The server response could not be confirmed.")
        return false
      }
      const acceptedOutcomes = Array.isArray(successOutcome)
        ? successOutcome
        : [successOutcome]
      if (!acceptedOutcomes.includes(result.outcome)) {
        if (!outcomeMessages[result.outcome]) {
          setUncertain("The server returned an unsupported outcome.")
          return false
        }
        if (result.outcome === "conflict") {
          await refreshConfiguration()
          onConflict?.()
        }
        setFeedback({
          tone: "error",
          message: controlledMessage(
            result.outcome,
            "The server returned an unsupported response. Reload before retrying."
          ),
        })
        return false
      }
      if (!hasValidMutationIdentity(key, result)) {
        setUncertain("The successful response was incomplete.")
        return false
      }
      if (!(await refreshConfiguration())) return false
      onSuccess?.()
      setFeedback({ tone: "success", message: successMessage })
      return true
    } catch {
      setUncertain("The request was interrupted.")
      return false
    } finally {
      setPendingOperation(null)
    }
  }

  const configureOptions = async () => {
    if (
      !eligibleByVisibleState ||
      !configurationConfirmed ||
      !categoryCode ||
      pendingOperation ||
      requiresRefresh
    ) {
      return
    }
    setPendingOperation("configure")
    setFeedback(null)
    try {
      const { data, error } = await supabase.rpc(
        "configure_vendor_product_options",
        { p_product_id: product.id, p_category_code: categoryCode }
      )
      const result = parseOutcome(data)
      if (error || !result) {
        setUncertain("The configuration response could not be confirmed.")
      } else if (
        result.outcome === "configured" &&
        isUuid(result.row.configured_product_id) &&
        result.row.configured_product_id === product.id &&
        result.row.configured_variant_mode === "options"
      ) {
        setFeedback({
          tone: "success",
          message: "Universal options configured. Loading the draft workspace…",
        })
        router.refresh()
      } else if (outcomeMessages[result.outcome]) {
        setFeedback({
          tone: "error",
          message: controlledMessage(
            result.outcome,
            "The server returned an unsupported configuration response."
          ),
        })
      } else {
        setUncertain("The server returned an unsupported configuration outcome.")
      }
    } catch {
      setUncertain("The configuration request was interrupted.")
    } finally {
      setPendingOperation(null)
    }
  }

  const chooseNewOption = (optionCode: string) => {
    const definition = optionByCode.get(optionCode)
    const template = categoryTemplates.find(
      (candidate) => candidate.option_code === optionCode
    )
    setNewOptionCode(optionCode)
    setAxisDisplayName(definition?.name ?? "")
    setAxisPosition(String((configuration?.axes.length ?? 0) + 1))
    setAxisUnitCode(template?.default_unit_code ?? "")
    setAxisSizeSystemCode(template?.default_size_system_code ?? "")
  }

  const addAxis = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const displayName = axisDisplayName.trim()
    const position = parseWholeNumber(axisPosition, 32767)
    if (
      !selectedDefinition ||
      !selectedTemplate ||
      !displayName ||
      Array.from(displayName).length > MAX_LABEL_LENGTH ||
      position === null ||
      position < 1 ||
      (selectedDefinition.requires_unit && !axisUnitCode) ||
      (selectedDefinition.requires_size_system && !axisSizeSystemCode)
    ) {
      setFeedback({
        tone: "error",
        message: "Complete the approved option, label, position, and metadata.",
      })
      return
    }
    await runMutation(
      "axis:add",
      () =>
        supabase.rpc("add_vendor_product_option_axis", {
          p_product_id: product.id,
          p_option_code: selectedDefinition.code,
          p_display_name: displayName,
          p_position: position,
          p_unit_code: selectedDefinition.requires_unit ? axisUnitCode : null,
          p_size_system_code: selectedDefinition.requires_size_system
            ? axisSizeSystemCode
            : null,
        }),
      "created",
      "Option axis added.",
      () => {
        setNewOptionCode("")
        setAxisDisplayName("")
        setAxisUnitCode("")
        setAxisSizeSystemCode("")
      }
    )
  }

  const beginAxisEdit = (axis: VendorProductOptionAxis) => {
    setEditingAxisId(axis.id)
    setEditAxisDisplayName(axis.display_name)
    setEditAxisPosition(String(axis.position))
    setEditAxisUnitCode(axis.unit_code ?? "")
    setEditAxisSizeSystemCode(axis.size_system_code ?? "")
    setFeedback(null)
  }

  const updateAxis = async (axis: VendorProductOptionAxis) => {
    const definition = optionByCode.get(axis.option_code)
    const displayName = editAxisDisplayName.trim()
    const position = parseWholeNumber(editAxisPosition, 32767)
    if (
      !definition ||
      !displayName ||
      Array.from(displayName).length > MAX_LABEL_LENGTH ||
      position === null ||
      position < 1 ||
      (definition.requires_unit && !editAxisUnitCode) ||
      (definition.requires_size_system && !editAxisSizeSystemCode)
    ) {
      setFeedback({ tone: "error", message: "Complete the axis details." })
      return
    }
    await runMutation(
      `axis:update:${axis.id}`,
      () =>
        supabase.rpc("update_vendor_product_option_axis", {
          p_axis_id: axis.id,
          p_display_name: displayName,
          p_position: position,
          p_unit_code: definition.requires_unit ? editAxisUnitCode : null,
          p_size_system_code: definition.requires_size_system
            ? editAxisSizeSystemCode
            : null,
        }),
      "updated",
      "Option axis updated.",
      () => setEditingAxisId(null)
    )
  }

  const beginValueForm = (
    axis: VendorProductOptionAxis,
    value?: VendorProductOptionValue
  ) => {
    setValueAxisId(axis.id)
    setEditingValueId(value?.id ?? null)
    setValueLabel(value?.display_label ?? "")
    setValueNumeric(value?.numeric_value === null || value?.numeric_value === undefined
      ? ""
      : String(value.numeric_value))
    setValueSwatch(value?.swatch_hex ?? "")
    setValueSortOrder(String(value?.sort_order ?? axis.values.length))
    setFeedback(null)
  }

  const saveValue = async (
    event: React.FormEvent<HTMLFormElement>,
    axis: VendorProductOptionAxis
  ) => {
    event.preventDefault()
    const definition = optionByCode.get(axis.option_code)
    const label = valueLabel.trim()
    const sortOrder = parseWholeNumber(valueSortOrder)
    const numericValue = valueNumeric.trim() ? Number(valueNumeric) : null
    const swatch = valueSwatch.trim() ? valueSwatch.trim().toUpperCase() : null
    if (
      !definition ||
      !label ||
      Array.from(label).length > MAX_LABEL_LENGTH ||
      sortOrder === null ||
      (definition.value_kind === "measurement" &&
        (numericValue === null || !Number.isFinite(numericValue) || numericValue <= 0)) ||
      (definition.value_kind !== "measurement" && numericValue !== null) ||
      (definition.value_kind === "colour" &&
        swatch !== null &&
        !HEX_COLOUR_PATTERN.test(swatch)) ||
      (definition.value_kind !== "colour" && swatch !== null)
    ) {
      setFeedback({
        tone: "error",
        message: "Complete the value using the option's approved value format.",
      })
      return
    }
    const editingId = editingValueId
    await runMutation(
      editingId ? `value:update:${editingId}` : `value:add:${axis.id}`,
      () =>
        editingId
          ? supabase.rpc("update_vendor_product_option_value", {
              p_value_id: editingId,
              p_display_label: label,
              p_numeric_value: numericValue,
              p_swatch_hex: swatch,
              p_sort_order: sortOrder,
            })
          : supabase.rpc("add_vendor_product_option_value", {
              p_axis_id: axis.id,
              p_display_label: label,
              p_numeric_value: numericValue,
              p_swatch_hex: swatch,
              p_sort_order: sortOrder,
            }),
      editingId ? "updated" : "created",
      editingId ? "Option value updated." : "Option value added.",
      () => {
        setValueAxisId(null)
        setEditingValueId(null)
        setValueLabel("")
        setValueNumeric("")
        setValueSwatch("")
      }
    )
  }

  const createVariant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const axes = configuration?.axes ?? []
    const selectedIds = axes.map((axis) => selectedValues[axis.id]).filter(Boolean)
    const stock = parseWholeNumber(variantStock)
    if (
      axes.length === 0 ||
      selectedIds.length !== axes.length ||
      new Set(selectedIds).size !== selectedIds.length ||
      stock === null
    ) {
      setFeedback({
        tone: "error",
        message: "Choose exactly one available value for every axis and enter valid stock.",
      })
      return
    }
    await runMutation(
      "variant:create",
      () =>
        supabase.rpc("create_vendor_product_option_variant", {
          p_product_id: product.id,
          p_value_ids: selectedIds,
          p_stock: stock,
        }),
      "created",
      "Draft option combination created.",
      () => {
        setSelectedValues({})
        setVariantStock("0")
      }
    )
  }

  const saveVariantStock = async (variant: VendorProductOptionVariant) => {
    const stock = parseWholeNumber(stockDraft)
    if (stock === null) {
      setFeedback({
        tone: "error",
        message: "Enter a whole stock quantity from 0 to 2147483647.",
      })
      return
    }
    await runMutation(
      `variant:stock:${variant.id}`,
      () =>
        supabase.rpc("update_vendor_product_variant_stock", {
          p_variant_id: variant.id,
          p_stock: stock,
          p_expected_stock_version: variant.stock_version,
        }),
      ["updated", "no_change"],
      "Variant stock updated.",
      () => setEditingStockId(null),
      () => {
        setEditingStockId(null)
        setStockDraft("")
      }
    )
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.kind === "axis") {
      await runMutation(
        `axis:delete:${deleteTarget.id}`,
        () =>
          supabase.rpc("delete_vendor_product_option_axis", {
            p_axis_id: deleteTarget.id,
          }),
        "deleted",
        "Option axis deleted.",
        () => setDeleteTarget(null)
      )
      return
    }
    if (deleteTarget.kind === "value") {
      await runMutation(
        `value:delete:${deleteTarget.id}`,
        () =>
          supabase.rpc("delete_vendor_product_option_value", {
            p_value_id: deleteTarget.id,
          }),
        "deleted",
        "Option value deleted.",
        () => setDeleteTarget(null)
      )
      return
    }
    const variant = deleteTarget.variant
    await runMutation(
      `variant:delete:${variant.id}`,
      () =>
        supabase.rpc("delete_vendor_product_variant", {
          p_variant_id: variant.id,
          p_expected_stock_version: variant.stock_version,
        }),
      "deleted",
      "Draft option combination deleted.",
      () => setDeleteTarget(null)
    )
  }

  const variantLabel = (variant: VendorProductOptionVariant) =>
    variant.selected_value_ids
      .flatMap((valueId) => {
        const selectedValue = valueById.get(valueId)
        return selectedValue ? [selectedValue] : []
      })
      .sort((left, right) => left.axis.position - right.axis.position)
      .map(({ value }) => value.display_label)
      .join(" · ")

  if (visibleMode !== "none" && visibleMode !== "options") return null

  return (
    <section className="max-w-5xl space-y-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            Universal product options
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Configure up to three approved option axes and create only the draft
            combinations you actually sell. Customer purchasing and publication
            remain unavailable.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={reloadAuthoritativeData}
          disabled={Boolean(pendingOperation)}
          className="rounded-lg border-zinc-200"
        >
          {pendingOperation === "reload" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Reload data
        </Button>
      </div>

      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            feedbackClass(feedback.tone)
          )}
        >
          {feedback.message}
        </p>
      ) : null}

      {!referenceData || !configuration ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Option management is locked until authoritative data loads successfully.
        </div>
      ) : visibleMode === "none" ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <p className="font-medium text-zinc-900">1. Configure category</p>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• Product must be inactive with zero parent stock.</li>
              <li>• Existing variants and order history make conversion ineligible.</li>
              <li>• Configuration is permanent through the current vendor workflow.</li>
            </ul>
            {!eligibleByVisibleState ? (
              <p className="mt-3 text-sm font-medium text-amber-800">
                This product is not visibly eligible. Make it an inactive,
                zero-stock ordinary draft before requesting configuration.
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Canonical category
            </span>
            <select
              value={categoryCode}
              onChange={(event) => {
                setCategoryCode(event.target.value)
                setConfigurationConfirmed(false)
              }}
              disabled={!eligibleByVisibleState || Boolean(pendingOperation)}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-amber-500 disabled:bg-zinc-100"
            >
              {referenceData.categories.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-zinc-200 p-4">
            <p className="text-sm font-medium text-zinc-900">
              Approved options for {categoryName}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {categoryTemplates.map((template) => (
                <span
                  key={template.option_code}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700"
                >
                  {optionByCode.get(template.option_code)?.name ??
                    template.option_code}
                </span>
              ))}
              {categoryTemplates.length === 0 ? (
                <span className="text-sm text-zinc-500">
                  No approved option templates are available for this category.
                </span>
              ) : null}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={configurationConfirmed}
              onChange={(event) => setConfigurationConfirmed(event.target.checked)}
              disabled={!eligibleByVisibleState || Boolean(pendingOperation)}
              className="mt-0.5 size-4 rounded border-amber-300"
            />
            <span>
              I understand this creates a draft-only universal option product and
              does not publish it for customer purchase.
            </span>
          </label>

          <Button
            type="button"
            onClick={configureOptions}
            disabled={
              !eligibleByVisibleState ||
              !configurationConfirmed ||
              !categoryCode ||
              requiresRefresh ||
              Boolean(pendingOperation)
            }
            className="h-11 rounded-lg bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            {pendingOperation === "configure" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Configure universal options
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase text-amber-700">Category</p>
              <p className="mt-1 font-semibold text-zinc-900">{categoryName}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-amber-700">Status</p>
              <p className="mt-1 font-semibold text-zinc-900">Draft only</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-amber-700">Limits</p>
              <p className="mt-1 font-semibold text-zinc-900">
                {configuration.axes.length}/3 axes · {configuration.variants.length}/100 combinations
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">2. Add option axes</h3>
              <p className="mt-1 text-sm text-zinc-600">
                Choose from the category&apos;s curated option definitions. Measurement
                units and size systems are explicit; no conversion is performed.
              </p>
            </div>

            {configuration.axes.length < 3 && availableTemplates.length > 0 ? (
              <form onSubmit={addAxis} className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-600">Approved option</span>
                  <select
                    value={newOptionCode}
                    onChange={(event) => chooseNewOption(event.target.value)}
                    disabled={Boolean(pendingOperation)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm"
                    required
                  >
                    <option value="">Choose an option</option>
                    {availableTemplates.map((template) => (
                      <option key={template.option_code} value={template.option_code}>
                        {optionByCode.get(template.option_code)?.name ?? template.option_code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-600">Display name</span>
                  <Input value={axisDisplayName} maxLength={80} onChange={(event) => setAxisDisplayName(event.target.value)} required />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-600">Position</span>
                  <Input type="number" min={1} max={3} value={axisPosition} onChange={(event) => setAxisPosition(event.target.value)} required />
                </label>
                {selectedDefinition?.requires_unit ? (
                  <label>
                    <span className="mb-1 block text-xs font-medium text-zinc-600">Measurement unit</span>
                    <select value={axisUnitCode} onChange={(event) => setAxisUnitCode(event.target.value)} className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm" required>
                      <option value="">Choose a unit</option>
                      {matchingUnits.map((unit) => (
                        <option key={unit.code} value={unit.code}>{unit.name} ({unit.symbol})</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {selectedDefinition?.requires_size_system ? (
                  <label>
                    <span className="mb-1 block text-xs font-medium text-zinc-600">Size system</span>
                    <select value={axisSizeSystemCode} onChange={(event) => setAxisSizeSystemCode(event.target.value)} className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm" required>
                      <option value="">Choose a size system</option>
                      {referenceData.size_systems.map((system) => (
                        <option key={system.code} value={system.code}>{system.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="flex items-end">
                  <Button type="submit" disabled={Boolean(pendingOperation) || requiresRefresh} className="h-10 w-full rounded-lg bg-zinc-900 text-white hover:bg-zinc-700">
                    {pendingOperation === "axis:add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Add axis
                  </Button>
                </div>
              </form>
            ) : (
              <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
                {configuration.axes.length >= 3
                  ? "This product has the maximum three option axes."
                  : "All approved category options are already configured."}
              </p>
            )}

            <div className="space-y-4">
              {configuration.axes.map((axis) => {
                const definition = optionByCode.get(axis.option_code)
                const unit = axis.unit_code ? unitByCode.get(axis.unit_code) : null
                const isEditingAxis = editingAxisId === axis.id
                const isEditingValue = valueAxisId === axis.id
                return (
                  <article key={axis.id} className="rounded-xl border border-zinc-200 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-semibold text-zinc-900">{axis.display_name}</h4>
                        <p className="text-xs text-zinc-500">
                          {definition?.name ?? axis.option_code}
                          {unit ? ` · ${unit.name} (${unit.symbol})` : ""}
                          {axis.size_system_code ? ` · ${referenceData.size_systems.find((item) => item.code === axis.size_system_code)?.name ?? axis.size_system_code}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => beginAxisEdit(axis)} disabled={Boolean(pendingOperation)} className="rounded-lg border-zinc-200">
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "axis", id: axis.id, label: axis.display_name })} disabled={Boolean(pendingOperation)} className="rounded-lg border-red-200 text-red-600 hover:bg-red-50">
                          <Trash2 className="size-3.5" /> Delete
                        </Button>
                      </div>
                    </div>

                    {isEditingAxis ? (
                      <div className="mt-4 grid gap-3 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label>
                          <span className="mb-1 block text-xs font-medium text-zinc-600">Display name</span>
                          <Input value={editAxisDisplayName} maxLength={80} onChange={(event) => setEditAxisDisplayName(event.target.value)} />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-medium text-zinc-600">Position</span>
                          <Input type="number" min={1} max={3} value={editAxisPosition} onChange={(event) => setEditAxisPosition(event.target.value)} />
                        </label>
                        {definition?.requires_unit ? (
                          <label>
                            <span className="mb-1 block text-xs font-medium text-zinc-600">Unit</span>
                            <select value={editAxisUnitCode} onChange={(event) => setEditAxisUnitCode(event.target.value)} className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
                              {(referenceData.units.filter((item) => item.dimension_code === definition.dimension_code)).map((item) => (
                                <option key={item.code} value={item.code}>{item.name} ({item.symbol})</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {definition?.requires_size_system ? (
                          <label>
                            <span className="mb-1 block text-xs font-medium text-zinc-600">Size system</span>
                            <select value={editAxisSizeSystemCode} onChange={(event) => setEditAxisSizeSystemCode(event.target.value)} className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm">
                              {referenceData.size_systems.map((item) => (
                                <option key={item.code} value={item.code}>{item.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <div className="flex items-end gap-2">
                          <Button type="button" size="sm" onClick={() => updateAxis(axis)} disabled={Boolean(pendingOperation) || requiresRefresh} className="rounded-lg bg-zinc-900 text-white">Save axis</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditingAxisId(null)} className="rounded-lg border-zinc-200">Cancel</Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 flex items-center justify-between">
                      <p className="text-sm font-medium text-zinc-900">Available values</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => beginValueForm(axis)} disabled={Boolean(pendingOperation)} className="rounded-lg border-zinc-200">
                        <Plus className="size-3.5" /> Add value
                      </Button>
                    </div>

                    {isEditingValue ? (
                      <form onSubmit={(event) => saveValue(event, axis)} className="mt-3 grid gap-3 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label>
                          <span className="mb-1 block text-xs font-medium text-zinc-600">Display label</span>
                          <Input value={valueLabel} maxLength={80} onChange={(event) => setValueLabel(event.target.value)} required />
                        </label>
                        {definition?.value_kind === "measurement" ? (
                          <label>
                            <span className="mb-1 block text-xs font-medium text-zinc-600">Numeric value</span>
                            <Input type="number" min="0.000001" step="any" value={valueNumeric} onChange={(event) => setValueNumeric(event.target.value)} required />
                          </label>
                        ) : null}
                        {definition?.value_kind === "colour" ? (
                          <label>
                            <span className="mb-1 block text-xs font-medium text-zinc-600">Colour swatch (optional)</span>
                            <Input placeholder="#112233" pattern="#[0-9A-Fa-f]{6}" value={valueSwatch} onChange={(event) => setValueSwatch(event.target.value)} />
                          </label>
                        ) : null}
                        <label>
                          <span className="mb-1 block text-xs font-medium text-zinc-600">Display order</span>
                          <Input type="number" min={0} value={valueSortOrder} onChange={(event) => setValueSortOrder(event.target.value)} required />
                        </label>
                        <div className="flex items-end gap-2">
                          <Button type="submit" size="sm" disabled={Boolean(pendingOperation) || requiresRefresh} className="rounded-lg bg-zinc-900 text-white">{editingValueId ? "Save value" : "Add value"}</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => { setValueAxisId(null); setEditingValueId(null) }} className="rounded-lg border-zinc-200">Cancel</Button>
                        </div>
                      </form>
                    ) : null}

                    {axis.values.length === 0 ? (
                      <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">No values yet.</p>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {axis.values.map((value) => (
                          <div key={value.id} className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-2.5 pr-1">
                            {value.swatch_hex ? <span className="size-4 rounded-full border border-zinc-200" style={{ backgroundColor: value.swatch_hex }} aria-hidden="true" /> : null}
                            <span className="text-sm text-zinc-800">{value.display_label}</span>
                            {value.numeric_value !== null && unit ? <span className="text-xs text-zinc-500">{value.numeric_value} {unit.symbol}</span> : null}
                            <button type="button" onClick={() => beginValueForm(axis, value)} disabled={Boolean(pendingOperation)} aria-label={`Edit ${value.display_label}`} className="inline-flex size-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"><Pencil className="size-3.5" /></button>
                            <button type="button" onClick={() => setDeleteTarget({ kind: "value", id: value.id, label: value.display_label })} disabled={Boolean(pendingOperation)} aria-label={`Delete ${value.display_label}`} className="inline-flex size-7 items-center justify-center rounded-full text-red-500 hover:bg-red-50"><Trash2 className="size-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>

          <div className="space-y-4 border-t border-zinc-200 pt-6">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">3. Create actual combinations</h3>
              <p className="mt-1 text-sm text-zinc-600">Choose exactly one existing value from every axis. Combinations are never generated automatically.</p>
            </div>
            {configuration.axes.length === 0 || configuration.axes.some((axis) => axis.values.length === 0) ? (
              <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">Add at least one value to every configured axis before creating a combination.</p>
            ) : configuration.variants.length >= 100 ? (
              <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">This product has reached the 100-combination limit.</p>
            ) : (
              <form onSubmit={createVariant} className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {configuration.axes.map((axis) => (
                  <label key={axis.id}>
                    <span className="mb-1 block text-xs font-medium text-zinc-600">{axis.display_name}</span>
                    <select value={selectedValues[axis.id] ?? ""} onChange={(event) => setSelectedValues((current) => ({ ...current, [axis.id]: event.target.value }))} className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm" required>
                      <option value="">Choose a value</option>
                      {axis.values.map((value) => <option key={value.id} value={value.id}>{value.display_label}</option>)}
                    </select>
                  </label>
                ))}
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-600">Initial stock</span>
                  <Input type="number" min={0} max={MAX_POSTGRES_INTEGER} value={variantStock} onChange={(event) => setVariantStock(event.target.value)} required />
                </label>
                <div className="flex items-end">
                  <Button type="submit" disabled={Boolean(pendingOperation) || requiresRefresh} className="h-10 w-full rounded-lg bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400">Create combination</Button>
                </div>
              </form>
            )}
          </div>

          <div className="space-y-4 border-t border-zinc-200 pt-6">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">4. Manage draft inventory</h3>
              <p className="mt-1 text-sm text-zinc-600">Stock updates use optimistic version checks. Every generic combination remains inactive.</p>
            </div>
            {configuration.variants.length === 0 ? (
              <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">No explicit combinations yet.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {configuration.variants.map((variant) => {
                  const label = variantLabel(variant) || "Unresolved combination"
                  const editingStock = editingStockId === variant.id
                  return (
                    <article key={variant.id} className="rounded-xl border border-zinc-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-zinc-900">{label}</h4>
                          <p className="mt-1 text-xs text-zinc-500">Draft · ID {variant.id.slice(0, 8)} · version {variant.stock_version}</p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Inactive</span>
                      </div>
                      {editingStock ? (
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <Input type="number" min={0} max={MAX_POSTGRES_INTEGER} value={stockDraft} onChange={(event) => setStockDraft(event.target.value)} aria-label={`Stock for ${label}`} />
                          <Button type="button" size="sm" onClick={() => saveVariantStock(variant)} disabled={Boolean(pendingOperation) || requiresRefresh} className="rounded-lg bg-zinc-900 text-white">Save stock</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditingStockId(null)} className="rounded-lg border-zinc-200">Cancel</Button>
                        </div>
                      ) : (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <span className="mr-auto text-sm font-medium text-zinc-700">Stock: {variant.stock}</span>
                          <Button type="button" size="sm" variant="outline" onClick={() => { setEditingStockId(variant.id); setStockDraft(String(variant.stock)) }} disabled={Boolean(pendingOperation)} className="rounded-lg border-zinc-200"><Pencil className="size-3.5" /> Edit stock</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "variant", variant, label })} disabled={Boolean(pendingOperation)} className="rounded-lg border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="size-3.5" /> Delete</Button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !pendingOperation) setDeleteTarget(null) }}>
        <DialogContent className="bg-white shadow-2xl">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.kind ?? "item"}?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "axis"
                ? `Delete ${deleteTarget.label}? Axes with dependent values or combinations may be protected.`
                : deleteTarget?.kind === "value"
                  ? `Delete ${deleteTarget.label}? Values used by combinations are protected.`
                  : `Delete the draft combination ${deleteTarget?.label ?? ""}? Historical references remain protected.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-white">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={Boolean(pendingOperation)} className="rounded-lg border-zinc-200">Cancel</Button>
            <Button type="button" onClick={confirmDelete} disabled={Boolean(pendingOperation) || requiresRefresh} className="rounded-lg bg-red-600 text-white hover:bg-red-700">
              {pendingOperation?.includes(":delete:") ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
