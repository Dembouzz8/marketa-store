"use server"

import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase-server"

export async function signOutCustomer() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect("/account/login")
}
