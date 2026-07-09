import { redirect } from "next/navigation"

import { PayoutTable } from "@/components/vendor/payout-table"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import type { PayoutLedgerEntry } from "@/types"

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
      <PayoutTable entries={entries} balance={balance} />
    </div>
  )
}
