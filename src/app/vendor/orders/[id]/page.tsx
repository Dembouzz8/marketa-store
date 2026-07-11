import Link from "next/link"
import { redirect } from "next/navigation"

import { Separator } from "@/components/ui/separator"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { cn, formatNaira, getProductImage } from "@/lib/utils"

type ShippingAddress = {
  address?: string
  city?: string
  state?: string
}

type OrderDetail = {
  id: string
  customer_email: string
  customer_phone: string | null
  status: string
  payment_ref: string | null
  shipping_address: ShippingAddress | null
  created_at: string
}

type OrderDetailItem = {
  id: string
  quantity: number
  unit_price: number
  subtotal: number
  products:
    | {
        name: string
        images: string[]
      }
    | {
        name: string
        images: string[]
      }[]
    | null
}

function statusClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "confirmed") return "bg-blue-100 text-blue-700"
  if (normalized === "fulfilled") return "bg-emerald-100 text-emerald-700"
  if (normalized === "cancelled") return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

function getProduct(item: OrderDetailItem) {
  return Array.isArray(item.products) ? item.products[0] : item.products
}

export default async function VendorOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/vendor/login")

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, platform_fee_pct")
    .eq("user_id", user.id)
    .single()

  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  const { data: orderData } = await supabase
    .from("orders")
    .select(
      `
      id,
      customer_email,
      customer_phone,
      status,
      payment_ref,
      shipping_address,
      created_at
    `
    )
    .eq("id", id)
    .single()

  const { data: itemsData } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, subtotal, products(name, images)")
    .eq("order_id", id)
    .eq("vendor_id", vendor.id)

  const order = orderData as OrderDetail | null
  const items = (itemsData ?? []) as OrderDetailItem[]

  if (!order || items.length === 0) redirect("/vendor/orders")

  const vendorEarnings = items.reduce(
    (sum, item) => sum + Number(item.subtotal),
    0
  )
  const afterPlatformFee =
    vendorEarnings * (1 - Number(vendor.platform_fee_pct) / 100)
  const address = order.shipping_address ?? {}

  return (
    <div className="space-y-6">
      <Link
        href="/vendor/orders"
        className="inline-flex text-sm font-medium text-zinc-500 hover:text-zinc-900"
      >
        &lt;- Back to Orders
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Order #{order.id.slice(0, 8)}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Placed on {new Date(order.created_at).toLocaleString()}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-zinc-900">Order Info</h2>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Order ID</span>
                <span className="font-medium text-zinc-900">{order.id}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Date</span>
                <span className="font-medium text-zinc-900">
                  {new Date(order.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Status</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                    statusClass(order.status)
                  )}
                >
                  {order.status}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Payment Reference</span>
                <span className="font-mono text-xs text-zinc-900">
                  {order.payment_ref ?? "Not available"}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-zinc-900">
              Customer Info
            </h2>
            <div className="mt-5 space-y-4 text-sm">
              <div>
                <p className="text-zinc-500">Email</p>
                <p className="mt-1 font-medium text-zinc-900">
                  {order.customer_email}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Phone</p>
                <p className="mt-1 font-medium text-zinc-900">
                  {order.customer_phone ?? "Not provided"}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Shipping Address</p>
                <p className="mt-1 font-medium text-zinc-900">
                  {[address.address, address.city, address.state]
                    .filter(Boolean)
                    .join(", ") || "Not provided"}
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-zinc-900">Items</h2>
          <div className="mt-5 space-y-4">
            {items.map((item) => {
              const product = getProduct(item)

              return (
                <div key={item.id} className="flex gap-3">
                  <img
                    src={getProductImage(product?.images ?? [])}
                    alt={product?.name ?? "Product"}
                    className="size-12 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                      {product?.name ?? "Product"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Qty {item.quantity} x {formatNaira(item.unit_price)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-zinc-900">
                    {formatNaira(item.subtotal)}
                  </p>
                </div>
              )
            })}
          </div>

          <Separator className="my-5" />

          <div className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">Your Earnings</span>
              <span className="font-semibold text-zinc-900">
                {formatNaira(vendorEarnings)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">After platform fee</span>
              <span className="font-bold text-emerald-600">
                {formatNaira(afterPlatformFee)}
              </span>
            </div>
            <p className="text-right text-xs text-zinc-500">
              Platform fee: {vendor.platform_fee_pct}%
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
