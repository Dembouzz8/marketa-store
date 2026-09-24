"use client"

import { CheckCircle2, Loader2, Mail } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

type ForgotPasswordFormProps = {
  recoveryRedirectUrl: string
}

const publicSuccessMessage =
  "If a Marketa account exists for that email, we'll send password recovery instructions."

export function ForgotPasswordForm({
  recoveryRedirectUrl,
}: ForgotPasswordFormProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || isComplete) return

    const normalizedEmail = email.trim().toLowerCase()
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      setEmailError("Enter a valid email address.")
      return
    }

    setIsSubmitting(true)
    setEmailError(null)

    try {
      await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: recoveryRedirectUrl,
      })
    } catch {
      // The public result remains identical to avoid account enumeration.
    } finally {
      setEmail("")
      setIsSubmitting(false)
      setIsComplete(true)
    }
  }

  if (isComplete) {
    return (
      <div
        role="status"
        className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900"
      >
        <p className="flex items-start gap-2 font-medium">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {publicSuccessMessage}
        </p>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
      <div>
        <Label htmlFor="password-recovery-email">Email</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            id="password-recovery-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError(null)
            }}
            aria-invalid={Boolean(emailError)}
            aria-describedby={
              emailError ? "password-recovery-email-error" : undefined
            }
            className="mt-2 h-11 border-zinc-300 bg-white pl-10 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"
          />
        </div>
        {emailError && (
          <p
            id="password-recovery-email-error"
            className="mt-1.5 text-sm text-red-600"
          >
            {emailError}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Requesting recovery...
          </>
        ) : (
          "Send recovery instructions"
        )}
      </Button>
    </form>
  )
}
