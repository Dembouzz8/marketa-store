"use client"

import Link from "next/link"
import { CheckCircle2, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"

interface ApplicationValues {
  business_name: string
  contact_name: string
  email: string
  phone: string
  business_category: string
  location: string
  business_description: string
  product_summary: string
  experience: string
  terms_accepted: boolean
}

type TextFieldName = Exclude<keyof ApplicationValues, "terms_accepted">
type FormErrors = Partial<Record<keyof ApplicationValues | "form", string>>

interface ApplicationOutcome {
  outcome: string
  application_id: string | null
}

const initialValues: ApplicationValues = {
  business_name: "",
  contact_name: "",
  email: "",
  phone: "",
  business_category: "",
  location: "",
  business_description: "",
  product_summary: "",
  experience: "",
  terms_accepted: false,
}

const fieldLimits: Record<TextFieldName, number> = {
  business_name: 120,
  contact_name: 120,
  email: 254,
  phone: 32,
  business_category: 100,
  location: 160,
  business_description: 2000,
  product_summary: 2000,
  experience: 2000,
}

const requiredFields: TextFieldName[] = [
  "business_name",
  "contact_name",
  "email",
  "phone",
  "business_category",
  "location",
  "business_description",
  "product_summary",
]

const fieldLabels: Record<TextFieldName, string> = {
  business_name: "Business Name",
  contact_name: "Contact Name",
  email: "Email Address",
  phone: "Phone Number",
  business_category: "Business Category",
  location: "Business Location",
  business_description: "Business Description",
  product_summary: "Products You Plan to Sell",
  experience: "Selling Experience",
}

const inputClassName =
  "h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"

const textareaClassName =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-amber-500 focus-visible:ring-3 focus-visible:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-70"

function FieldError({ field, message }: { field: string; message?: string }) {
  if (!message) return null

  return (
    <p id={`${field}-error`} className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  )
}

export function ApplicationForm() {
  const [values, setValues] = useState<ApplicationValues>(initialValues)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [hasDuplicate, setHasDuplicate] = useState(false)
  const outcomeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSubmitted || hasDuplicate || errors.form) {
      outcomeRef.current?.focus()
    }
  }, [errors.form, hasDuplicate, isSubmitted])

  const updateTextField = (field: TextFieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
    setHasDuplicate(false)
  }

  const validate = () => {
    const normalized: ApplicationValues = {
      ...values,
      business_name: values.business_name.trim(),
      contact_name: values.contact_name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: values.phone.trim(),
      business_category: values.business_category.trim(),
      location: values.location.trim(),
      business_description: values.business_description.trim(),
      product_summary: values.product_summary.trim(),
      experience: values.experience.trim(),
    }
    const nextErrors: FormErrors = {}

    requiredFields.forEach((field) => {
      if (!normalized[field]) {
        nextErrors[field] = `${fieldLabels[field]} is required.`
      }
    })

    ;(Object.keys(fieldLimits) as TextFieldName[]).forEach((field) => {
      if (normalized[field].length > fieldLimits[field]) {
        nextErrors[field] = `${fieldLabels[field]} must be ${fieldLimits[field]} characters or fewer.`
      }
    })

    if (
      normalized.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
    ) {
      nextErrors.email = "Enter a valid email address."
    }

    if (!normalized.terms_accepted) {
      nextErrors.terms_accepted = "You must accept the acknowledgement to apply."
    }

    setValues(normalized)
    setErrors(nextErrors)

    const firstInvalidField = Object.keys(nextErrors)[0]
    if (firstInvalidField) {
      requestAnimationFrame(() =>
        document.getElementById(firstInvalidField)?.focus()
      )
    }

    return { isValid: Object.keys(nextErrors).length === 0, normalized }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    setHasDuplicate(false)
    const { isValid, normalized } = validate()
    if (!isValid) return

    setIsSubmitting(true)
    setErrors({})

    try {
      const { data, error } = await supabase.rpc("submit_vendor_application", {
        p_business_name: normalized.business_name,
        p_contact_name: normalized.contact_name,
        p_email: normalized.email,
        p_phone: normalized.phone,
        p_business_category: normalized.business_category,
        p_location: normalized.location,
        p_business_description: normalized.business_description,
        p_product_summary: normalized.product_summary,
        p_experience: normalized.experience || null,
        p_terms_accepted: normalized.terms_accepted,
      })

      if (error) {
        setErrors({
          form: "We could not submit your application. Please try again.",
        })
        return
      }

      const result = (data as ApplicationOutcome[] | null)?.[0]

      if (
        result?.outcome === "submitted" &&
        typeof result.application_id === "string"
      ) {
        setIsSubmitted(true)
        return
      }

      if (
        result?.outcome === "duplicate_active_application" &&
        result.application_id === null
      ) {
        setHasDuplicate(true)
        return
      }

      setErrors({
        form: "We could not submit your application. Please try again.",
      })
    } catch {
      setErrors({
        form: "We could not submit your application. Please try again.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSubmitted) {
    return (
      <div
        ref={outcomeRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-200 bg-white px-6 py-12 text-center shadow-sm outline-none sm:px-10 sm:py-16"
      >
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="size-9" aria-hidden="true" />
        </span>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-900">
          Application submitted
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-zinc-600">
          Your seller application has been received and will be reviewed.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/sell-with-us"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            Back to Sell With Us
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            Visit the marketplace
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="border-b border-zinc-200 px-5 py-6 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Business details
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          All fields are required unless marked optional.
        </p>
      </div>

      <div className="space-y-8 px-5 py-7 sm:px-8 sm:py-8">
        {(hasDuplicate || errors.form) && (
          <div
            ref={outcomeRef}
            tabIndex={-1}
            role="alert"
            aria-live="assertive"
            className={`rounded-xl border px-4 py-3 text-sm leading-6 outline-none ${
              hasDuplicate
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {hasDuplicate
              ? "We already have an active application for this email address."
              : errors.form}
          </div>
        )}

        <fieldset disabled={isSubmitting} className="space-y-8">
          <legend className="sr-only">Seller application details</legend>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="business_name">Business Name</Label>
              <Input
                id="business_name"
                name="business_name"
                autoComplete="organization"
                maxLength={fieldLimits.business_name}
                value={values.business_name}
                onChange={(event) =>
                  updateTextField("business_name", event.target.value)
                }
                aria-invalid={Boolean(errors.business_name)}
                aria-describedby={errors.business_name ? "business_name-error" : undefined}
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError field="business_name" message={errors.business_name} />
            </div>

            <div>
              <Label htmlFor="contact_name">Contact Name</Label>
              <Input
                id="contact_name"
                name="contact_name"
                autoComplete="name"
                maxLength={fieldLimits.contact_name}
                value={values.contact_name}
                onChange={(event) =>
                  updateTextField("contact_name", event.target.value)
                }
                aria-invalid={Boolean(errors.contact_name)}
                aria-describedby={errors.contact_name ? "contact_name-error" : undefined}
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError field="contact_name" message={errors.contact_name} />
            </div>

            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={fieldLimits.email}
                value={values.email}
                onChange={(event) => updateTextField("email", event.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError field="email" message={errors.email} />
            </div>

            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={fieldLimits.phone}
                value={values.phone}
                onChange={(event) => updateTextField("phone", event.target.value)}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? "phone-error" : undefined}
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError field="phone" message={errors.phone} />
            </div>

            <div>
              <Label htmlFor="business_category">Business Category</Label>
              <Input
                id="business_category"
                name="business_category"
                maxLength={fieldLimits.business_category}
                placeholder="For example, Fashion or Food & Drinks"
                value={values.business_category}
                onChange={(event) =>
                  updateTextField("business_category", event.target.value)
                }
                aria-invalid={Boolean(errors.business_category)}
                aria-describedby={
                  errors.business_category ? "business_category-error" : undefined
                }
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError
                field="business_category"
                message={errors.business_category}
              />
            </div>

            <div>
              <Label htmlFor="location">Business Location</Label>
              <Input
                id="location"
                name="location"
                autoComplete="address-level1"
                maxLength={fieldLimits.location}
                placeholder="City and state"
                value={values.location}
                onChange={(event) => updateTextField("location", event.target.value)}
                aria-invalid={Boolean(errors.location)}
                aria-describedby={errors.location ? "location-error" : undefined}
                className={`mt-2 ${inputClassName}`}
                required
              />
              <FieldError field="location" message={errors.location} />
            </div>
          </div>

          <div className="space-y-5 border-t border-zinc-200 pt-8">
            <div>
              <Label htmlFor="business_description">Business Description</Label>
              <textarea
                id="business_description"
                name="business_description"
                rows={5}
                maxLength={fieldLimits.business_description}
                value={values.business_description}
                onChange={(event) =>
                  updateTextField("business_description", event.target.value)
                }
                aria-invalid={Boolean(errors.business_description)}
                aria-describedby={
                  errors.business_description
                    ? "business_description-error"
                    : undefined
                }
                className={`mt-2 ${textareaClassName}`}
                required
              />
              <FieldError
                field="business_description"
                message={errors.business_description}
              />
            </div>

            <div>
              <Label htmlFor="product_summary">Products You Plan to Sell</Label>
              <textarea
                id="product_summary"
                name="product_summary"
                rows={5}
                maxLength={fieldLimits.product_summary}
                value={values.product_summary}
                onChange={(event) =>
                  updateTextField("product_summary", event.target.value)
                }
                aria-invalid={Boolean(errors.product_summary)}
                aria-describedby={
                  errors.product_summary ? "product_summary-error" : undefined
                }
                className={`mt-2 ${textareaClassName}`}
                required
              />
              <FieldError field="product_summary" message={errors.product_summary} />
            </div>

            <div>
              <Label htmlFor="experience">
                Selling Experience <span className="font-normal text-zinc-500">(optional)</span>
              </Label>
              <textarea
                id="experience"
                name="experience"
                rows={4}
                maxLength={fieldLimits.experience}
                value={values.experience}
                onChange={(event) =>
                  updateTextField("experience", event.target.value)
                }
                aria-invalid={Boolean(errors.experience)}
                aria-describedby={errors.experience ? "experience-error" : undefined}
                className={`mt-2 ${textareaClassName}`}
              />
              <FieldError field="experience" message={errors.experience} />
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-8">
            <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <input
                id="terms_accepted"
                name="terms_accepted"
                type="checkbox"
                checked={values.terms_accepted}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    terms_accepted: event.target.checked,
                  }))
                  setErrors((current) => ({
                    ...current,
                    terms_accepted: undefined,
                    form: undefined,
                  }))
                  setHasDuplicate(false)
                }}
                aria-invalid={Boolean(errors.terms_accepted)}
                aria-describedby={
                  errors.terms_accepted ? "terms_accepted-error" : undefined
                }
                className="mt-0.5 size-5 shrink-0 rounded border-zinc-300 accent-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                required
              />
              <div>
                <Label htmlFor="terms_accepted" className="leading-6 text-zinc-700">
                  I confirm that the information provided is accurate and I agree
                  to Marketa&apos;s seller application review process.
                </Label>
                <FieldError
                  field="terms_accepted"
                  message={errors.terms_accepted}
                />
              </div>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-zinc-500">
            Submitting an application does not create a vendor account.
          </p>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-12 bg-amber-500 px-7 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Submitting application...
              </>
            ) : (
              "Submit application"
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
