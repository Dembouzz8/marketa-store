"use client"

import { Loader2, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  setVariantProductPublication,
  type VariantPublicationActionResult,
} from "@/lib/vendor/variant-publication"
import { cn } from "@/lib/utils"

export type VariantPublicationState = "draft" | "published" | "unavailable"

type VariantPublicationPanelProps = {
  productId: string
  publicationState: VariantPublicationState
  enabled: boolean
  combinationCount: number
  hasAvailableStock: boolean
}

type Feedback = Pick<VariantPublicationActionResult, "status" | "message">

export function VariantPublicationPanel({
  productId,
  publicationState,
  enabled,
  combinationCount,
  hasAvailableStock,
}: VariantPublicationPanelProps) {
  const router = useRouter()
  const inFlightRef = useRef(false)
  const [isPending, startTransition] = useTransition()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [targetActive, setTargetActive] = useState<boolean | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const controlsAvailable = enabled && publicationState !== "unavailable"

  const submitPublication = () => {
    if (targetActive === null || inFlightRef.current || isPending) return

    inFlightRef.current = true
    setIsSubmitting(true)
    const requestedActive = targetActive
    setFeedback(null)

    startTransition(async () => {
      try {
        const result = await setVariantProductPublication(
          productId,
          requestedActive
        )
        setFeedback({ status: result.status, message: result.message })

        if (result.status === "success") {
          setTargetActive(null)
          router.refresh()
        }
      } catch {
        setFeedback({
          status: "error",
          message: "Unable to update publication right now. Please try again.",
        })
      } finally {
        inFlightRef.current = false
        setIsSubmitting(false)
      }
    })
  }

  const stateLabel =
    publicationState === "published"
      ? "Published"
      : publicationState === "draft"
        ? "Draft"
        : "State unavailable"

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-zinc-900">
              Variant publication
            </h2>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                publicationState === "published"
                  ? "bg-emerald-100 text-emerald-800"
                  : publicationState === "draft"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-zinc-100 text-zinc-600"
              )}
            >
              {stateLabel}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Publication changes are applied atomically to this product and its
            combinations. The database remains the final eligibility authority.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600">
            <span className="rounded-full bg-zinc-100 px-2.5 py-1">
              {combinationCount} {combinationCount === 1 ? "combination" : "combinations"}
            </span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1">
              {hasAvailableStock ? "Stock available" : "No stock available"}
            </span>
          </div>
        </div>

        {controlsAvailable ? (
          <Button
            type="button"
            onClick={() => {
              setFeedback(null)
              setTargetActive(publicationState === "draft")
            }}
            disabled={isPending || isSubmitting}
            className={cn(
              "shrink-0 rounded-lg",
              publicationState === "draft"
                ? "bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400"
                : "bg-zinc-900 text-white hover:bg-zinc-700"
            )}
          >
            {publicationState === "draft"
              ? "Publish Product"
              : "Unpublish Product"}
          </Button>
        ) : (
          <p className="max-w-sm rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
            {enabled
              ? "Publication state could not be confirmed. Refresh before making publication changes."
              : "Publication controls are not enabled."}
          </p>
        )}
      </div>

      {feedback ? (
        <p
          aria-live="polite"
          className={cn(
            "mt-4 rounded-lg border px-3 py-2 text-sm",
            feedback.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          )}
        >
          {feedback.message}
        </p>
      ) : null}

      {controlsAvailable ? (
        <Dialog
          open={targetActive !== null}
          onOpenChange={(open) => {
            if (!open && !isPending && !isSubmitting) {
              setTargetActive(null)
            }
          }}
        >
          <DialogContent className="bg-white shadow-2xl">
            <DialogHeader>
              <DialogTitle>
                {targetActive ? "Publish this product?" : "Unpublish this product?"}
              </DialogTitle>
              <DialogDescription>
                {targetActive
                  ? "The database will verify ownership, release readiness, configuration, combinations, and stock before publishing."
                  : "The product and all of its combinations will return to Draft. Structural editing will become available after the authoritative state refreshes."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTargetActive(null)}
                disabled={isPending || isSubmitting}
                className="rounded-lg border-zinc-200"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitPublication}
                disabled={isPending || isSubmitting}
                className={cn(
                  "rounded-lg",
                  targetActive
                    ? "bg-amber-500 font-semibold text-zinc-900 hover:bg-amber-400"
                    : "bg-zinc-900 text-white hover:bg-zinc-700"
                )}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {targetActive ? "Publish Product" : "Unpublish Product"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}
