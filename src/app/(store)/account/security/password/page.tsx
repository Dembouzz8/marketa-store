import Link from "next/link"
import { KeyRound } from "lucide-react"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

import { PasswordForm } from "./password-form"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function PasswordUnavailable() {
  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Password setup unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          We couldn&apos;t verify that this session can update a password. Keep
          this session signed in and try again later or contact support.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          Return to Marketa
        </Link>
      </section>
    </main>
  )
}

export default async function AccountPasswordPage() {
  let userResult

  try {
    const supabase = await createSupabaseServerClient()
    userResult = await supabase.auth.getUser()
  } catch {
    return <PasswordUnavailable />
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
    return <PasswordUnavailable />
  }

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <KeyRound className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
          Set your Marketa password
        </h1>
        <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-600">
          <p>
            This password belongs to your Marketa account. You will use the
            same password for customer and seller sign-in.
          </p>
          <p>
            If you joined through a seller invitation and have never chosen a
            password, set one before signing out.
          </p>
          <p>
            If you already know your Marketa password, you do not have to
            change it because seller enrollment completed.
          </p>
        </div>

        <PasswordForm />

        <Link
          href="/vendor/dashboard"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          Continue to seller dashboard
        </Link>
      </section>
    </main>
  )
}
