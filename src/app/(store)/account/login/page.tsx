"use client"

import Link from "next/link"
import { Loader2, LockKeyhole, Mail, UserRound } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

type LoginErrors = Partial<Record<"email" | "password" | "form", string>>

const inputClassName =
  "mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"

export default function CustomerLoginPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<LoginErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const normalizedEmail = email.trim().toLowerCase()
    const nextErrors: LoginErrors = {}

    if (!normalizedEmail) {
      nextErrors.email = "Enter your email address."
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = "Enter a valid email address."
    }

    if (!password) {
      nextErrors.password = "Enter your password."
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (error) {
        setErrors({
          form: "We couldn't sign you in. Check your email and password and try again.",
        })
        return
      }

      window.location.assign("/account")
    } catch {
      setErrors({
        form: "We couldn't sign you in right now. Please try again.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <UserRound className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
            Customer Login
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Sign in to your Marketa customer account. You can always shop and
            check out without an account.
          </p>
        </div>

        <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
          {errors.form && (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
            >
              {errors.form}
            </p>
          )}

          <fieldset disabled={isSubmitting} className="space-y-5">
            <legend className="sr-only">Customer login details</legend>

            <div>
              <Label htmlFor="customer-login-email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="customer-login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setErrors((current) => ({
                      ...current,
                      email: undefined,
                      form: undefined,
                    }))
                  }}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "customer-login-email-error" : undefined}
                  className={`${inputClassName} pl-10`}
                  required
                />
              </div>
              {errors.email && (
                <p id="customer-login-email-error" className="mt-1.5 text-sm text-red-600">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="customer-login-password">Password</Label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="customer-login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setErrors((current) => ({
                      ...current,
                      password: undefined,
                      form: undefined,
                    }))
                  }}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "customer-login-password-error" : undefined
                  }
                  className={`${inputClassName} pl-10`}
                  required
                />
              </div>
              {errors.password && (
                <p
                  id="customer-login-password-error"
                  className="mt-1.5 text-sm text-red-600"
                >
                  {errors.password}
                </p>
              )}
            </div>
          </fieldset>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600">
          Don&apos;t have an account?{" "}
          <Link
            href="/account/register"
            className="font-semibold text-amber-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  )
}
