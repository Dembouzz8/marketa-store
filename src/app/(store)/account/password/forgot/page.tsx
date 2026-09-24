import Link from "next/link"
import { KeyRound } from "lucide-react"

import { ForgotPasswordForm } from "./forgot-password-form"

export const dynamic = "force-dynamic"

function recoveryRedirectUrl(): string | null {
  const configuredSiteUrl = process.env.MARKETA_SITE_URL
  if (!configuredSiteUrl) return null
  if (
    configuredSiteUrl !== configuredSiteUrl.trim() ||
    !configuredSiteUrl.startsWith("https://") ||
    /[\s\\]/u.test(configuredSiteUrl) ||
    configuredSiteUrl.includes("?") ||
    configuredSiteUrl.includes("#")
  ) {
    return null
  }

  let marketaSiteUrl: URL
  try {
    marketaSiteUrl = new URL(configuredSiteUrl)
  } catch {
    return null
  }

  if (
    marketaSiteUrl.protocol !== "https:" ||
    marketaSiteUrl.username !== "" ||
    marketaSiteUrl.password !== "" ||
    marketaSiteUrl.pathname !== "/" ||
    marketaSiteUrl.search !== "" ||
    marketaSiteUrl.hash !== "" ||
    marketaSiteUrl.hostname === ""
  ) {
    return null
  }

  return new URL("/account/auth/recovery", marketaSiteUrl).toString()
}

export default function ForgotPasswordPage() {
  const redirectUrl = recoveryRedirectUrl()

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <KeyRound className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-center text-3xl font-semibold tracking-tight text-zinc-900">
          Recover your Marketa password
        </h1>
        <p className="mt-3 text-center text-sm leading-6 text-zinc-600">
          Enter the email for your shared Marketa account. Recovery applies to
          both customer and seller sign-in.
        </p>

        {redirectUrl ? (
          <ForgotPasswordForm recoveryRedirectUrl={redirectUrl} />
        ) : (
          <p
            role="alert"
            className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          >
            Password recovery is temporarily unavailable. Please try again
            later or contact support.
          </p>
        )}

        <Link
          href="/account/login"
          className="mt-6 block text-center text-sm font-semibold text-amber-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          Return to login
        </Link>
      </section>
    </main>
  )
}
