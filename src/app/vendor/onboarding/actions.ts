"use server"

import { headers } from "next/headers"

import { createSupabaseServerClient } from "@/lib/supabase-server"
import {
  finalizeSellerAccount,
  type SellerFinalizationOutcome,
} from "@/lib/vendor/finalization"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FinalizationActionOutcome =
  | SellerFinalizationOutcome
  | "auth_required"
  | "invalid_request"

export type FinalizationResult = {
  outcome: FinalizationActionOutcome
  message: string
  revision: string
}

const messages: Record<FinalizationActionOutcome, string> = {
  finalized:
    "Your seller account has been created. Your store is currently inactive and is not yet verified.",
  already_finalized: "Your seller account has already been created.",
  auth_required: "Your session has expired. Sign in again to continue.",
  email_unconfirmed:
    "Confirm your account email before creating your seller account.",
  no_pending_enrollment:
    "No pending seller enrollment is available for this account.",
  identity_mismatch:
    "We couldn't verify this seller enrollment against your account. Contact support.",
  vendor_collision: "This seller enrollment requires manual review.",
  invalid_state:
    "This seller enrollment is no longer ready to finalize. Refresh and review its current status.",
  reconciliation_required:
    "Seller account status is uncertain. Do not retry immediately. Refresh the page or contact support.",
  service_unavailable:
    "We couldn't complete seller enrollment right now. Try again later.",
  invalid_request: "Invalid request. Reload the page and try again.",
}

async function assertSellerOrigin() {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  const isVercel = process.env.VERCEL === "1"
  const host =
    isVercel
      ? requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
      : requestHeaders.get("host")
  const forwardedProtocol = isVercel
    ? requestHeaders.get("x-forwarded-proto")
    : null

  if (
    !origin ||
    origin === "null" ||
    !host ||
    /[\s,/@\\]/.test(host) ||
    (isVercel && forwardedProtocol !== "https")
  ) {
    throw new Error("Invalid seller request origin.")
  }

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error("Invalid seller request origin.")
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== origin ||
    parsed.host.toLowerCase() !== host.toLowerCase() ||
    (isVercel && parsed.protocol !== `${forwardedProtocol}:`)
  ) {
    throw new Error("Invalid seller request origin.")
  }
}

function result(outcome: FinalizationActionOutcome): FinalizationResult {
  return {
    outcome,
    message: messages[outcome],
    revision: crypto.randomUUID(),
  }
}

export async function finalizeSellerEnrollment(
  _previous: FinalizationResult,
  _formData: FormData
): Promise<FinalizationResult> {
  void _previous
  void _formData

  try {
    await assertSellerOrigin()
  } catch {
    return result("invalid_request")
  }

  let user
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return result("auth_required")
    user = data.user
  } catch {
    return result("auth_required")
  }

  if (!UUID_PATTERN.test(user.id)) return result("auth_required")
  if (!user.email) return result("identity_mismatch")
  if (!user.email_confirmed_at) return result("email_unconfirmed")

  const normalizedEmail = user.email.trim().toLowerCase()
  if (!normalizedEmail) return result("identity_mismatch")

  let outcome: SellerFinalizationOutcome
  try {
    outcome = await finalizeSellerAccount({
      userId: user.id,
      normalizedEmail,
    })
  } catch {
    outcome = "service_unavailable"
  }

  return result(outcome)
}
