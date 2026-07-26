export interface Product {
  id: string
  vendor_id: string
  name: string
  description: string | null
  price: number
  stock: number
  category: string | null
  images: string[]
  is_active: boolean
  created_at: string
}

export interface CatalogueVendor {
  id: string
  name: string
}

export interface CatalogueProduct {
  product: Product
  vendor: CatalogueVendor
}

export interface CartItem {
  product: Product
  quantity: number
}

export interface CheckoutFormData {
  full_name: string
  customer_email: string
  customer_phone: string
  shipping_address: {
    address: string
    city: string
    state: string
  }
}

export interface CheckoutPayload {
  customer_name: string
  customer_email: string
  customer_phone: string
  items: { product_id: string; quantity: number }[]
  shipping_address: {
    address: string
    city: string
    state: string
  }
}

export type CheckoutErrorCode =
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

export interface CheckoutSuccessResponse {
  ok: true
  data: {
    order_id: string
    reference: string
    authorization_url: string
  }
}

export interface CheckoutErrorResponse {
  ok: false
  error: {
    code: CheckoutErrorCode
    message: string
  }
  retry_after_ms?: number
}

export type CheckoutResponse =
  | CheckoutSuccessResponse
  | CheckoutErrorResponse

export interface Vendor {
  id: string
  user_id: string
  name: string
  email: string
  phone: string | null
  bank_details: {
    bank_name?: string
    account_number?: string
    account_name?: string
  }
  platform_fee_pct: number
  is_active: boolean
  created_at: string
}

export interface VendorOrder {
  id: string
  customer_email: string
  customer_phone: string | null
  status: string
  total_amount: number
  payment_ref: string | null
  shipping_address: {
    address?: string
    city?: string
    state?: string
  }
  created_at: string
  order_items: VendorOrderItem[]
}

export interface VendorOrderItem {
  id: string
  quantity: number
  unit_price: number
  subtotal: number
  product_id: string
  products: {
    name: string
    images: string[]
  }
}

export interface PayoutLedgerEntry {
  id: string
  amount: number
  type: "credit" | "debit"
  reference: string
  description: string | null
  created_at: string
  order_id: string | null
}

export interface DashboardStats {
  totalOrders: number
  totalRevenue: number
  pendingPayout: number
  activeProducts: number
}
