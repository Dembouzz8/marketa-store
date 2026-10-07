import type {
  EmailAdapter,
  EmailDeliveryCommand,
  EmailDeliveryResult,
} from "./index.ts"
import { renderPaidOrderEmail } from "./paid-order-email.ts"

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const PROVIDER_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 16 * 1024
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/
const API_KEY_PATTERN = /^re_[A-Za-z0-9_-]+$/

type EnvironmentReader = (name: string) => string | undefined
type FetchImplementation = typeof fetch

function validMailbox(value: string): boolean {
  if (value.length < 6 || value.length > 254 || value !== value.trim()) return false
  const parts = value.split("@")
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (
    local.length < 1 ||
    local.length > 64 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return false
  }
  const labels = domain.split(".")
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    ) &&
    /^[A-Za-z]{2,63}$/.test(labels.at(-1) ?? "")
  )
}

export function validSender(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 6 ||
    value.length > 320 ||
    value !== value.trim() ||
    CONTROL_PATTERN.test(value)
  ) {
    return false
  }
  if (!value.includes("<") && !value.includes(">")) return validMailbox(value)
  const match = /^([^<>]{1,100}) <([^<>]+)>$/.exec(value)
  return Boolean(
    match && match[1] === match[1].trim() && validMailbox(match[2])
  )
}

function validApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 256 &&
    API_KEY_PATTERN.test(value)
  )
}

function validRecipient(value: string): boolean {
  return validMailbox(value)
}

function validIdempotencyKey(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && !CONTROL_PATTERN.test(value)
}

function validProviderMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    value === value.trim() &&
    !CONTROL_PATTERN.test(value)
  )
}

async function readBoundedText(
  response: Response
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && /^[0-9]+$/.test(declaredLength)) {
    if (BigInt(declaredLength) > BigInt(MAX_RESPONSE_BYTES)) return { ok: false }
  }
  if (!response.body) return { ok: true, text: "" }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return { ok: false }
      }
      chunks.push(result.value)
    }
  } catch {
    return { ok: false }
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}

function classifyErrorStatus(status: number): EmailDeliveryResult {
  switch (status) {
    case 400:
      return { outcome: "PERMANENT_FAILURE", diagnosticCode: "RESEND_INVALID_REQUEST" }
    case 401:
      return { outcome: "RETRYABLE_FAILURE", diagnosticCode: "RESEND_UNAUTHORIZED" }
    case 403:
      return { outcome: "RETRYABLE_FAILURE", diagnosticCode: "RESEND_FORBIDDEN" }
    case 404:
      return { outcome: "PERMANENT_FAILURE", diagnosticCode: "RESEND_NOT_FOUND" }
    case 408:
      return { outcome: "UNKNOWN", diagnosticCode: "RESEND_REQUEST_UNCERTAIN" }
    case 409:
      return { outcome: "UNKNOWN", diagnosticCode: "RESEND_IDEMPOTENCY_UNCERTAIN" }
    case 422:
      return { outcome: "PERMANENT_FAILURE", diagnosticCode: "RESEND_VALIDATION_FAILED" }
    case 429:
      return { outcome: "RETRYABLE_FAILURE", diagnosticCode: "RESEND_RATE_LIMITED" }
    default:
      return { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }
  }
}

function createResendAdapter(
  apiKey: string,
  sender: string,
  fetchImpl: FetchImplementation,
  providerTimeoutMs: number
): EmailAdapter {
  return {
    providerName: "resend",
    async sendEmail(command: EmailDeliveryCommand): Promise<EmailDeliveryResult> {
      if (
        !validRecipient(command.to) ||
        !validIdempotencyKey(command.idempotencyKey)
      ) {
        return { outcome: "PERMANENT_FAILURE", diagnosticCode: "RESEND_INVALID_REQUEST" }
      }

      let rendered
      try {
        rendered = renderPaidOrderEmail(command)
      } catch {
        return { outcome: "PERMANENT_FAILURE", diagnosticCode: "RESEND_INVALID_REQUEST" }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), providerTimeoutMs)
      try {
        const providerResponse = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": command.idempotencyKey,
          },
          body: JSON.stringify({
            from: sender,
            to: [command.to],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
          signal: controller.signal,
        })
        if (providerResponse.status < 200 || providerResponse.status > 299) {
          return classifyErrorStatus(providerResponse.status)
        }
        const body = await readBoundedText(providerResponse)
        if (!body.ok) {
          return { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }
        }
        try {
          const parsed: unknown = JSON.parse(body.text)
          const providerMessageId =
            typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>).id
              : null
          return validProviderMessageId(providerMessageId)
            ? { outcome: "DELIVERED", providerMessageId }
            : { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }
        } catch {
          return { outcome: "UNKNOWN", diagnosticCode: "RESEND_PROVIDER_UNCERTAIN" }
        }
      } catch {
        return { outcome: "UNKNOWN", diagnosticCode: "PROVIDER_RESULT_UNKNOWN" }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export function createProductionEmailAdapter(
  getEnv: EnvironmentReader,
  fetchImpl: FetchImplementation = fetch,
  providerTimeoutMs = PROVIDER_TIMEOUT_MS
): EmailAdapter | null {
  try {
    const apiKey = getEnv("RESEND_API_KEY")
    const sender = getEnv("MARKETA_EMAIL_FROM")
    return validApiKey(apiKey) && validSender(sender) &&
        Number.isInteger(providerTimeoutMs) && providerTimeoutMs >= 1 &&
        providerTimeoutMs <= PROVIDER_TIMEOUT_MS
      ? createResendAdapter(apiKey, sender, fetchImpl, providerTimeoutMs)
      : null
  } catch {
    return null
  }
}
