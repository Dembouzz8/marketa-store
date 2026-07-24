import { Skeleton } from "@/components/ui/skeleton"

export default function ProductDetailLoading() {
  return (
    <main className="bg-white py-8 sm:py-12 lg:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Skeleton className="mb-7 h-11 w-36" />
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="space-y-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <div className="flex gap-3"><Skeleton className="size-20 rounded-lg" /><Skeleton className="size-20 rounded-lg" /></div>
          </div>
          <div className="space-y-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </main>
  )
}
