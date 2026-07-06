"use client"

import * as React from "react"

type ToastVariant = "default" | "destructive"

export interface Toast {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  variant?: ToastVariant
}

type ToastInput = Omit<Toast, "id">

const listeners = new Set<(toasts: Toast[]) => void>()
let memoryToasts: Toast[] = []

function emit() {
  listeners.forEach((listener) => listener(memoryToasts))
}

export function toast(input: ToastInput) {
  const id = crypto.randomUUID()
  memoryToasts = [{ id, ...input }, ...memoryToasts].slice(0, 4)
  emit()

  window.setTimeout(() => {
    dismissToast(id)
  }, 3500)

  return { id, dismiss: () => dismissToast(id) }
}

export function dismissToast(id: string) {
  memoryToasts = memoryToasts.filter((toastItem) => toastItem.id !== id)
  emit()
}

export function useToast() {
  const [toasts, setToasts] = React.useState<Toast[]>(memoryToasts)

  React.useEffect(() => {
    listeners.add(setToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])

  return { toasts, toast, dismiss: dismissToast }
}
