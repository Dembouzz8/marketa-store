import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Separator } from "@/components/ui/separator"
import {
  aggregateOrderItemFinancials,
  formatNairaFromKobo,
  presentOrderItemSnapshot,
  type VariantOptionPresentation,
} from "@/lib/order-item-snapshot"
import {
  getVendorOrderDetail,
  type ShippingAddress,
  type VendorOrderDetail,
  type VendorOrderItem,
} from "@/lib/order-data-server"
import { cn, getProductImage } from "@/lib/utils"

type OrderDetail = VendorOrderDetail
type OrderDetailItem = VendorOrderItem

function statusClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === "confirmed") return "bg-blue-100 text-blue-700"
  if (normalized === "fulfilled") return "bg-emerald-100 text-emerald-700"
  if (normalized === "cancelled") return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

function getProduct(item: OrderDetailItem) {
  return item.products
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

function VariantDetails({ item }: { item: OrderDetailItem }) {
  const variant = presentOrderItemSnapshot(item).variant
  if (variant.kind === "ordinary") return null
  if (variant.kind === "unavailable") {
    return <p className="mt-1 text-xs text-zinc-500">{variant.fallback}</p>
  }

  return (
    <dl className="mt-1 space-y-0.5 text-xs text-zinc-500">
      {variant.options.map((option) => (
        <div
          key={`${option.axisPosition}-${option.axisLabel}`}
          className="flex min-w-0 flex-wrap gap-x-1"
        >
          <dt className="shrink-0">{option.axisLabel}:</dt>
          <dd className="min-w-0 break-words font-medium text-zinc-700">
            {formatOptionValue(option)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default async function VendorOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const orderResult = await getVendorOrderDetail(id)
  if (!orderResult.ok) {
    if (orderResult.code === "AUTH_REQUIRED") redirect("/vendor/login")
    if (orderResult.code === "VENDOR_ACCESS_DENIED") {
      redirect("/vendor/login?error=not_a_vendor")
    }
    redirect("/vendor/orders")
  }

  const order: OrderDetail = orderResult.data.order
  const items: OrderDetailItem[] = orderResult.data.items

  const totals = aggregateOrderItemFinancials(items)
  const gross = formatNairaFromKobo(totals.grossAmountKobo)
  const fee = formatNairaFromKobo(totals.platformFeeAmountKobo)
  const net = formatNairaFromKobo(totals.vendorNetAmountKobo)
  const fulfillment = order.fulfillment
  const address: ShippingAddress = fulfillment?.shipping_address ?? {}

  return (
    <div className="min-w-0 space-y-6">
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
          Placed on {new Date(order.created_at).toLocaleString("en-NG")}
        </p>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-medium text-zinc-900">Order Info</h2>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <span className="shrink-0 text-zinc-500">Order ID</span>
                <span className="min-w-0 break-all font-medium text-zinc-900 sm:text-right">
                  {order.id}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <span className="shrink-0 text-zinc-500">Date</span>
                <span className="min-w-0 font-medium text-zinc-900 sm:text-right">
                  {new Date(order.created_at).toLocaleDateString("en-NG")}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-4">
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
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-medium text-zinc-900">
              Customer Info
            </h2>
            {fulfillment ? (
              <div className="mt-5 space-y-4 text-sm">
                <div>
                  <p className="text-zinc-500">Email</p>
                  <p className="mt-1 break-words font-medium text-zinc-900">
                    {fulfillment.customer_email}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Phone</p>
                  <p className="mt-1 break-words font-medium text-zinc-900">
                    {fulfillment.customer_phone ?? "Not provided"}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Shipping Address</p>
                  <p className="mt-1 break-words font-medium text-zinc-900">
                    {[address.address, address.city, address.state]
                      .filter(Boolean)
                      .join(", ") || "Not provided"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-zinc-600">
                Fulfillment contact details become available after payment is
                confirmed.
              </p>
            )}
          </section>
        </div>

        <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-medium text-zinc-900">Items</h2>
          <div className="mt-5 space-y-4">
            {items.map((item) => {
              const product = getProduct(item)
              const financial = presentOrderItemSnapshot(item).financial
              const unit = formatNairaFromKobo(financial.unitAmountKobo)
              const itemGross = formatNairaFromKobo(financial.grossAmountKobo)

              return (
                <div
                  key={item.id}
                  className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
                >
                  <Image
                    src={getProductImage(product?.images ?? [])}
                    alt={product?.name ?? "Historical product unavailable"}
                    width={48}
                    height={48}
                    className="row-span-2 size-12 rounded-lg object-cover sm:row-span-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                      {product?.name ?? "Historical product unavailable"}
                    </p>
                    <VariantDetails item={item} />
                    <p className="mt-1 text-xs text-zinc-500">
                      Qty {item.quantity}
                      {unit ? ` × ${unit}` : " · Unit amount unavailable"}
                    </p>
                  </div>
                  <p className="col-start-2 break-words text-sm font-semibold text-zinc-900 sm:col-start-3 sm:row-start-1 sm:shrink-0 sm:text-right">
                    {itemGross ?? "Unavailable"}
                  </p>
                </div>
              )
            })}
          </div>

          <Separator className="my-5" />

          <div className="space-y-3 text-sm">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <span className="min-w-0 text-zinc-500">Vendor gross</span>
              <span className="shrink-0 text-right font-semibold text-zinc-900">
                {gross ?? "Unavailable"}
              </span>
            </div>
            <div className="flex min-w-0 items-start justify-between gap-4">
              <span className="min-w-0 text-zinc-500">
                Recorded platform fee
              </span>
              <span className="shrink-0 text-right font-semibold text-zinc-900">
                {fee ?? "Unavailable"}
              </span>
            </div>
            <div className="flex min-w-0 items-start justify-between gap-4">
              <span className="min-w-0 text-zinc-500">Net earnings</span>
              <span className="shrink-0 text-right font-bold text-emerald-600">
                {net ?? "Unavailable"}
              </span>
            </div>
            {fee === null || net === null ? (
              <p className="text-right text-xs leading-5 text-zinc-500">
                Historical fee and net snapshots are unavailable for one or more
                items. No current fee was applied.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
