import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.38.0"

const MAX_BODY_BYTES = 256 * 1024
const NOTIFICATION_TIMEOUT_MS = 5_000
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/
const TRANSACTION_ID_PATTERN = /^[0-9]+$/
const REFERENCE_PATTERN = /^[A-Za-z0-9._=-]{1,100}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n

const ACKNOWLEDGED_OUTCOMES = new Set([
  "FINALIZED",
  "ALREADY_FINALIZED",
  "EVENT_ALREADY_COMPLETED",
  "LEGACY_ALREADY_FINALIZED",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "PAYMENT_IDENTITY_CONFLICT",
  "CREDIT_CONFLICT",
  "LEGACY_FINALIZATION_REQUIRES_RECONCILIATION",
  "RECONCILIATION_REQUIRED",
])
const RETRYABLE_OUTCOMES = new Set([
  "ORDER_NOT_FOUND_RETRYABLE",
  "RETRYABLE_FAILURE",
])

type JsonRange = { start: number; end: number }
type ParsedRpcResult = {
  outcome: string
  orderId: string | null
  retryable: boolean
  status: 200 | 503
}

function jsonResponse(status: number, code?: string): Response {
  return new Response(
    JSON.stringify(
      status === 200
        ? { received: true }
        : { received: false, error: { code: code ?? "WEBHOOK_UNAVAILABLE" } }
    ),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    }
  )
}

function logOperationalFailure(category: string, outcome?: string) {
  console.error("[paystack-webhook] operation failed", {
    category,
    ...(outcome ? { outcome } : {}),
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

async function readBoundedRawBody(req: Request): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; tooLarge: boolean }
> {
  const declaredLength = req.headers.get("content-length")
  if (
    declaredLength !== null &&
    /^[0-9]+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_BODY_BYTES
  ) {
    return { ok: false, tooLarge: true }
  }

  if (!req.body) return { ok: true, bytes: new Uint8Array() }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, tooLarge: false }
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

function hexToBytes(value: string): Uint8Array | null {
  if (!SIGNATURE_PATTERN.test(value)) return null

  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

async function verifyPaystackSignature(
  rawBody: Uint8Array,
  signature: string,
  secret: string
): Promise<boolean> {
  const signatureBytes = hexToBytes(signature)
  if (!signatureBytes) return false

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["verify"]
  )
  return crypto.subtle.verify("HMAC", key, signatureBytes, rawBody)
}

async function sha256Hex(rawBody: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", rawBody)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

// OPS_2B3_LOSSLESS_JSON_START
function skipWhitespace(text: string, start: number): number {
  let index = start
  while (/\s/.test(text[index] ?? "")) index += 1
  return index
}

function skipJsonString(text: string, start: number): number {
  if (text[start] !== '"') throw new Error("expected string")

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') return index + 1
    if (character === "\\") {
      index += 1
      if (text[index] === "u") index += 4
    }
  }
  throw new Error("unterminated string")
}

function skipJsonValue(text: string, start: number): number {
  const index = skipWhitespace(text, start)
  const character = text[index]
  if (character === '"') return skipJsonString(text, index)

  if (character === "{") {
    let cursor = skipWhitespace(text, index + 1)
    if (text[cursor] === "}") return cursor + 1
    while (cursor < text.length) {
      cursor = skipJsonString(text, cursor)
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] !== ":") throw new Error("expected colon")
      cursor = skipJsonValue(text, cursor + 1)
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === "}") return cursor + 1
      if (text[cursor] !== ",") throw new Error("expected comma")
      cursor = skipWhitespace(text, cursor + 1)
    }
  }

  if (character === "[") {
    let cursor = skipWhitespace(text, index + 1)
    if (text[cursor] === "]") return cursor + 1
    while (cursor < text.length) {
      cursor = skipJsonValue(text, cursor)
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === "]") return cursor + 1
      if (text[cursor] !== ",") throw new Error("expected comma")
      cursor = skipWhitespace(text, cursor + 1)
    }
  }

  let end = index
  while (end < text.length && !/[\s,\]}]/.test(text[end])) end += 1
  if (end === index) throw new Error("expected value")
  return end
}

function findUniqueObjectProperty(
  text: string,
  objectRange: JsonRange,
  propertyName: string
): JsonRange | null {
  let cursor = skipWhitespace(text, objectRange.start)
  if (text[cursor] !== "{") return null

  cursor = skipWhitespace(text, cursor + 1)
  let result: JsonRange | null = null
  while (cursor < objectRange.end && text[cursor] !== "}") {
    const keyStart = cursor
    const keyEnd = skipJsonString(text, keyStart)
    const key = JSON.parse(text.slice(keyStart, keyEnd))
    cursor = skipWhitespace(text, keyEnd)
    if (text[cursor] !== ":") throw new Error("expected colon")

    const valueStart = skipWhitespace(text, cursor + 1)
    const valueEnd = skipJsonValue(text, valueStart)
    if (key === propertyName) {
      if (result) throw new Error("duplicate property")
      result = { start: valueStart, end: valueEnd }
    }

    cursor = skipWhitespace(text, valueEnd)
    if (text[cursor] === "}") break
    if (text[cursor] !== ",") throw new Error("expected comma")
    cursor = skipWhitespace(text, cursor + 1)
  }
  return result
}

function extractUniqueScalarText(
  text: string,
  path: readonly string[]
): string | null {
  const rootStart = skipWhitespace(text, 0)
  const rootEnd = skipJsonValue(text, rootStart)
  if (skipWhitespace(text, rootEnd) !== text.length) return null

  let range: JsonRange | null = { start: rootStart, end: rootEnd }
  for (const propertyName of path) {
    range = range
      ? findUniqueObjectProperty(text, range, propertyName)
      : null
    if (!range) return null
  }

  const rawValue = text.slice(range.start, range.end)
  if (rawValue.startsWith('"')) {
    const parsed = JSON.parse(rawValue)
    return typeof parsed === "string" ? parsed : null
  }
  return rawValue
}
// OPS_2B3_LOSSLESS_JSON_END

function parsePositiveBigintText(value: string | null): string | null {
  if (!value || !/^[0-9]+$/.test(value)) return null
  try {
    const parsed = BigInt(value)
    return parsed > 0n && parsed <= POSTGRES_BIGINT_MAX ? value : null
  } catch {
    return null
  }
}

function validPaidAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) &&
    Number.isFinite(Date.parse(value))
  )
}

function parseRpcResult(data: unknown): ParsedRpcResult | null {
  if (!Array.isArray(data) || data.length !== 1 || !isPlainObject(data[0])) {
    return null
  }

  const row = data[0]
  if (
    Object.keys(row).sort().join(",") !== "order_id,outcome,retryable" ||
    typeof row.outcome !== "string" ||
    typeof row.retryable !== "boolean" ||
    !(
      row.order_id === null ||
      (typeof row.order_id === "string" && UUID_PATTERN.test(row.order_id))
    )
  ) {
    return null
  }

  const outcome = row.outcome
  if (outcome === "INVALID_PROVIDER_PAYLOAD") {
    return {
      outcome,
      orderId: row.order_id as string | null,
      retryable: row.retryable,
      status: row.retryable ? 503 : 200,
    }
  }

  if (ACKNOWLEDGED_OUTCOMES.has(outcome) && row.retryable === false) {
    if (outcome === "FINALIZED" && typeof row.order_id !== "string") {
      return null
    }
    return {
      outcome,
      orderId: row.order_id as string | null,
      retryable: false,
      status: 200,
    }
  }

  if (RETRYABLE_OUTCOMES.has(outcome) && row.retryable === true) {
    return {
      outcome,
      orderId: row.order_id as string | null,
      retryable: true,
      status: 503,
    }
  }
  return null
}

async function notifyPaidOrder(
  supabase: SupabaseClient,
  orderId: string,
  reference: string
) {
  try {
    const n8nUrl = Deno.env.get("N8N_PAID_ORDER_WEBHOOK_URL")
    if (!n8nUrl) {
      logOperationalFailure("notification_configuration_missing")
      return
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, customer_email, customer_phone, total_amount")
      .eq("id", orderId)
      .maybeSingle()

    if (error || !order) {
      logOperationalFailure("notification_order_lookup_failed")
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      NOTIFICATION_TIMEOUT_MS
    )
    let response: Response
    try {
      response = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.id,
          customer_email: order.customer_email,
          customer_phone: order.customer_phone,
          total_amount: order.total_amount,
          reference,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
    if (!response.ok) {
      logOperationalFailure("notification_http_failure")
    }
  } catch {
    logOperationalFailure("notification_failure")
  }
}

async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(405, "METHOD_NOT_ALLOWED")
  }

  const signature = req.headers.get("x-paystack-signature")
  if (!signature) return jsonResponse(401, "SIGNATURE_REQUIRED")
  if (!SIGNATURE_PATTERN.test(signature)) {
    return jsonResponse(401, "INVALID_SIGNATURE")
  }

  const webhookSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET")
  if (!webhookSecret) {
    logOperationalFailure("webhook_secret_missing")
    return jsonResponse(503, "WEBHOOK_UNAVAILABLE")
  }

  const boundedBody = await readBoundedRawBody(req)
  if (!boundedBody.ok) {
    return boundedBody.tooLarge
      ? jsonResponse(413, "PAYLOAD_TOO_LARGE")
      : jsonResponse(400, "INVALID_BODY")
  }

  let signatureValid = false
  try {
    signatureValid = await verifyPaystackSignature(
      boundedBody.bytes,
      signature,
      webhookSecret
    )
  } catch {
    logOperationalFailure("signature_verification_failed")
    return jsonResponse(503, "WEBHOOK_UNAVAILABLE")
  }
  if (!signatureValid) return jsonResponse(401, "INVALID_SIGNATURE")

  let rawBody: string
  let event: unknown
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(
      boundedBody.bytes
    )
    event = JSON.parse(rawBody)
  } catch {
    return jsonResponse(400, "INVALID_PAYLOAD")
  }

  if (
    !isPlainObject(event) ||
    typeof event.event !== "string" ||
    event.event.length < 1 ||
    event.event.length > 100
  ) {
    return jsonResponse(400, "INVALID_PAYLOAD")
  }

  if (event.event !== "charge.success") return jsonResponse(200)
  if (!isPlainObject(event.data)) return jsonResponse(400, "INVALID_PAYLOAD")

  let transactionId: string | null = null
  let amountKobo: string | null = null
  try {
    transactionId = extractUniqueScalarText(rawBody, ["data", "id"])
    amountKobo = parsePositiveBigintText(
      extractUniqueScalarText(rawBody, ["data", "amount"])
    )
  } catch {
    return jsonResponse(400, "INVALID_PAYLOAD")
  }

  const reference = event.data.reference
  const status = event.data.status
  const currency = event.data.currency
  const paidAt = event.data.paid_at
  const environment = event.data.domain
  if (
    !transactionId ||
    !TRANSACTION_ID_PATTERN.test(transactionId) ||
    transactionId.length > 100 ||
    !amountKobo ||
    typeof reference !== "string" ||
    !REFERENCE_PATTERN.test(reference) ||
    typeof status !== "string" ||
    status.length < 1 ||
    status.length > 100 ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency) ||
    !validPaidAt(paidAt) ||
    typeof environment !== "string" ||
    !["test", "live"].includes(environment)
  ) {
    return jsonResponse(400, "INVALID_PAYLOAD")
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    logOperationalFailure("database_configuration_missing")
    return jsonResponse(503, "WEBHOOK_UNAVAILABLE")
  }

  const payloadSha256 = await sha256Hex(boundedBody.bytes)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  let rpcData: unknown
  try {
    const { data, error } = await supabase.rpc(
      "finalize_paystack_paid_order",
      {
        p_payload_sha256: payloadSha256,
        p_event_type: event.event,
        p_environment: environment,
        p_transaction_id: transactionId,
        p_reference: reference,
        p_status: status,
        p_amount_kobo: amountKobo,
        p_currency: currency,
        p_paid_at: paidAt,
      }
    )
    if (error) {
      logOperationalFailure("finalization_rpc_error")
      return jsonResponse(503, "WEBHOOK_RETRY_REQUIRED")
    }
    rpcData = data
  } catch {
    logOperationalFailure("finalization_rpc_transport_failure")
    return jsonResponse(503, "WEBHOOK_RETRY_REQUIRED")
  }

  const result = parseRpcResult(rpcData)
  if (!result) {
    logOperationalFailure("malformed_finalization_result")
    return jsonResponse(503, "WEBHOOK_RETRY_REQUIRED")
  }

  if (result.status === 503) {
    logOperationalFailure("retryable_finalization_outcome", result.outcome)
    return jsonResponse(503, "WEBHOOK_RETRY_REQUIRED")
  }

  if (result.outcome === "FINALIZED" && result.orderId) {
    await notifyPaidOrder(supabase, result.orderId, reference)
  }
  return jsonResponse(200)
}

serve(async (req) => {
  try {
    return await handleWebhook(req)
  } catch {
    logOperationalFailure("unexpected_webhook_failure")
    return jsonResponse(503, "WEBHOOK_UNAVAILABLE")
  }
})
