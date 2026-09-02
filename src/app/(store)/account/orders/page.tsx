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

import { createSupabaseServerClient } from "@/lib/supabase-server"
import { cn, formatNaira, getProductImage } from "@/lib/utils"

const PAGE_SIZE = 20
const MAX_SAFE_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)
const orderDateFormatter = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
})

type OrderItemRow = {
  id: string
  product_id: string | null
  vendor_id: string
  quantity: number
}

type CustomerOrderRow = {
  id: string
  status: string
  total_amount: number | string
  created_at: string | null
  order_items: OrderItemRow[] | null
}

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

function formatOrderTotal(value: number | string) {
  const amount = Number(value)
  return Number.isFinite(amount) ? formatNaira(amount) : "Total unavailable"
}

function getPreviewProductId(order: CustomerOrderRow) {
  return order.order_items?.find((item) => item.product_id)?.product_id ?? null
}

function getItemQuantity(order: CustomerOrderRow) {
  return (order.order_items ?? []).reduce((total, item) => {
    const quantity = Number(item.quantity)
    return Number.isSafeInteger(quantity) && quantity > 0
      ? total + quantity
      : total
  }, 0)
}

function pageHref(page: number) {
  return page === 1 ? "/account/orders" : `/account/orders?page=${page}`
}

export default async function CustomerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const resolvedSearchParams = await searchParams
  const page = parsePage(resolvedSearchParams.page)
  const offset = (page - 1) * PAGE_SIZE
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect("/account/login")

  const { data, error, count } = await supabase
    .from("orders")
    .select(
      `
      id,
      status,
      total_amount,
      created_at,
      order_items (
        id,
        product_id,
        vendor_id,
        quantity
      )
      `,
      { count: "exact" }
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    return <OrdersQueryError />
  }

  const orders = (data ?? []) as CustomerOrderRow[]
  const totalOrders = count ?? orders.length
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE))

  if (page > totalPages) {
    redirect(pageHref(totalPages))
  }

  const previewProductIds = [
    ...new Set(
      orders
        .map(getPreviewProductId)
        .filter((id): id is string => typeof id === "string")
    ),
  ]
  const productPreviews = new Map<string, ProductPreview>()

  if (previewProductIds.length > 0) {
    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id, name, images")
      .in("id", previewProductIds)
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
                const previewId = getPreviewProductId(order)
                const preview = previewId
                  ? productPreviews.get(previewId)
                  : undefined
                const itemQuantity = getItemQuantity(order)
                const status = getStatusPresentation(order.status)

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

                    <div className="mt-5 flex items-center gap-4 border-t border-zinc-100 pt-5">
                      {preview ? (
                        <Image
                          src={getProductImage(preview.images ?? [])}
                          alt={`${preview.name} product preview`}
                          width={72}
                          height={72}
                          className="size-16 shrink-0 rounded-xl border border-zinc-100 object-cover sm:size-[72px]"
                        />
                      ) : (
                        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-400 sm:size-[72px]">
                          <PackageOpen className="size-7" aria-hidden="true" />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 font-semibold text-zinc-900">
                          {preview?.name ?? "Product unavailable"}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
                          <ShoppingBag className="size-4" aria-hidden="true" />
                          {itemQuantity} {itemQuantity === 1 ? "item" : "items"}
                        </p>
                      </div>

                      <p className="shrink-0 text-right text-lg font-bold text-amber-600">
                        {formatOrderTotal(order.total_amount)}
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
