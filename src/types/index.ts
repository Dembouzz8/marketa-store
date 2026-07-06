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
