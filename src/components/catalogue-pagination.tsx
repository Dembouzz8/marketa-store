import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { catalogueHref, type CatalogueParams } from "@/lib/catalogue"

export function CataloguePagination({ params, page, totalPages }: { params: CatalogueParams; page: number; totalPages: number }) {
  if (totalPages <= 1) return null
  const pages = Array.from(new Set([1, page - 1, page, page + 1, totalPages])).filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b)
  return (
    <nav className="mt-10 flex flex-wrap items-center justify-center gap-2" aria-label="Catalogue pagination">
      {page > 1 ? <Link href={catalogueHref(params, { page: page - 1 })} className="flex min-h-11 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium"><ChevronLeft className="size-4" /> Previous</Link> : <span className="flex min-h-11 items-center gap-1 rounded-lg border border-zinc-100 px-3 text-sm text-zinc-300"><ChevronLeft className="size-4" /> Previous</span>}
      {pages.map((item, index) => <span key={item} className="contents">{index > 0 && item - pages[index - 1] > 1 && <span className="px-1 text-zinc-400">…</span>}<Link href={catalogueHref(params, { page: item })} aria-current={item === page ? "page" : undefined} className={`flex size-11 items-center justify-center rounded-lg text-sm font-semibold ${item === page ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"}`}>{item}</Link></span>)}
      {page < totalPages ? <Link href={catalogueHref(params, { page: page + 1 })} className="flex min-h-11 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium">Next <ChevronRight className="size-4" /></Link> : <span className="flex min-h-11 items-center gap-1 rounded-lg border border-zinc-100 px-3 text-sm text-zinc-300">Next <ChevronRight className="size-4" /></span>}
    </nav>
  )
}
