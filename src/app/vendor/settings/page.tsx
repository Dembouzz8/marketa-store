"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
import type { Vendor } from "@/types"

export default function VendorSettingsPage() {
  const router = useRouter()
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [storeName, setStoreName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [bankName, setBankName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [accountName, setAccountName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingStore, setIsSavingStore] = useState(false)
  const [isSavingBank, setIsSavingBank] = useState(false)

  useEffect(() => {
    const loadVendor = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/vendor/login")
        return
      }

      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("user_id", user.id)
        .single()

      if (error || !data) {
        router.push("/vendor/login?error=not_a_vendor")
        return
      }

      const nextVendor = data as Vendor
      const bankDetails = nextVendor.bank_details ?? {}

      setVendor(nextVendor)
      setStoreName(nextVendor.name)
      setEmail(nextVendor.email)
      setPhone(nextVendor.phone ?? "")
      setBankName(bankDetails.bank_name ?? "")
      setAccountNumber(bankDetails.account_number ?? "")
      setAccountName(bankDetails.account_name ?? "")
      setIsLoading(false)
    }

    loadVendor()
  }, [router])

  const saveVendor = async (saving: "store" | "bank") => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.push("/vendor/login")
      return
    }

    if (saving === "store") setIsSavingStore(true)
    if (saving === "bank") setIsSavingBank(true)

    const { error } = await supabase
      .from("vendors")
      .update({
        name: storeName,
        phone,
        bank_details: {
          bank_name: bankName,
          account_number: accountNumber,
          account_name: accountName,
        },
      })
      .eq("user_id", user.id)

    if (saving === "store") setIsSavingStore(false)
    if (saving === "bank") setIsSavingBank(false)

    if (error) {
      toast({
        title: "Could not save changes",
        description: error.message,
        variant: "destructive",
      })
      return
    }

    toast({ title: "Changes saved" })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900">Settings</h1>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-zinc-900">
          Store Information
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label>
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Store name
            </span>
            <Input
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              className="h-11 rounded-lg border-zinc-200"
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Email
            </span>
            <Input
              value={email}
              readOnly
              className="h-11 rounded-lg border-zinc-200 bg-zinc-100 text-zinc-500"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Phone number
            </span>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="h-11 rounded-lg border-zinc-200"
            />
          </label>
        </div>
        <Button
          type="button"
          onClick={() => saveVendor("store")}
          disabled={isSavingStore}
          className="mt-5 h-11 rounded-lg bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
        >
          {isSavingStore ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Save Changes"
          )}
        </Button>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-zinc-900">Bank Details</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label>
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Bank Name
            </span>
            <Input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              className="h-11 rounded-lg border-zinc-200"
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Account Number
            </span>
            <Input
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              className="h-11 rounded-lg border-zinc-200"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Account Name
            </span>
            <Input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              className="h-11 rounded-lg border-zinc-200"
            />
          </label>
        </div>
        <Button
          type="button"
          onClick={() => saveVendor("bank")}
          disabled={isSavingBank}
          className="mt-5 h-11 rounded-lg bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
        >
          {isSavingBank ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Save Changes"
          )}
        </Button>
      </section>

      {vendor && (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-zinc-900">Account</h2>
          <div className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-zinc-500">Member since</p>
              <p className="mt-1 font-medium text-zinc-900">
                {new Date(vendor.created_at).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Platform fee</p>
              <p className="mt-1 font-medium text-zinc-900">
                {vendor.platform_fee_pct}%
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Vendor ID</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-900">
                {vendor.id}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
