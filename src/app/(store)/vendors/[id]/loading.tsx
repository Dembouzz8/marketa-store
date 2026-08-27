import { Skeleton } from "@/components/ui/skeleton"

export default function VendorStorefrontLoading() {
  return (
    <main
      className="min-h-screen bg-white"
      aria-busy="true"
      aria-label="Loading vendor storefront"
    >
      <section className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <Skeleton className="h-5 w-32 bg-zinc-700" />
          <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start">
            <Skeleton className="size-16 rounded-2xl bg-zinc-700 sm:size-20" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-4 w-36 bg-zinc-700" />
              <Skeleton className="h-10 w-56 max-w-full bg-zinc-700 sm:w-80" />
              <div className="flex flex-wrap gap-3">
                <Skeleton className="h-7 w-28 rounded-full bg-zinc-700" />
                <Skeleton className="h-7 w-36 rounded-full bg-zinc-700" />
              </div>
              <div className="max-w-2xl space-y-2 pt-1">
                <Skeleton className="h-4 w-full bg-zinc-700" />
                <Skeleton className="h-4 w-4/5 bg-zinc-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-xl border border-zinc-100 bg-white p-4 shadow-sm"
              >
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="mt-4 h-5 w-4/5" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-3 h-6 w-2/5" />
                <Skeleton className="mt-4 h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-5 border-t border-zinc-200 pt-10 md:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-6"
              >
                <Skeleton className="size-10 rounded-xl" />
                <Skeleton className="mt-4 h-6 w-44 max-w-full" />
                <Skeleton className="mt-4 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
