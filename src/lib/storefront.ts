export const STORE_CATEGORIES = [
  { name: "Fashion", slug: "fashion", icon: "👗" },
  { name: "Phones & Tablets", slug: "phones-and-tablets", icon: "📱" },
  { name: "Computing", slug: "computing", icon: "💻" },
  { name: "Electronics", slug: "electronics", icon: "🎧" },
  { name: "Home & Kitchen", slug: "home-and-kitchen", icon: "🏠" },
  { name: "Appliances", slug: "appliances", icon: "🔌" },
  {
    name: "Beauty & Personal Care",
    slug: "beauty-and-personal-care",
    icon: "✨",
  },
  { name: "Food & Groceries", slug: "food-and-groceries", icon: "🛒" },
  { name: "Baby, Kids & Toys", slug: "baby-kids-and-toys", icon: "🧸" },
  { name: "Health & Wellness", slug: "health-and-wellness", icon: "💚" },
  { name: "Sports & Fitness", slug: "sports-and-fitness", icon: "⚽" },
  {
    name: "Automotive Accessories",
    slug: "automotive-accessories",
    icon: "🚗",
  },
] as const

const CATEGORY_ALIASES: Record<string, string[]> = {
  fashion: ["fashion"],
  "phones-and-tablets": ["phones", "phone", "tablets", "mobile-phones"],
  computing: ["computing", "computers", "laptops"],
  electronics: ["electronics"],
  "home-and-kitchen": ["home", "kitchen", "home-and-living"],
  appliances: ["appliances"],
  "beauty-and-personal-care": ["beauty", "personal-care"],
  "food-and-groceries": ["food", "food-and-drinks", "groceries"],
  "baby-kids-and-toys": ["baby", "kids", "toys"],
  "health-and-wellness": ["health", "wellness"],
  "sports-and-fitness": ["sports", "fitness"],
  "automotive-accessories": ["automotive", "auto-accessories"],
}

export function toCategorySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function getCategoryName(slug: string): string | null {
  return (
    STORE_CATEGORIES.find((category) => category.slug === slug)?.name ?? null
  )
}

export function categoryMatchesSlug(value: string, slug: string): boolean {
  const normalizedValue = toCategorySlug(value)

  return (
    normalizedValue === slug ||
    (CATEGORY_ALIASES[slug]?.includes(normalizedValue) ?? false)
  )
}
