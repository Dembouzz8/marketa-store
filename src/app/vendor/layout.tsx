import { Sidebar } from "@/components/vendor/sidebar"
import { createSupabaseServerClient } from "@/lib/supabase-server"

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <>{children}</>
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, email")
    .eq("user_id", user.id)
    .single()

  if (!vendor) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Sidebar vendorName={vendor.name} vendorEmail={vendor.email} />
      <main className="min-h-screen overflow-auto pt-16 lg:ml-64 lg:pt-0">
        <div className="p-4 lg:p-6">{children}</div>
      </main>
    </div>
  )
}
