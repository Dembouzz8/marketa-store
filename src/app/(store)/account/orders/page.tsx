import Image from "next/image"
import Link from "next/link"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  ReceiptText,
  ShoppingBag,
} from "lucide-react"
import { redirect } from "next/navigation"

import {
  formatNairaFromKobo,
  presentOrderItemSnapshot,
  resolveStoredOrderTotalKobo,
  type VariantOptionPresentation,
} from "@/lib/order-item-snapshot"
import {
  getCustomerOrderHistory,
  type CustomerOrder,
  type CustomerOrderItem,
} from "@/lib/order-data-server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { cn, getProductImage } from "@/lib/utils"

const PAGE_SIZE = 20
const MAX_SAFE_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)
const orderDateFormatter = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
})

type OrderItemRow = CustomerOrderItem
type CustomerOrderRow = CustomerOrder

type ProductPreview = {
  id: string
  name: string
  images: string[] | null
}

type StatusPresentation = {
  label: string
  className: string
}

function parsePage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || !/^[1-9]\d*$/.test(candidate)) return 1

  const page = Number(candidate)
  return Number.isSafeInteger(page) && page <= MAX_SAFE_PAGE ? page : 1
}

function getStatusPresentation(status: string): StatusPresentation {
  switch (status.trim().toLowerCase()) {
    case "pending":
      return { label: "Pending", className: "bg-amber-100 text-amber-700" }
    case "confirmed":
      return { label: "Confirmed", className: "bg-blue-100 text-blue-700" }
    case "fulfilled":
      return {
        label: "Fulfilled",
        className: "bg-emerald-100 text-emerald-700",
      }
    case "cancelled":
      return { label: "Cancelled", className: "bg-red-100 text-red-700" }
    default:
      return { label: "Unknown", className: "bg-zinc-100 text-zinc-600" }
  }
}

function formatOrderDate(value: string | null) {
  if (!value) return "Date unavailable"

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : orderDateFormatter.format(date)
}

function getItemQuantity(order: CustomerOrderRow) {
  return (order.order_items ?? []).reduce((total, item) => {
    const quantity = presentOrderItemSnapshot(item).quantity
    return quantity === null ? total : total + quantity
  }, 0)
}

function pageHref(page: number) {
  return page === 1 ? "/account/orders" : `/account/orders?page=${page}`
}

function formatOptionValue(option: VariantOptionPresentation) {
  const metadata: string[] = []
  if (option.numericValue && option.unitSymbol) {
    metadata.push(`${option.numericValue} ${option.unitSymbol}`)
  }
  if (option.unitName) metadata.push(option.unitName)
  if (option.sizeSystemName) metadata.push(option.sizeSystemName)

  return metadata.length > 0
    ? `${option.valueLabel} (${metadata.join(", ")})`
    : option.valueLabel
}

function VariantDetails({ item }: { item: OrderItemRow }) {
  const variant = presentOrderItemSnapshot(item).variant
  if (variant.kind === "ordinary") return null
  if (variant.kind === "unavailable") {
    return <p className="mt-1 text-xs text-zinc-500">{variant.fallback}</p>
  }

  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
      {variant.options.map((option) => (
        <div key={`${option.axisPosition}-${option.axisLabel}`} className="flex gap-1">
          <dt>{option.axisLabel}:</dt>
          <dd className="font-medium text-zinc-700">
            {formatOptionValue(option)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default async function CustomerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const resolvedSearchParams = await searchParams
  const page = parsePage(resolvedSearchParams.page)
  const orderResult = await getCustomerOrderHistory({
    page,
    pageSize: PAGE_SIZE,
  })
  if (!orderResult.ok) {
    if (orderResult.code === "AUTH_REQUIRED") redirect("/account/login")
    return <OrdersQueryError />
  }

  const { orders, totalOrders } = orderResult.data
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE))

  if (page > totalPages) redirect(pageHref(totalPages))

  const productIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.order_items ?? [])
          .map((item) => item.product_id)
          .filter((id): id is string => typeof id === "string")
      )
    ),
  ]
  const productPreviews = new Map<string, ProductPreview>()

  if (productIds.length > 0) {
    const supabase = await createSupabaseServerClient()
    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id, name, images")
      .in("id", productIds)
      .eq("is_active", true)

    if (!productError) {
      for (const product of (products ?? []) as ProductPreview[]) {
        productPreviews.set(product.id, product)
      }
    }
  }

  return (
    <main className="bg-zinc-50 px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href="/account"
          className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to account
        </Link>

        <div className="mt-6 flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <ReceiptText className="size-7" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Order History
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Review the purchases made with your Marketa account.
            </p>
          </div>
        </div>

        {orders.length === 0 ? (
          <OrdersEmptyState />
        ) : (
          <>
            <div className="mt-8 space-y-4">
              {orders.map((order) => {
                const itemQuantity = getItemQuantity(order)
                const status = getStatusPresentation(order.status)
                const total = formatNairaFromKobo(
                  resolveStoredOrderTotalKobo(order)
                )

                return (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-mono text-sm font-semibold uppercase tracking-wide text-zinc-900">
                          Order #{order.id.slice(0, 8)}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          Placed {formatOrderDate(order.created_at)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "w-fit rounded-full px-3 py-1 text-xs font-semibold",
                          status.className
                        )}
                      >
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-5 space-y-4 border-t border-zinc-100 pt-5">
                      {(order.order_items ?? []).map((item) => {
                        const product = item.product_id
                          ? productPreviews.get(item.product_id)
                          : undefined
                        const financial = presentOrderItemSnapshot(item).financial
                        const unit = formatNairaFromKobo(
                          financial.unitAmountKobo
                        )
                        const gross = formatNairaFromKobo(
                          financial.grossAmountKobo
                        )

                        return (
                          <div key={item.id} className="flex items-start gap-3">
                            {product ? (
                              <Image
                                src={getProductImage(product.images ?? [])}
                                alt={`${product.name} product preview`}
                                width={48}
                                height={48}
                                className="size-12 shrink-0 rounded-lg border border-zinc-100 object-cover"
                              />
                            ) : (
                              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-400">
                                <PackageOpen className="size-5" aria-hidden="true" />
                              </span>
                            )}

                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-1 text-sm font-semibold text-zinc-900">
                                {product?.name ?? "Historical product unavailable"}
                              </p>
                              <VariantDetails item={item} />
                              <p className="mt-1 text-xs text-zinc-500">
                                Qty {item.quantity}
                                {unit ? ` × ${unit}` : " · Unit amount unavailable"}
                              </p>
                            </div>

                            <p className="shrink-0 text-sm font-semibold text-zinc-900">
                              {gross ?? "Amount unavailable"}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-5">
                      <p className="flex items-center gap-1.5 text-sm text-zinc-500">
                        <ShoppingBag className="size-4" aria-hidden="true" />
                        {itemQuantity} {itemQuantity === 1 ? "item" : "items"}
                      </p>
                      <p className="text-right text-lg font-bold text-amber-600">
                        {total ?? "Total unavailable"}
                      </p>
                    </div>
                  </article>
                )
              })}
            </div>

            <nav
              aria-label="Order history pagination"
              className="mt-8 flex items-center justify-between gap-4"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  aria-label={`Go to order history page ${page - 1}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Previous
                </Link>
              ) : (
                <span />
              )}

              <span className="text-sm text-zinc-500">
                Page {page} of {totalPages}
              </span>

              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  aria-label={`Go to order history page ${page + 1}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        )}
      </div>
    </main>
  )
}

function OrdersEmptyState() {
  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-white px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
        <ShoppingBag className="size-8" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-semibold text-zinc-900">
        No orders yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
        Your purchases will appear here after checkout.
      </p>
      <Link
        href="/products"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        Start shopping
      </Link>
    </section>
  )
}

function OrdersQueryError() {
  return (
    <main className="bg-zinc-50 px-4 py-10 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <ReceiptText className="mx-auto size-10 text-red-500" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          We couldn&apos;t load your orders
        </h1>
        <p role="alert" className="mt-2 text-sm leading-6 text-zinc-600">
          We couldn&apos;t load your orders right now. Please try again.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/account/orders"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            Try again
          </Link>
          <Link
            href="/account"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            Back to account
          </Link>
        </div>
      </section>
    </main>
  )
}
