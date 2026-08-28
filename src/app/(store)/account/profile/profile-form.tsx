"use client"

import { Loader2, Save } from "lucide-react"
import { useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  saveCustomerProfile,
  type ProfileSaveResult,
} from "../actions"

type ProfileFormProps = {
  initialFullName: string
  initialPhone: string
}

const inputClassName =
  "mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"

export function ProfileForm({
  initialFullName,
  initialPhone,
}: ProfileFormProps) {
  const [fullName, setFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(initialPhone)
  const [result, setResult] = useState<ProfileSaveResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const resultRef = useRef<HTMLDivElement>(null)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return

    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const nextResult = await saveCustomerProfile(formData)

      setResult(nextResult)
      if (nextResult.status === "success" && nextResult.values) {
        setFullName(nextResult.values.full_name)
        setPhone(nextResult.values.phone)
      }

      requestAnimationFrame(() => resultRef.current?.focus())
    })
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-6">
      {result && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role={result.status === "error" ? "alert" : "status"}
          aria-live={result.status === "error" ? "assertive" : "polite"}
          className={`rounded-xl border px-4 py-3 text-sm leading-6 outline-none ${
            result.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}

      <fieldset disabled={isPending} className="space-y-5">
        <legend className="sr-only">Customer profile details</legend>

        <div>
          <Label htmlFor="full_name">Full Name</Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            maxLength={120}
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value)
              setResult(null)
            }}
            aria-invalid={Boolean(result?.fieldErrors?.full_name)}
            aria-describedby={
              result?.fieldErrors?.full_name ? "full_name-error" : "full_name-help"
            }
            className={inputClassName}
          />
          {result?.fieldErrors?.full_name ? (
            <p id="full_name-error" className="mt-1.5 text-sm text-red-600">
              {result.fieldErrors.full_name}
            </p>
          ) : (
            <p id="full_name-help" className="mt-1.5 text-xs text-zinc-500">
              Optional, up to 120 characters.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="phone">Phone Number</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
              setResult(null)
            }}
            aria-invalid={Boolean(result?.fieldErrors?.phone)}
            aria-describedby={
              result?.fieldErrors?.phone ? "phone-error" : "phone-help"
            }
            className={inputClassName}
          />
          {result?.fieldErrors?.phone ? (
            <p id="phone-error" className="mt-1.5 text-sm text-red-600">
              {result.fieldErrors.phone}
            </p>
          ) : (
            <p id="phone-help" className="mt-1.5 text-xs text-zinc-500">
              Optional. Include a country code when appropriate.
            </p>
          )}
        </div>
      </fieldset>

      <Button
        type="submit"
        disabled={isPending}
        className="h-12 w-full gap-2 bg-amber-500 px-6 font-semibold text-zinc-900 hover:bg-amber-400 sm:w-auto"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving profile...
          </>
        ) : (
          <>
            <Save className="size-4" aria-hidden="true" />
            Save profile
          </>
        )}
      </Button>
    </form>
  )
}
