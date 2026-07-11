"use client"

import { createBrowserClient } from "@supabase/ssr"
import { Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import type { Vendor } from "@/types"

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function VendorSettingsPage() {
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [storeName, setStoreName] = useState("")
  const [phone, setPhone] = useState("")
  const [bankName, setBankName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [accountName, setAccountName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const loadVendor = async () => {
      setIsLoading(true)
      setError(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (!isMounted) return

      if (userError || !user) {
        setError(userError?.message ?? "Unable to load vendor profile.")
        setIsLoading(false)
        return
      }

      const { data, error: vendorError } = await supabase
        .from("vendors")
        .select("*")
        .eq("user_id", user.id)
        .single()

      if (!isMounted) return

      if (vendorError || !data) {
        setError(vendorError?.message ?? "Vendor profile was not found.")
        setIsLoading(false)
        return
      }

      const nextVendor = data as Vendor
      const bankDetails = nextVendor.bank_details ?? {}

      setVendor(nextVendor)
      setStoreName(nextVendor.name ?? "")
      setPhone(nextVendor.phone ?? "")
      setBankName(bankDetails.bank_name ?? "")
      setAccountNumber(bankDetails.account_number ?? "")
      setAccountName(bankDetails.account_name ?? "")
      setIsLoading(false)
    }

    loadVendor()

    return () => {
      isMounted = false
    }
  }, [])

  const saveVendor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!vendor) {
      toast({
        title: "Could not save changes",
        description: "Vendor profile is still loading.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    setError(null)

    const bankDetails = {
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
    }

    const { data, error: updateError } = await supabase
      .from("vendors")
      .update({
        name: storeName,
        phone,
        bank_details: bankDetails,
      })
      .eq("id", vendor.id)
      .select("*")
      .single()

    setIsSaving(false)

    if (updateError) {
      setError(updateError.message)
      toast({
        title: "Could not save changes",
        description: updateError.message,
        variant: "destructive",
      })
      return
    }

    if (data) {
      setVendor(data as Vendor)
    }

    toast({ title: "Settings saved" })
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
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your store profile and payout bank details.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <form
        onSubmit={saveVendor}
        className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
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
                required
              />
            </label>
            <label>
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
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-medium text-zinc-900">Bank Details</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-sm font-medium text-zinc-700">
                Bank name
              </span>
              <Input
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                className="h-11 rounded-lg border-zinc-200"
              />
            </label>
            <label>
              <span className="mb-2 block text-sm font-medium text-zinc-700">
                Account number
              </span>
              <Input
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                className="h-11 rounded-lg border-zinc-200"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-zinc-700">
                Account name
              </span>
              <Input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                className="h-11 rounded-lg border-zinc-200"
              />
            </label>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isSaving || !vendor}
          className="mt-6 h-11 rounded-lg bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : "Save Changes"}
        </Button>
      </form>
    </div>
  )
}
