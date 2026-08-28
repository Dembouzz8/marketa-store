"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

export type ProfileSaveResult = {
  status: "success" | "error"
  message: string
  fieldErrors?: {
    full_name?: string
    phone?: string
  }
  values?: {
    full_name: string
    phone: string
  }
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null

  const normalized = value.trim()
  return normalized || null
}

export async function saveCustomerProfile(
  formData: FormData
): Promise<ProfileSaveResult> {
  const fullName = normalizeOptionalText(formData.get("full_name"))
  const phone = normalizeOptionalText(formData.get("phone"))
  const fieldErrors: NonNullable<ProfileSaveResult["fieldErrors"]> = {}

  if (fullName && fullName.length > 120) {
    fieldErrors.full_name = "Full name must be 120 characters or fewer."
  }

  if (phone && phone.length > 32) {
    fieldErrors.phone = "Phone number must be 32 characters or fewer."
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
    }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      status: "error",
      message: "Your session has expired. Please sign in again.",
    }
  }

  const { data: existingProfile, error: readError } = await supabase
    .from("customer_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (readError) {
    return {
      status: "error",
      message: "We couldn't save your profile right now. Please try again.",
    }
  }

  if (existingProfile) {
    const { data: updatedProfile, error: updateError } = await supabase
      .from("customer_profiles")
      .update({
        full_name: fullName,
        phone,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .select("user_id")
      .maybeSingle()

    if (updateError || !updatedProfile) {
      return {
        status: "error",
        message: "We couldn't save your profile right now. Please try again.",
      }
    }
  } else {
    const { error: insertError } = await supabase
      .from("customer_profiles")
      .insert({
        user_id: user.id,
        full_name: fullName,
        phone,
      })

    if (insertError) {
      return {
        status: "error",
        message: "We couldn't save your profile right now. Please try again.",
      }
    }
  }

  revalidatePath("/account/profile")

  return {
    status: "success",
    message: "Profile saved.",
    values: {
      full_name: fullName ?? "",
      phone: phone ?? "",
    },
  }
}

export async function signOutCustomer() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect("/account/login")
}
