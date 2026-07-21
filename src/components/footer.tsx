import Link from "next/link"
import { ShoppingBag } from "lucide-react"

interface FooterLink {
  href: string
  label: string
}

const shopLinks: FooterLink[] = [
  { href: "/products", label: "Products" },
  { href: "/products", label: "Categories" },
  { href: "/vendors", label: "Vendors" },
]

const sellLinks: FooterLink[] = [
  { href: "/sell-with-us", label: "Sell With Us" },
  { href: "/vendor/login", label: "Vendor Login" },
  { href: "/sell-with-us#seller-guide", label: "Seller Guide" },
  { href: "/sell-with-us#commission", label: "Commission Rates" },
]

const companyLinks: FooterLink[] = [
  { href: "/about", label: "About Marketa" },
]

export function Footer() {
  return (
    <footer className="bg-zinc-900 text-zinc-400">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <ShoppingBag className="size-6 text-amber-500" />
              <span className="text-xl font-bold text-white">Marketa</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6">
              Nigeria&apos;s premium multi-vendor marketplace.
            </p>
          </div>

          <FooterColumn title="Shop" links={shopLinks} />
          <FooterColumn title="Sell" links={sellLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-zinc-800 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-sm">&copy; 2025 Marketa. All rights reserved.</p>
          <div className="flex gap-2">
            {["Visa", "Mastercard", "Paystack"].map((method) => (
              <span
                key={method}
                className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300"
              >
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-sm transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
