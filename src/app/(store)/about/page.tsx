import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  Handshake,
  MapPin,
  MessageSquareText,
  ShieldCheck,
  ShoppingBag,
  Store,
} from "lucide-react"

export const metadata: Metadata = {
  title: "About Marketa | Nigeria's Marketplace",
  description:
    "Learn how Marketa helps Nigerian shoppers discover independent vendors through a clearer, safer marketplace experience.",
}

const marketplaceNeeds = [
  {
    icon: Store,
    title: "Better discovery",
    description:
      "Quality Nigerian businesses can be hard to find when products are scattered across social feeds and private chats.",
  },
  {
    icon: MessageSquareText,
    title: "Clearer buying",
    description:
      "Customers deserve consistent product information, visible prices and an order journey they can understand.",
  },
  {
    icon: Handshake,
    title: "A fairer connection",
    description:
      "Independent sellers need a professional storefront, while shoppers need the confidence to buy from businesses they are meeting for the first time.",
  },
]

const trustPrinciples = [
  {
    icon: BadgeCheck,
    title: "Thoughtful vendor checks",
    description:
      "Seller details are reviewed as part of onboarding. Verification is shown only when the relevant checks have been completed.",
  },
  {
    icon: CreditCard,
    title: "Secure payments",
    description:
      "Checkout is handled through Paystack, so customers can pay through a familiar payment experience instead of informal transfers in a chat.",
  },
  {
    icon: ShieldCheck,
    title: "Customer protection",
    description:
      "Clear order records, status updates and support pathways help customers know what they ordered and what happens next.",
  },
]

export default function AboutPage() {
  return (
    <main className="bg-white">
      <section className="relative isolate overflow-hidden bg-zinc-900 text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_20%,rgba(245,158,11,0.16),transparent_34%)]" />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400">
              <MapPin className="size-4" aria-hidden="true" />
              Built with Nigeria in mind
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Local commerce should feel
              <span className="block text-amber-500">simple and trustworthy.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
              Marketa is a multi-vendor marketplace that brings Nigerian
              businesses and shoppers into one clear, dependable shopping
              experience.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/products"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Explore products
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/sell-with-us"
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-zinc-400 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Sell with us
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:justify-self-end">
            <div className="absolute -inset-4 rounded-[2rem] bg-amber-500/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800/80 p-6 shadow-2xl backdrop-blur sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-900">
                  <ShoppingBag className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-white">The Marketa idea</p>
                  <p className="text-sm text-zinc-400">One marketplace, clearer choices</p>
                </div>
              </div>
              <div className="mt-8 space-y-5 border-t border-zinc-700 pt-6">
                {[
                  "Help shoppers find independent Nigerian vendors",
                  "Give sellers a focused home for their products",
                  "Build confidence into discovery, checkout and support",
                ].map((item) => (
                  <div key={item} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                      <BadgeCheck className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm leading-6 text-zinc-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
                Why we exist
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                Closing the gap between discovery and confidence
              </h2>
              <p className="mt-5 text-base leading-7 text-zinc-600">
                Nigeria is full of capable makers, merchants and growing
                businesses. Yet buying from an unfamiliar seller can still
                mean fragmented conversations, unclear product information and
                uncertainty after payment. Marketa is being built to make that
                journey more consistent for both sides.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {marketplaceNeeds.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
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
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-zinc-50 py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
              Trust, made visible
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              Confidence should be part of every order
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Trust is not a slogan. It comes from practical checks, secure
              payment handling and useful information throughout the shopping
              journey.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {trustPrinciples.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-zinc-900 text-amber-400">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-zinc-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl bg-zinc-900 px-6 py-10 text-white sm:px-10 sm:py-12 lg:flex lg:items-center lg:justify-between lg:gap-12 lg:px-14">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-400">
                Our mission
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Help Nigerian commerce grow through trust.
              </h2>
              <p className="mt-4 text-base leading-7 text-zinc-300">
                We want excellent local businesses to be easier to discover
                and easier to buy from, while giving customers a marketplace
                experience that respects their money, time and confidence.
              </p>
            </div>
            <Link
              href="/products"
              className="mt-8 inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-amber-400 lg:mt-0"
            >
              Start shopping
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
