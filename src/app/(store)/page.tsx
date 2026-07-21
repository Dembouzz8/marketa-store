import Link from "next/link"
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Headphones,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react"

import { Hero } from "@/components/hero"
import { ProductCard } from "@/components/product-card"
import { STORE_CATEGORIES } from "@/lib/storefront"
import { supabase } from "@/lib/supabase"
import type { Product } from "@/types"

export const dynamic = "force-dynamic"

interface FeaturedVendor {
  id: string
  name: string
}

const marketplaceBenefits = [
  {
    icon: ShieldCheck,
    title: "Secure Paystack Payments",
    description:
      "Complete checkout through Paystack without sharing card details with vendors.",
  },
  {
    icon: BadgeCheck,
    title: "Verified Nigerian Vendors",
    description:
      "Discover products from Nigerian sellers brought together in one marketplace.",
  },
  {
    icon: BellRing,
    title: "Order Updates",
    description:
      "Receive the information you need as your order moves from payment to delivery.",
  },
  {
    icon: Headphones,
    title: "Customer Support",
    description:
      "Get a clear path to help when you have a question about your purchase.",
  },
]

const shoppingSteps = [
  {
    icon: Search,
    number: "01",
    title: "Find your product",
    description:
      "Browse recent arrivals or search the catalogue for what you need.",
  },
  {
    icon: ShoppingBag,
    number: "02",
    title: "Add it to your cart",
    description:
      "Choose your quantity and keep shopping until your order is ready.",
  },
  {
    icon: PackageCheck,
    number: "03",
    title: "Check out securely",
    description:
      "Enter your delivery details and continue to Paystack to complete payment.",
  },
]

async function getHomepageData(): Promise<{
  products: Product[]
  vendors: FeaturedVendor[]
}> {
  const [productsResult, vendorsResult] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("vendors")
      .select("id, name")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(4),
  ])

  if (productsResult.error) {
    console.error("[homepage products] query failed:", productsResult.error)
  }

  if (vendorsResult.error) {
    console.error("[homepage vendors] query failed:", vendorsResult.error)
  }

  return {
    products: (productsResult.data ?? []) as Product[],
    vendors: (vendorsResult.data ?? []) as FeaturedVendor[],
  }
}

export default async function Home() {
  const { products, vendors } = await getHomepageData()

  return (
    <>
      <Hero />

      <section className="bg-white py-12 sm:py-16" aria-labelledby="categories-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">
              Explore the marketplace
            </p>
            <h2
              id="categories-heading"
              className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900"
            >
              Shop by Category
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
              Start with the department that matches what you are looking for.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            {STORE_CATEGORIES.map((category) => (
              <Link
                key={category.slug}
                href={`/products?category=${category.slug}`}
                className="group flex min-h-32 flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-4 transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <span className="text-3xl" aria-hidden="true">
                  {category.icon}
                </span>
                <span className="mt-5 text-sm font-semibold leading-5 text-zinc-900 group-hover:text-amber-800">
                  {category.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        className="bg-zinc-50 py-12 sm:py-16"
        aria-labelledby="featured-products-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">
                Fresh finds
              </p>
              <h2
                id="featured-products-heading"
                className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900"
              >
                Featured Products
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
                Take a look at products recently added to the marketplace.
              </p>
            </div>
            <Link
              href="/products"
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-sm font-semibold text-zinc-900 transition-colors hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              View All Products
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {products.length > 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product, index) => (
                <ProductCard key={product.id} product={product} index={index} />
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
              <p className="font-semibold text-zinc-900">
                New products are on the way
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                Check the catalogue again soon for the latest additions.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16" aria-labelledby="vendors-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">
                Meet the sellers
              </p>
              <h2
                id="vendors-heading"
                className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900"
              >
                Featured Vendors
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
                Discover independent Nigerian businesses selling through Marketa.
              </p>
            </div>
            <Link
              href="/vendors"
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-sm font-semibold text-zinc-900 transition-colors hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Explore Vendors
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {vendors.length > 0 ? (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {vendors.map((vendor) => (
                <article
                  key={vendor.id}
                  className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-900 text-lg font-bold text-amber-500">
                    {vendor.name.slice(0, 1).toUpperCase()}
                  </div>
                  <h3 className="mt-5 font-semibold text-zinc-900">
                    {vendor.name}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">Marketa vendor</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-8 flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900">
                  Vendor profiles are being prepared
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  Visit the vendor page to learn how sellers appear on Marketa.
                </p>
              </div>
              <Link
                href="/vendors"
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-700"
              >
                Visit Vendors
              </Link>
            </div>
          )}
        </div>
      </section>

      <section
        className="bg-zinc-950 py-12 text-white sm:py-16"
        aria-labelledby="why-marketa-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
              Built around your order
            </p>
            <h2
              id="why-marketa-heading"
              className="mt-2 text-3xl font-semibold tracking-tight"
            >
              Why Shop on Marketa
            </h2>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {marketplaceBenefits.map((benefit) => (
              <article
                key={benefit.title}
                className="rounded-xl border border-white/10 bg-white/5 p-5"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-950">
                  <benefit.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold text-white">
                  {benefit.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {benefit.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-amber-500 py-12 sm:py-16" aria-labelledby="seller-cta-heading">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-800">
              Grow with Marketa
            </p>
            <h2
              id="seller-cta-heading"
              className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950"
            >
              Bring your products to more Nigerian shoppers
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-800 sm:text-base">
              Learn how selling works, what you need to get started, and how
              marketplace payments and payouts are handled.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            <Link
              href="/sell-with-us"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-zinc-950 px-7 font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              Sell With Us
            </Link>
            <Link
              href="/vendor/login"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-900/30 px-7 font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Vendor Login
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16" aria-labelledby="how-it-works-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">
              From browse to checkout
            </p>
            <h2
              id="how-it-works-heading"
              className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900"
            >
              How Marketa Works
            </h2>
          </div>

          <div className="relative mt-10 grid gap-5 md:grid-cols-3">
            {shoppingSteps.map((step) => (
              <article
                key={step.number}
                className="relative rounded-xl border border-zinc-200 bg-zinc-50 p-6"
              >
                <span className="text-xs font-bold tracking-[0.2em] text-amber-700">
                  STEP {step.number}
                </span>
                <step.icon className="mt-5 size-7 text-zinc-900" />
                <h3 className="mt-5 text-lg font-semibold text-zinc-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
