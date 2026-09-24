import Link from "next/link"
import { KeyRound } from "lucide-react"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

import { PasswordForm } from "../../security/password/password-form"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function RecoveryUnavailable() {
  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Password reset unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          We couldn&apos;t verify a recovery session. Request new password
          recovery instructions and try again.
        </p>
        <Link
          href="/account/password/forgot"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          Request recovery instructions
        </Link>
      </section>
    </main>
  )
}

export default async function ResetPasswordPage() {
  let userResult

  try {
    const supabase = await createSupabaseServerClient()
    userResult = await supabase.auth.getUser()
  } catch {
    return <RecoveryUnavailable />
  }

  const {
    data: { user },
    error,
  } = userResult

  if (!user) redirect("/account/login")

  if (
    error ||
    !UUID_PATTERN.test(user.id) ||
    !user.email?.trim() ||
    !user.email_confirmed_at
  ) {
    return <RecoveryUnavailable />
  }

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <KeyRound className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
          Reset your Marketa password
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          This changes the password for your shared Marketa account. The same
          new password works for customer sign-in and, if you are also a
          seller, seller sign-in.
        </p>

        <PasswordForm mode="recovery" />
      </section>
    </main>
  )
}
