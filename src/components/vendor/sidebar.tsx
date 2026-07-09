"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  X,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

interface SidebarProps {
  vendorName: string
  vendorEmail: string
}

const navigation = [
  { label: "Dashboard", href: "/vendor/dashboard", icon: LayoutDashboard },
  { label: "Orders", href: "/vendor/orders", icon: ShoppingCart },
  { label: "Products", href: "/vendor/products", icon: Package },
  { label: "Payouts", href: "/vendor/payouts", icon: Wallet },
  { label: "Settings", href: "/vendor/settings", icon: Settings },
]

function SidebarBody({
  vendorName,
  vendorEmail,
  onNavigate,
}: SidebarProps & {
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/vendor/login")
    router.refresh()
  }

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-400">
      <div className="p-5">
        <Link
          href="/"
          className="flex items-center gap-3"
          onClick={onNavigate}
        >
          <ShoppingBag className="size-6 text-amber-500" />
          <span className="text-xl font-bold text-white">Marketa</span>
        </Link>
        <p className="mt-3 line-clamp-1 text-sm text-zinc-400">
          {vendorName}
        </p>
      </div>

      <Separator className="bg-zinc-800" />

      <nav className="mt-4 flex-1 space-y-1">
        {navigation.map((item) => {
          const Icon = item.icon
          const isActive =
            pathname === item.href ||
            (item.href !== "/vendor/dashboard" && pathname.startsWith(item.href))

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "mx-2 flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition-colors hover:bg-zinc-800 hover:text-white",
                isActive && "bg-zinc-800 text-amber-500"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-zinc-800 p-4">
        <p className="mb-3 line-clamp-1 text-xs text-zinc-500">
          {vendorEmail}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={handleLogout}
          className="w-full justify-start gap-3 rounded-lg px-4 py-3 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >
          <LogOut className="size-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}

export function Sidebar({ vendorName, vendorEmail }: SidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-zinc-800 lg:block">
        <SidebarBody vendorName={vendorName} vendorEmail={vendorEmail} />
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-zinc-700 hover:bg-zinc-100"
          aria-label="Open vendor navigation"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <ShoppingBag className="size-5 text-amber-500" />
          <span className="font-semibold text-zinc-900">Marketa</span>
        </div>
        <div className="w-9" />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-64 border-zinc-800 bg-zinc-900 p-0"
        >
          <SheetTitle className="sr-only">Vendor navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigation links for the vendor dashboard.
          </SheetDescription>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label="Close vendor navigation"
          >
            <X className="size-4" />
          </button>
          <SidebarBody
            vendorName={vendorName}
            vendorEmail={vendorEmail}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
