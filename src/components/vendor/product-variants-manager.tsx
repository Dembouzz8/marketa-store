"use client"

import { Loader2, Pencil, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import type {
  ProductVariant,
  ProductVariantMode,
  VendorProduct,
} from "@/types"

interface ProductVariantsManagerProps {
  product: VendorProduct
  initialVariants: ProductVariant[]
  initialLoadFailed: boolean
}

type Feedback = {
  tone: "success" | "error" | "info"
  message: string
}

type VariantLabels = {
  size: string | null
  colour: string | null
}

type VariantMutationResult = {
  outcome: string
  variant_id: string | null
  result_stock_version: number | null
}

type ConfigureResult = {
  outcome: string
  configured_product_id: string | null
  configured_variant_mode: ProductVariantMode | null
}

const MAX_LABEL_LENGTH = 80
const MAX_POSTGRES_INTEGER = 2_147_483_647

const variantSelect =
  "id, product_id, vendor_id, size, colour, size_normalized, colour_normalized, stock, stock_version, is_active, created_at, updated_at"

const modeLabels: Record<Exclude<ProductVariantMode, "none">, string> = {
  size: "Sizes",
  colour: "Colours",
  size_colour: "Sizes and colours",
}

const configureMessages: Record<string, string> = {
  access_denied: "Your seller account cannot configure this product.",
  invalid_input: "Choose a supported variant mode.",
  not_found: "This product is no longer available to your seller account.",
  invalid_state:
    "This product is no longer an eligible inactive, zero-stock ordinary draft.",
  order_history_exists:
    "Products with order history cannot be converted to use sizes or colours.",
  operation_failed: "Variant setup could not be completed. Please try again.",
}

const createMessages: Record<string, string> = {
  access_denied: "Your seller account cannot add variants to this product.",
  invalid_input: "Check the labels and stock quantity, then try again.",
  not_found: "This product is no longer available to your seller account.",
  invalid_state: "This product is not available for variant management.",
  duplicate_combination: "That size or colour combination already exists.",
  operation_failed: "The combination could not be created. Please try again.",
}

const labelMessages: Record<string, string> = {
  access_denied: "Your seller account cannot edit this combination.",
  invalid_input: "Check the size and colour labels, then try again.",
  not_found: "This combination no longer exists.",
  invalid_state: "This combination is not available for editing.",
  duplicate_combination: "That size or colour combination already exists.",
  operation_failed: "The labels could not be updated. Please try again.",
}

const stockMessages: Record<string, string> = {
  access_denied: "Your seller account cannot update this stock quantity.",
  invalid_input: "Enter a whole stock quantity from 0 to 2147483647.",
  not_found: "This combination no longer exists.",
  invalid_state: "This combination is not available for stock updates.",
  operation_failed: "The stock quantity could not be updated. Please try again.",
}

const deleteMessages: Record<string, string> = {
  access_denied: "Your seller account cannot delete this combination.",
  invalid_input: "The delete request is invalid. Refresh and try again.",
  not_found: "This combination no longer exists.",
  invalid_state: "This combination is not available for deletion.",
  historical_reference:
    "This combination is preserved because it is referenced by order history.",
  operation_failed: "The combination could not be deleted. Please try again.",
}

function firstRpcRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const row = data[0]
  return row && typeof row === "object" ? (row as T) : null
}

function cleanLabel(value: string) {
  const label = value.trim()
  if (!label || Array.from(label).length > MAX_LABEL_LENGTH) return null
  return label
}

export function validateVariantLabels(
  mode: Exclude<ProductVariantMode, "none">,
  sizeInput: string,
  colourInput: string
): { ok: true; labels: VariantLabels } | { ok: false; message: string } {
  const size = cleanLabel(sizeInput)
  const colour = cleanLabel(colourInput)

  if (mode === "size") {
    if (!size || colourInput.trim()) {
      return { ok: false, message: "Enter one size label of 80 characters or fewer." }
    }
    return { ok: true, labels: { size, colour: null } }
  }

  if (mode === "colour") {
    if (!colour || sizeInput.trim()) {
      return { ok: false, message: "Enter one colour label of 80 characters or fewer." }
    }
    return { ok: true, labels: { size: null, colour } }
  }

  if (!size || !colour) {
    return {
      ok: false,
      message: "Enter size and colour labels of 80 characters or fewer.",
    }
  }

  return { ok: true, labels: { size, colour } }
}

export function parseVariantStock(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null

  try {
    const stock = BigInt(normalized)
    if (stock > BigInt(MAX_POSTGRES_INTEGER)) return null
    return Number(stock)
  } catch {
    return null
  }
}

function feedbackClass(tone: Feedback["tone"]) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (tone === "error") return "border-red-200 bg-red-50 text-red-700"
  return "border-blue-200 bg-blue-50 text-blue-800"
}

function combinationLabel(variant: ProductVariant) {
  return [variant.size, variant.colour].filter(Boolean).join(" · ")
}

export function ProductVariantsManager({
  product,
  initialVariants,
  initialLoadFailed,
}: ProductVariantsManagerProps) {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [variants, setVariants] = useState(initialVariants)
  const [pendingOperation, setPendingOperation] = useState<string | null>(null)
  const [configurationUncertain, setConfigurationUncertain] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(
    initialLoadFailed
      ? {
          tone: "error",
          message: "Current combinations could not be loaded. Reload the page.",
        }
      : null
  )
  const [selectedMode, setSelectedMode] = useState<
    Exclude<ProductVariantMode, "none">
  >("size")
  const [modeConfirmed, setModeConfirmed] = useState(false)
  const [createSize, setCreateSize] = useState("")
  const [createColour, setCreateColour] = useState("")
  const [createStock, setCreateStock] = useState("0")
  const [editingLabelsId, setEditingLabelsId] = useState<string | null>(null)
  const [sizeDraft, setSizeDraft] = useState("")
  const [colourDraft, setColourDraft] = useState("")
  const [editingStockId, setEditingStockId] = useState<string | null>(null)
  const [stockDraft, setStockDraft] = useState("")
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const mode = product.variant_mode ?? "none"
  const isEligibleByVisibleState =
    mode === "none" && product.is_active === false && product.stock === 0

  const refreshVariants = async () => {
    const { data, error } = await supabase
      .from("product_variants")
      .select(variantSelect)
      .eq("product_id", product.id)
      .eq("vendor_id", product.vendor_id)
      .order("created_at", { ascending: true })

    if (error) {
      setFeedback({
        tone: "error",
        message: "Current combinations could not be refreshed. Reload the page.",
      })
      return false
    }

    setVariants((data ?? []) as ProductVariant[])
    return true
  }

  const configureMode = async () => {
    if (
      !isEligibleByVisibleState ||
      !modeConfirmed ||
      configurationUncertain ||
      pendingOperation
    ) {
      return
    }

    setPendingOperation("configure")
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        "configure_vendor_product_variant_mode",
        {
          p_product_id: product.id,
          p_variant_mode: selectedMode,
        }
      )
      const result = firstRpcRow<ConfigureResult>(data)

      if (error || !result || typeof result.outcome !== "string") {
        setConfigurationUncertain(true)
        setFeedback({
          tone: "info",
          message:
            "The variant configuration result could not be confirmed and may have completed. Reload authoritative product state before trying again.",
        })
      } else if (result.outcome === "configured") {
        setFeedback({
          tone: "success",
          message: "Variant mode configured. Loading combination management…",
        })
        router.refresh()
      } else if (configureMessages[result.outcome]) {
        setFeedback({
          tone: "error",
          message: configureMessages[result.outcome],
        })
      } else {
        setConfigurationUncertain(true)
        setFeedback({
          tone: "info",
          message:
            "The variant configuration result could not be confirmed and may have completed. Reload authoritative product state before trying again.",
        })
      }
    } catch {
      setConfigurationUncertain(true)
      setFeedback({
        tone: "info",
        message:
          "The variant configuration result could not be confirmed and may have completed. Reload authoritative product state before trying again.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  const createVariant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === "none" || pendingOperation) return

    const labelResult = validateVariantLabels(mode, createSize, createColour)
    const stock = parseVariantStock(createStock)
    if (!labelResult.ok || stock === null) {
      setFeedback({
        tone: "error",
        message:
          !labelResult.ok
            ? labelResult.message
            : "Enter a whole stock quantity from 0 to 2147483647.",
      })
      return
    }

    setPendingOperation("create")
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        "create_vendor_product_variant",
        {
          p_product_id: product.id,
          p_size: labelResult.labels.size,
          p_colour: labelResult.labels.colour,
          p_stock: stock,
        }
      )
      const result = firstRpcRow<VariantMutationResult>(data)

      if (error || !result) {
        setFeedback({
          tone: "error",
          message: "The combination could not be created. Please try again.",
        })
      } else if (result.outcome === "created") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setCreateSize("")
          setCreateColour("")
          setCreateStock("0")
          setFeedback({ tone: "success", message: "Combination created." })
        }
      } else {
        setFeedback({
          tone: "error",
          message:
            createMessages[result.outcome] ??
            "Variant creation returned an unsupported response.",
        })
      }
    } catch {
      setFeedback({
        tone: "error",
        message: "The combination could not be created. Please try again.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  const beginLabelEdit = (variant: ProductVariant) => {
    setEditingLabelsId(variant.id)
    setSizeDraft(variant.size ?? "")
    setColourDraft(variant.colour ?? "")
    setFeedback(null)
  }

  const updateLabels = async (variant: ProductVariant) => {
    if (mode === "none" || pendingOperation) return

    const labelResult = validateVariantLabels(mode, sizeDraft, colourDraft)
    if (!labelResult.ok) {
      setFeedback({ tone: "error", message: labelResult.message })
      return
    }

    setPendingOperation(`labels:${variant.id}`)
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        "update_vendor_product_variant_labels",
        {
          p_variant_id: variant.id,
          p_size: labelResult.labels.size,
          p_colour: labelResult.labels.colour,
        }
      )
      const result = firstRpcRow<VariantMutationResult>(data)

      if (error || !result) {
        setFeedback({
          tone: "error",
          message: "The labels could not be updated. Please try again.",
        })
      } else if (result.outcome === "updated") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setEditingLabelsId(null)
          setFeedback({ tone: "success", message: "Combination labels updated." })
        }
      } else {
        setFeedback({
          tone: "error",
          message:
            labelMessages[result.outcome] ??
            "Label editing returned an unsupported response.",
        })
      }
    } catch {
      setFeedback({
        tone: "error",
        message: "The labels could not be updated. Please try again.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  const updateStock = async (variant: ProductVariant) => {
    if (pendingOperation) return

    const stock = parseVariantStock(stockDraft)
    if (stock === null) {
      setFeedback({
        tone: "error",
        message: "Enter a whole stock quantity from 0 to 2147483647.",
      })
      return
    }

    setPendingOperation(`stock:${variant.id}`)
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        "update_vendor_product_variant_stock",
        {
          p_variant_id: variant.id,
          p_stock: stock,
          p_expected_stock_version: variant.stock_version,
        }
      )
      const result = firstRpcRow<VariantMutationResult>(data)

      if (error || !result) {
        setFeedback({
          tone: "error",
          message: "The stock quantity could not be updated. Please try again.",
        })
      } else if (result.outcome === "updated") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setEditingStockId(null)
          setFeedback({ tone: "success", message: "Combination stock updated." })
        }
      } else if (result.outcome === "no_change") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setEditingStockId(null)
          setFeedback({ tone: "info", message: "The stock quantity is unchanged." })
        }
      } else if (result.outcome === "conflict") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setEditingStockId(null)
          setFeedback({
            tone: "error",
            message: "Stock changed elsewhere. Review the refreshed value and try again.",
          })
        }
      } else {
        setFeedback({
          tone: "error",
          message:
            stockMessages[result.outcome] ??
            "Stock editing returned an unsupported response.",
        })
      }
    } catch {
      setFeedback({
        tone: "error",
        message: "The stock quantity could not be updated. Please try again.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  const deleteVariant = async (variant: ProductVariant) => {
    if (pendingOperation) return

    setPendingOperation(`delete:${variant.id}`)
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        "delete_vendor_product_variant",
        {
          p_variant_id: variant.id,
          p_expected_stock_version: variant.stock_version,
        }
      )
      const result = firstRpcRow<Pick<VariantMutationResult, "outcome" | "variant_id">>(data)

      if (error || !result) {
        setFeedback({
          tone: "error",
          message: "The combination could not be deleted. Please try again.",
        })
      } else if (result.outcome === "deleted") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setDeleteTargetId(null)
          setFeedback({ tone: "success", message: "Combination deleted." })
        }
      } else if (result.outcome === "conflict") {
        const refreshed = await refreshVariants()
        if (refreshed) {
          setDeleteTargetId(null)
          setFeedback({
            tone: "error",
            message: "This combination changed elsewhere. Review the refreshed data.",
          })
        }
      } else {
        setFeedback({
          tone: "error",
          message:
            deleteMessages[result.outcome] ??
            "Variant deletion returned an unsupported response.",
        })
      }
    } catch {
      setFeedback({
        tone: "error",
        message: "The combination could not be deleted. Please try again.",
      })
    } finally {
      setPendingOperation(null)
    }
  }

  return (
    <section className="max-w-3xl space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">
          Sizes and colours
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Manage draft combinations and their stock. Customer variant purchasing
          is not available yet.
        </p>
      </div>

      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            feedbackClass(feedback.tone)
          )}
        >
          {feedback.message}
        </p>
      )}

      {initialLoadFailed ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Variant management is unavailable until the product data is reloaded.
        </p>
      ) : mode === "none" ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm font-medium text-zinc-900">
              Product eligibility
            </p>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• Seller account must be active.</li>
              <li>• Product must be inactive.</li>
              <li>• Parent stock must be zero.</li>
              <li>• Product must have no order history or existing variants.</li>
            </ul>
            {!isEligibleByVisibleState && (
              <p className="mt-3 text-sm font-medium text-amber-800">
                Set this ordinary product to inactive with zero stock before
                configuring sizes or colours.
              </p>
            )}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Variant mode
            </span>
            <select
              value={selectedMode}
              onChange={(event) => {
                setSelectedMode(
                  event.target.value as Exclude<ProductVariantMode, "none">
                )
                setModeConfirmed(false)
              }}
              disabled={!isEligibleByVisibleState || Boolean(pendingOperation)}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-amber-500 disabled:bg-zinc-100"
            >
              <option value="size">Sizes</option>
              <option value="colour">Colours</option>
              <option value="size_colour">Sizes and colours</option>
            </select>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={modeConfirmed}
              disabled={!isEligibleByVisibleState || Boolean(pendingOperation)}
              onChange={(event) => setModeConfirmed(event.target.checked)}
              className="mt-0.5 size-4 rounded border-amber-300"
            />
            <span>
              I understand that this product&apos;s variant mode cannot currently
              be changed or reverted after configuration.
            </span>
          </label>

          <Button
            type="button"
            onClick={configureMode}
            disabled={
              !isEligibleByVisibleState ||
              !modeConfirmed ||
              configurationUncertain ||
              Boolean(pendingOperation)
            }
            className="h-11 rounded-lg bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            {pendingOperation === "configure" && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Configure {modeLabels[selectedMode]}
          </Button>

          {configurationUncertain && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
              className="ml-3 h-11 rounded-lg border-zinc-300"
            >
              Reload product state
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white">
              {modeLabels[mode]}
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              Draft only
            </span>
          </div>

          <form
            onSubmit={createVariant}
            className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
          >
            <h3 className="font-medium text-zinc-900">Add combination</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {mode !== "colour" && (
                <label>
                  <span className="mb-1 block text-sm text-zinc-700">Size</span>
                  <Input
                    value={createSize}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(event) => setCreateSize(event.target.value)}
                    disabled={Boolean(pendingOperation)}
                    className="h-10 rounded-lg border-zinc-200"
                  />
                </label>
              )}
              {mode !== "size" && (
                <label>
                  <span className="mb-1 block text-sm text-zinc-700">Colour</span>
                  <Input
                    value={createColour}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(event) => setCreateColour(event.target.value)}
                    disabled={Boolean(pendingOperation)}
                    className="h-10 rounded-lg border-zinc-200"
                  />
                </label>
              )}
              <label>
                <span className="mb-1 block text-sm text-zinc-700">Stock</span>
                <Input
                  inputMode="numeric"
                  value={createStock}
                  onChange={(event) => setCreateStock(event.target.value)}
                  disabled={Boolean(pendingOperation)}
                  className="h-10 rounded-lg border-zinc-200"
                />
              </label>
            </div>
            <Button
              type="submit"
              disabled={Boolean(pendingOperation)}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-700"
            >
              {pendingOperation === "create" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Add combination
            </Button>
          </form>

          <div className="space-y-3">
            <h3 className="font-medium text-zinc-900">
              Existing combinations ({variants.length})
            </h3>
            {variants.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                No combinations have been added yet.
              </p>
            ) : (
              variants.map((variant) => (
                <article
                  key={variant.id}
                  className="space-y-4 rounded-lg border border-zinc-200 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-zinc-900">
                        {combinationLabel(variant)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Stock {variant.stock} · Version {variant.stock_version}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => beginLabelEdit(variant)}
                        disabled={Boolean(pendingOperation)}
                        className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                        aria-label={`Edit labels for ${combinationLabel(variant)}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(variant.id)}
                        disabled={Boolean(pendingOperation)}
                        className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        aria-label={`Delete ${combinationLabel(variant)}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  {editingLabelsId === variant.id && (
                    <div className="grid gap-3 rounded-lg bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
                      {mode !== "colour" ? (
                        <Input
                          value={sizeDraft}
                          maxLength={MAX_LABEL_LENGTH}
                          aria-label="Size label"
                          onChange={(event) => setSizeDraft(event.target.value)}
                          className="h-9 rounded-lg border-zinc-200"
                        />
                      ) : (
                        <span />
                      )}
                      {mode !== "size" ? (
                        <Input
                          value={colourDraft}
                          maxLength={MAX_LABEL_LENGTH}
                          aria-label="Colour label"
                          onChange={(event) => setColourDraft(event.target.value)}
                          className="h-9 rounded-lg border-zinc-200"
                        />
                      ) : (
                        <span />
                      )}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => updateLabels(variant)}
                          disabled={Boolean(pendingOperation)}
                          className="rounded-lg bg-zinc-900 text-white"
                        >
                          Save labels
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingLabelsId(null)}
                          disabled={Boolean(pendingOperation)}
                          className="rounded-lg border-zinc-200"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {editingStockId === variant.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        inputMode="numeric"
                        value={stockDraft}
                        aria-label="Variant stock"
                        onChange={(event) => setStockDraft(event.target.value)}
                        className="h-9 w-32 rounded-lg border-zinc-200"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => updateStock(variant)}
                        disabled={Boolean(pendingOperation)}
                        className="rounded-lg bg-zinc-900 text-white"
                      >
                        Save stock
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingStockId(null)}
                        disabled={Boolean(pendingOperation)}
                        className="rounded-lg border-zinc-200"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingStockId(variant.id)
                        setStockDraft(String(variant.stock))
                        setFeedback(null)
                      }}
                      disabled={Boolean(pendingOperation)}
                      className="rounded-lg border-zinc-200"
                    >
                      Edit stock
                    </Button>
                  )}

                  {deleteTargetId === variant.id && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <p>
                        Delete this combination? Referenced historical
                        combinations cannot be removed.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => deleteVariant(variant)}
                          disabled={Boolean(pendingOperation)}
                          className="rounded-lg bg-red-600 text-white hover:bg-red-700"
                        >
                          Delete combination
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTargetId(null)}
                          disabled={Boolean(pendingOperation)}
                          className="rounded-lg border-red-200 bg-white"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  )
}
