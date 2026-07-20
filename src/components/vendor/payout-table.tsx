"use client"

import { Wallet } from "lucide-react"

import { cn, formatNaira } from "@/lib/utils"
import type { PayoutLedgerEntry } from "@/types"

type EnrichedPayoutLedgerEntry = PayoutLedgerEntry & {
  product_names?: string | null
}

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

interface PayoutTableProps {
  entries: EnrichedPayoutLedgerEntry[]
  balance: number
}

export function PayoutTable({ entries, balance }: PayoutTableProps) {
  const totalCredits = entries
    .filter((entry) => entry.type === "credit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const totalDebits = entries
    .filter((entry) => entry.type === "debit")
    .reduce((sum, entry) => sum + Number(entry.amount), 0)

  let runningBalance = balance
  const rows = entries.map((entry) => {
    const currentBalance = runningBalance
    runningBalance =
      entry.type === "credit"
        ? runningBalance - Number(entry.amount)
        : runningBalance + Number(entry.amount)

    return {
      entry,
      runningBalance: currentBalance,
    }
  })

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">
              Current Balance
            </p>
            <p className="mt-2 text-4xl font-bold text-emerald-600">
              {formatNaira(balance)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">Available for payout</p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Wallet className="size-6" />
          </div>
        </div>
        <p className="mt-6 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          Payouts are processed automatically at T+7 days
        </p>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-700">
              Total Credits
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-700">
              {formatNaira(totalCredits)}
            </p>
          </div>
          <div className="rounded-lg bg-red-50 p-3">
            <p className="text-xs font-medium text-red-700">Total Debits</p>
            <p className="mt-1 text-lg font-bold text-red-700">
              {formatNaira(totalDebits)}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs font-medium text-zinc-600">Net Balance</p>
            <p className="mt-1 text-lg font-bold text-zinc-900">
              {formatNaira(balance)}
            </p>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <Wallet className="mx-auto size-16 text-zinc-200" />
            <h2 className="mt-4 text-lg font-medium text-zinc-900">
              No transactions yet
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Credits and debits will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px]">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Date
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Description
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Order ID
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Type
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Amount
                  </th>
                  <th className="px-3 py-3 text-xs font-medium uppercase text-zinc-500">
                    Running Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry, runningBalance: rowBalance }) => (
                  <tr key={entry.id} className="border-b border-zinc-100">
                    <td className="px-3 py-4 text-sm text-zinc-900">
                      {dateFormatter.format(new Date(entry.created_at))}
                    </td>
                    <td className="px-3 py-4 text-sm text-zinc-900">
                      {entry.product_names ? (
                        <div>
                          <p className="font-semibold text-zinc-900">
                            {entry.product_names}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {entry.type === "credit"
                              ? "Sale credit"
                              : "Refund reversal"}
                          </p>
                        </div>
                      ) : (
                        entry.description ?? entry.reference
                      )}
                    </td>
                    <td className="px-3 py-4 font-mono text-xs text-zinc-500">
                      {entry.order_id ? `#${entry.order_id.slice(0, 8)}` : "-"}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                          entry.type === "credit"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        )}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-4 text-sm font-semibold",
                        entry.type === "credit"
                          ? "text-emerald-600"
                          : "text-red-600"
                      )}
                    >
                      {entry.type === "credit" ? "+" : "-"}
                      {formatNaira(entry.amount)}
                    </td>
                    <td className="px-3 py-4 text-sm font-semibold text-zinc-900">
                      {formatNaira(rowBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
