"use client"

import Link from "next/link"
import { CheckCircle2, Loader2, LockKeyhole, Mail, UserPlus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

type RegisterErrors = Partial<
  Record<"email" | "password" | "confirmPassword" | "form", string>
>

const minimumPasswordLength = 6
const inputClassName =
  "mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"

export default function CustomerRegisterPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const normalizedEmail = email.trim().toLowerCase()
    const nextErrors: RegisterErrors = {}

    if (!normalizedEmail) {
      nextErrors.email = "Enter your email address."
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = "Enter a valid email address."
    }

    if (!password) {
      nextErrors.password = "Create a password."
    } else if (password.length < minimumPasswordLength) {
      nextErrors.password = `Use at least ${minimumPasswordLength} characters.`
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = "Confirm your password."
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match."
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account/auth/callback`,
        },
      })

      if (error) {
        setErrors({
          form: "We couldn't create your account. Please check your details and try again.",
        })
        return
      }

      if (data.session) {
        window.location.assign("/account/profile?setup=1")
        return
      }

      setIsAwaitingConfirmation(true)
    } catch {
      setErrors({
        form: "We couldn't create your account right now. Please try again.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isAwaitingConfirmation) {
    return (
      <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
        <div
          role="status"
          aria-live="polite"
          className="mx-auto w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm sm:p-8"
        >
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="size-9" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-900">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            If confirmation is required, use the link sent to your email to
            continue to required profile setup.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/account/login"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Go to login
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Continue shopping
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <UserPlus className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
            Create Customer Account
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Create an account, then add your required name and phone number
            before purchasing.
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
            <legend className="sr-only">Customer registration details</legend>

            <div>
              <Label htmlFor="customer-register-email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="customer-register-email"
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
                  aria-describedby={
                    errors.email ? "customer-register-email-error" : undefined
                  }
                  className={`${inputClassName} pl-10`}
                  required
                />
              </div>
              {errors.email && (
                <p
                  id="customer-register-email-error"
                  className="mt-1.5 text-sm text-red-600"
                >
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="customer-register-password">Password</Label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="customer-register-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={minimumPasswordLength}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setErrors((current) => ({
                      ...current,
                      password: undefined,
                      confirmPassword: undefined,
                      form: undefined,
                    }))
                  }}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "customer-register-password-error" : undefined
                  }
                  className={`${inputClassName} pl-10`}
                  required
                />
              </div>
              {errors.password ? (
                <p
                  id="customer-register-password-error"
                  className="mt-1.5 text-sm text-red-600"
                >
                  {errors.password}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-zinc-500">
                  Use at least {minimumPasswordLength} characters.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="customer-register-confirm-password">
                Confirm Password
              </Label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="customer-register-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={minimumPasswordLength}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    setErrors((current) => ({
                      ...current,
                      confirmPassword: undefined,
                      form: undefined,
                    }))
                  }}
                  aria-invalid={Boolean(errors.confirmPassword)}
                  aria-describedby={
                    errors.confirmPassword
                      ? "customer-register-confirm-password-error"
                      : undefined
                  }
                  className={`${inputClassName} pl-10`}
                  required
                />
              </div>
              {errors.confirmPassword && (
                <p
                  id="customer-register-confirm-password-error"
                  className="mt-1.5 text-sm text-red-600"
                >
                  {errors.confirmPassword}
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
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600">
          Already have an account?{" "}
          <Link
            href="/account/login"
            className="font-semibold text-amber-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  )
}
