"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Menu, Search, ShoppingBag, ShoppingCart } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useCartStore } from "@/lib/store"

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/#products", label: "Products" },
  { href: "/#vendors", label: "Vendors" },
  { href: "/#about", label: "About" },
]

export function Navbar() {
  const pathname = usePathname()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const totalItems = useCartStore((state) => state.totalItems())
  const setCartOpen = useCartStore((state) => state.setCartOpen)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    handleScroll()
    window.addEventListener("scroll", handleScroll)

    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-900 transition-all",
        isScrolled && "bg-zinc-900/95 backdrop-blur-md"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white md:hidden"
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <ShoppingBag className="size-6 text-amber-500" />
            <span className="text-xl font-bold text-white">Marketa</span>
          </Link>
        </div>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm text-zinc-400 transition-colors hover:text-white",
                pathname === link.href && "text-white"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Search"
          >
            <Search className="size-5" />
          </button>
          <button
            type="button"
            className="relative rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            onClick={() => setCartOpen(true)}
            aria-label="Open cart"
          >
            <ShoppingCart className="size-5" />
            {totalItems > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-zinc-900">
                {totalItems}
              </span>
            )}
          </button>
          <Link
            href="/#vendors"
            className="hidden rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-amber-400 md:inline-flex"
          >
            Sell with us
          </Link>
        </div>
      </div>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="w-80 bg-zinc-900 text-white">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-white">
              <ShoppingBag className="size-6 text-amber-500" />
              Marketa
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileOpen(false)}
                className="rounded-lg px-3 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/#vendors"
              onClick={() => setIsMobileOpen(false)}
              className="mt-4 rounded-lg bg-amber-500 px-4 py-3 text-center text-sm font-medium text-zinc-900"
            >
              Sell with us
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </motion.nav>
  )
}
