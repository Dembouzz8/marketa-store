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

export type ProductVariantMode =
  | "none"
  | "size"
  | "colour"
  | "size_colour"
  | "options"

export type PublicProductVariantMode = Exclude<ProductVariantMode, "none">

export interface PublicProductVariantValue {
  id: string
  label: string
  position: number
  swatch_hex: string | null
}

export interface PublicProductVariantAxis {
  id: string
  label: string
  position: number
  values: PublicProductVariantValue[]
}

export interface PublicProductVariantSelection {
  axis_id: string
  value_id: string
}

export interface PublicProductVariantCombination {
  variant_id: string
  stock: number
  selections: PublicProductVariantSelection[]
}

export interface PublicProductVariantProjection {
  product_id: string
  variant_mode: PublicProductVariantMode
  axes: PublicProductVariantAxis[]
  combinations: PublicProductVariantCombination[]
}

export interface StorefrontProduct extends Product {
  variant_mode: ProductVariantMode
  available_stock: number
  has_in_stock_combination: boolean
}

export interface VendorProduct extends Product {
  variant_mode: ProductVariantMode
  category_code: string | null
  stock_version: number
}

export type ProductOptionValueKind = "label" | "measurement" | "colour"

export interface VendorOptionCategory {
  code: string
  name: string
  sort_order: number
}

export interface VendorOptionDefinition {
  code: string
  name: string
  value_kind: ProductOptionValueKind
  dimension_code: string | null
  requires_unit: boolean
  requires_size_system: boolean
  sort_order: number
}

export interface VendorOptionUnit {
  code: string
  name: string
  symbol: string
  dimension_code: string
  sort_order: number
}

export interface VendorOptionSizeSystem {
  code: string
  name: string
  sort_order: number
}

export interface VendorOptionTemplate {
  category_code: string
  option_code: string
  sort_order: number
  default_unit_code: string | null
  default_size_system_code: string | null
}

export interface VendorOptionReferenceData {
  categories: VendorOptionCategory[]
  options: VendorOptionDefinition[]
  units: VendorOptionUnit[]
  size_systems: VendorOptionSizeSystem[]
  templates: VendorOptionTemplate[]
}

export interface VendorProductOptionValue {
  id: string
  display_label: string
  numeric_value: number | null
  swatch_hex: string | null
  sort_order: number
}

export interface VendorProductOptionAxis {
  id: string
  option_code: string
  display_name: string
  position: number
  unit_code: string | null
  size_system_code: string | null
  values: VendorProductOptionValue[]
}

export interface VendorProductOptionVariant {
  id: string
  stock: number
  stock_version: number
  is_active: boolean
  selected_value_ids: string[]
}

export interface VendorProductOptionConfiguration {
  product_id: string
  category_code: string | null
  variant_mode: ProductVariantMode
  is_active: boolean
  parent_stock: number
  axes: VendorProductOptionAxis[]
  variants: VendorProductOptionVariant[]
}

export interface ProductVariant {
  id: string
  product_id: string
  vendor_id: string
  size: string | null
  colour: string | null
  size_normalized: string | null
  colour_normalized: string | null
  stock: number
  stock_version: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PublicVendor {
  id: string
  name: string
  slug: string | null
  description: string | null
  main_category: string | null
  location: string | null
  shipping_info: string | null
  return_info: string | null
  is_verified: boolean
}

export type CatalogueVendor = Pick<PublicVendor, "id" | "name">

export interface CatalogueProduct {
  product: StorefrontProduct
  vendor: CatalogueVendor
}

/** Display-only product data persisted with a version-1 cart line. */
export interface CartProductSnapshot {
  id: string
  name: string
  price: number
  images: string[]
}

/** Display-only option data derived from a public variant projection. */
export interface SelectedOptionSnapshot {
  axis_id: string
  value_id: string
  axis_label: string
  value_label: string
}

export interface OrdinaryCartItem {
  kind: "ordinary"
  cartLineId: string
  product: CartProductSnapshot
  quantity: number
  stock_snapshot: number
}

export interface VariantCartItem {
  kind: "variant"
  cartLineId: string
  product: CartProductSnapshot
  quantity: number
  variant: {
    product_id: string
    variant_id: string
    variant_mode: PublicProductVariantMode
    stock_snapshot: number
    selected_options: SelectedOptionSnapshot[]
  }
}

/** Persisted and active version-1 cart contract. */
export type CartItemV1 = OrdinaryCartItem | VariantCartItem

export type CartItem = CartItemV1

export interface OrdinaryCheckoutIdentity {
  kind: "ordinary"
  product_id: string
  quantity: number
}

export interface VariantCheckoutIdentity {
  kind: "variant"
  product_id: string
  product_variant_id: string
  quantity: number
}

export type CheckoutIdentity =
  | OrdinaryCheckoutIdentity
  | VariantCheckoutIdentity

export interface OrdinaryCheckoutRequestItem {
  product_id: string
  quantity: number
}

export interface CheckoutFormData {
  shipping_address: {
    address: string
    city: string
    state: string
  }
}

export interface OrdinaryCheckoutPayload {
  checkout_attempt_id: string
  items: OrdinaryCheckoutRequestItem[]
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
  | "AUTH_REQUIRED"
  | "PROFILE_INCOMPLETE"
  | "AUTH_SERVICE_UNAVAILABLE"
  | "INVALID_SHIPPING_ADDRESS"
  | "INVALID_ITEMS"
  | "DUPLICATE_PRODUCT"
  | "PRODUCT_UNAVAILABLE"
  | "INSUFFICIENT_STOCK"
  | "VENDOR_UNAVAILABLE"
  | "INVALID_PRODUCT_PRICE"
  | "INVALID_CHECKOUT_ATTEMPT"
  | "CHECKOUT_ATTEMPT_CONFLICT"
  | "CHECKOUT_INITIALIZING"
  | "CHECKOUT_EXPIRED"
  | "CHECKOUT_ALREADY_CONFIRMED"
  | "PAYMENT_INITIALIZATION_FAILED"
  | "SERVICE_UNAVAILABLE"

export interface CheckoutSuccessResponse {
  ok: true
  data: {
    order_id: string
    reference: string
    authorization_url: string
    checkout_attempt_id: string
    reused: boolean
  }
}

export interface CheckoutErrorResponse {
  ok: false
  error: {
    code: CheckoutErrorCode
    message: string
  }
  retry_after_ms?: number
  order?: {
    order_id: string
    reference: string
  }
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
