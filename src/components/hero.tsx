"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  BellRing,
  Headphones,
  MapPin,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react"

const benefits = [
  { icon: ShieldCheck, label: "Secure Paystack Payments" },
  { icon: Store, label: "Nigerian Marketplace Vendors" },
  { icon: BellRing, label: "Order Updates" },
  { icon: Headphones, label: "Customer Support" },
]

const shoppingJourney = [
  {
    icon: Search,
    eyebrow: "Discover",
    label: "Search products and categories",
    className: "left-0 top-8 -rotate-2",
    duration: 3.2,
  },
  {
    icon: ShieldCheck,
    eyebrow: "Checkout",
    label: "Pay securely with Paystack",
    className: "right-0 top-44 rotate-2",
    duration: 3.8,
  },
  {
    icon: MapPin,
    eyebrow: "Stay informed",
    label: "Follow your order updates",
    className: "bottom-8 left-12 -rotate-1",
    duration: 4.2,
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_45%,rgba(245,158,11,0.14),transparent_38%)]" />
      <div className="relative mx-auto grid min-h-[70vh] max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-16 lg:min-h-[82vh] lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-20">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-7 lg:space-y-8"
        >
          <motion.div
            variants={itemVariants}
            className="inline-flex rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-400 ring-1 ring-inset ring-amber-400/20"
          >
            🇳🇬 A marketplace made for Nigeria
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-5">
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Find what you need.
              <span className="block text-amber-500">
                Shop with confidence.
              </span>
            </h1>
            <p className="max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
              Discover products from Nigerian vendors, check out securely with
              Paystack, and stay informed as your order moves.
            </p>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <Link
              href="/products"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-amber-500 px-8 py-3 text-base font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Shop Now
            </Link>
            <Link
              href="/sell-with-us"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/70 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-white hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Become a Vendor
            </Link>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="grid max-w-2xl grid-cols-2 gap-x-5 gap-y-4 border-t border-white/10 pt-6 sm:grid-cols-4"
          >
            {benefits.map((benefit) => (
              <div key={benefit.label} className="flex items-start gap-2.5">
                <benefit.icon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span className="text-xs leading-5 text-zinc-300">
                  {benefit.label}
                </span>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <div className="relative hidden min-h-[500px] lg:block" aria-hidden="true">
          <div className="absolute inset-10 rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl backdrop-blur-sm" />
          <div className="absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-950">
                <Store className="size-5" />
              </span>
              <div>
                <p className="font-semibold text-white">The Marketa journey</p>
                <p className="text-xs text-zinc-400">Simple from search to delivery</p>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {benefits.slice(0, 3).map((benefit) => (
                <div
                  key={benefit.label}
                  className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-200"
                >
                  <benefit.icon className="size-4 text-amber-500" />
                  {benefit.label}
                </div>
              ))}
            </div>
          </div>

          {shoppingJourney.map((item) => (
            <motion.div
              key={item.eyebrow}
              animate={{ y: [0, -12, 0] }}
              transition={{
                duration: item.duration,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className={`absolute w-56 rounded-xl bg-white p-4 shadow-2xl ${item.className}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <item.icon className="size-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    {item.eyebrow}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-zinc-900">
                    {item.label}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
