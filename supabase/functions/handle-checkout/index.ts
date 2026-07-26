import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"

const MAX_BODY_BYTES = 32 * 1024
const MAX_ITEMS = 50
const MAX_QUANTITY = 99

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFERENCE_PATTERN = /^[A-Za-z0-9._=-]{1,100}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHECKOUT_FIELDS = new Set([
  "customer_name",
  "customer_email",
  "customer_phone",
  "shipping_address",
  "items",
])
const SHIPPING_FIELDS = new Set(["address", "city", "state"])
const ITEM_FIELDS = new Set(["product_id", "quantity"])
const NIGERIAN_STATES = new Set([
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Federal Capital Territory",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
])

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type CheckoutErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_CONTACT"
  | "INVALID_SHIPPING_ADDRESS"
  | "INVALID_ITEMS"
  | "DUPLICATE_PRODUCT"
  | "PRODUCT_UNAVAILABLE"
  | "INSUFFICIENT_STOCK"
  | "VENDOR_UNAVAILABLE"
  | "INVALID_PRODUCT_PRICE"
  | "PAYMENT_INITIALIZATION_FAILED"
  | "SERVICE_UNAVAILABLE"

type ValidatedItem = {
  product_id: string
  quantity: number
}

type ValidatedCheckout = {
  customer_name: string
  customer_email: string
  customer_phone: string
  shipping_address: {
    address: string
    city: string
    state: string
  }
  items: ValidatedItem[]
}

type ValidationResult =
  | { ok: true; value: ValidatedCheckout }
  | {
      ok: false
      code: CheckoutErrorCode
      message: string
      status: number
    }

function jsonHeaders(): HeadersInit {
  return {
    ...corsHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  }
}

function errorResponse(
  code: CheckoutErrorCode,
  message: string,
  status: number,
  retryAfterMs?: number
) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message },
      ...(retryAfterMs ? { retry_after_ms: retryAfterMs } : {}),
    }),
    { status, headers: jsonHeaders() }
  )
}

function successResponse(data: {
  order_id: string
  reference: string
  authorization_url: string
}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: jsonHeaders(),
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function hasLengthBetween(value: string, minimum: number, maximum: number) {
  return value.length >= minimum && value.length <= maximum
}

function validateCheckout(value: unknown): ValidationResult {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "The checkout request is invalid.",
      status: 400,
    }
  }

  if (Object.keys(value).some((field) => !CHECKOUT_FIELDS.has(field))) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "The checkout request contains unsupported fields.",
      status: 400,
    }
  }

  const customerName =
    typeof value.customer_name === "string"
      ? normalizeWhitespace(value.customer_name)
      : ""
  const customerEmail =
    typeof value.customer_email === "string"
      ? value.customer_email.trim().toLowerCase()
      : ""
  const phoneInput =
    typeof value.customer_phone === "string" ? value.customer_phone.trim() : ""
  const customerPhone = phoneInput.replace(/\D/g, "")

  if (
    !hasLengthBetween(customerName, 2, 100) ||
    !hasLengthBetween(customerEmail, 3, 254) ||
    !EMAIL_PATTERN.test(customerEmail) ||
    phoneInput.length > 32 ||
    !hasLengthBetween(customerPhone, 7, 15)
  ) {
    return {
      ok: false,
      code: "INVALID_CONTACT",
      message: "Check your name, email address and phone number.",
      status: 400,
    }
  }

  if (
    !isPlainObject(value.shipping_address) ||
    Object.keys(value.shipping_address).some(
      (field) => !SHIPPING_FIELDS.has(field)
    )
  ) {
    return {
      ok: false,
      code: "INVALID_SHIPPING_ADDRESS",
      message: "Check your delivery address and state.",
      status: 400,
    }
  }

  const address =
    typeof value.shipping_address.address === "string"
      ? normalizeWhitespace(value.shipping_address.address)
      : ""
  const city =
    typeof value.shipping_address.city === "string"
      ? normalizeWhitespace(value.shipping_address.city)
      : ""
  const state =
    typeof value.shipping_address.state === "string"
      ? value.shipping_address.state.trim()
      : ""

  if (
    !hasLengthBetween(address, 5, 300) ||
    !hasLengthBetween(city, 2, 100) ||
    !NIGERIAN_STATES.has(state)
  ) {
    return {
      ok: false,
      code: "INVALID_SHIPPING_ADDRESS",
      message: "Check your delivery address and state.",
      status: 400,
    }
  }

  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_ITEMS
  ) {
    return {
      ok: false,
      code: "INVALID_ITEMS",
      message: "Review the products and quantities in your cart.",
      status: 400,
    }
  }

  const items: ValidatedItem[] = []
  const productIds = new Set<string>()

  for (const item of value.items) {
    if (
      !isPlainObject(item) ||
      Object.keys(item).some((field) => !ITEM_FIELDS.has(field)) ||
      typeof item.product_id !== "string" ||
      !UUID_PATTERN.test(item.product_id) ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY
    ) {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        message: "Review the products and quantities in your cart.",
        status: 400,
      }
    }

    const productId = item.product_id.toLowerCase()
    if (productIds.has(productId)) {
      return {
        ok: false,
        code: "DUPLICATE_PRODUCT",
        message: "Each product may appear only once in the cart.",
        status: 400,
      }
    }

    productIds.add(productId)
    items.push({
      product_id: productId,
      quantity: item.quantity,
    })
  }

  return {
    ok: true,
    value: {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      shipping_address: { address, city, state },
      items,
    },
  }
}

async function readBoundedBody(req: Request): Promise<
  | { ok: true; text: string }
  | { ok: false; tooLarge: boolean }
> {
  const declaredLength = Number(req.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, tooLarge: true }
  }

  if (!req.body) return { ok: true, text: "" }

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

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(body),
    }
  } catch {
    return { ok: false, tooLarge: false }
  }
}

function logOperationFailure(
  operation: string,
  code: CheckoutErrorCode,
  orderId?: string
) {
  console.error("[handle-checkout] operation failed", {
    operation,
    code,
    ...(orderId ? { order_id: orderId } : {}),
  })
}

function validAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:"
  } catch {
    return false
  }
}

async function handleCheckout(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return errorResponse(
      "INVALID_REQUEST",
      "Only POST checkout requests are supported.",
      405
    )
  }

  const mediaType = req.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase()

  if (mediaType !== "application/json") {
    return errorResponse(
      "UNSUPPORTED_MEDIA_TYPE",
      "Checkout requests must use application/json.",
      415
    )
  }

  const boundedBody = await readBoundedBody(req)
  if (!boundedBody.ok) {
    return boundedBody.tooLarge
      ? errorResponse(
          "PAYLOAD_TOO_LARGE",
          "The checkout request is too large.",
          413
        )
      : errorResponse(
          "INVALID_REQUEST",
          "The checkout request is invalid.",
          400
        )
  }

  let requestBody: unknown
  try {
    requestBody = JSON.parse(boundedBody.text)
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The checkout request contains malformed JSON.",
      400
    )
  }

  const validation = validateCheckout(requestBody)
  if (!validation.ok) {
    return errorResponse(
      validation.code,
      validation.message,
      validation.status
    )
  }

  const {
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    shipping_address: shippingAddress,
    items,
  } = validation.value

  // Batch 2B2 will persist customerName after its schema migration.
  // It is intentionally not sent to Paystack metadata in this batch.
  void customerName

  const storefrontUrl = Deno.env.get("STOREFRONT_URL")
  let storefrontOrigin: URL
  try {
    storefrontOrigin = new URL(storefrontUrl ?? "")
  } catch {
    logOperationFailure("validate_storefront_url", "SERVICE_UNAVAILABLE")
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )
  const productIds = items.map((item) => item.product_id)
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, vendor_id, price, stock, is_active")
    .in("id", productIds)

  if (productsError || !products) {
    logOperationFailure("fetch_products", "SERVICE_UNAVAILABLE")
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }

  const productMap = new Map(products.map((product) => [product.id, product]))
  if (productMap.size !== productIds.length) {
    return errorResponse(
      "PRODUCT_UNAVAILABLE",
      "One or more products are no longer available.",
      409
    )
  }

  const vendorIds = [
    ...new Set(products.map((product) => String(product.vendor_id))),
  ]
  const { data: activeVendors, error: vendorsError } = await supabase
    .from("public_active_vendors")
    .select("id")
    .in("id", vendorIds)

  if (vendorsError || !activeVendors) {
    logOperationFailure("fetch_active_vendors", "SERVICE_UNAVAILABLE")
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }

  const activeVendorIds = new Set(
    activeVendors.map((vendor) => String(vendor.id))
  )
  if (vendorIds.some((vendorId) => !activeVendorIds.has(vendorId))) {
    return errorResponse(
      "VENDOR_UNAVAILABLE",
      "One or more sellers are currently unavailable.",
      409
    )
  }

  const validatedItems: Array<{
    product_id: string
    vendor_id: string
    quantity: number
    unit_price: number
    subtotal: number
  }> = []
  let totalKobo = 0

  for (const cartItem of items) {
    const product = productMap.get(cartItem.product_id)
    if (!product || product.is_active !== true) {
      return errorResponse(
        "PRODUCT_UNAVAILABLE",
        "One or more products are no longer available.",
        409
      )
    }

    const stock = Number(product.stock)
    if (!Number.isFinite(stock) || stock < cartItem.quantity) {
      return errorResponse(
        "INSUFFICIENT_STOCK",
        "One or more products no longer have enough stock.",
        409
      )
    }

    const unitPrice = Number(product.price)
    const unitPriceKobo = Math.round(unitPrice * 100)
    const subtotalKobo = unitPriceKobo * cartItem.quantity
    if (
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      !Number.isSafeInteger(unitPriceKobo) ||
      unitPriceKobo <= 0 ||
      !Number.isSafeInteger(subtotalKobo) ||
      subtotalKobo <= 0
    ) {
      logOperationFailure("validate_product_price", "INVALID_PRODUCT_PRICE")
      return errorResponse(
        "INVALID_PRODUCT_PRICE",
        "One or more products cannot currently be purchased.",
        422
      )
    }

    totalKobo += subtotalKobo
    if (!Number.isSafeInteger(totalKobo) || totalKobo <= 0) {
      logOperationFailure("calculate_order_total", "INVALID_PRODUCT_PRICE")
      return errorResponse(
        "INVALID_PRODUCT_PRICE",
        "The order total cannot currently be processed.",
        422
      )
    }

    validatedItems.push({
      product_id: product.id,
      vendor_id: product.vendor_id,
      quantity: cartItem.quantity,
      unit_price: unitPriceKobo / 100,
      subtotal: subtotalKobo / 100,
    })
  }

  if (!Number.isSafeInteger(totalKobo) || totalKobo <= 0) {
    logOperationFailure("validate_order_total", "INVALID_PRODUCT_PRICE")
    return errorResponse(
      "INVALID_PRODUCT_PRICE",
      "The order total cannot currently be processed.",
      422
    )
  }

  const idempotencyKey = `ORD-${Date.now()}-${crypto.randomUUID()
    .split("-")[0]
    .toUpperCase()}`
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_email: customerEmail,
      customer_phone: customerPhone,
      status: "pending",
      total_amount: totalKobo / 100,
      idempotency_key: idempotencyKey,
      shipping_address: shippingAddress,
    })
    .select("id")
    .single()

  if (orderError || !order) {
    logOperationFailure("insert_pending_order", "SERVICE_UNAVAILABLE")
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }

  const orderId = String(order.id)
  const cleanupOrder = async () => {
    const { error: itemsCleanupError } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", orderId)
    if (itemsCleanupError) {
      logOperationFailure(
        "cleanup_order_items",
        "SERVICE_UNAVAILABLE",
        orderId
      )
    }

    const { error: orderCleanupError } = await supabase
      .from("orders")
      .delete()
      .eq("id", orderId)
    if (orderCleanupError) {
      logOperationFailure("cleanup_order", "SERVICE_UNAVAILABLE", orderId)
    }
  }

  const orderItems = validatedItems.map((item) => ({
    order_id: orderId,
    ...item,
  }))
  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems)

  if (itemsError) {
    logOperationFailure("insert_order_items", "SERVICE_UNAVAILABLE", orderId)
    await cleanupOrder()
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }

  const callbackUrl = new URL("/payment-success", storefrontOrigin)
  callbackUrl.searchParams.set("order", orderId)

  let paystackResponse: Response
  try {
    paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: totalKobo,
          reference: idempotencyKey,
          callback_url: callbackUrl.toString(),
          metadata: {
            order_id: orderId,
            customer_phone: customerPhone,
          },
        }),
      }
    )
  } catch {
    logOperationFailure(
      "initialize_paystack",
      "PAYMENT_INITIALIZATION_FAILED",
      orderId
    )
    await cleanupOrder()
    return errorResponse(
      "PAYMENT_INITIALIZATION_FAILED",
      "Checkout is temporarily unavailable. Please try again.",
      502
    )
  }

  let paystackData: unknown = null
  try {
    paystackData = await paystackResponse.json()
  } catch {
    // The controlled response below handles malformed provider JSON.
  }

  const paystackPayload = isPlainObject(paystackData) ? paystackData : null
  const paystackResult =
    paystackPayload && isPlainObject(paystackPayload.data)
      ? paystackPayload.data
      : null
  const reference =
    paystackResult && typeof paystackResult.reference === "string"
      ? paystackResult.reference
      : ""
  const authorizationUrl =
    paystackResult && typeof paystackResult.authorization_url === "string"
      ? paystackResult.authorization_url
      : ""

  if (
    !paystackResponse.ok ||
    paystackPayload?.status !== true ||
    !REFERENCE_PATTERN.test(reference) ||
    !validAuthorizationUrl(authorizationUrl)
  ) {
    logOperationFailure(
      "validate_paystack_response",
      "PAYMENT_INITIALIZATION_FAILED",
      orderId
    )
    await cleanupOrder()
    return errorResponse(
      "PAYMENT_INITIALIZATION_FAILED",
      "Checkout is temporarily unavailable. Please try again.",
      502
    )
  }

  const { data: updatedOrder, error: paymentReferenceError } = await supabase
    .from("orders")
    .update({ payment_ref: reference })
    .eq("id", orderId)
    .select("id")
    .single()

  if (paymentReferenceError || !updatedOrder) {
    logOperationFailure("persist_payment_ref", "SERVICE_UNAVAILABLE", orderId)
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503
    )
  }

  return successResponse({
    order_id: orderId,
    reference,
    authorization_url: authorizationUrl,
  })
}

serve(async (req) => {
  try {
    return await handleCheckout(req)
  } catch {
    logOperationFailure("unexpected_checkout_failure", "SERVICE_UNAVAILABLE")
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      "Checkout is temporarily unavailable. Please try again.",
      503,
      2000
    )
  }
})
