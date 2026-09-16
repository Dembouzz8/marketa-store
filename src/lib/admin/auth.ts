import "server-only"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { createAdminClient } from "./supabase-admin"

// Intentionally uncached: membership is checked on every protected entry.
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const user = await (async () => {
    try {
      const client = await createSupabaseServerClient()
      const { data, error } = await client.auth.getUser()
      return error ? null : data.user
    } catch {
      return null
    }
  })()
  if (!user) redirect("/admin/login")

  const membership = await (async () => {
    try {
      return await createAdminClient()
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle()
    } catch {
      return { data: null, error: true }
    }
  })()
  if (membership.error) redirect("/admin/login?access=unavailable")
  if (!membership.data || membership.data.user_id !== user.id) {
    redirect("/admin/login?access=denied")
  }
  return { userId: user.id, email: user.email ?? "" }
}
