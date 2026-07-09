import Link from "next/link"
import {
  Package,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { redirect } from "next/navigation"

import { StatsCard } from "@/components/vendor/stats-card"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { cn, formatNaira } from "@/lib/utils"

type DashboardOrderItem = {
  order_id: string
  subtotal: number
  orders:
    | {
        id: string
        status: string
        created_at: string
        total_amount: number
      }
    | {
        id: string
        status: string
        created_at: string
        total_amount: number
      }[]
    | null
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

function getOrderObject(row: DashboardOrderItem) {
  return Array.isArray(row.orders) ? row.orders[0] : row.orders
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

  const { data: orderItemsData } = await supabase
    .from("order_items")
    .select("order_id, subtotal, orders(id, status, created_at, total_amount)")
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

  const orderItems = (orderItemsData ?? []) as DashboardOrderItem[]
  const ledger = (ledgerData ?? []) as LedgerEntry[]
  const uniqueOrders = new Set(orderItems.map((item) => item.order_id)).size
  const totalRevenue = ledger
    .filter((entry) => entry.type === "credit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const totalDebits = ledger
    .filter((entry) => entry.type === "debit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const pendingPayout = totalRevenue - totalDebits

  const recentOrders = Array.from(
    orderItems
      .reduce((map, item) => {
        const order = getOrderObject(item)
        if (!order) return map

        const existing = map.get(item.order_id)
        map.set(item.order_id, {
          id: order.id,
          status: order.status,
          created_at: order.created_at,
          amount: (existing?.amount ?? 0) + Number(item.subtotal),
        })
        return map
      }, new Map<string, { id: string; status: string; created_at: string; amount: number }>())
      .values()
  )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 5)

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
          value={uniqueOrders.toLocaleString()}
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
                    Order ID
                  </th>
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Date
                  </th>
                  <th className="pb-3 text-xs font-medium uppercase text-zinc-500">
                    Amount
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
                      <td className="py-4 text-sm font-medium text-zinc-900">
                        #{order.id.slice(0, 8)}
                      </td>
                      <td className="py-4 text-sm text-zinc-600">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 text-sm font-semibold text-zinc-900">
                        {formatNaira(order.amount)}
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
