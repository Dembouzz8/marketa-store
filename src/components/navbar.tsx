"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
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
  { href: "/products", label: "Products" },
  { href: "/products", label: "Categories" },
  { href: "/vendors", label: "Vendors" },
  { href: "/about", label: "About" },
]

function subscribeToCartHydration(onStoreChange: () => void) {
  const unsubscribeHydrate = useCartStore.persist.onHydrate(onStoreChange)
  const unsubscribeFinish = useCartStore.persist.onFinishHydration(onStoreChange)

  return () => {
    unsubscribeHydrate()
    unsubscribeFinish()
  }
}

function getCartHydrationSnapshot() {
  return useCartStore.persist.hasHydrated()
}

function getServerCartHydrationSnapshot() {
  return false
}

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const totalItems = useCartStore((state) => state.totalItems())
  const setCartOpen = useCartStore((state) => state.setCartOpen)
  const hasHydratedCart = useSyncExternalStore(
    subscribeToCartHydration,
    getCartHydrationSnapshot,
    getServerCartHydrationSnapshot
  )

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    handleScroll()
    window.addEventListener("scroll", handleScroll)

    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus()
    }
  }, [isSearchOpen])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const query = searchTerm.trim()
    if (!query) return

    setIsSearchOpen(false)
    setIsMobileOpen(false)
    router.push(`/products?q=${encodeURIComponent(query)}`)
  }

  const isActiveLink = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

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
              key={link.label}
              href={link.href}
              className={cn(
                "text-sm text-zinc-400 transition-colors hover:text-white",
                isActiveLink(link.href) && "text-white"
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
            onClick={() => setIsSearchOpen((open) => !open)}
            aria-label={isSearchOpen ? "Close search" : "Search products"}
            aria-expanded={isSearchOpen}
            aria-controls="navbar-search"
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
            {hasHydratedCart && totalItems > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-zinc-900">
                {totalItems}
              </span>
            )}
          </button>
          <Link
            href="/sell-with-us"
            className="hidden rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-amber-400 md:inline-flex"
          >
            Sell with us
          </Link>
        </div>
      </div>

      {isSearchOpen && (
        <div
          id="navbar-search"
          className="border-t border-zinc-800 px-4 py-3 sm:px-6 lg:px-8"
        >
          <form
            role="search"
            onSubmit={handleSearch}
            className="mx-auto flex max-w-2xl items-center gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-zinc-500"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setIsSearchOpen(false)
                }}
                placeholder="Search products"
                aria-label="Search products"
                className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-10 pr-3 text-base text-white outline-none placeholder:text-zinc-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={!searchTerm.trim()}
              className="h-11 shrink-0 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Search
            </button>
          </form>
        </div>
      )}

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
                key={link.label}
                href={link.href}
                onClick={() => setIsMobileOpen(false)}
                className={cn(
                  "rounded-lg px-3 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white",
                  isActiveLink(link.href) && "bg-zinc-800 text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/sell-with-us"
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
