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
  customer_email: string
  customer_phone: string
  items: { product_id: string; quantity: number }[]
  shipping_address: {
    address: string
    city: string
    state: string
  }
}

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
