import "server-only"

import {
  createSupabaseServerClient,
  supabaseAdmin,
} from "@/lib/supabase-server"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FULFILLMENT_STATUSES = ["confirmed", "fulfilled"] as const

const CUSTOMER_ORDER_FIELDS = `
  id,
  status,
  total_amount,
  total_amount_kobo,
  currency,
  financial_contract_version,
  created_at,
  order_items (
    id,
    product_id,
    vendor_id,
    quantity,
    unit_price,
    subtotal,
    unit_amount_kobo,
    gross_amount_kobo,
    currency,
    financial_contract_version,
    product_variant_id,
    variant_size_snapshot,
    variant_colour_snapshot,
    variant_options_snapshot
  )
`

const VENDOR_ITEM_FIELDS = `
  id,
  order_id,
  product_id,
  vendor_id,
  quantity,
  unit_price,
  subtotal,
  unit_amount_kobo,
  gross_amount_kobo,
  platform_fee_bps,
  platform_fee_amount_kobo,
  vendor_net_amount_kobo,
  currency,
  financial_contract_version,
  product_variant_id,
  variant_size_snapshot,
  variant_colour_snapshot,
  variant_options_snapshot,
  products (
    id,
    name,
    images
  )
`

const VENDOR_DETAIL_ITEM_FIELDS = `
  id,
  order_id,
  product_id,
  vendor_id,
  quantity,
  unit_price,
  subtotal,
  unit_amount_kobo,
  gross_amount_kobo,
  platform_fee_bps,
  platform_fee_amount_kobo,
  vendor_net_amount_kobo,
  currency,
  financial_contract_version,
  product_variant_id,
  variant_size_snapshot,
  variant_colour_snapshot,
  variant_options_snapshot,
  products (
    name,
    images
  )
`

type AuthenticatedClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>

export type OrderDataDependencies = {
  createAuthenticatedClient: () => Promise<Pick<AuthenticatedClient, "auth">>
  privilegedClient: Pick<typeof supabaseAdmin, "from">
}

type AccessFailureCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "QUERY_FAILED"
  | "VENDOR_ACCESS_DENIED"
  | "ORDER_NOT_FOUND"

type AccessFailure = { ok: false; code: AccessFailureCode }
type AccessSuccess<T> = { ok: true; data: T }
export type OrderDataResult<T> = AccessSuccess<T> | AccessFailure

export type CustomerOrderItem = {
  id: string
  product_id: string | null
  vendor_id: string
  quantity: number
  unit_price: number | string
  subtotal: number | string
  unit_amount_kobo: number | string | null
  gross_amount_kobo: number | string | null
  currency: string | null
  financial_contract_version: number | null
  product_variant_id: string | null
  variant_size_snapshot: string | null
  variant_colour_snapshot: string | null
  variant_options_snapshot: unknown
}

export type CustomerOrder = {
  id: string
  status: string
  total_amount: number | string
  total_amount_kobo: number | string | null
  currency: string | null
  financial_contract_version: number | null
  created_at: string | null
  order_items: CustomerOrderItem[]
}

export type VendorProduct = {
  id?: string
  name: string
  images: string[] | null
}

export type VendorOrderItem = {
  id: string
  order_id: string
  product_id: string | null
  vendor_id: string
  quantity: number
  unit_price: number | string
  subtotal: number | string
  unit_amount_kobo: number | string | null
  gross_amount_kobo: number | string | null
  platform_fee_bps: number | null
  platform_fee_amount_kobo: number | string | null
  vendor_net_amount_kobo: number | string | null
  currency: string | null
  financial_contract_version: number | null
  product_variant_id: string | null
  variant_size_snapshot: string | null
  variant_colour_snapshot: string | null
  variant_options_snapshot: unknown
  products: VendorProduct | null
}

export type VendorOrderSummary = {
  id: string
  status: string
  created_at: string
}

export type ShippingAddress = {
  address?: string
  city?: string
  state?: string
}

export type VendorFulfillment = {
  customer_email: string
  customer_phone: string | null
  shipping_address: ShippingAddress | null
}

export type VendorOrderDetail = VendorOrderSummary & {
  fulfillment: VendorFulfillment | null
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null
}

function product(value: unknown): VendorProduct | null {
  const candidate = Array.isArray(value) ? value[0] : value
  const row = record(candidate)
  if (!row || typeof row.name !== "string") return null

  return {
    ...(typeof row.id === "string" ? { id: row.id } : {}),
    name: row.name,
    images: stringArray(row.images),
  }
}

function customerItem(value: unknown): CustomerOrderItem | null {
  const row = record(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.vendor_id !== "string" ||
    typeof row.quantity !== "number"
  ) {
    return null
  }

  return {
    id: row.id,
    product_id: nullableString(row.product_id),
    vendor_id: row.vendor_id,
    quantity: row.quantity,
    unit_price: row.unit_price as number | string,
    subtotal: row.subtotal as number | string,
    unit_amount_kobo: row.unit_amount_kobo as number | string | null,
    gross_amount_kobo: row.gross_amount_kobo as number | string | null,
    currency: nullableString(row.currency),
    financial_contract_version:
      typeof row.financial_contract_version === "number"
        ? row.financial_contract_version
        : null,
    product_variant_id: nullableString(row.product_variant_id),
    variant_size_snapshot: nullableString(row.variant_size_snapshot),
    variant_colour_snapshot: nullableString(row.variant_colour_snapshot),
    variant_options_snapshot: row.variant_options_snapshot ?? null,
  }
}

function customerOrder(value: unknown): CustomerOrder | null {
  const row = record(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.status !== "string" ||
    !Array.isArray(row.order_items)
  ) {
    return null
  }

  const items = row.order_items.map(customerItem)
  if (items.some((item) => item === null)) return null

  return {
    id: row.id,
    status: row.status,
    total_amount: row.total_amount as number | string,
    total_amount_kobo: row.total_amount_kobo as number | string | null,
    currency: nullableString(row.currency),
    financial_contract_version:
      typeof row.financial_contract_version === "number"
        ? row.financial_contract_version
        : null,
    created_at: nullableString(row.created_at),
    order_items: items as CustomerOrderItem[],
  }
}

function vendorItem(value: unknown, vendorId: string): VendorOrderItem | null {
  const row = record(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.order_id !== "string" ||
    row.vendor_id !== vendorId ||
    typeof row.quantity !== "number"
  ) {
    return null
  }

  return {
    id: row.id,
    order_id: row.order_id,
    product_id: nullableString(row.product_id),
    vendor_id: vendorId,
    quantity: row.quantity,
    unit_price: row.unit_price as number | string,
    subtotal: row.subtotal as number | string,
    unit_amount_kobo: row.unit_amount_kobo as number | string | null,
    gross_amount_kobo: row.gross_amount_kobo as number | string | null,
    platform_fee_bps:
      typeof row.platform_fee_bps === "number" ? row.platform_fee_bps : null,
    platform_fee_amount_kobo:
      row.platform_fee_amount_kobo as number | string | null,
    vendor_net_amount_kobo:
      row.vendor_net_amount_kobo as number | string | null,
    currency: nullableString(row.currency),
    financial_contract_version:
      typeof row.financial_contract_version === "number"
        ? row.financial_contract_version
        : null,
    product_variant_id: nullableString(row.product_variant_id),
    variant_size_snapshot: nullableString(row.variant_size_snapshot),
    variant_colour_snapshot: nullableString(row.variant_colour_snapshot),
    variant_options_snapshot: row.variant_options_snapshot ?? null,
    products: product(row.products),
  }
}

function vendorOrderSummary(
  value: unknown,
  authorizedOrderIds: Set<string>
): VendorOrderSummary | null {
  const row = record(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    !authorizedOrderIds.has(row.id) ||
    typeof row.status !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return null
  }

  return { id: row.id, status: row.status, created_at: row.created_at }
}

function shippingAddress(value: unknown): ShippingAddress | null {
  if (value === null || value === undefined) return null
  const row = record(value)
  if (!row) return null

  return {
    ...(typeof row.address === "string" ? { address: row.address } : {}),
    ...(typeof row.city === "string" ? { city: row.city } : {}),
    ...(typeof row.state === "string" ? { state: row.state } : {}),
  }
}

async function authenticatedUserId(
  dependencies: OrderDataDependencies
): Promise<OrderDataResult<string>> {
  try {
    const client = await dependencies.createAuthenticatedClient()
    const { data, error } = await client.auth.getUser()
    const userId = data.user?.id
    if (error || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      return { ok: false, code: "AUTH_REQUIRED" }
    }
    return { ok: true, data: userId }
  } catch {
    return { ok: false, code: "AUTH_REQUIRED" }
  }
}

async function authorizedVendorId(
  userId: string,
  dependencies: OrderDataDependencies
): Promise<OrderDataResult<string>> {
  try {
    const { data, error } = await dependencies.privilegedClient
      .from("vendors")
      .select("id")
      .eq("user_id", userId)
      .limit(2)

    if (error || !Array.isArray(data)) {
      return { ok: false, code: "QUERY_FAILED" }
    }
    if (data.length !== 1 || !UUID_PATTERN.test(String(data[0]?.id ?? ""))) {
      return { ok: false, code: "VENDOR_ACCESS_DENIED" }
    }
    return { ok: true, data: String(data[0].id) }
  } catch {
    return { ok: false, code: "QUERY_FAILED" }
  }
}

export function createOrderDataAccess(dependencies: OrderDataDependencies) {
  async function getCustomerOrderHistory(input: {
    page: number
    pageSize: number
  }): Promise<
    OrderDataResult<{ orders: CustomerOrder[]; totalOrders: number }>
  > {
    const identity = await authenticatedUserId(dependencies)
    if (!identity.ok) return identity
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100
    ) {
      return { ok: false, code: "INVALID_REQUEST" }
    }

    const offset = (input.page - 1) * input.pageSize
    if (!Number.isSafeInteger(offset)) {
      return { ok: false, code: "INVALID_REQUEST" }
    }

    try {
      const { data, error, count } = await dependencies.privilegedClient
        .from("orders")
        .select(CUSTOMER_ORDER_FIELDS, { count: "exact" })
        .eq("customer_id", identity.data)
        .order("created_at", { ascending: false })
        .range(offset, offset + input.pageSize - 1)

      if (error || !Array.isArray(data)) {
        return { ok: false, code: "QUERY_FAILED" }
      }
      const orders = data.map(customerOrder)
      if (orders.some((order) => order === null)) {
        return { ok: false, code: "QUERY_FAILED" }
      }

      return {
        ok: true,
        data: {
          orders: orders as CustomerOrder[],
          totalOrders:
            typeof count === "number" && count >= 0 ? count : orders.length,
        },
      }
    } catch {
      return { ok: false, code: "QUERY_FAILED" }
    }
  }

  async function getVendorOrderHistory(): Promise<
    OrderDataResult<{
      vendorId: string
      items: VendorOrderItem[]
      orders: VendorOrderSummary[]
    }>
  > {
    const identity = await authenticatedUserId(dependencies)
    if (!identity.ok) return identity
    const vendorIdentity = await authorizedVendorId(identity.data, dependencies)
    if (!vendorIdentity.ok) return vendorIdentity

    try {
      const { data: itemData, error: itemError } =
        await dependencies.privilegedClient
          .from("order_items")
          .select(VENDOR_ITEM_FIELDS)
          .eq("vendor_id", vendorIdentity.data)

      if (itemError || !Array.isArray(itemData)) {
        return { ok: false, code: "QUERY_FAILED" }
      }
      const items = itemData.map((row) => vendorItem(row, vendorIdentity.data))
      if (items.some((item) => item === null)) {
        return { ok: false, code: "QUERY_FAILED" }
      }

      const authorizedItems = items as VendorOrderItem[]
      const orderIds = new Set(authorizedItems.map((item) => item.order_id))
      if (orderIds.size === 0) {
        return {
          ok: true,
          data: { vendorId: vendorIdentity.data, items: [], orders: [] },
        }
      }

      const { data: orderData, error: orderError } =
        await dependencies.privilegedClient
          .from("orders")
          .select("id, status, created_at")
          .in("id", [...orderIds])
          .order("created_at", { ascending: false })

      if (orderError || !Array.isArray(orderData)) {
        return { ok: false, code: "QUERY_FAILED" }
      }
      const orders = orderData.map((row) => vendorOrderSummary(row, orderIds))
      if (orders.some((order) => order === null)) {
        return { ok: false, code: "QUERY_FAILED" }
      }

      return {
        ok: true,
        data: {
          vendorId: vendorIdentity.data,
          items: authorizedItems,
          orders: orders as VendorOrderSummary[],
        },
      }
    } catch {
      return { ok: false, code: "QUERY_FAILED" }
    }
  }

  async function getVendorOrderDetail(
    orderId: string
  ): Promise<
    OrderDataResult<{
      vendorId: string
      order: VendorOrderDetail
      items: VendorOrderItem[]
    }>
  > {
    const identity = await authenticatedUserId(dependencies)
    if (!identity.ok) return identity
    if (!UUID_PATTERN.test(orderId)) {
      return { ok: false, code: "INVALID_REQUEST" }
    }
    const vendorIdentity = await authorizedVendorId(identity.data, dependencies)
    if (!vendorIdentity.ok) return vendorIdentity

    try {
      const { data: itemData, error: itemError } =
        await dependencies.privilegedClient
          .from("order_items")
          .select(VENDOR_DETAIL_ITEM_FIELDS)
          .eq("order_id", orderId)
          .eq("vendor_id", vendorIdentity.data)

      if (itemError || !Array.isArray(itemData)) {
        return { ok: false, code: "QUERY_FAILED" }
      }
      if (itemData.length === 0) {
        return { ok: false, code: "ORDER_NOT_FOUND" }
      }
      const items = itemData.map((row) => vendorItem(row, vendorIdentity.data))
      if (
        items.some(
          (item) => item === null || item.order_id !== orderId
        )
      ) {
        return { ok: false, code: "QUERY_FAILED" }
      }

      const authorizedOrderIds = new Set([orderId])
      const { data: orderData, error: orderError } =
        await dependencies.privilegedClient
          .from("orders")
          .select("id, status, created_at")
          .eq("id", orderId)
          .maybeSingle()

      if (orderError) return { ok: false, code: "QUERY_FAILED" }
      const summary = vendorOrderSummary(orderData, authorizedOrderIds)
      if (!summary) return { ok: false, code: "ORDER_NOT_FOUND" }

      let fulfillment: VendorFulfillment | null = null
      if (FULFILLMENT_STATUSES.includes(summary.status as "confirmed" | "fulfilled")) {
        const { data: fulfillmentData, error: fulfillmentError } =
          await dependencies.privilegedClient
            .from("orders")
            .select(
              "id, status, customer_email, customer_phone, shipping_address"
            )
            .eq("id", orderId)
            .in("status", [...FULFILLMENT_STATUSES])
            .maybeSingle()

        if (fulfillmentError) return { ok: false, code: "QUERY_FAILED" }
        const row = record(fulfillmentData)
        if (
          row &&
          row.id === orderId &&
          FULFILLMENT_STATUSES.includes(
            row.status as "confirmed" | "fulfilled"
          ) &&
          typeof row.customer_email === "string"
        ) {
          fulfillment = {
            customer_email: row.customer_email,
            customer_phone: nullableString(row.customer_phone),
            shipping_address: shippingAddress(row.shipping_address),
          }
        }
      }

      return {
        ok: true,
        data: {
          vendorId: vendorIdentity.data,
          order: { ...summary, fulfillment },
          items: items as VendorOrderItem[],
        },
      }
    } catch {
      return { ok: false, code: "QUERY_FAILED" }
    }
  }

  return {
    getCustomerOrderHistory,
    getVendorOrderHistory,
    getVendorOrderDetail,
  }
}

const productionOrderData = createOrderDataAccess({
  createAuthenticatedClient: createSupabaseServerClient,
  privilegedClient: supabaseAdmin,
})

export const getCustomerOrderHistory =
  productionOrderData.getCustomerOrderHistory
export const getVendorOrderHistory = productionOrderData.getVendorOrderHistory
export const getVendorOrderDetail = productionOrderData.getVendorOrderDetail
