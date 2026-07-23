"use client"

import { Filter } from "lucide-react"
import { useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

export function CatalogueMobileFilters({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900">
        <Filter className="size-4" /> Filters
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[100dvh] max-h-[100dvh] gap-0 overflow-hidden rounded-t-2xl bg-white p-0 sm:h-[90dvh] sm:max-h-[90dvh]" showCloseButton>
        <SheetHeader className="shrink-0 border-b border-zinc-200 px-5 py-4">
          <SheetTitle>Filter products</SheetTitle>
          <SheetDescription>Refine the catalogue, then apply your choices.</SheetDescription>
        </SheetHeader>
        <form action="/products" className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [-webkit-overflow-scrolling:touch]">
            {children}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-zinc-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <a href="/products" className="flex min-h-12 items-center justify-center rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-700">Clear all</a>
            <button className="min-h-12 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white">Apply</button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
