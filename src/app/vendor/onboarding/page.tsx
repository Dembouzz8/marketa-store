import Link from "next/link"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"
import {
  getSellerEnrollmentState,
  type SellerEnrollmentState,
} from "@/lib/vendor/finalization"

import { FinalizationForm } from "./finalization-form"

export const dynamic = "force-dynamic"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const stateMessages: Record<Exclude<SellerEnrollmentState, "ready">, string> = {
  already_finalized: "Your seller account has already been created.",
  email_unconfirmed:
    "Confirm your account email before creating your seller account.",
  no_pending_enrollment:
    "Seller enrollment is not currently ready for this account.",
  identity_mismatch:
    "We couldn't verify this seller enrollment against your account. Contact support.",
  reconciliation_required:
    "Seller account status requires review. Do not retry enrollment until it has been checked.",
  service_unavailable:
    "We couldn't load seller enrollment right now. Try again later.",
}

function EnrollmentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Marketa sellers</p>
        {children}
      </div>
    </main>
  )
}

function NonReadyState({
  state,
}: {
  state: Exclude<SellerEnrollmentState, "ready">
}) {
  return (
    <EnrollmentShell>
      <h1 className="mt-3 text-3xl font-semibold text-zinc-900">
        Seller enrollment
      </h1>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        {stateMessages[state]}
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
      >
        Continue shopping
      </Link>
    </EnrollmentShell>
  )
}

function ReadyState() {
  return (
    <EnrollmentShell>
      <h1 className="mt-3 text-3xl font-semibold text-zinc-900">
        Create your seller account
      </h1>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Your seller application has been approved. This action creates your
        seller account and connects it to your store.
      </p>
      <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-600">
        <li>Your store begins inactive.</li>
        <li>Store activation happens separately.</li>
        <li>Seller verification happens separately.</li>
        <li>
          Products are not eligible for normal marketplace purchase until your
          store is activated.
        </li>
      </ul>
      <FinalizationForm />
      <Link
        href="/"
        className="mt-5 inline-block text-sm font-medium text-amber-700 underline"
      >
        Continue shopping
      </Link>
    </EnrollmentShell>
  )
}

export default async function VendorOnboardingPage() {
  let supabase
  try {
    supabase = await createSupabaseServerClient()
  } catch {
    return <NonReadyState state="service_unavailable" />
  }

  let userResult
  try {
    userResult = await supabase.auth.getUser()
  } catch {
    return <NonReadyState state="service_unavailable" />
  }

  const {
    data: { user },
    error: userError,
  } = userResult
  if (!user) redirect("/account/login?vendor_onboarding=1")
  if (userError) return <NonReadyState state="service_unavailable" />

  if (!UUID_PATTERN.test(user.id)) {
    return <NonReadyState state="identity_mismatch" />
  }

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (vendorError) return <NonReadyState state="service_unavailable" />
  if (vendor) redirect("/vendor/dashboard")

  if (!user.email || !user.email.trim()) {
    return <NonReadyState state="identity_mismatch" />
  }
  if (!user.email_confirmed_at) {
    return <NonReadyState state="email_unconfirmed" />
  }

  const state = await getSellerEnrollmentState({
    userId: user.id,
    normalizedEmail: user.email.trim().toLowerCase(),
  })

  if (state === "already_finalized") redirect("/vendor/dashboard")
  if (state === "ready") return <ReadyState />
  return <NonReadyState state={state} />
}
