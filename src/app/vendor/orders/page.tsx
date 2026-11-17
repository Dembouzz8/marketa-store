import Link from "next/link"
import { Search, ShoppingCart } from "lucide-react"
import { redirect } from "next/navigation"

import { Input } from "@/components/ui/input"
import {
  aggregateOrderItemFinancials,
  formatNairaFromKobo,
  presentOrderItemSnapshot,
} from "@/lib/order-item-snapshot"
import {
  getVendorOrderHistory,
  type VendorOrderItem,
  type VendorOrderSummary,
} from "@/lib/order-data-server"
import { cn } from "@/lib/utils"

type VendorItemRow = VendorOrderItem
type OrderRow = VendorOrderSummary

type VendorOrderPresentation = OrderRow & {
  productNames: string
  variantDetails: string
  itemCount: number
  gross: string | null
  fee: string | null
  net: string | null
}

const allowedStatuses = new Set([
  "all",
  "pending",
  "confirmed",
  "fulfilled",
  "cancelled",
])

function getProduct(item: VendorItemRow) {
  return item.products
}

function statusClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === "confirmed") return "bg-blue-100 text-blue-700"
  if (normalized === "fulfilled") return "bg-emerald-100 text-emerald-700"
  if (normalized === "cancelled") return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

function variantSummary(item: VendorItemRow) {
  const variant = presentOrderItemSnapshot(item).variant
  if (variant.kind === "ordinary") return null
  if (variant.kind === "unavailable") return variant.fallback
  return variant.options
    .map((option) => `${option.axisLabel}: ${option.valueLabel}`)
    .join(", ")
}

function firstSearchValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

export default async function VendorOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string | string[]
    status?: string | string[]
  }>
}) {
  const resolvedSearchParams = await searchParams
  const query = firstSearchValue(resolvedSearchParams.query).slice(0, 120)
  const requestedStatus = firstSearchValue(resolvedSearchParams.status).toLowerCase()
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "all"
  const orderResult = await getVendorOrderHistory()
  if (!orderResult.ok) {
    if (orderResult.code === "AUTH_REQUIRED") redirect("/vendor/login")
    if (orderResult.code === "VENDOR_ACCESS_DENIED") {
      redirect("/vendor/login?error=not_a_vendor")
    }
    return <VendorOrdersQueryError />
  }
  const vendorItems = orderResult.data.items
  const orderRows = orderResult.data.orders

  const vendorOrders: VendorOrderPresentation[] = orderRows.map((order) => {
    const items = vendorItems.filter((item) => item.order_id === order.id)
    const financials = aggregateOrderItemFinancials(items)
    const productNames =
      items
        .map((item) => getProduct(item)?.name)
        .filter((name): name is string => Boolean(name))
        .join(", ") || "Historical product unavailable"
    const variantDetails = items
      .map(variantSummary)
      .filter((value): value is string => Boolean(value))
      .join(" · ")

    return {
      ...order,
      productNames,
      variantDetails,
      itemCount: items.reduce((total, item) => {
        const quantity = presentOrderItemSnapshot(item).quantity
        return total + (quantity ?? 0)
      }, 0),
      gross: formatNairaFromKobo(financials.grossAmountKobo),
      fee: formatNairaFromKobo(financials.platformFeeAmountKobo),
      net: formatNairaFromKobo(financials.vendorNetAmountKobo),
    }
  })

  const normalizedQuery = query.toLowerCase()
  const filteredOrders = vendorOrders.filter((order) => {
    const matchesQuery =
      !normalizedQuery ||
      order.id.toLowerCase().includes(normalizedQuery) ||
      order.productNames.toLowerCase().includes(normalizedQuery) ||
      order.variantDetails.toLowerCase().includes(normalizedQuery)
    const matchesStatus =
      status === "all" || order.status.toLowerCase() === status
    return matchesQuery && matchesStatus
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Orders</h1>
        <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-900">
          {vendorOrders.length} total
        </span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <form
          action="/vendor/orders"
          className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              name="query"
              defaultValue={query}
              maxLength={120}
              placeholder="Search orders or products"
              aria-label="Search orders or products"
              className="h-10 rounded-lg border-zinc-200 pl-10"
            />
          </div>
          <div className="flex min-w-0 gap-2">
            <select
              name="status"
              defaultValue={status}
              aria-label="Filter orders by status"
              className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-amber-500 sm:flex-none"
            >
              {[
                ["all", "All"],
                ["pending", "Pending"],
                ["confirmed", "Confirmed"],
                ["fulfilled", "Fulfilled"],
                ["cancelled", "Cancelled"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-10 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
        </form>

        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShoppingCart className="size-16 text-zinc-200" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-medium text-zinc-900">
              No orders found
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Orders from your products will appear here.
            </p>
          </div>
        ) : (
          <>
          <div className="space-y-3 lg:hidden">
            {filteredOrders.map((order) => (
              <article
                key={order.id}
                className="min-w-0 rounded-lg border border-zinc-200 p-4"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-medium text-zinc-900">
                      {order.productNames}
                    </h2>
                    {order.variantDetails ? (
                      <p className="mt-1 break-words text-xs leading-5 text-zinc-500">
                        {order.variantDetails}
                      </p>
                    ) : null}
                    <p className="mt-1 font-mono text-xs text-zinc-400">
                      #{order.id.slice(0, 8)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                      statusClass(order.status)
                    )}
                  >
                    {order.status}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-zinc-100 py-4 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-zinc-500">Date</dt>
                    <dd className="mt-1 font-medium text-zinc-900">
                      {new Date(order.created_at).toLocaleDateString("en-NG")}
                    </dd>
                  </div>
                  <div className="min-w-0 text-right">
                    <dt className="text-xs text-zinc-500">Items</dt>
                    <dd className="mt-1 font-medium text-zinc-900">
                      {order.itemCount}{" "}
                      {order.itemCount === 1 ? "item" : "items"}
                    </dd>
                  </div>
                </dl>

                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <dt className="min-w-0 text-zinc-500">Vendor gross</dt>
                    <dd className="shrink-0 text-right font-medium text-zinc-900">
                      {order.gross ?? "Unavailable"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <dt className="min-w-0 text-zinc-500">Platform fee</dt>
                    <dd className="shrink-0 text-right text-zinc-700">
                      {order.fee ?? "Unavailable"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <dt className="min-w-0 text-zinc-500">Net earnings</dt>
                    <dd className="shrink-0 text-right font-semibold text-emerald-700">
                      {order.net ?? "Unavailable"}
                    </dd>
                  </div>
                </dl>

                <Link
                  href={`/vendor/orders/${order.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900"
                >
                  View order
                </Link>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  {[
                    "Products",
                    "Date",
                    "Items",
                    "Gross",
                    "Platform fee",
                    "Net earnings",
                    "Status",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="px-3 py-3 text-xs font-medium uppercase text-zinc-500"
                    >
                      {heading}
                    </th>
                  ))}
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
                        {order.productNames}
                      </p>
                      {order.variantDetails ? (
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
                          {order.variantDetails}
                        </p>
                      ) : null}
                      <p className="mt-1 font-mono text-xs text-zinc-400">
                        #{order.id.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-sm text-zinc-600">
                      {new Date(order.created_at).toLocaleDateString("en-NG")}
                    </td>
                    <td className="px-3 py-4 text-sm text-zinc-900">
                      {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                    </td>
                    <td className="px-3 py-4 text-sm font-medium text-zinc-900">
                      {order.gross ?? "Unavailable"}
                    </td>
                    <td className="px-3 py-4 text-sm text-zinc-600">
                      {order.fee ?? "Unavailable"}
                    </td>
                    <td className="px-3 py-4 text-sm font-semibold text-emerald-700">
                      {order.net ?? "Unavailable"}
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
          </>
        )}
      </div>
    </div>
  )
}

function VendorOrdersQueryError() {
  return (
    <section className="rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-900">
        We couldn&apos;t load your orders
      </h1>
      <p role="alert" className="mt-2 text-sm text-zinc-600">
        Please try again. No order information was displayed.
      </p>
      <Link
        href="/vendor/orders"
        className="mt-5 inline-flex rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900"
      >
        Try again
      </Link>
    </section>
  )
}
