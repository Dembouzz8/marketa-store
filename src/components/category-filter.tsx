"use client"

import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

interface CategoryFilterProps {
  categories: string[]
  selected: string
  onSelect: (category: string) => void
}

const labels: Record<string, string> = {
  All: "🛍️ All",
  Fashion: "👗 Fashion",
  Electronics: "📱 Electronics",
  Food: "🍔 Food & Drinks",
  Beauty: "💄 Beauty",
  Home: "🏠 Home & Living",
  Sports: "⚽ Sports",
}

function getCategoryLabel(category: string) {
  return labels[category] ?? `📦 ${category}`
}

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: CategoryFilterProps) {
  const allCategories = ["All", ...categories]

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.05 } },
      }}
      className="scrollbar-hide flex gap-3 overflow-x-auto pb-2"
    >
      {allCategories.map((category) => (
        <motion.button
          key={category}
          type="button"
          variants={{
            hidden: { opacity: 0, y: 10 },
            visible: { opacity: 1, y: 0 },
          }}
          onClick={() => onSelect(category)}
          className={cn(
            "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all",
            selected === category
              ? "bg-zinc-900 text-white"
              : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
          )}
        >
          {getCategoryLabel(category)}
        </motion.button>
      ))}
    </motion.div>
  )
}
