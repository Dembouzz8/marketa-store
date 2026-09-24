"use client"

import Link from "next/link"
import { CheckCircle2, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

const minimumPasswordLength = 8

type PasswordErrors = Partial<
  Record<"password" | "confirmPassword" | "form", string>
>

type PasswordFormProps = {
  mode?: "setup" | "recovery"
}

export function PasswordForm({ mode = "setup" }: PasswordFormProps = {}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccessful, setIsSuccessful] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const nextErrors: PasswordErrors = {}

    if (!password) {
      nextErrors.password = "Enter a new password."
    } else if (password.length < minimumPasswordLength) {
      nextErrors.password = `Use at least ${minimumPasswordLength} characters.`
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = "Confirm your new password."
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match."
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      setIsSuccessful(false)
      return
    }

    setIsSubmitting(true)
    setErrors({})
    setIsSuccessful(false)

    try {
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setErrors({
          form:
            error.code === "weak_password"
              ? "Choose a stronger password that meets Marketa's password requirements."
              : "We couldn't update your password from this session. Keep this session signed in and try again later or contact support.",
        })
        return
      }

      setPassword("")
      setConfirmPassword("")
      setIsSuccessful(true)
    } catch {
      setErrors({
        form: "We couldn't update your password from this session. Keep this session signed in and try again later or contact support.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
      <div>
        <Label htmlFor="marketa-new-password">New password</Label>
        <Input
          id="marketa-new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minimumPasswordLength}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setErrors((current) => ({ ...current, password: undefined, form: undefined }))
            setIsSuccessful(false)
          }}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "marketa-new-password-error" : undefined}
          className="mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"
        />
        {errors.password && (
          <p id="marketa-new-password-error" className="mt-2 text-sm text-red-600">
            {errors.password}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="marketa-confirm-password">Confirm password</Label>
        <Input
          id="marketa-confirm-password"
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
            setIsSuccessful(false)
          }}
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={
            errors.confirmPassword ? "marketa-confirm-password-error" : undefined
          }
          className="mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"
        />
        {errors.confirmPassword && (
          <p id="marketa-confirm-password-error" className="mt-2 text-sm text-red-600">
            {errors.confirmPassword}
          </p>
        )}
      </div>

      {errors.form && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {errors.form}
        </p>
      )}

      {isSuccessful && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            {mode === "recovery"
              ? "Your Marketa password has been reset."
              : "Your Marketa password has been set."}
          </p>
          <p className="mt-2 leading-6">
            You can use it for both customer and seller sign-in.
          </p>
          {mode === "recovery" ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/account/login" className="font-semibold underline underline-offset-4">
                Customer login
              </Link>
              <Link href="/vendor/login" className="font-semibold underline underline-offset-4">
                Seller login
              </Link>
              <Link href="/" className="font-semibold underline underline-offset-4">
                Marketa home
              </Link>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/vendor/dashboard" className="font-semibold underline underline-offset-4">
                Seller dashboard
              </Link>
              <Link href="/" className="font-semibold underline underline-offset-4">
                Marketa home
              </Link>
            </div>
          )}
        </div>
      )}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Setting password...
          </>
        ) : (
          mode === "recovery" ? "Reset password" : "Set password"
        )}
      </Button>
    </form>
  )
}
