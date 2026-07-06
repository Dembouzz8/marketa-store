"use client"

import { X } from "lucide-react"

import { dismissToast, useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3">
      {toasts.map((toastItem) => (
        <div
          key={toastItem.id}
          className={cn(
            "rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-900 shadow-2xl",
            toastItem.variant === "destructive" &&
              "border-red-200 bg-red-50 text-red-900"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {toastItem.title && (
                <p className="font-semibold">{toastItem.title}</p>
              )}
              {toastItem.description && (
                <p className="text-zinc-500">{toastItem.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toastItem.id)}
              className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
