import Link from "next/link"
import { ShoppingBag } from "lucide-react"

const categoryLinks = [
  "Fashion",
  "Electronics",
  "Food & Drinks",
  "Beauty",
  "Home & Living",
  "Sports",
]

const vendorLinks = [
  "Become a Vendor",
  "Vendor Login",
  "Seller Guide",
  "Commission Rates",
]

const supportLinks = [
  "Help Center",
  "Track Order",
  "Returns Policy",
  "Contact Us",
]

const socialLinks = ["X", "IG", "f", "in"]

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
            <div className="mt-5 flex gap-3">
              {socialLinks.map((social) => (
                <Link
                  key={social}
                  href="#"
                  className="flex size-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-300"
                  aria-label={social}
                >
                  {social}
                </Link>
              ))}
            </div>
          </div>

          <FooterColumn title="Shop" links={categoryLinks} />
          <FooterColumn title="Vendors" links={vendorLinks} />
          <FooterColumn title="Support" links={supportLinks} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-zinc-800 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-sm">© 2025 Marketa. All rights reserved.</p>
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

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={link}>
            <Link
              href="#"
              className="text-sm transition-colors hover:text-white"
            >
              {link}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
