import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CreditCard,
  LayoutDashboard,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react"

export const metadata: Metadata = {
  title: "Sell With Us | Marketa",
  description:
    "Learn how Nigerian businesses can sell through Marketa, from vendor checks and product listings to secure payments and payouts.",
}

const benefits = [
  {
    icon: Store,
    title: "A dedicated storefront",
    description:
      "Present your products in a focused marketplace experience built to make browsing and buying straightforward.",
  },
  {
    icon: Users,
    title: "Reach ready-to-shop customers",
    description:
      "Make your business discoverable beyond your existing social audience without losing your own store identity.",
  },
  {
    icon: LayoutDashboard,
    title: "Practical seller tools",
    description:
      "Use the vendor dashboard to manage products and follow the orders that matter to your business.",
  },
  {
    icon: ShieldCheck,
    title: "A trust-led experience",
    description:
      "Vendor checks, clear product information and structured orders help customers buy with greater confidence.",
  },
]

const sellingSteps = [
  {
    number: "01",
    title: "Introduce your business",
    description:
      "Share accurate store, contact and identity details so your application can be reviewed.",
  },
  {
    number: "02",
    title: "Complete vendor checks",
    description:
      "Provide the requested verification information and agree to the marketplace seller terms.",
  },
  {
    number: "03",
    title: "Build your catalogue",
    description:
      "Add clear product names, descriptions, prices, stock levels and images through the vendor dashboard.",
  },
  {
    number: "04",
    title: "Receive and fulfil orders",
    description:
      "Follow confirmed orders, prepare items carefully and keep fulfilment information current.",
  },
]

const requirements = [
  "A Nigerian business, brand or independent seller",
  "Valid contact and identity or business information",
  "Authentic products that can be described and priced accurately",
  "Reliable stock, packaging and order fulfilment practices",
  "Agreement to Marketa's seller and prohibited-item policies",
]

export default function SellWithUsPage() {
  return (
    <main className="bg-white">
      <section className="relative isolate overflow-hidden bg-zinc-900 text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_30%,rgba(245,158,11,0.18),transparent_35%)]" />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400">
              <Store className="size-4" aria-hidden="true" />
              Built for Nigerian sellers
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Bring your products to
              <span className="block text-amber-500">more customers.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
              Marketa gives independent vendors a clear storefront, structured
              order management and a secure way for customers to pay.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#start-selling"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Start Selling
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <Link
                href="/vendor/login"
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-zinc-400 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Already a Vendor? Log In
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:justify-self-end">
            <div className="absolute -inset-5 rounded-[2rem] bg-amber-500/10 blur-2xl" />
            <div className="relative rounded-2xl border border-zinc-700 bg-zinc-800/90 p-6 shadow-2xl sm:p-8">
              <div className="flex items-center justify-between gap-4 border-b border-zinc-700 pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-900">
                    <ShoppingBag className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-semibold text-white">Your store on Marketa</p>
                    <p className="text-sm text-zinc-400">Simple tools, clear orders</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                  Seller ready
                </span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Storefront", icon: Store },
                  { label: "Products", icon: PackageCheck },
                  { label: "Payments", icon: CreditCard },
                  { label: "Dashboard", icon: LayoutDashboard },
                ].map(({ label, icon: Icon }) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 rounded-xl bg-zinc-900/70 p-4 text-sm font-medium text-zinc-200"
                  >
                    <Icon className="size-4 text-amber-400" aria-hidden="true" />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
              Why sell on Marketa
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              Give your business a better way to sell online
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Focus on your products and customers while Marketa provides a
              consistent marketplace journey from discovery to confirmed order.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 font-semibold text-zinc-900">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="seller-guide"
        className="scroll-mt-24 border-y border-zinc-200 bg-zinc-50 py-12 sm:py-16 lg:py-20"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
                Seller guide
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                How selling works
              </h2>
              <p className="mt-4 text-base leading-7 text-zinc-600">
                A straightforward path from introducing your business to
                fulfilling your first confirmed order.
              </p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2">
              {sellingSteps.map((step) => (
                <li
                  key={step.number}
                  className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <span className="text-sm font-bold text-amber-600">
                    {step.number}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold text-zinc-900">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-start lg:gap-16 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
              Seller requirements
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              What to prepare
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Accurate information helps us review your business and helps
              customers understand exactly what you sell.
            </p>
          </div>
          <ul className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            {requirements.map((requirement) => (
              <li
                key={requirement}
                className="flex gap-3 border-b border-zinc-100 py-4 first:pt-0 last:border-0 last:pb-0"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm leading-6 text-zinc-700">
                  {requirement}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="commission"
        className="scroll-mt-24 border-y border-zinc-800 bg-zinc-900 py-12 text-white sm:py-16 lg:py-20"
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400">
              <Banknote className="size-4" aria-hidden="true" />
              Clear commercial terms
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              Commission without surprises
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-300">
              Applicable commission rates are shared during onboarding before
              your store is activated. Rates may vary by product category, so
              you can review the relevant terms before you begin selling.
            </p>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              There are no invented headline rates here. Your onboarding terms
              are the source of truth for commissions, payout timing and any
              applicable charges.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-700 bg-zinc-800 p-6 shadow-2xl sm:p-8">
            <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500 text-zinc-900">
              <CreditCard className="size-6" aria-hidden="true" />
            </div>
            <h3 className="mt-5 text-xl font-semibold">Secure payment and payout</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Customers check out through Paystack. Marketa uses confirmed
              payment information to create the order record, and vendor
              payouts follow the agreed onboarding terms and account details.
            </p>
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden="true" />
              <p className="text-sm leading-6 text-zinc-300">
                Keep your payout details private and current in the approved
                vendor channel. Marketa will not ask you to confirm customer
                payments through personal messages.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="start-selling"
        className="scroll-mt-24 bg-amber-50 py-12 sm:py-16 lg:py-20"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white px-6 py-10 shadow-sm sm:px-10 sm:py-12 lg:flex lg:items-center lg:justify-between lg:gap-12 lg:px-14">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
                Start selling
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                Prepare your store for onboarding
              </h2>
              <p className="mt-4 text-base leading-7 text-zinc-600">
                Gather your business and product information, then review the
                seller guide and commission notes above. Approved vendors can
                use the vendor portal to manage their store.
              </p>
            </div>
            <div className="mt-8 flex shrink-0 flex-col gap-3 sm:flex-row lg:mt-0 lg:flex-col">
              <a
                href="#seller-guide"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
              >
                Review the seller guide
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <Link
                href="/vendor/login"
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-500"
              >
                Already a Vendor? Log In
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
