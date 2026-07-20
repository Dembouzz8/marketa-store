import { redirect } from "next/navigation"

import { PayoutTable } from "@/components/vendor/payout-table"
import {
  createSupabaseServerClient,
  supabaseAdmin,
} from "@/lib/supabase-server"
import type { PayoutLedgerEntry } from "@/types"

type ProductJoin = {
  name: string
}

type OrderItemProductRow = {
  order_id: string
  products: ProductJoin | ProductJoin[] | null
}

function getProductName(item: OrderItemProductRow) {
  const product = Array.isArray(item.products)
    ? item.products[0]
    : item.products

  return product?.name
}

export default async function VendorPayoutsPage() {
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

  const { data: entriesData } = await supabase
    .from("payout_ledger")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false })

  const entries = (entriesData ?? []) as PayoutLedgerEntry[]
  const orderIds = [
    ...new Set(entries.map((entry) => entry.order_id).filter(Boolean)),
  ] as string[]
  let orderItems: OrderItemProductRow[] = []

  if (orderIds.length > 0) {
    const { data: orderItemsData } = await supabaseAdmin
      .from("order_items")
      .select("order_id, products(name)")
      .in("order_id", orderIds)
      .eq("vendor_id", vendor.id)

    orderItems = (orderItemsData ?? []) as OrderItemProductRow[]
  }

  const orderProductMap = new Map<string, string[]>()
  orderItems.forEach((item) => {
    const existing = orderProductMap.get(item.order_id) ?? []
    const productName = getProductName(item)

    if (productName) {
      existing.push(productName)
    }

    orderProductMap.set(item.order_id, existing)
  })

  const enrichedEntries = entries.map((entry) => ({
    ...entry,
    product_names: entry.order_id
      ? (orderProductMap.get(entry.order_id) ?? []).join(", ")
      : null,
  }))
  const totalCredits = entries
    .filter((entry) => entry.type === "credit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const totalDebits = entries
    .filter((entry) => entry.type === "debit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const balance = totalCredits - totalDebits

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900">Payouts</h1>
      <PayoutTable entries={enrichedEntries} balance={balance} />
    </div>
  )
}
