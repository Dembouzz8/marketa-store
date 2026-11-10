import {
  normalizeCartItemsV1,
  normalizeLegacyCartItems,
} from "@/lib/cart-model"
import type { CartItemV1 } from "@/types"
import type { PersistOptions, PersistStorage } from "zustand/middleware"

export const CART_STORAGE_KEY = "marketa-cart"
export const CART_PERSISTENCE_VERSION = 1

export type CartPersistenceStatus =
  | "unchecked"
  | "healthy"
  | "corrupt"
  | "incompatible"
  | "unavailable"
export type CartPersistenceOperation = "idle" | "read" | "write" | "remove"
export type CartPersistenceDiagnostic =
  | "CART_STORAGE_CORRUPT_JSON"
  | "CART_STORAGE_INVALID_RECORD"
  | "CART_STORAGE_UNSUPPORTED_VERSION"
  | "CART_STORAGE_UNAVAILABLE"
  | "CART_STORAGE_READ_FAILED"
  | "CART_STORAGE_WRITE_FAILED"
  | "CART_STORAGE_REMOVE_FAILED"

export interface CartPersistenceHealth {
  status: CartPersistenceStatus
  operation: CartPersistenceOperation
  diagnostic: CartPersistenceDiagnostic | null
  hasStoredValue: boolean | null
  revision: number
}

export interface CartPersistenceHealthStore {
  getSnapshot(): CartPersistenceHealth
  subscribe(listener: () => void): () => void
}

export interface CartRawStorage {
  getItem(name: string): string | null
  setItem(name: string, value: string): void
  removeItem(name: string): void
}

export interface CartPersistedStateV1 {
  items: CartItemV1[]
}

export interface FutureCartState extends CartPersistedStateV1 {
  isCartOpen: boolean
}

export interface CreateCartPersistStorageOptions {
  getStorage?: () => CartRawStorage | null
}

export interface CartPersistenceController {
  storage: PersistStorage<unknown>
  health: CartPersistenceHealthStore
}

type HealthUpdate = Omit<CartPersistenceHealth, "revision">
type StorageOperation = Exclude<CartPersistenceOperation, "idle">
type MutationOperation = Extract<StorageOperation, "write" | "remove">

export class UnsupportedCartPersistenceVersionError extends Error {
  constructor() {
    super("Unsupported cart persistence version")
    this.name = "UnsupportedCartPersistenceVersionError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function browserStorage(): CartRawStorage | null {
  if (typeof window === "undefined") return null
  return window.localStorage
}

function envelopeFromUnknown(value: unknown):
  | { valid: true; value: { state: unknown; version: number } }
  | { valid: false; unsupported: boolean } {
  if (!isRecord(value)) {
    return { valid: false, unsupported: false }
  }

  const version = "version" in value ? value.version : 0
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    return { valid: false, unsupported: false }
  }

  if (version > CART_PERSISTENCE_VERSION) {
    return { valid: false, unsupported: true }
  }

  if (!("state" in value)) {
    return { valid: false, unsupported: false }
  }

  if (!isRecord(value.state)) {
    return { valid: false, unsupported: false }
  }

  if ("items" in value.state && !Array.isArray(value.state.items)) {
    return { valid: false, unsupported: false }
  }

  return {
    valid: true,
    value: {
      state: value.state,
      version,
    },
  }
}

function itemsFromPersistedState(value: unknown): unknown {
  return isRecord(value) ? value.items : undefined
}

/**
 * Creates a lazy JSON adapter for Zustand persist plus an observable health
 * store. Calling this factory does not access window or localStorage.
 *
 * An incompatible envelope locks this controller for its lifetime. Every
 * destructive operation also rechecks the current raw envelope so a fresh
 * controller cannot sequentially bypass another controller's detection.
 * Browser storage has no atomic compare-and-swap, so this read-before-write
 * guard does not claim protection from simultaneous cross-tab mutations.
 */
export function createCartPersistStorage(
  options: CreateCartPersistStorageOptions = {}
): CartPersistenceController {
  const getStorage = options.getStorage ?? browserStorage
  const listeners = new Set<() => void>()
  const unresolvedFailures = new Map<
    StorageOperation,
    CartPersistenceDiagnostic
  >()
  let incompatibleLocked = false
  let snapshot: CartPersistenceHealth = Object.freeze({
    status: "unchecked",
    operation: "idle",
    diagnostic: null,
    hasStoredValue: null,
    revision: 0,
  })

  function publish(update: HealthUpdate): void {
    snapshot = Object.freeze({ ...update, revision: snapshot.revision + 1 })
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Observer failures must not change the result of a storage operation.
      }
    }
  }

  function latestFailure(): CartPersistenceDiagnostic | null {
    const diagnostics = [...unresolvedFailures.values()]
    return diagnostics.at(-1) ?? null
  }

  function publishIncompatible(
    operation: StorageOperation,
    hasStoredValue: boolean | null
  ): void {
    publish({
      status: "incompatible",
      operation,
      diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
      hasStoredValue,
    })
  }

  function recordFailure(
    operation: StorageOperation,
    diagnostic: CartPersistenceDiagnostic
  ): void {
    unresolvedFailures.delete(operation)
    unresolvedFailures.set(operation, diagnostic)
    publish({
      status: "unavailable",
      operation,
      diagnostic,
      hasStoredValue: null,
    })
  }

  function publishSuccessfulOperation(
    operation: StorageOperation,
    hasStoredValue: boolean
  ): void {
    unresolvedFailures.delete(operation)

    if (incompatibleLocked) {
      publishIncompatible(operation, hasStoredValue)
      return
    }

    const diagnostic = latestFailure()
    publish({
      status: diagnostic ? "unavailable" : "healthy",
      operation,
      diagnostic,
      hasStoredValue,
    })
  }

  function publishDataIssue(
    diagnostic: Extract<
      CartPersistenceDiagnostic,
      "CART_STORAGE_CORRUPT_JSON" | "CART_STORAGE_INVALID_RECORD"
    >
  ): void {
    unresolvedFailures.delete("read")

    if (incompatibleLocked) {
      publishIncompatible("read", true)
      return
    }

    const unresolvedDiagnostic = latestFailure()
    publish({
      status: unresolvedDiagnostic ? "unavailable" : "corrupt",
      operation: "read",
      diagnostic: unresolvedDiagnostic ?? diagnostic,
      hasStoredValue: true,
    })
  }

  function resolveStorage(
    operation: StorageOperation,
    failureDiagnostic: CartPersistenceDiagnostic
  ): CartRawStorage | null {
    let rawStorage: CartRawStorage | null
    try {
      rawStorage = getStorage()
    } catch {
      recordFailure(operation, failureDiagnostic)
      return null
    }

    if (!rawStorage) {
      recordFailure(operation, "CART_STORAGE_UNAVAILABLE")
      return null
    }
    return rawStorage
  }

  function mutationFailureDiagnostic(
    operation: MutationOperation
  ): CartPersistenceDiagnostic {
    return operation === "write"
      ? "CART_STORAGE_WRITE_FAILED"
      : "CART_STORAGE_REMOVE_FAILED"
  }

  function recordMutationPreflightReadFailure(
    operation: MutationOperation
  ): void {
    unresolvedFailures.delete("read")
    unresolvedFailures.set("read", "CART_STORAGE_READ_FAILED")
    recordFailure(operation, mutationFailureDiagnostic(operation))
  }

  /**
   * Validates the current backend value immediately before a mutation.
   * Successful preflight reads are deliberately silent health transitions;
   * the attempted mutation owns the resulting observable status.
   */
  function preflightMutation(
    name: string,
    operation: MutationOperation
  ): CartRawStorage | null {
    if (incompatibleLocked) {
      publishIncompatible(operation, true)
      return null
    }

    const rawStorage = resolveStorage(
      operation,
      mutationFailureDiagnostic(operation)
    )
    if (!rawStorage) return null

    let rawValue: string | null
    try {
      rawValue = rawStorage.getItem(name)
    } catch {
      recordMutationPreflightReadFailure(operation)
      return null
    }

    if (rawValue === null) {
      unresolvedFailures.delete("read")
      return rawStorage
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawValue) as unknown
    } catch {
      // Corrupt JSON remains intentionally replaceable by a later mutation.
      return rawStorage
    }

    const envelope = envelopeFromUnknown(parsed)
    if (!envelope.valid && envelope.unsupported) {
      unresolvedFailures.delete("read")
      incompatibleLocked = true
      publishIncompatible(operation, true)
      return null
    }

    if (envelope.valid) {
      unresolvedFailures.delete("read")
    }

    // Invalid supported envelopes retain the existing recoverable behavior.
    return rawStorage
  }

  const storage: PersistStorage<unknown> = {
    getItem(name) {
      const rawStorage = resolveStorage("read", "CART_STORAGE_READ_FAILED")
      if (!rawStorage) return null

      let rawValue: string | null
      try {
        rawValue = rawStorage.getItem(name)
      } catch {
        recordFailure("read", "CART_STORAGE_READ_FAILED")
        return null
      }

      if (rawValue === null) {
        publishSuccessfulOperation("read", false)
        return null
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawValue) as unknown
      } catch {
        publishDataIssue("CART_STORAGE_CORRUPT_JSON")
        return null
      }

      const envelope = envelopeFromUnknown(parsed)
      if (!envelope.valid) {
        if (envelope.unsupported) {
          unresolvedFailures.delete("read")
          incompatibleLocked = true
          publishIncompatible("read", true)
        } else {
          publishDataIssue("CART_STORAGE_INVALID_RECORD")
        }
        return null
      }

      publishSuccessfulOperation("read", true)
      return envelope.value
    },

    setItem(name, value) {
      const rawStorage = preflightMutation(name, "write")
      if (!rawStorage) return

      let serialized: string
      try {
        serialized = JSON.stringify(value)
      } catch {
        recordFailure("write", "CART_STORAGE_WRITE_FAILED")
        return
      }

      try {
        rawStorage.setItem(name, serialized)
      } catch {
        recordFailure("write", "CART_STORAGE_WRITE_FAILED")
        return
      }

      publishSuccessfulOperation("write", true)
    },

    removeItem(name) {
      const rawStorage = preflightMutation(name, "remove")
      if (!rawStorage) return

      try {
        rawStorage.removeItem(name)
      } catch {
        recordFailure("remove", "CART_STORAGE_REMOVE_FAILED")
        return
      }

      publishSuccessfulOperation("remove", false)
    },
  }

  const health: CartPersistenceHealthStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return { storage, health }
}

/** Uses the accepted version-0 normalizer and never infers variant identity. */
export function migrateCartPersistedState(
  persistedState: unknown,
  version: number
): CartPersistedStateV1 {
  if (version !== 0) throw new UnsupportedCartPersistenceVersionError()
  return {
    items: normalizeLegacyCartItems(itemsFromPersistedState(persistedState)),
  }
}

/** Revalidates untrusted v1 data and only merges the persisted cart slice. */
export function mergeCartPersistedState<T extends FutureCartState>(
  persistedState: unknown,
  currentState: T
): T {
  return {
    ...currentState,
    items: normalizeCartItemsV1(itemsFromPersistedState(persistedState)),
    isCartOpen: false,
  }
}

/**
 * Reusable future-store configuration. It intentionally is not connected to
 * the active version-0 useCartStore in this batch.
 */
export function createCartPersistOptions<T extends FutureCartState>(
  storage: PersistStorage<unknown>
): PersistOptions<T, unknown> {
  return {
    name: CART_STORAGE_KEY,
    version: CART_PERSISTENCE_VERSION,
    storage,
    partialize: (state) => ({
      items: normalizeCartItemsV1(state.items),
    }),
    migrate: migrateCartPersistedState,
    merge: mergeCartPersistedState,
  }
}
