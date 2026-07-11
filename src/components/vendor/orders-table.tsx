"use client"

import Link from "next/link"
import { Search, ShoppingCart } from "lucide-react"
import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import { cn, formatNaira } from "@/lib/utils"

type VendorOrdersTableOrder = {
  id: string
  customer_email: string
  status: string
  created_at: string
  vendor_amount: number
  product_names: string
  item_count: number
}

interface OrdersTableProps {
  orders: VendorOrdersTableOrder[]
}

const statuses = ["All", "Pending", "Confirmed", "Fulfilled", "Cancelled"]

function statusClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "confirmed") return "bg-blue-100 text-blue-700"
  if (normalized === "fulfilled") return "bg-emerald-100 text-emerald-700"
  if (normalized === "cancelled") return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

export function OrdersTable({ orders }: OrdersTableProps) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("All")

  const filteredOrders = useMemo(() => {
    const search = query.trim().toLowerCase()

    return orders.filter((order) => {
      const matchesSearch =
        !search ||
        order.id.toLowerCase().includes(search) ||
        order.customer_email.toLowerCase().includes(search) ||
        order.product_names.toLowerCase().includes(search)
      const matchesStatus =
        status === "All" ||
        order.status.toLowerCase() === status.toLowerCase()

      return matchesSearch && matchesStatus
    })
  }, [orders, query, status])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search orders or products"
            className="h-10 rounded-lg border-zinc-200 pl-10"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-amber-500"
        >
          {statuses.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShoppingCart className="size-16 text-zinc-200" />
          <h2 className="mt-4 text-lg font-medium text-zinc-900">
            No orders yet
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Orders from your products will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Products
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Date
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Items
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Your Earnings
                </th>
                <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                  Status
                </th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id} className="border-b border-zinc-100">
                  <td className="px-3 py-4">
                    <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                      {order.product_names}
                    </p>
                    <p className="mt-1 font-mono text-xs text-zinc-400">
                      #{order.id.slice(0, 8)}
                    </p>
                  </td>
                  <td className="px-3 py-4 text-sm text-zinc-600">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-4 text-sm text-zinc-900">
                    {order.item_count}{" "}
                    {order.item_count === 1 ? "item" : "items"}
                  </td>
                  <td className="px-3 py-4 text-sm font-semibold text-zinc-900">
                    {formatNaira(order.vendor_amount)}
                  </td>
                  <td className="px-3 py-4">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                        statusClass(order.status)
                      )}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Link
                      href={`/vendor/orders/${order.id}`}
                      className="inline-flex rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
