"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"

import { formatNaira } from "@/lib/utils"

const stats = [
  { value: 2500, suffix: "+", label: "Products" },
  { value: 340, suffix: "+", label: "Vendors" },
  { value: 15000, suffix: "+", label: "Customers" },
]

const mockProducts = [
  {
    name: "Adire Tote Bag",
    price: 18500,
    image: "https://placehold.co/320x320/fef3c7/18181b?text=Adire+Bag",
    rotate: -3,
    duration: 3,
    className: "left-0 top-8",
  },
  {
    name: "Wireless Earbuds",
    price: 42000,
    image: "https://placehold.co/320x320/e4e4e7/18181b?text=Earbuds",
    rotate: 0,
    duration: 3.5,
    className: "right-8 top-28",
  },
  {
    name: "Skincare Kit",
    price: 26000,
    image: "https://placehold.co/320x320/fce7f3/18181b?text=Skincare",
    rotate: 3,
    duration: 4,
    className: "bottom-8 left-20",
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
  const [counts, setCounts] = useState(stats.map(() => 0))

  useEffect(() => {
    const duration = 1200
    const start = performance.now()

    const frame = (time: number) => {
      const progress = Math.min((time - start) / duration, 1)
      setCounts(stats.map((stat) => Math.floor(stat.value * progress)))

      if (progress < 1) {
        requestAnimationFrame(frame)
      }
    }

    requestAnimationFrame(frame)
  }, [])

  return (
    <section className="relative min-h-[70vh] overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 md:min-h-[85vh]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.12),transparent_42%)]" />
      <div className="relative mx-auto grid min-h-[70vh] max-w-7xl items-center gap-12 px-4 py-10 sm:px-6 md:min-h-[85vh] md:grid-cols-2 md:py-16 lg:px-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-8"
        >
          <motion.div
            variants={itemVariants}
            className="inline-flex rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-400"
          >
            🇳🇬 Nigeria&apos;s #1 Marketplace
          </motion.div>
          <motion.div variants={itemVariants} className="space-y-4">
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-5xl">
              Shop From Nigeria&apos;s
              <span className="block text-amber-500">Best Vendors</span>
            </h1>
            <p className="max-w-md text-sm leading-6 text-zinc-400 md:text-base">
              Discover unique products from thousands of verified vendors
              across the country. Fast delivery, secure Paystack payments.
            </p>
          </motion.div>
          <motion.div
            variants={itemVariants}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <Link
              href="#products"
              className="rounded-lg bg-amber-500 px-8 py-3 text-center font-semibold text-zinc-900 transition-colors hover:bg-amber-400"
            >
              Shop Now
            </Link>
            <Link
              href="#vendors"
              className="rounded-lg border border-white px-8 py-3 text-center font-semibold text-white transition-colors hover:bg-white hover:text-zinc-900"
            >
              Become a Vendor
            </Link>
          </motion.div>
          <motion.div
            variants={itemVariants}
            className="grid max-w-lg grid-cols-3 gap-4 pt-4"
          >
            {stats.map((stat, index) => (
              <div key={stat.label}>
                <p className="text-xl font-bold text-amber-500 md:text-2xl">
                  {counts[index].toLocaleString()}
                  {stat.suffix}
                </p>
                <p className="text-xs text-zinc-400">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <div className="relative hidden min-h-[560px] md:block">
          {mockProducts.map((product) => (
            <motion.div
              key={product.name}
              animate={{ y: [0, -12, 0] }}
              transition={{
                duration: product.duration,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              style={{ rotate: product.rotate }}
              className={`absolute w-56 rounded-xl bg-white p-4 shadow-2xl ${product.className}`}
            >
              <img
                src={product.image}
                alt={product.name}
                className="aspect-square w-full rounded-lg object-cover"
              />
              <div className="mt-3">
                <p className="font-semibold text-zinc-900">{product.name}</p>
                <p className="text-lg font-bold text-amber-600">
                  {formatNaira(product.price)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
