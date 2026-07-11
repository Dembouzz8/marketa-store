import { redirect } from "next/navigation"

import { OrdersTable } from "@/components/vendor/orders-table"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { supabaseAdmin } from "@/lib/supabase-server"

type ShippingAddress = {
  address?: string
  city?: string
  state?: string
}

type ProductJoin = {
  id: string
  name: string
  images: string[]
}

type VendorItemRow = {
  id: string
  order_id: string
  quantity: number
  unit_price: number
  subtotal: number
  products: ProductJoin | ProductJoin[] | null
}

type OrderRow = {
  id: string
  customer_email: string
  customer_phone: string | null
  status: string
  payment_ref: string | null
  shipping_address: ShippingAddress | null
  created_at: string
}

function getProduct(item: VendorItemRow) {
  return Array.isArray(item.products) ? item.products[0] : item.products
}

export default async function VendorOrdersPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/vendor/login")

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, platform_fee_pct")
    .eq("user_id", user.id)
    .single()

  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  const { data: vendorItemsData } = await supabaseAdmin
    .from("order_items")
    .select(
      `
      id,
      order_id,
      quantity,
      unit_price,
      subtotal,
      products (
        id,
        name,
        images
      )
    `
    )
    .eq("vendor_id", vendor.id)
  
  console.log("vendor.id:", vendor.id)
console.log("vendorItemsData count:", vendorItemsData?.length)
console.log("vendorItemsData sample:", JSON.stringify(vendorItemsData?.[0], null, 2))

  const vendorItems = (vendorItemsData ?? []) as VendorItemRow[]
  const orderIds = [...new Set(vendorItems.map((item) => item.order_id))]
  let orderRows: OrderRow[] = []

  if (orderIds.length > 0) {
    const { data: ordersData } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        customer_email,
        customer_phone,
        status,
        shipping_address,
        payment_ref,
        created_at
      `
      )
      .in("id", orderIds)
      .order("created_at", { ascending: false })

    orderRows = (ordersData ?? []) as OrderRow[]
  }

  const vendorOrders = orderRows.map((order) => {
    const itemsForThisOrder = vendorItems.filter(
      (item) => item.order_id === order.id
    )
    const vendorSubtotal = itemsForThisOrder.reduce(
      (sum, item) => sum + Number(item.subtotal),
      0
    )
    const productNames =
      itemsForThisOrder
        .map((item) => getProduct(item)?.name)
        .filter(Boolean)
        .join(", ") || "Products"

    return {
      ...order,
      shipping_address: order.shipping_address ?? {},
      vendor_amount: vendorSubtotal,
      product_names: productNames,
      item_count: itemsForThisOrder.length,
      order_items: itemsForThisOrder,
    }
  })
  
console.log("vendor.id:", vendor.id)
console.log("vendorItems count:", vendorItems.length)
console.log("orderIds:", orderIds)
console.log("orderRows count:", orderRows.length)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Orders</h1>
        <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-900">
          {vendorOrders.length} total
        </span>
      </div>
      <OrdersTable orders={vendorOrders} />
    </div>
  )
}
