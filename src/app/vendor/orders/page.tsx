import { redirect } from "next/navigation"

import { OrdersTable } from "@/components/vendor/orders-table"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { VendorOrder } from "@/types"

type JoinedOrder = {
  id: string
  customer_email: string
  customer_phone: string | null
  status: string
  total_amount: number
  payment_ref: string | null
  shipping_address: VendorOrder["shipping_address"]
  created_at: string
}

type OrderItemRow = {
  id: string
  order_id: string
  quantity: number
  unit_price: number
  subtotal: number
  product_id: string
  orders: JoinedOrder | JoinedOrder[] | null
}

function getJoinedOrder(row: OrderItemRow) {
  return Array.isArray(row.orders) ? row.orders[0] : row.orders
}

export default async function VendorOrdersPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/vendor/login")

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.id)
    .single()

  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  const { data: orderItemsData } = await supabase
    .from("order_items")
    .select(
      `
      id,
      order_id,
      product_id,
      quantity,
      unit_price,
      subtotal,
      orders (
        id,
        customer_email,
        customer_phone,
        status,
        total_amount,
        payment_ref,
        shipping_address,
        created_at
      )
    `
    )
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false })

  const orderMap = new Map<string, VendorOrder>()
  const orderItems = (orderItemsData ?? []) as OrderItemRow[]

  for (const item of orderItems) {
    const order = getJoinedOrder(item)
    if (!order) continue

    if (!orderMap.has(order.id)) {
      orderMap.set(order.id, {
        id: order.id,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        status: order.status,
        total_amount: Number(order.total_amount),
        payment_ref: order.payment_ref,
        shipping_address: order.shipping_address ?? {},
        created_at: order.created_at,
        order_items: [],
      })
    }

    orderMap.get(order.id)?.order_items.push({
      id: item.id,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      product_id: item.product_id,
      products: {
        name: "",
        images: [],
      },
    })
  }

  const orders = Array.from(orderMap.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Orders</h1>
        <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-900">
          {orders.length} total
        </span>
      </div>
      <OrdersTable orders={orders} />
    </div>
  )
}
