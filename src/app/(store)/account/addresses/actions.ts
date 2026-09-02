"use server"

import { revalidatePath } from "next/cache"

import { NIGERIAN_STATES } from "@/lib/nigerian-states"
import { createSupabaseServerClient } from "@/lib/supabase-server"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AddressFieldErrors = {
  label?: string
  address?: string
  city?: string
  state?: string
}

export type AddressActionResult = {
  status: "success" | "error"
  message: string
  fieldErrors?: AddressFieldErrors
}

type ValidatedAddress = {
  label: string
  address: string
  city: string
  state: string
}

function normalizeText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return ""
  return value.trim().replace(/\s+/g, " ")
}

function textLength(value: string) {
  return Array.from(value).length
}

function validateAddress(formData: FormData):
  | { values: ValidatedAddress; fieldErrors?: never }
  | { values?: never; fieldErrors: AddressFieldErrors } {
  const values = {
    label: normalizeText(formData.get("label")),
    address: normalizeText(formData.get("address")),
    city: normalizeText(formData.get("city")),
    state:
      typeof formData.get("state") === "string"
        ? String(formData.get("state")).trim()
        : "",
  }
  const fieldErrors: AddressFieldErrors = {}

  if (!values.label) {
    fieldErrors.label = "Enter an address label."
  } else if (textLength(values.label) > 50) {
    fieldErrors.label = "Label must be 50 characters or fewer."
  }

  if (!values.address) {
    fieldErrors.address = "Enter a delivery address."
  } else if (
    textLength(values.address) < 5 ||
    textLength(values.address) > 300
  ) {
    fieldErrors.address = "Address must be between 5 and 300 characters."
  }

  if (!values.city) {
    fieldErrors.city = "Enter a city."
  } else if (textLength(values.city) < 2 || textLength(values.city) > 100) {
    fieldErrors.city = "City must be between 2 and 100 characters."
  }

  if (!(NIGERIAN_STATES as readonly string[]).includes(values.state)) {
    fieldErrors.state = "Select a valid Nigerian state."
  }

  return Object.keys(fieldErrors).length > 0
    ? { fieldErrors }
    : { values }
}

async function authenticateCustomer() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return null
  return { supabase, userId: user.id }
}

function revalidateAddressPages() {
  revalidatePath("/account/addresses")
  revalidatePath("/account")
}

function sessionError(): AddressActionResult {
  return {
    status: "error",
    message: "Your session has expired. Please sign in again.",
  }
}

function unavailableAddress(): AddressActionResult {
  return {
    status: "error",
    message: "Address unavailable.",
  }
}

export async function createCustomerAddress(
  formData: FormData
): Promise<AddressActionResult> {
  const customer = await authenticateCustomer()
  if (!customer) return sessionError()

  const validation = validateAddress(formData)
  if (validation.fieldErrors) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: validation.fieldErrors,
    }
  }

  const { data: existingAddress, error: readError } = await customer.supabase
    .from("customer_addresses")
    .select("id")
    .eq("user_id", customer.userId)
    .limit(1)
    .maybeSingle()

  if (readError) {
    return {
      status: "error",
      message: "We couldn't add this address right now. Please try again.",
    }
  }

  const { data: insertedAddress, error: insertError } = await customer.supabase
    .from("customer_addresses")
    .insert({
      user_id: customer.userId,
      label: validation.values.label,
      address: validation.values.address,
      city: validation.values.city,
      state: validation.values.state,
      is_default: existingAddress === null,
    })
    .select("id")
    .maybeSingle()

  if (insertError || !insertedAddress) {
    return {
      status: "error",
      message: "We couldn't add this address right now. Please try again.",
    }
  }

  revalidateAddressPages()
  return { status: "success", message: "Address added." }
}

export async function updateCustomerAddress(
  formData: FormData
): Promise<AddressActionResult> {
  const customer = await authenticateCustomer()
  if (!customer) return sessionError()

  const addressId = normalizeText(formData.get("address_id"))
  if (!UUID_PATTERN.test(addressId)) return unavailableAddress()

  const validation = validateAddress(formData)
  if (validation.fieldErrors) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: validation.fieldErrors,
    }
  }

  const { data: updatedAddress, error: updateError } = await customer.supabase
    .from("customer_addresses")
    .update({
      label: validation.values.label,
      address: validation.values.address,
      city: validation.values.city,
      state: validation.values.state,
    })
    .eq("id", addressId)
    .eq("user_id", customer.userId)
    .select("id")
    .maybeSingle()

  if (updateError) {
    return {
      status: "error",
      message: "We couldn't update this address right now. Please try again.",
    }
  }

  if (!updatedAddress) return unavailableAddress()

  revalidateAddressPages()
  return { status: "success", message: "Address updated." }
}

export async function deleteCustomerAddress(
  formData: FormData
): Promise<AddressActionResult> {
  const customer = await authenticateCustomer()
  if (!customer) return sessionError()

  const addressId = normalizeText(formData.get("address_id"))
  if (!UUID_PATTERN.test(addressId)) return unavailableAddress()

  const { data: deletedAddress, error: deleteError } = await customer.supabase
    .from("customer_addresses")
    .delete()
    .eq("id", addressId)
    .eq("user_id", customer.userId)
    .select("id")
    .maybeSingle()

  if (deleteError) {
    return {
      status: "error",
      message: "We couldn't delete this address right now. Please try again.",
    }
  }

  if (!deletedAddress) return unavailableAddress()

  revalidateAddressPages()
  return { status: "success", message: "Address deleted." }
}

export async function setDefaultCustomerAddress(
  formData: FormData
): Promise<AddressActionResult> {
  const customer = await authenticateCustomer()
  if (!customer) return sessionError()

  const addressId = normalizeText(formData.get("address_id"))
  if (!UUID_PATTERN.test(addressId)) return unavailableAddress()

  const { error } = await customer.supabase.rpc(
    "set_customer_default_address",
    { p_address_id: addressId }
  )

  if (error) {
    return {
      status: "error",
      message:
        "We couldn't set the default address right now. Please try again.",
    }
  }

  revalidateAddressPages()
  return { status: "success", message: "Default address updated." }
}
