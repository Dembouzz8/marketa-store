import Link from "next/link"
import { Package, ShoppingCart, TrendingUp, Wallet } from "lucide-react"
import { redirect } from "next/navigation"

import { StatsCard } from "@/components/vendor/stats-card"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { supabaseAdmin } from "@/lib/supabase-server"
import { cn, formatNaira } from "@/lib/utils"

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
  status: string
  created_at: string
}

type LedgerEntry = {
  amount: number
  type: "credit" | "debit"
}

function statusClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "confirmed") {
    return "bg-blue-100 text-blue-700"
  }
  if (normalized === "fulfilled") {
    return "bg-emerald-100 text-emerald-700"
  }
  if (normalized === "cancelled") {
    return "bg-red-100 text-red-700"
  }
  return "bg-amber-100 text-amber-700"
}

function getGreeting() {
  const hour = new Date().getHours()

  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function getProduct(item: VendorItemRow) {
  return Array.isArray(item.products) ? item.products[0] : item.products
}

export default async function VendorDashboardPage() {
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

  const { data: vendorOrderItems } = await supabaseAdmin
    .from("order_items")
    .select("order_id")
    .eq("vendor_id", vendor.id)

  const { data: ledgerData } = await supabase
    .from("payout_ledger")
    .select("amount, type")
    .eq("vendor_id", vendor.id)

  const { count: productCount } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("vendor_id", vendor.id)
    .eq("is_active", true)

  const uniqueOrderCount = new Set(
    vendorOrderItems?.map((item) => item.order_id) ?? []
  ).size
  const ledger = (ledgerData ?? []) as LedgerEntry[]
  const totalRevenue = ledger
    .filter((entry) => entry.type === "credit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const totalDebits = ledger
    .filter((entry) => entry.type === "debit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const pendingPayout = totalRevenue - totalDebits

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

  const vendorItems = (vendorItemsData ?? []) as VendorItemRow[]
  const orderIds = [...new Set(vendorItems.map((item) => item.order_id))]
  let orderRows: OrderRow[] = []

  if (orderIds.length > 0) {
    const { data: ordersData } = await supabaseAdmin
      .from("orders")
      .select("id, status, created_at")
      .in("id", orderIds)
      .order("created_at", { ascending: false })
      .limit(5)

    orderRows = (ordersData ?? []) as OrderRow[]
  }

  const recentOrders = orderRows.map((order) => {
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
      product_names: productNames,
      vendor_amount: vendorSubtotal,
    }
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {getGreeting()}, {vendor.name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatsCard
          title="Total Orders"
          value={uniqueOrderCount.toLocaleString()}
          subtitle="All vendor orders"
          icon={ShoppingCart}
          color="blue"
        />
        <StatsCard
          title="Total Revenue"
          value={formatNaira(totalRevenue)}
          subtitle="Ledger credits"
          icon={TrendingUp}
          color="emerald"
        />
        <StatsCard
          title="Pending Payout"
          value={formatNaira(pendingPayout)}
          subtitle="Available balance"
          icon={Wallet}
          color="amber"
        />
        <StatsCard
          title="Active Products"
          value={(productCount ?? 0).toLocaleString()}
          subtitle="Visible in storefront"
          icon={Package}
          color="purple"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium text-zinc-900">
              Recent Orders
            </h2>
            <Link
              href="/vendor/orders"
              className="text-sm font-medium text-amber-600 hover:text-amber-700"
            >
              View all orders
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Products
                  </th>
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Date
                  </th>
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Your Earnings
                  </th>
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-10 text-center text-sm text-zinc-500"
                    >
                      No recent orders yet
                    </td>
                  </tr>
                ) : (
                  recentOrders.map((order) => (
                    <tr key={order.id} className="border-b border-zinc-100">
                      <td className="py-4">
                        <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                          {order.product_names}
                        </p>
                      </td>
                      <td className="py-4 text-sm text-zinc-600">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 text-sm font-semibold text-zinc-900">
                        {formatNaira(order.vendor_amount)}
                      </td>
                      <td className="py-4">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                            statusClass(order.status)
                          )}
                        >
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-zinc-900">Quick Actions</h2>
          <div className="mt-5 space-y-3">
            <Link
              href="/vendor/products/new"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-amber-500 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
            >
              Add New Product
            </Link>
            <Link
              href="/vendor/payouts"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              View Payouts
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
