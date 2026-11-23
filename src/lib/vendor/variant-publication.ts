"use server"

import { revalidatePath } from "next/cache"

import { createSupabaseServerClient } from "@/lib/supabase-server"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PublicationOutcome =
  | "published"
  | "deactivated"
  | "no_change"
  | "access_denied"
  | "invalid_input"
  | "not_found"
  | "invalid_state"
  | "release_disabled"
  | "operation_failed"

export type VariantPublicationActionResult = {
  status: "success" | "error"
  outcome: PublicationOutcome | "gate_disabled" | "unconfirmed"
  message: string
  productId?: string
  active?: boolean
}

type PublicationRow = {
  outcome: PublicationOutcome
  publication_product_id: string | null
  publication_active: boolean | null
}

function errorResult(
  outcome: VariantPublicationActionResult["outcome"],
  message: string
): VariantPublicationActionResult {
  return { status: "error", outcome, message }
}

function parsePublicationRow(data: unknown): PublicationRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null

  const row: unknown = data[0]
  if (!row || typeof row !== "object" || Array.isArray(row)) return null

  const value = row as Record<string, unknown>
  const outcomes: PublicationOutcome[] = [
    "published",
    "deactivated",
    "no_change",
    "access_denied",
    "invalid_input",
    "not_found",
    "invalid_state",
    "release_disabled",
    "operation_failed",
  ]

  if (
    typeof value.outcome !== "string" ||
    !outcomes.includes(value.outcome as PublicationOutcome) ||
    (value.publication_product_id !== null &&
      typeof value.publication_product_id !== "string") ||
    (value.publication_active !== null &&
      typeof value.publication_active !== "boolean")
  ) {
    return null
  }

  return {
    outcome: value.outcome as PublicationOutcome,
    publication_product_id: value.publication_product_id as string | null,
    publication_active: value.publication_active as boolean | null,
  }
}

function controlledError(outcome: PublicationOutcome) {
  if (outcome === "access_denied") {
    return "You do not have permission to change this product's publication state."
  }
  if (outcome === "invalid_input") {
    return "The publication request was invalid. Refresh and try again."
  }
  if (outcome === "not_found") {
    return "This product is unavailable or no longer belongs to your vendor account."
  }
  if (outcome === "invalid_state") {
    return "This product is not currently eligible for that publication change. Refresh and review its combinations."
  }
  if (outcome === "release_disabled") {
    return "Variant publication is not available yet. No publication change was made."
  }
  return "Unable to update publication right now. Please try again."
}

export async function setVariantProductPublication(
  productId: string,
  active: boolean
): Promise<VariantPublicationActionResult> {
  if (process.env.VARIANT_PUBLICATION_UI_ENABLED !== "true") {
    return errorResult(
      "gate_disabled",
      "Variant publication controls are currently unavailable."
    )
  }

  if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) {
    return errorResult("invalid_input", "The publication request was invalid.")
  }
  if (typeof active !== "boolean") {
    return errorResult("invalid_input", "The publication request was invalid.")
  }

  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResult(
        "access_denied",
        "Your session has expired. Please sign in again."
      )
    }

    const { data, error } = await supabase.rpc(
      "set_vendor_product_variant_publication",
      {
        p_product_id: productId,
        p_active: active,
      }
    )

    if (error) {
      return errorResult(
        "operation_failed",
        "Unable to update publication right now. Please try again."
      )
    }

    const row = parsePublicationRow(data)
    if (!row) {
      return errorResult(
        "unconfirmed",
        "The publication result could not be confirmed. Refresh before trying again."
      )
    }

    if (
      row.outcome === "published" ||
      row.outcome === "deactivated" ||
      row.outcome === "no_change"
    ) {
      const expectedOutcome = active ? "published" : "deactivated"
      if (
        row.publication_product_id !== productId ||
        row.publication_active !== active ||
        (row.outcome !== expectedOutcome && row.outcome !== "no_change")
      ) {
        return errorResult(
          "unconfirmed",
          "The publication result could not be confirmed. Refresh before trying again."
        )
      }

      revalidatePath(`/vendor/products/${productId}/edit`)
      revalidatePath("/vendor/products")

      return {
        status: "success",
        outcome: row.outcome,
        message:
          row.outcome === "no_change"
            ? active
              ? "This product is already published."
              : "This product is already a draft."
            : active
              ? "Product published."
              : "Product unpublished.",
        productId,
        active,
      }
    }

    return errorResult(row.outcome, controlledError(row.outcome))
  } catch {
    return errorResult(
      "operation_failed",
      "Unable to update publication right now. Please try again."
    )
  }
}
