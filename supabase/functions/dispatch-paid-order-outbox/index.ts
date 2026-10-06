import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDER_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/
const DIAGNOSTIC_PATTERN = /^[A-Z0-9_]{1,80}$/
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

type DatabaseResult = { data: unknown; error: unknown }
type DispatcherClient = SupabaseClient
type LogMarker =
  | "MARKETA_DISPATCH_AUTH_FAILED"
  | "MARKETA_DISPATCH_CONFIG_MISSING"
  | "MARKETA_DISPATCH_CLAIM_FAILED"
  | "MARKETA_DISPATCH_EXPANSION_FAILED"
  | "MARKETA_DISPATCH_DATA_LOAD_FAILED"
  | "MARKETA_DISPATCH_CHILD_BLOCKED"
  | "MARKETA_DISPATCH_PROVIDER_UNKNOWN"
  | "MARKETA_DISPATCH_CHILD_ACK_FAILED"
  | "MARKETA_DISPATCH_PARENT_ACK_FAILED"

export type EmailDeliveryCommand =
  | {
      recipientKind: "customer"
      to: string
      idempotencyKey: string
      orderId: string
      totalAmountKobo: string
      currency: string
      items: Array<{
        productName: string
        quantity: number
        grossAmountKobo: string
      }>
    }
  | {
      recipientKind: "vendor"
      to: string
      idempotencyKey: string
      orderId: string
      vendor: { id: string; name: string }
      items: Array<{
        productName: string
        quantity: number
        grossAmountKobo: string
        platformFeeAmountKobo: string
        vendorNetAmountKobo: string
        currency: string
      }>
    }

type PreparedEmailDeliveryCommand =
  | Omit<
      Extract<EmailDeliveryCommand, { recipientKind: "customer" }>,
      "idempotencyKey"
    >
  | Omit<
      Extract<EmailDeliveryCommand, { recipientKind: "vendor" }>,
      "idempotencyKey"
    >

export type EmailDeliveryResult =
  | { outcome: "DELIVERED"; providerMessageId?: string }
  | { outcome: "RETRYABLE_FAILURE"; diagnosticCode: string }
  | { outcome: "PERMANENT_FAILURE"; diagnosticCode: string }
  | { outcome: "UNKNOWN"; diagnosticCode: string }

export type EmailAdapter = {
  providerName: string
  sendEmail(command: EmailDeliveryCommand): Promise<EmailDeliveryResult>
}

export type DispatchResult =
  | { result: "NO_WORK" }
  | { result: "DELIVERED"; parentsProcessed: 1 }
  | { result: "PARENT_RETRY_SCHEDULED"; code: string }
  | { result: "PARENT_DEAD_LETTER" }
  | { result: "PARENT_LEASE_LOST" }
  | { result: "CHILD_ACK_UNCERTAIN" }
  | { result: "CLAIM_FAILED" }

type ClaimedParent = {
  eventId: string
  orderId: string
  leaseToken: string
}

type DeliveryChild = {
  id: string
  outboxEventId: string
  orderId: string
  recipientKind: "customer" | "vendor"
  vendorId: string | null
  channel: "email"
  deliveryKey: string
  status: "pending" | "processing" | "delivered" | "unknown" | "dead_letter"
  attemptCount: number
}

type OrderData = {
  id: string
  customerEmail: string
  totalAmountKobo: bigint
  currency: string
  financialContractVersion: 1 | 2
}

type ItemData = {
  id: string
  orderId: string
  productId: string
  vendorId: string
  quantity: number
  unitAmountKobo: bigint
  grossAmountKobo: bigint
  platformFeeBps: number
  platformFeeAmountKobo: bigint
  vendorNetAmountKobo: bigint
  currency: string
  financialContractVersion: 1 | 2
  productName: string
}

type VendorData = { id: string; name: string; email: string }
type AuthoritativeData = {
  order: OrderData
  items: ItemData[]
  vendors: Map<string, VendorData>
}

type DataLoadResult =
  | { ok: true; value: AuthoritativeData }
  | { ok: false; code: "DELIVERY_DATA_INVALID" | "DELIVERY_DATA_LOAD_FAILED" }

type RuntimeDependencies = {
  getEnv(name: string): string | undefined
  createServiceClient(url: string, key: string): DispatcherClient
  emailAdapter: EmailAdapter | null
  createWorkerId(): string
  log(marker: LogMarker): void
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function positiveBigint(value: unknown): bigint | null {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "bigint") ||
    !/^[0-9]+$/.test(String(value))
  ) {
    return null
  }
  try {
    const parsed = BigInt(value)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

function decimalToKobo(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(String(value))
  if (!match) return null
  try {
    return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
  } catch {
    return null
  }
}

function oneRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) && data.length === 1 && isPlainObject(data[0])
    ? data[0]
    : null
}

function noRows(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0
}

function parseClaim(data: unknown): ClaimedParent | "NO_WORK" | null {
  if (noRows(data)) return "NO_WORK"
  const row = oneRow(data)
  if (!row) return null
  if (
    !isUuid(row.event_id) ||
    !isUuid(row.order_id) ||
    !isUuid(row.lease_token) ||
    row.event_version !== 1 ||
    !isInteger(row.attempt_count, 1, 12) ||
    row.idempotency_key !== `paid-order:${row.order_id}`
  ) {
    return null
  }
  return {
    eventId: row.event_id,
    orderId: row.order_id,
    leaseToken: row.lease_token,
  }
}

function validExpansion(data: unknown): boolean {
  const row = oneRow(data)
  if (!row) return false
  const keys = [
    "delivery_count",
    "pending_count",
    "processing_count",
    "delivered_count",
    "unknown_count",
    "dead_letter_count",
  ]
  const counts = keys.map((key) => {
    const value = row[key]
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value)
        ? Number(value)
        : -1
  })
  return (
    counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    counts[0] >= 1 &&
    counts.slice(1).reduce((sum, value) => sum + value, 0) === counts[0]
  )
}

function parseChildren(data: unknown, parent: ClaimedParent): DeliveryChild[] | null {
  if (!Array.isArray(data) || data.length < 1) return null
  const ids = new Set<string>()
  const keys = new Set<string>()
  const children: DeliveryChild[] = []
  for (const value of data) {
    if (!isPlainObject(value)) return null
    const recipientKind = value.recipient_kind
    const vendorId = value.vendor_id
    const expectedKey =
      recipientKind === "customer" && vendorId === null
        ? `paid-order:${parent.orderId}:customer:email`
        : recipientKind === "vendor" && isUuid(vendorId)
          ? `paid-order:${parent.orderId}:vendor:${vendorId}:email`
          : null
    if (
      !isUuid(value.id) ||
      value.outbox_event_id !== parent.eventId ||
      value.order_id !== parent.orderId ||
      value.channel !== "email" ||
      value.delivery_key !== expectedKey ||
      !["pending", "processing", "delivered", "unknown", "dead_letter"].includes(
        String(value.status)
      ) ||
      !isInteger(value.attempt_count, 0, 12) ||
      ids.has(value.id) ||
      keys.has(value.delivery_key as string)
    ) {
      return null
    }
    ids.add(value.id)
    keys.add(value.delivery_key as string)
    children.push({
      id: value.id,
      outboxEventId: value.outbox_event_id as string,
      orderId: value.order_id as string,
      recipientKind: recipientKind as "customer" | "vendor",
      vendorId: vendorId as string | null,
      channel: "email",
      deliveryKey: value.delivery_key as string,
      status: value.status as DeliveryChild["status"],
      attemptCount: value.attempt_count,
    })
  }
  return children
}

function validEmail(value: string): boolean {
  return value.length <= 254 && value === value.trim() && EMAIL_PATTERN.test(value)
}

function validDiagnostic(value: unknown): value is string {
  return typeof value === "string" && DIAGNOSTIC_PATTERN.test(value)
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function validDispatcherSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    /^[\x21-\x7e]+$/.test(value)
  )
}

function parseParentFailure(
  data: unknown
): "pending" | "dead_letter" | null {
  const row = oneRow(data)
  if (!row || !isInteger(row.outbox_attempt_count, 1, 12)) return null

  if (row.outbox_status === "pending") {
    return row.outbox_attempt_count < 12 && validTimestamp(row.next_available_at)
      ? "pending"
      : null
  }

  if (row.outbox_status === "dead_letter") {
    return row.outbox_attempt_count === 12 ? "dead_letter" : null
  }

  return null
}

async function safeRpc(
  client: DispatcherClient,
  name: string,
  parameters: Record<string, unknown>
): Promise<DatabaseResult | null> {
  try {
    return (await client.rpc(name, parameters)) as DatabaseResult
  } catch {
    return null
  }
}

async function failParent(
  client: DispatcherClient,
  parent: ClaimedParent,
  code: string,
  log: (marker: LogMarker) => void
): Promise<DispatchResult> {
  const response = await safeRpc(client, "mark_paid_order_outbox_failed", {
    p_event_id: parent.eventId,
    p_lease_token: parent.leaseToken,
    p_error_code: code,
  })
  const failureState =
    response && !response.error ? parseParentFailure(response.data) : null
  if (!failureState) {
    log("MARKETA_DISPATCH_PARENT_ACK_FAILED")
    return { result: "PARENT_LEASE_LOST" }
  }
  return failureState === "pending"
    ? { result: "PARENT_RETRY_SCHEDULED", code }
    : { result: "PARENT_DEAD_LETTER" }
}

async function loadAuthoritativeData(
  client: DispatcherClient,
  parent: ClaimedParent,
  children: DeliveryChild[]
): Promise<DataLoadResult> {
  try {
    const orderResult = (await client
      .from("orders")
      .select(
        "id, customer_email, status, total_amount, total_amount_kobo, currency, financial_contract_version, payment_finalized_at"
      )
      .eq("id", parent.orderId)
      .maybeSingle()) as DatabaseResult
    if (orderResult.error) return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
    const orderRow = orderResult.data
    if (!isPlainObject(orderRow)) return { ok: false, code: "DELIVERY_DATA_INVALID" }

    const totalAmountKobo = positiveBigint(orderRow.total_amount_kobo)
    const financialVersion = orderRow.financial_contract_version
    const currency = orderRow.currency
    if (
      orderRow.id !== parent.orderId ||
      orderRow.status !== "confirmed" ||
      typeof orderRow.payment_finalized_at !== "string" ||
      (financialVersion !== 1 && financialVersion !== 2) ||
      !totalAmountKobo ||
      typeof currency !== "string" ||
      !CURRENCY_PATTERN.test(currency) ||
      (financialVersion === 1 && currency !== "NGN") ||
      decimalToKobo(orderRow.total_amount) !== totalAmountKobo ||
      typeof orderRow.customer_email !== "string"
    ) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }

    const paymentResult = (await client
      .from("payments")
      .select(
        "order_id, status, amount_kobo, currency, financial_contract_version, finalization_state, outcome_code"
      )
      .eq("order_id", parent.orderId)
      .eq("status", "success")
      .eq("finalization_state", "completed")
      .eq("outcome_code", "FINALIZED")) as DatabaseResult
    if (paymentResult.error) return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
    if (!Array.isArray(paymentResult.data) || paymentResult.data.length !== 1) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }
    const payment = paymentResult.data[0]
    if (
      !isPlainObject(payment) ||
      payment.order_id !== parent.orderId ||
      payment.status !== "success" ||
      payment.finalization_state !== "completed" ||
      payment.outcome_code !== "FINALIZED" ||
      positiveBigint(payment.amount_kobo) !== totalAmountKobo ||
      payment.currency !== currency ||
      payment.financial_contract_version !== financialVersion
    ) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }

    const itemResult = (await client
      .from("order_items")
      .select(
        "id, order_id, product_id, vendor_id, quantity, unit_price, subtotal, unit_amount_kobo, gross_amount_kobo, platform_fee_bps, platform_fee_amount_kobo, vendor_net_amount_kobo, currency, financial_contract_version"
      )
      .eq("order_id", parent.orderId)) as DatabaseResult
    if (itemResult.error) return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
    if (!Array.isArray(itemResult.data) || itemResult.data.length < 1) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }

    const rawItems: Array<Omit<ItemData, "productName">> = []
    const productIds = new Set<string>()
    const vendorIds = new Set<string>()
    let itemTotal = 0n
    for (const value of itemResult.data) {
      if (!isPlainObject(value)) return { ok: false, code: "DELIVERY_DATA_INVALID" }
      const unit = positiveBigint(value.unit_amount_kobo)
      const gross = positiveBigint(value.gross_amount_kobo)
      const fee = positiveBigint(value.platform_fee_amount_kobo) ??
        (String(value.platform_fee_amount_kobo) === "0" ? 0n : null)
      const net = positiveBigint(value.vendor_net_amount_kobo) ??
        (String(value.vendor_net_amount_kobo) === "0" ? 0n : null)
      if (
        !isUuid(value.id) ||
        value.order_id !== parent.orderId ||
        !isUuid(value.product_id) ||
        !isUuid(value.vendor_id) ||
        !isInteger(value.quantity, 1, 99) ||
        !unit ||
        !gross ||
        fee === null ||
        net === null ||
        !isInteger(value.platform_fee_bps, 0, 10000) ||
        value.currency !== currency ||
        value.financial_contract_version !== financialVersion ||
        decimalToKobo(value.unit_price) !== unit ||
        decimalToKobo(value.subtotal) !== gross ||
        unit * BigInt(value.quantity) !== gross ||
        fee + net !== gross
      ) {
        return { ok: false, code: "DELIVERY_DATA_INVALID" }
      }
      productIds.add(value.product_id)
      vendorIds.add(value.vendor_id)
      itemTotal += gross
      rawItems.push({
        id: value.id,
        orderId: parent.orderId,
        productId: value.product_id,
        vendorId: value.vendor_id,
        quantity: value.quantity,
        unitAmountKobo: unit,
        grossAmountKobo: gross,
        platformFeeBps: value.platform_fee_bps,
        platformFeeAmountKobo: fee,
        vendorNetAmountKobo: net,
        currency,
        financialContractVersion: financialVersion,
      })
    }
    if (itemTotal !== totalAmountKobo) return { ok: false, code: "DELIVERY_DATA_INVALID" }

    const productResult = (await client
      .from("products")
      .select("id, vendor_id, name")
      .in("id", [...productIds])) as DatabaseResult
    if (productResult.error) return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
    if (!Array.isArray(productResult.data) || productResult.data.length !== productIds.size) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }
    const products = new Map<string, { vendorId: string; name: string }>()
    for (const value of productResult.data) {
      if (
        !isPlainObject(value) ||
        !isUuid(value.id) ||
        !isUuid(value.vendor_id) ||
        typeof value.name !== "string" ||
        value.name.trim().length < 1 ||
        value.name.length > 300 ||
        products.has(value.id)
      ) {
        return { ok: false, code: "DELIVERY_DATA_INVALID" }
      }
      products.set(value.id, { vendorId: value.vendor_id, name: value.name })
    }

    const vendorResult = (await client
      .from("vendors")
      .select("id, name, email")
      .in("id", [...vendorIds])) as DatabaseResult
    if (vendorResult.error) return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
    if (!Array.isArray(vendorResult.data) || vendorResult.data.length !== vendorIds.size) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }
    const vendors = new Map<string, VendorData>()
    for (const value of vendorResult.data) {
      if (
        !isPlainObject(value) ||
        !isUuid(value.id) ||
        typeof value.name !== "string" ||
        value.name.trim().length < 1 ||
        value.name.length > 200 ||
        typeof value.email !== "string" ||
        vendors.has(value.id)
      ) {
        return { ok: false, code: "DELIVERY_DATA_INVALID" }
      }
      vendors.set(value.id, { id: value.id, name: value.name, email: value.email })
    }

    const items: ItemData[] = []
    for (const item of rawItems) {
      const product = products.get(item.productId)
      if (!product || product.vendorId !== item.vendorId) {
        return { ok: false, code: "DELIVERY_DATA_INVALID" }
      }
      items.push({ ...item, productName: product.name })
    }

    const expectedVendors = new Set(
      children
        .filter((child) => child.recipientKind === "vendor")
        .map((child) => child.vendorId)
    )
    if (
      !children.some((child) => child.recipientKind === "customer") ||
      expectedVendors.size !== vendorIds.size ||
      [...vendorIds].some((id) => !expectedVendors.has(id))
    ) {
      return { ok: false, code: "DELIVERY_DATA_INVALID" }
    }

    return {
      ok: true,
      value: {
        order: {
          id: parent.orderId,
          customerEmail: orderRow.customer_email,
          totalAmountKobo,
          currency,
          financialContractVersion: financialVersion,
        },
        items,
        vendors,
      },
    }
  } catch {
    return { ok: false, code: "DELIVERY_DATA_LOAD_FAILED" }
  }
}

function commandForChild(
  child: DeliveryChild,
  data: AuthoritativeData
): PreparedEmailDeliveryCommand | null {
  if (child.recipientKind === "customer") {
    return {
      recipientKind: "customer",
      to: data.order.customerEmail,
      orderId: data.order.id,
      totalAmountKobo: data.order.totalAmountKobo.toString(),
      currency: data.order.currency,
      items: data.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        grossAmountKobo: item.grossAmountKobo.toString(),
      })),
    }
  }
  if (!child.vendorId) return null
  const vendor = data.vendors.get(child.vendorId)
  if (!vendor) return null
  return {
    recipientKind: "vendor",
    to: vendor.email,
    orderId: data.order.id,
    vendor: { id: vendor.id, name: vendor.name },
    items: data.items
      .filter((item) => item.vendorId === vendor.id)
      .map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        grossAmountKobo: item.grossAmountKobo.toString(),
        platformFeeAmountKobo: item.platformFeeAmountKobo.toString(),
        vendorNetAmountKobo: item.vendorNetAmountKobo.toString(),
        currency: item.currency,
      })),
  }
}

function parseAttempt(data: unknown, child: DeliveryChild) {
  const row = oneRow(data)
  if (
    !row ||
    row.delivery_id !== child.id ||
    row.delivery_key !== child.deliveryKey ||
    row.recipient_kind !== child.recipientKind ||
    row.vendor_id !== child.vendorId ||
    !isInteger(row.attempt_count, 1, 12) ||
    !isUuid(row.attempt_token)
  ) {
    return null
  }
  return { token: row.attempt_token, count: row.attempt_count }
}

function providerAttemptIdempotencyKey(
  deliveryKey: string,
  attemptCount: number
): string | null {
  if (!isInteger(attemptCount, 1, 12)) return null
  const key = `${deliveryKey}:attempt:${attemptCount}`
  return key.length >= 1 && key.length <= 256 ? key : null
}

async function acknowledgeUnknown(
  client: DispatcherClient,
  parent: ClaimedParent,
  child: DeliveryChild,
  attemptToken: string,
  diagnosticCode: string
): Promise<boolean> {
  const response = await safeRpc(client, "mark_paid_order_notification_unknown", {
    p_outbox_event_id: parent.eventId,
    p_parent_lease_token: parent.leaseToken,
    p_delivery_id: child.id,
    p_attempt_token: attemptToken,
    p_error_code: diagnosticCode,
  })
  return Boolean(response && !response.error && response.data === true)
}

export async function dispatchOnePaidOrder(
  client: DispatcherClient,
  adapter: EmailAdapter,
  workerId: string,
  log: (marker: LogMarker) => void = (marker) => console.error(marker)
): Promise<DispatchResult> {
  if (!PROVIDER_PATTERN.test(adapter.providerName) || !PROVIDER_PATTERN.test(workerId)) {
    log("MARKETA_DISPATCH_CONFIG_MISSING")
    return { result: "CLAIM_FAILED" }
  }

  const claim = await safeRpc(client, "claim_paid_order_outbox", {
    p_worker_id: workerId,
    p_batch_size: 1,
  })
  if (!claim || claim.error) {
    log("MARKETA_DISPATCH_CLAIM_FAILED")
    return { result: "CLAIM_FAILED" }
  }
  const parent = parseClaim(claim.data)
  if (parent === "NO_WORK") return { result: "NO_WORK" }
  if (!parent) {
    log("MARKETA_DISPATCH_CLAIM_FAILED")
    return { result: "CLAIM_FAILED" }
  }

  const expansion = await safeRpc(
    client,
    "expand_paid_order_notification_deliveries",
    {
      p_outbox_event_id: parent.eventId,
      p_parent_lease_token: parent.leaseToken,
    }
  )
  if (!expansion || expansion.error || !validExpansion(expansion.data)) {
    log("MARKETA_DISPATCH_EXPANSION_FAILED")
    return failParent(client, parent, "DELIVERY_EXPANSION_FAILED", log)
  }

  let childResult: DatabaseResult
  try {
    childResult = (await client
      .from("notification_deliveries")
      .select(
        "id, outbox_event_id, order_id, recipient_kind, vendor_id, channel, delivery_key, status, attempt_count"
      )
      .eq("outbox_event_id", parent.eventId)
      .order("id", { ascending: true })) as DatabaseResult
  } catch {
    log("MARKETA_DISPATCH_DATA_LOAD_FAILED")
    return failParent(client, parent, "DELIVERY_DATA_LOAD_FAILED", log)
  }
  const children = childResult.error ? null : parseChildren(childResult.data, parent)
  if (!children) {
    log("MARKETA_DISPATCH_DATA_LOAD_FAILED")
    return failParent(
      client,
      parent,
      childResult.error ? "DELIVERY_DATA_LOAD_FAILED" : "DELIVERY_DATA_INVALID",
      log
    )
  }
  if (children.some((child) => child.status === "unknown" || child.status === "dead_letter")) {
    log("MARKETA_DISPATCH_CHILD_BLOCKED")
    return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
  }

  const authoritative = await loadAuthoritativeData(client, parent, children)
  if (!authoritative.ok) {
    log("MARKETA_DISPATCH_DATA_LOAD_FAILED")
    return failParent(client, parent, authoritative.code, log)
  }

  for (const child of children) {
    if (child.status !== "pending") continue
    const preparedCommand = commandForChild(child, authoritative.value)
    if (!preparedCommand) {
      return failParent(client, parent, "DELIVERY_DATA_INVALID", log)
    }
    const recipientIsValid = validEmail(preparedCommand.to)

    const begin = await safeRpc(client, "begin_paid_order_notification_delivery", {
      p_outbox_event_id: parent.eventId,
      p_parent_lease_token: parent.leaseToken,
      p_delivery_id: child.id,
      p_provider: adapter.providerName,
    })
    const attempt = begin && !begin.error ? parseAttempt(begin.data, child) : null
    if (!attempt) return { result: "PARENT_LEASE_LOST" }

    if (!recipientIsValid) {
      const failed = await safeRpc(client, "mark_paid_order_notification_failed", {
        p_outbox_event_id: parent.eventId,
        p_parent_lease_token: parent.leaseToken,
        p_delivery_id: child.id,
        p_attempt_token: attempt.token,
        p_error_code: "INVALID_RECIPIENT",
        p_permanent: true,
      })
      if (!failed || failed.error || !oneRow(failed.data)) {
        return { result: "PARENT_LEASE_LOST" }
      }
      log("MARKETA_DISPATCH_CHILD_BLOCKED")
      return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
    }

    const idempotencyKey = providerAttemptIdempotencyKey(
      child.deliveryKey,
      attempt.count
    )
    if (!idempotencyKey) {
      const failed = await safeRpc(client, "mark_paid_order_notification_failed", {
        p_outbox_event_id: parent.eventId,
        p_parent_lease_token: parent.leaseToken,
        p_delivery_id: child.id,
        p_attempt_token: attempt.token,
        p_error_code: "DELIVERY_DATA_INVALID",
        p_permanent: true,
      })
      if (!failed || failed.error || !oneRow(failed.data)) {
        return { result: "PARENT_LEASE_LOST" }
      }
      log("MARKETA_DISPATCH_CHILD_BLOCKED")
      return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
    }
    const command: EmailDeliveryCommand = {
      ...preparedCommand,
      idempotencyKey,
    }

    let outcome: EmailDeliveryResult
    try {
      outcome = await adapter.sendEmail(command)
    } catch {
      log("MARKETA_DISPATCH_PROVIDER_UNKNOWN")
      const recorded = await acknowledgeUnknown(
        client,
        parent,
        child,
        attempt.token,
        "PROVIDER_RESULT_UNKNOWN"
      )
      if (!recorded) return { result: "PARENT_LEASE_LOST" }
      return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
    }

    if (!isPlainObject(outcome) || typeof outcome.outcome !== "string") {
      log("MARKETA_DISPATCH_PROVIDER_UNKNOWN")
      const recorded = await acknowledgeUnknown(
        client,
        parent,
        child,
        attempt.token,
        "PROVIDER_RESULT_UNKNOWN"
      )
      if (!recorded) return { result: "PARENT_LEASE_LOST" }
      return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
    }

    if (outcome.outcome === "DELIVERED") {
      const providerMessageId = outcome.providerMessageId
      if (
        providerMessageId !== undefined &&
        (typeof providerMessageId !== "string" ||
          providerMessageId.length < 1 ||
          providerMessageId.length > 255 ||
          /[\u0000-\u001f\u007f]/.test(providerMessageId))
      ) {
        log("MARKETA_DISPATCH_PROVIDER_UNKNOWN")
        const recorded = await acknowledgeUnknown(
          client,
          parent,
          child,
          attempt.token,
          "PROVIDER_RESULT_UNKNOWN"
        )
        if (!recorded) return { result: "PARENT_LEASE_LOST" }
        return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
      }
      const delivered = await safeRpc(client, "mark_paid_order_notification_delivered", {
        p_outbox_event_id: parent.eventId,
        p_parent_lease_token: parent.leaseToken,
        p_delivery_id: child.id,
        p_attempt_token: attempt.token,
        p_provider_message_id: providerMessageId ?? null,
      })
      if (!delivered || delivered.error || delivered.data !== true) {
        log("MARKETA_DISPATCH_CHILD_ACK_FAILED")
        return { result: "CHILD_ACK_UNCERTAIN" }
      }
      continue
    }

    if (outcome.outcome === "UNKNOWN") {
      const code = validDiagnostic(outcome.diagnosticCode)
        ? outcome.diagnosticCode
        : "PROVIDER_RESULT_UNKNOWN"
      const recorded = await acknowledgeUnknown(client, parent, child, attempt.token, code)
      if (!recorded) return { result: "PARENT_LEASE_LOST" }
      log("MARKETA_DISPATCH_CHILD_BLOCKED")
      return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
    }

    if (
      outcome.outcome === "RETRYABLE_FAILURE" ||
      outcome.outcome === "PERMANENT_FAILURE"
    ) {
      const code = validDiagnostic(outcome.diagnosticCode)
        ? outcome.diagnosticCode
        : "DELIVERY_PROVIDER_FAILURE"
      const failed = await safeRpc(client, "mark_paid_order_notification_failed", {
        p_outbox_event_id: parent.eventId,
        p_parent_lease_token: parent.leaseToken,
        p_delivery_id: child.id,
        p_attempt_token: attempt.token,
        p_error_code: code,
        p_permanent: outcome.outcome === "PERMANENT_FAILURE",
      })
      const failedRow = failed && !failed.error ? oneRow(failed.data) : null
      if (!failedRow) return { result: "PARENT_LEASE_LOST" }
      if (failedRow.delivery_status === "dead_letter") {
        log("MARKETA_DISPATCH_CHILD_BLOCKED")
        return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
      }
      if (failedRow.delivery_status !== "pending") {
        return { result: "PARENT_LEASE_LOST" }
      }
      continue
    }

    log("MARKETA_DISPATCH_PROVIDER_UNKNOWN")
    const recorded = await acknowledgeUnknown(
      client,
      parent,
      child,
      attempt.token,
      "PROVIDER_RESULT_UNKNOWN"
    )
    if (!recorded) return { result: "PARENT_LEASE_LOST" }
    return failParent(client, parent, "CHILD_DELIVERY_BLOCKED", log)
  }

  const completed = await safeRpc(client, "mark_paid_order_outbox_delivered", {
    p_event_id: parent.eventId,
    p_lease_token: parent.leaseToken,
  })
  if (completed && !completed.error && completed.data === true) {
    return { result: "DELIVERED", parentsProcessed: 1 }
  }
  log("MARKETA_DISPATCH_PARENT_ACK_FAILED")
  return failParent(client, parent, "CHILDREN_INCOMPLETE", log)
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const leftDigest = await crypto.subtle.digest("SHA-256", encoder.encode(left))
  const rightDigest = await crypto.subtle.digest("SHA-256", encoder.encode(right))
  const leftBytes = new Uint8Array(leftDigest)
  const rightBytes = new Uint8Array(rightDigest)
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")
  if (!value) return null
  const token = /^Bearer ([^\s]+)$/.exec(value)?.[1]
  return token && token.length <= 1024 ? token : null
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  })
}

// Ops 3C1D deployment contract: use verify_jwt=false because this endpoint
// authenticates each request with its own MARKETA_DISPATCHER_SECRET bearer value.
const productionEmailAdapter: EmailAdapter | null = null
const productionDependencies: RuntimeDependencies = {
  getEnv: (name) => Deno.env.get(name),
  createServiceClient: (url, key) =>
    createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }),
  emailAdapter: productionEmailAdapter,
  createWorkerId: () => `edge-${crypto.randomUUID()}`,
  log: (marker) => console.error(marker),
}

export async function handleDispatcherRequest(
  request: Request,
  dependencies: RuntimeDependencies = productionDependencies
): Promise<Response> {
  if (request.method !== "POST") {
    return response(405, { ok: false, code: "METHOD_NOT_ALLOWED" })
  }

  const expectedSecret = dependencies.getEnv("MARKETA_DISPATCHER_SECRET")
  if (!validDispatcherSecret(expectedSecret)) {
    dependencies.log("MARKETA_DISPATCH_CONFIG_MISSING")
    return response(503, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  }

  const suppliedSecret = bearerToken(request)
  if (!suppliedSecret || !(await timingSafeEqual(suppliedSecret, expectedSecret))) {
    dependencies.log("MARKETA_DISPATCH_AUTH_FAILED")
    return response(401, { ok: false, code: "AUTH_REQUIRED" })
  }

  if (!dependencies.emailAdapter) {
    dependencies.log("MARKETA_DISPATCH_CONFIG_MISSING")
    return response(503, {
      ok: false,
      code: "DELIVERY_PROVIDER_NOT_CONFIGURED",
    })
  }

  const supabaseUrl = dependencies.getEnv("SUPABASE_URL")
  const serviceRoleKey = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    dependencies.log("MARKETA_DISPATCH_CONFIG_MISSING")
    return response(503, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  }

  let client: DispatcherClient
  try {
    client = dependencies.createServiceClient(supabaseUrl, serviceRoleKey)
  } catch {
    dependencies.log("MARKETA_DISPATCH_CONFIG_MISSING")
    return response(503, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  }

  const result = await dispatchOnePaidOrder(
    client,
    dependencies.emailAdapter,
    dependencies.createWorkerId(),
    dependencies.log
  )
  if (result.result === "NO_WORK") {
    return response(200, { ok: true, result: "NO_WORK" })
  }
  if (result.result === "DELIVERED") {
    return response(200, {
      ok: true,
      result: "DELIVERED",
      parents_processed: result.parentsProcessed,
    })
  }
  return response(503, { ok: false, code: result.result })
}

serve(async (request) => {
  try {
    return await handleDispatcherRequest(request)
  } catch {
    console.error("MARKETA_DISPATCH_PARENT_ACK_FAILED")
    return response(503, { ok: false, code: "DISPATCHER_UNAVAILABLE" })
  }
})
