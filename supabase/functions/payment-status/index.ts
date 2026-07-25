import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"

type PublicPaymentStatus = "confirmed" | "processing" | "unknown"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFERENCE_PATTERN = /^[A-Za-z0-9._=-]{1,100}$/

function allowedOrigin(): string | null {
  const configuredOrigin = Deno.env.get("STOREFRONT_URL")
  if (!configuredOrigin) return null

  try {
    return new URL(configuredOrigin).origin
  } catch {
    return null
  }
}

function responseHeaders(req: Request): HeadersInit {
  const configuredOrigin = allowedOrigin()
  const requestOrigin = req.headers.get("origin")
  const responseOrigin =
    configuredOrigin && requestOrigin === configuredOrigin
      ? requestOrigin
      : configuredOrigin ?? ""

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin",
  }
}

function publicResponse(
  req: Request,
  status: PublicPaymentStatus,
  httpStatus = 200
) {
  const body =
    status === "processing"
      ? { status, retry_after_ms: 2000 }
      : { status }

  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: responseHeaders(req),
  })
}

serve(async (req) => {
  const configuredOrigin = allowedOrigin()
  const requestOrigin = req.headers.get("origin")

  if (!configuredOrigin) {
    console.error("[payment-status] STOREFRONT_URL is missing or invalid")
    return publicResponse(req, "unknown", 500)
  }

  if (requestOrigin && requestOrigin !== configuredOrigin) {
    return publicResponse(req, "unknown", 403)
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(req),
    })
  }

  if (req.method !== "POST") {
    return publicResponse(req, "unknown", 405)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return publicResponse(req, "unknown", 400)
  }

  const orderId =
    typeof body === "object" &&
    body !== null &&
    "order_id" in body &&
    typeof body.order_id === "string"
      ? body.order_id
      : ""
  const reference =
    typeof body === "object" &&
    body !== null &&
    "reference" in body &&
    typeof body.reference === "string"
      ? body.reference
      : ""

  if (!UUID_PATTERN.test(orderId) || !REFERENCE_PATTERN.test(reference)) {
    return publicResponse(req, "unknown", 400)
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )
    const { data, error } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .eq("payment_ref", reference)
      .maybeSingle()

    if (error) {
      console.error("[payment-status] order lookup failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return publicResponse(req, "unknown", 503)
    }

    if (!data) {
      return publicResponse(req, "unknown")
    }

    const orderStatus =
      typeof data.status === "string" ? data.status.toLowerCase() : ""

    if (orderStatus === "confirmed" || orderStatus === "fulfilled") {
      return publicResponse(req, "confirmed")
    }

    if (orderStatus === "pending") {
      return publicResponse(req, "processing")
    }

    return publicResponse(req, "unknown")
  } catch (error) {
    console.error(
      "[payment-status] unexpected lookup failure",
      error instanceof Error ? error.message : "Unknown error"
    )
    return publicResponse(req, "unknown", 503)
  }
})
