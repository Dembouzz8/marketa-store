import ProductSkeleton from "@/components/product-skeleton"

export default function ProductsLoading() {
  return <main className="min-h-screen bg-white"><div className="h-64 animate-pulse bg-zinc-950" /><section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"><div className="mb-8 h-10 w-48 animate-pulse rounded-lg bg-zinc-100" /><div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]"><div className="hidden h-96 animate-pulse rounded-xl bg-zinc-100 lg:block" /><ProductSkeleton /></div></section></main>
}
