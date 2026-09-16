"use server"

import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { requireAdmin } from "@/lib/admin/auth"
import { assertAdminOrigin } from "@/lib/admin/origin"

export async function loginAdmin(_previous: { message: string }, formData: FormData) {
  try {
    await assertAdminOrigin()
  } catch {
    return { message: "Invalid request. Reload the page and try again." }
  }
  const rawEmail = formData.get("email")
  const password = formData.get("password")
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : ""
  if (
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== "string" || !password.length || password.length > 4096
  ) return { message: "Unable to sign in. Check your credentials and try again." }

  try {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) return { message: "Unable to sign in. Check your credentials and try again." }
  } catch {
    return { message: "Unable to sign in. Please try again." }
  }
  await requireAdmin()
  redirect("/admin/vendor-applications")
}

export async function logoutAdmin() {
  try {
    await assertAdminOrigin()
  } catch {
    redirect("/admin/login?access=invalid-request")
  }
  try {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.signOut({ scope: "local" })
    if (error) throw new Error()
  } catch {
    redirect("/admin/login?access=logout-failed")
  }
  redirect("/admin/login")
}
