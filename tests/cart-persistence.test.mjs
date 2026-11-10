import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { persist } from "zustand/middleware"
import { createStore } from "zustand/vanilla"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function transpile(file) {
  const result = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }
  )
  assert.equal(result.diagnostics?.length ?? 0, 0)
  return result.outputText
}

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
}

const parserUrl = moduleUrl(transpile("src/lib/public-product-variants.ts"))
const cartModelOutput = transpile("src/lib/cart-model.ts").replace(
  /from ["']@\/lib\/public-product-variants["']/u,
  `from "${parserUrl}"`
)
assert.doesNotMatch(cartModelOutput, /@\/lib\/public-product-variants/u)

const cartModelUrl = moduleUrl(cartModelOutput)
const cartStorageOutput = transpile("src/lib/cart-storage.ts").replace(
  /from ["']@\/lib\/cart-model["']/u,
  `from "${cartModelUrl}"`
)
assert.doesNotMatch(cartStorageOutput, /@\/lib\/cart-model/u)

const {
  CART_PERSISTENCE_VERSION,
  CART_STORAGE_KEY,
  UnsupportedCartPersistenceVersionError,
  createCartPersistOptions,
  createCartPersistStorage,
  mergeCartPersistedState,
  migrateCartPersistedState,
} = await import(moduleUrl(cartStorageOutput))

const ids = {
  product: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherProduct: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  variant: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  axis: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  value: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
}

function legacyItem(overrides = {}) {
  return {
    product: {
      id: ids.product,
      vendor_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      name: "Legacy ordinary product",
      description: "Not retained",
      price: 12_500.5,
      stock: 14,
      category: "Tests",
      images: ["https://example.test/ordinary.jpg"],
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      variant_mode: "none",
      ...overrides,
    },
    quantity: 2,
  }
}

function ordinaryItem(overrides = {}) {
  return {
    kind: "ordinary",
    cartLineId: `ordinary:${ids.product}`,
    product: {
      id: ids.product,
      name: "Ordinary product",
      price: 12_500.5,
      images: ["https://example.test/ordinary.jpg"],
    },
    quantity: 2,
    stock_snapshot: 14,
    ...overrides,
  }
}

function variantItem(overrides = {}) {
  return {
    kind: "variant",
    cartLineId: `variant:${ids.product}:${ids.variant}`,
    product: {
      id: ids.product,
      name: "Variant product",
      price: 8_000,
      images: ["https://example.test/variant.jpg"],
    },
    quantity: 1,
    variant: {
      product_id: ids.product,
      variant_id: ids.variant,
      variant_mode: "size",
      stock_snapshot: 6,
      selected_options: [
        {
          axis_id: ids.axis,
          value_id: ids.value,
          axis_label: "Size",
          value_label: "Large",
        },
      ],
    },
    ...overrides,
  }
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  const operations = {
    get: 0,
    set: 0,
    remove: 0,
  }
  const failures = {
    get: false,
    set: false,
    remove: false,
  }
  const storage = {
    getItem(name) {
      operations.get += 1
      if (failures.get) throw new Error("private read failure payload")
      return values.get(name) ?? null
    },
    setItem(name, value) {
      operations.set += 1
      if (failures.set) throw new Error("private write failure payload")
      values.set(name, value)
    },
    removeItem(name) {
      operations.remove += 1
      if (failures.remove) throw new Error("private remove failure payload")
      values.delete(name)
    },
  }
  return { failures, operations, storage, values }
}

function envelope(state, version = CART_PERSISTENCE_VERSION) {
  return JSON.stringify({ state, version })
}

function createIsolatedStore(controller, initialOpen = false) {
  return createStore(
    persist(
      (set) => ({
        items: [],
        isCartOpen: initialOpen,
        marker: "live-state",
        replaceItems: (items) => set({ items }),
        setCartOpen: (isCartOpen) => set({ isCartOpen }),
      }),
      {
        ...createCartPersistOptions(controller.storage),
        skipHydration: true,
      }
    )
  )
}

function controllerFor(memory) {
  return createCartPersistStorage({ getStorage: () => memory.storage })
}

async function hydrate(store) {
  await store.persist.rehydrate()
  assert.equal(store.persist.hasHydrated(), true)
}

test("factory is SSR-lazy and missing storage is observably unavailable", async () => {
  const controller = createCartPersistStorage()
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "unchecked",
    operation: "idle",
    diagnostic: null,
    hasStoredValue: null,
    revision: 0,
  })

  const store = createIsolatedStore(controller)
  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "unavailable",
    operation: "read",
    diagnostic: "CART_STORAGE_UNAVAILABLE",
    hasStoredValue: null,
    revision: 1,
  })
})

test("empty storage hydrates and is distinct from corruption and failure", async () => {
  const memory = createMemoryStorage()
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller, true)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.equal(store.getState().isCartOpen, false)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "healthy",
    operation: "read",
    diagnostic: null,
    hasStoredValue: false,
    revision: 1,
  })
})

test("actual middleware migrates version 0 through the accepted legacy normalizer", async () => {
  const invalidVariant = legacyItem({
    id: ids.otherProduct,
    name: "Never infer this variant",
    variant_mode: "size",
  })
  const invalidPrice = legacyItem({
    id: ids.otherProduct,
    price: Number.MAX_VALUE,
  })
  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: envelope(
      {
        items: [
          legacyItem(),
          { ...legacyItem(), quantity: 98 },
          invalidVariant,
          invalidPrice,
        ],
        isCartOpen: true,
      },
      0
    ),
  })
  const store = createIsolatedStore(controllerFor(memory), true)

  await hydrate(store)
  assert.equal(store.getState().items.length, 1)
  assert.deepEqual(store.getState().items[0], {
    kind: "ordinary",
    cartLineId: `ordinary:${ids.product}`,
    product: {
      id: ids.product,
      name: "Legacy ordinary product",
      price: 12_500.5,
      images: ["https://example.test/ordinary.jpg"],
    },
    quantity: 99,
    stock_snapshot: 14,
  })
  assert.equal(store.getState().isCartOpen, false)

  const rewritten = JSON.parse(memory.values.get(CART_STORAGE_KEY))
  assert.equal(rewritten.version, 1)
  assert.deepEqual(Object.keys(rewritten.state), ["items"])
  assert.equal(memory.operations.set, 1)
})

test("missing-version envelopes are normalized to legacy version 0 before middleware migration", async () => {
  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: JSON.stringify({
      state: { items: [legacyItem()], isCartOpen: true },
    }),
  })
  const store = createIsolatedStore(controllerFor(memory), true)

  await hydrate(store)
  assert.equal(store.getState().items[0].kind, "ordinary")
  assert.equal(store.getState().isCartOpen, false)
  assert.equal(
    JSON.parse(memory.values.get(CART_STORAGE_KEY)).version,
    CART_PERSISTENCE_VERSION
  )
  assert.equal(memory.operations.set, 1)
})

test("valid version 1 ordinary and variant records reload through revalidation", async () => {
  const raw = envelope({
    items: [
      { ...ordinaryItem(), cartLineId: "tampered", extra: "ignored" },
      {
        ...variantItem(),
        cartLineId: "tampered",
        extra: "ignored",
      },
    ],
    unknown: "ignored",
  })
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
  const store = createIsolatedStore(controllerFor(memory))

  await hydrate(store)
  assert.equal(store.getState().items.length, 2)
  assert.equal(
    store.getState().items[0].cartLineId,
    `ordinary:${ids.product}`
  )
  assert.equal(
    store.getState().items[1].cartLineId,
    `variant:${ids.product}:${ids.variant}`
  )
  assert.equal("extra" in store.getState().items[0], false)
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.equal(memory.operations.set, 0)
})

test("malformed JSON is retained, diagnosed, and does not prevent hydration", async () => {
  const corrupt = `${envelope({ items: [ordinaryItem()] })} trailing-data`
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: corrupt })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller, true)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.equal(store.getState().isCartOpen, false)
  assert.equal(memory.values.get(CART_STORAGE_KEY), corrupt)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "corrupt",
    operation: "read",
    diagnostic: "CART_STORAGE_CORRUPT_JSON",
    hasStoredValue: true,
    revision: 1,
  })
})

test("a successful write replaces corruption and recovers health", async () => {
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: "{broken" })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)
  await hydrate(store)

  store.getState().replaceItems([ordinaryItem()])
  const replacement = JSON.parse(memory.values.get(CART_STORAGE_KEY))
  assert.equal(replacement.version, 1)
  assert.deepEqual(replacement.state.items, [ordinaryItem()])
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "healthy",
    operation: "write",
    diagnostic: null,
    hasStoredValue: true,
    revision: 2,
  })
})

test("valid JSON with an invalid envelope is rejected without deletion", async () => {
  const raw = JSON.stringify({ items: [ordinaryItem()], version: 1 })
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.equal(controller.health.getSnapshot().status, "corrupt")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_INVALID_RECORD"
  )
})

test("primitive, null, array, missing-state, and malformed-items envelopes are rejected", async () => {
  const invalidStates = [null, 5, "cart", false, []]
  const rawRecords = [
    ...invalidStates.map((state) => JSON.stringify({ state, version: 1 })),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ state: { items: "not-an-array" }, version: 1 }),
  ]

  for (const raw of rawRecords) {
    const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
    const controller = controllerFor(memory)
    const store = createIsolatedStore(controller)

    await hydrate(store)
    assert.deepEqual(store.getState().items, [])
    assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
    assert.equal(memory.operations.set, 0)
    assert.equal(controller.health.getSnapshot().status, "corrupt")
    assert.equal(
      controller.health.getSnapshot().diagnostic,
      "CART_STORAGE_INVALID_RECORD"
    )
  }
})

test("empty cart-state records and item arrays are valid envelopes", async () => {
  for (const state of [{}, { items: [] }]) {
    const memory = createMemoryStorage({
      [CART_STORAGE_KEY]: envelope(state),
    })
    const controller = controllerFor(memory)
    const store = createIsolatedStore(controller)

    await hydrate(store)
    assert.deepEqual(store.getState().items, [])
    assert.equal(controller.health.getSnapshot().status, "healthy")
    assert.equal(memory.operations.set, 0)
  }
})

test("read failure is unavailable, hydration completes, and a later read recovers", async () => {
  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: envelope({ items: [ordinaryItem()] }),
  })
  memory.failures.get = true
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_READ_FAILED"
  )

  memory.failures.get = false
  await hydrate(store)
  assert.equal(store.getState().items.length, 1)
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(controller.health.getSnapshot().operation, "read")
})

test("failed writes remain observable and a later successful write recovers", async () => {
  const memory = createMemoryStorage()
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)
  await hydrate(store)

  memory.failures.set = true
  store.getState().replaceItems([ordinaryItem()])
  assert.equal(memory.values.has(CART_STORAGE_KEY), false)
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_WRITE_FAILED"
  )
  assert.equal(controller.health.getSnapshot().hasStoredValue, null)

  memory.failures.set = false
  controller.storage.getItem(CART_STORAGE_KEY)
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(controller.health.getSnapshot().operation, "read")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_WRITE_FAILED"
  )
  assert.equal(controller.health.getSnapshot().hasStoredValue, false)

  store.getState().replaceItems([ordinaryItem({ quantity: 3 })])
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(controller.health.getSnapshot().operation, "write")
  assert.equal(
    JSON.parse(memory.values.get(CART_STORAGE_KEY)).state.items[0].quantity,
    3
  )
})

test("failed removals do not report success and a later removal recovers", async () => {
  const raw = envelope({ items: [ordinaryItem()] })
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)
  await hydrate(store)

  memory.failures.remove = true
  store.persist.clearStorage()
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_REMOVE_FAILED"
  )

  memory.failures.remove = false
  controller.storage.getItem(CART_STORAGE_KEY)
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(controller.health.getSnapshot().operation, "read")
  assert.equal(
    controller.health.getSnapshot().diagnostic,
    "CART_STORAGE_REMOVE_FAILED"
  )
  assert.equal(controller.health.getSnapshot().hasStoredValue, true)

  store.persist.clearStorage()
  assert.equal(memory.values.has(CART_STORAGE_KEY), false)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "healthy",
    operation: "remove",
    diagnostic: null,
    hasStoredValue: false,
    revision: 4,
  })
})

test("health subscriptions expose stable codes without storage payloads", async () => {
  const privatePayload = "customer@example.test-secret"
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: privatePayload })
  const controller = controllerFor(memory)
  const revisions = []
  const initialSnapshot = controller.health.getSnapshot()
  const unsubscribe = controller.health.subscribe(() => {
    revisions.push(controller.health.getSnapshot().revision)
  })
  const store = createIsolatedStore(controller)

  await hydrate(store)
  const corruptSnapshot = controller.health.getSnapshot()
  const sameCorruptSnapshot = controller.health.getSnapshot()
  unsubscribe()
  controller.storage.getItem(CART_STORAGE_KEY)
  assert.deepEqual(revisions, [1])
  assert.equal(Object.isFrozen(initialSnapshot), true)
  assert.equal(Object.isFrozen(corruptSnapshot), true)
  assert.equal(corruptSnapshot, sameCorruptSnapshot)
  assert.notEqual(initialSnapshot, corruptSnapshot)
  assert.equal(corruptSnapshot.revision, 1)
  assert.equal(controller.health.getSnapshot().revision, 2)
  assert.equal(
    JSON.stringify(controller.health.getSnapshot()).includes(privatePayload),
    false
  )
})

test("subscribers observe sticky failures and same-operation recovery", async () => {
  const memory = createMemoryStorage()
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)
  await hydrate(store)

  const transitions = []
  const unsubscribe = controller.health.subscribe(() => {
    const health = controller.health.getSnapshot()
    transitions.push({
      revision: health.revision,
      status: health.status,
      operation: health.operation,
      diagnostic: health.diagnostic,
    })
  })

  memory.failures.set = true
  store.getState().replaceItems([ordinaryItem()])
  memory.failures.set = false
  controller.storage.getItem(CART_STORAGE_KEY)
  store.getState().replaceItems([ordinaryItem({ quantity: 3 })])

  memory.failures.remove = true
  store.persist.clearStorage()
  memory.failures.remove = false
  controller.storage.getItem(CART_STORAGE_KEY)
  store.persist.clearStorage()
  unsubscribe()
  controller.storage.getItem(CART_STORAGE_KEY)

  assert.deepEqual(transitions, [
    {
      revision: 2,
      status: "unavailable",
      operation: "write",
      diagnostic: "CART_STORAGE_WRITE_FAILED",
    },
    {
      revision: 3,
      status: "unavailable",
      operation: "read",
      diagnostic: "CART_STORAGE_WRITE_FAILED",
    },
    {
      revision: 4,
      status: "healthy",
      operation: "write",
      diagnostic: null,
    },
    {
      revision: 5,
      status: "unavailable",
      operation: "remove",
      diagnostic: "CART_STORAGE_REMOVE_FAILED",
    },
    {
      revision: 6,
      status: "unavailable",
      operation: "read",
      diagnostic: "CART_STORAGE_REMOVE_FAILED",
    },
    {
      revision: 7,
      status: "healthy",
      operation: "remove",
      diagnostic: null,
    },
  ])
})

test("v1 validation drops malformed entries while preserving valid siblings", async () => {
  const invalidVariant = variantItem()
  invalidVariant.variant.product_id = ids.otherProduct
  const validSibling = ordinaryItem({
    product: {
      ...ordinaryItem().product,
      id: ids.otherProduct,
      name: "Valid sibling",
    },
  })
  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: envelope({
      items: [
        ordinaryItem({ quantity: 1.5 }),
        ordinaryItem({
          product: { ...ordinaryItem().product, id: "not-a-uuid" },
        }),
        invalidVariant,
        { ...ordinaryItem(), kind: "unknown" },
        validSibling,
      ],
    }),
  })
  const store = createIsolatedStore(controllerFor(memory))

  await hydrate(store)
  assert.equal(store.getState().items.length, 1)
  assert.equal(store.getState().items[0].product.name, "Valid sibling")
  assert.equal(
    store.getState().items[0].cartLineId,
    `ordinary:${ids.otherProduct}`
  )
})

test("persisted state cannot inject methods or open the cart", async () => {
  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: envelope({
      items: [ordinaryItem()],
      isCartOpen: true,
      marker: "persisted-overwrite",
      replaceItems: "malicious-function-replacement",
      setCartOpen: "malicious-function-replacement",
    }),
  })
  const store = createIsolatedStore(controllerFor(memory), true)
  const replaceItems = store.getState().replaceItems
  const setCartOpen = store.getState().setCartOpen

  await hydrate(store)
  assert.equal(store.getState().replaceItems, replaceItems)
  assert.equal(store.getState().setCartOpen, setCartOpen)
  assert.equal(store.getState().marker, "live-state")
  assert.equal(store.getState().isCartOpen, false)
})

test("writes persist only canonical items and exclude isCartOpen", async () => {
  const memory = createMemoryStorage()
  const store = createIsolatedStore(controllerFor(memory))
  await hydrate(store)

  store.getState().replaceItems([
    { ...ordinaryItem(), cartLineId: "tampered", extra: true },
  ])
  store.getState().setCartOpen(true)
  const saved = JSON.parse(memory.values.get(CART_STORAGE_KEY))
  assert.deepEqual(Object.keys(saved.state), ["items"])
  assert.equal(saved.state.items[0].cartLineId, `ordinary:${ids.product}`)
  assert.equal("extra" in saved.state.items[0], false)

  const reload = createIsolatedStore(controllerFor(memory), true)
  await hydrate(reload)
  assert.equal(reload.getState().isCartOpen, false)
})

test("migration and v1 reload are deterministic, idempotent, and non-mutating", async () => {
  const source = { items: [legacyItem()] }
  const before = structuredClone(source)
  const once = migrateCartPersistedState(source, 0)
  const twice = mergeCartPersistedState(once, {
    items: [],
    isCartOpen: true,
    action: () => "live",
  })
  assert.deepEqual(source, before)
  assert.deepEqual(twice.items, once.items)
  assert.equal(twice.isCartOpen, false)
  assert.equal(twice.action(), "live")

  const memory = createMemoryStorage({
    [CART_STORAGE_KEY]: envelope(source, 0),
  })
  const firstStore = createIsolatedStore(controllerFor(memory))
  await hydrate(firstStore)
  const migratedRaw = memory.values.get(CART_STORAGE_KEY)

  const secondStore = createIsolatedStore(controllerFor(memory))
  await hydrate(secondStore)
  assert.deepEqual(secondStore.getState().items, firstStore.getState().items)
  assert.equal(memory.values.get(CART_STORAGE_KEY), migratedRaw)
  assert.equal(memory.operations.set, 1)
})

test("direct migration accepts only version 0", () => {
  assert.deepEqual(migrateCartPersistedState({ items: [] }, 0), { items: [] })
  for (const version of [1, 2, 99]) {
    assert.throws(
      () => migrateCartPersistedState({ items: [ordinaryItem()] }, version),
      UnsupportedCartPersistenceVersionError
    )
  }
})

test("future versions hydrate empty and lock their exact raw value", async () => {
  const raw = ` {"state":{"items":[${JSON.stringify(
    ordinaryItem()
  )}],"marker":"future"},"version":99} `
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])
  assert.equal(store.getState().marker, "live-state")
  assert.equal(store.persist.hasHydrated(), true)
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "incompatible",
    operation: "read",
    diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
    hasStoredValue: true,
    revision: 1,
  })

  store.getState().replaceItems([ordinaryItem({ quantity: 3 })])
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  assert.equal(controller.health.getSnapshot().operation, "write")

  store.persist.clearStorage()
  assert.equal(memory.operations.remove, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "incompatible",
    operation: "remove",
    diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
    hasStoredValue: true,
    revision: 3,
  })

  await hydrate(store)
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.operations.remove, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
  assert.deepEqual(controller.health.getSnapshot(), {
    status: "incompatible",
    operation: "read",
    diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
    hasStoredValue: true,
    revision: 4,
  })
})

test("fresh controllers preflight future records before write or removal", () => {
  for (const operation of ["write", "remove"]) {
    const raw = ` {"state":{"items":[],"marker":"future"},"version":99} `
    const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
    const controller = controllerFor(memory)

    if (operation === "write") {
      controller.storage.setItem(CART_STORAGE_KEY, {
        state: { items: [ordinaryItem()] },
        version: CART_PERSISTENCE_VERSION,
      })
    } else {
      controller.storage.removeItem(CART_STORAGE_KEY)
    }

    assert.equal(memory.operations.get, 1)
    assert.equal(memory.operations.set, 0)
    assert.equal(memory.operations.remove, 0)
    assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
    assert.deepEqual(controller.health.getSnapshot(), {
      status: "incompatible",
      operation,
      diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
      hasStoredValue: true,
      revision: 1,
    })
  }
})

test("future versions are incompatible before current envelope validation", async () => {
  const futureRecords = [
    {
      name: "future-payload",
      value: { version: 99, future_payload: { cart: ["opaque"] } },
    },
    { name: "version-two-payload", value: { version: 2, payload: [] } },
    { name: "null-state", value: { version: 99, state: null } },
    { name: "string-state", value: { version: 99, state: "future" } },
    { name: "future-only", value: { version: 99, future_only: true } },
    {
      name: "maximum-safe-version",
      value: { version: 9_007_199_254_740_991, future_data: {} },
    },
  ]

  for (const { name, value } of futureRecords) {
    const raw = ` ${JSON.stringify(value)} `
    const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
    const controller = controllerFor(memory)
    const store = createIsolatedStore(controller)

    await hydrate(store)
    assert.deepEqual(store.getState().items, [], name)
    assert.equal(store.persist.hasHydrated(), true, name)
    assert.equal(memory.operations.set, 0, name)
    assert.equal(memory.operations.remove, 0, name)
    assert.equal(memory.values.get(CART_STORAGE_KEY), raw, name)
    assert.deepEqual(
      controller.health.getSnapshot(),
      {
        status: "incompatible",
        operation: "read",
        diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
        hasStoredValue: true,
        revision: 1,
      },
      name
    )

    store.getState().replaceItems([ordinaryItem({ quantity: 4 })])
    assert.equal(memory.operations.set, 0, name)
    assert.equal(memory.values.get(CART_STORAGE_KEY), raw, name)
    assert.equal(controller.health.getSnapshot().status, "incompatible", name)

    store.persist.clearStorage()
    assert.equal(memory.operations.remove, 0, name)
    assert.equal(memory.values.get(CART_STORAGE_KEY), raw, name)
    assert.equal(controller.health.getSnapshot().status, "incompatible", name)

    if (name === "future-payload") {
      const upgradedRaw = envelope({
        items: [ordinaryItem({ quantity: 7 })],
      })
      memory.values.set(CART_STORAGE_KEY, upgradedRaw)
      assert.equal(
        controller.storage.getItem(CART_STORAGE_KEY).state.items[0].quantity,
        7
      )
      assert.equal(controller.health.getSnapshot().status, "incompatible")

      store.getState().replaceItems([ordinaryItem({ quantity: 8 })])
      assert.equal(memory.operations.set, 0)
      assert.equal(memory.values.get(CART_STORAGE_KEY), upgradedRaw)
      assert.equal(controller.health.getSnapshot().status, "incompatible")
    }
  }
})

test("future schemas block fresh and independent controller mutations", () => {
  const futureRecords = [
    { version: 99, future_payload: { cart: ["opaque"] } },
    { version: 2, payload: [] },
    { version: 99, state: null },
    { version: 99, state: "future" },
    { version: 99, future_only: true },
    { version: 9_007_199_254_740_991, future_data: {} },
  ]

  for (const value of futureRecords) {
    for (const operation of ["write", "remove"]) {
      const raw = ` ${JSON.stringify(value)} `
      const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
      const controllerA = controllerFor(memory)
      const controllerB = controllerFor(memory)

      assert.equal(controllerA.storage.getItem(CART_STORAGE_KEY), null)
      assert.equal(controllerA.health.getSnapshot().status, "incompatible")

      if (operation === "write") {
        controllerB.storage.setItem(CART_STORAGE_KEY, {
          state: { items: [ordinaryItem()] },
          version: CART_PERSISTENCE_VERSION,
        })
      } else {
        controllerB.storage.removeItem(CART_STORAGE_KEY)
      }

      assert.equal(memory.operations.get, 2)
      assert.equal(memory.operations.set, 0)
      assert.equal(memory.operations.remove, 0)
      assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
      assert.deepEqual(controllerB.health.getSnapshot(), {
        status: "incompatible",
        operation,
        diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
        hasStoredValue: true,
        revision: 1,
      })
    }
  }
})

test("each controller independently preflights a shared future record", async () => {
  for (const creationOrder of ["before-detection", "after-detection"]) {
    for (const operation of ["write", "remove"]) {
      const raw = ` {"state":{"items":[]},"version":99} `
      const memory = createMemoryStorage({ [CART_STORAGE_KEY]: raw })
      const controllerB =
        creationOrder === "before-detection" ? controllerFor(memory) : null
      const controllerA = controllerFor(memory)
      const storeA = createIsolatedStore(controllerA)

      await hydrate(storeA)
      const freshController = controllerB ?? controllerFor(memory)

      if (operation === "write") {
        freshController.storage.setItem(CART_STORAGE_KEY, {
          state: { items: [ordinaryItem()] },
          version: CART_PERSISTENCE_VERSION,
        })
      } else {
        freshController.storage.removeItem(CART_STORAGE_KEY)
      }

      assert.equal(memory.operations.get, 2)
      assert.equal(memory.operations.set, 0)
      assert.equal(memory.operations.remove, 0)
      assert.equal(memory.values.get(CART_STORAGE_KEY), raw)
      assert.equal(controllerA.health.getSnapshot().status, "incompatible")
      assert.deepEqual(freshController.health.getSnapshot(), {
        status: "incompatible",
        operation,
        diagnostic: "CART_STORAGE_UNSUPPORTED_VERSION",
        hasStoredValue: true,
        revision: 1,
      })
    }
  }
})

test("an incompatible controller stays locked after an external compatible upgrade", async () => {
  const futureRaw = envelope({ items: [ordinaryItem()] }, 99)
  const upgradedRaw = envelope({
    items: [ordinaryItem({ quantity: 7 })],
  })
  const memory = createMemoryStorage({ [CART_STORAGE_KEY]: futureRaw })
  const controller = controllerFor(memory)
  const store = createIsolatedStore(controller)

  await hydrate(store)
  assert.deepEqual(store.getState().items, [])

  memory.values.set(CART_STORAGE_KEY, upgradedRaw)
  const supportedEnvelope = controller.storage.getItem(CART_STORAGE_KEY)
  assert.equal(supportedEnvelope.version, CART_PERSISTENCE_VERSION)
  assert.equal(supportedEnvelope.state.items[0].quantity, 7)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  assert.equal(controller.health.getSnapshot().operation, "read")

  store.getState().replaceItems([ordinaryItem({ quantity: 3 })])
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), upgradedRaw)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  assert.equal(controller.health.getSnapshot().operation, "write")

  await hydrate(store)
  assert.equal(store.getState().items[0].quantity, 7)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  store.getState().replaceItems([ordinaryItem({ quantity: 8 })])
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(CART_STORAGE_KEY), upgradedRaw)

  const freshController = controllerFor(memory)
  const freshStore = createIsolatedStore(freshController)
  await hydrate(freshStore)
  assert.equal(freshController.health.getSnapshot().status, "healthy")
  assert.equal(freshStore.getState().items[0].quantity, 7)

  freshStore.getState().replaceItems([ordinaryItem({ quantity: 8 })])
  assert.equal(memory.operations.set, 1)
  assert.equal(
    JSON.parse(memory.values.get(CART_STORAGE_KEY)).state.items[0].quantity,
    8
  )
  assert.equal(freshController.health.getSnapshot().status, "healthy")
})

test("preflight read failures block mutations and remain sticky by operation", () => {
  for (const operation of ["write", "remove"]) {
    const initial =
      operation === "remove"
        ? { [CART_STORAGE_KEY]: envelope({ items: [ordinaryItem()] }) }
        : {}
    const memory = createMemoryStorage(initial)
    const controller = controllerFor(memory)
    const transitions = []
    const unsubscribe = controller.health.subscribe(() => {
      transitions.push(controller.health.getSnapshot())
    })
    memory.failures.get = true

    if (operation === "write") {
      controller.storage.setItem(CART_STORAGE_KEY, {
        state: { items: [ordinaryItem()] },
        version: CART_PERSISTENCE_VERSION,
      })
    } else {
      controller.storage.removeItem(CART_STORAGE_KEY)
    }

    assert.equal(memory.operations.get, 1)
    assert.equal(memory.operations.set, 0)
    assert.equal(memory.operations.remove, 0)
    assert.equal(controller.health.getSnapshot().status, "unavailable")
    assert.equal(controller.health.getSnapshot().operation, operation)
    assert.equal(
      controller.health.getSnapshot().diagnostic,
      operation === "write"
        ? "CART_STORAGE_WRITE_FAILED"
        : "CART_STORAGE_REMOVE_FAILED"
    )
    assert.equal(controller.health.getSnapshot().revision, 1)
    assert.equal(Object.isFrozen(controller.health.getSnapshot()), true)

    memory.failures.get = false
    controller.storage.getItem(CART_STORAGE_KEY)
    assert.equal(controller.health.getSnapshot().status, "unavailable")
    assert.equal(controller.health.getSnapshot().operation, "read")
    assert.equal(
      controller.health.getSnapshot().diagnostic,
      operation === "write"
        ? "CART_STORAGE_WRITE_FAILED"
        : "CART_STORAGE_REMOVE_FAILED"
    )

    if (operation === "write") {
      controller.storage.setItem(CART_STORAGE_KEY, {
        state: { items: [ordinaryItem()] },
        version: CART_PERSISTENCE_VERSION,
      })
      assert.equal(memory.operations.set, 1)
      assert.equal(memory.values.has(CART_STORAGE_KEY), true)
    } else {
      controller.storage.removeItem(CART_STORAGE_KEY)
      assert.equal(memory.operations.remove, 1)
      assert.equal(memory.values.has(CART_STORAGE_KEY), false)
    }

    assert.equal(controller.health.getSnapshot().status, "healthy")
    assert.equal(controller.health.getSnapshot().operation, operation)
    assert.equal(controller.health.getSnapshot().revision, 3)
    assert.deepEqual(
      transitions.map(({ revision }) => revision),
      [1, 2, 3]
    )
    unsubscribe()
  }
})

test("supported and recoverable records permit intentional preflight mutations", () => {
  const cases = [
    { name: "missing", initial: {} },
    {
      name: "version-zero",
      initial: { [CART_STORAGE_KEY]: envelope({ items: [legacyItem()] }, 0) },
    },
    {
      name: "version-one",
      initial: { [CART_STORAGE_KEY]: envelope({ items: [ordinaryItem()] }) },
    },
    {
      name: "missing-version",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({ state: { items: [legacyItem()] } }),
      },
    },
    { name: "corrupt", initial: { [CART_STORAGE_KEY]: "{broken" } },
    {
      name: "invalid",
      initial: { [CART_STORAGE_KEY]: JSON.stringify({ version: 1 }) },
    },
    {
      name: "version-one-null-state",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({ version: 1, state: null }),
      },
    },
    {
      name: "version-one-invalid-items",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({
          version: 1,
          state: { items: "invalid" },
        }),
      },
    },
    {
      name: "invalid-version-type",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({
          version: "1",
          state: { items: [] },
        }),
      },
    },
    {
      name: "null-version",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({
          version: null,
          state: { items: [] },
        }),
      },
    },
    {
      name: "negative-version",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({
          version: -1,
          state: { items: [] },
        }),
      },
    },
    {
      name: "unsafe-version",
      initial: {
        [CART_STORAGE_KEY]: JSON.stringify({
          version: Number.MAX_SAFE_INTEGER + 1,
          state: { items: [] },
        }),
      },
    },
  ]

  for (const { name, initial } of cases) {
    const memory = createMemoryStorage(initial)
    const controller = controllerFor(memory)
    controller.storage.setItem(CART_STORAGE_KEY, {
      state: { items: [ordinaryItem({ quantity: 4 })] },
      version: CART_PERSISTENCE_VERSION,
    })

    assert.equal(memory.operations.get, 1, name)
    assert.equal(memory.operations.set, 1, name)
    assert.equal(memory.operations.remove, 0, name)
    assert.equal(controller.health.getSnapshot().status, "healthy", name)
    assert.equal(
      JSON.parse(memory.values.get(CART_STORAGE_KEY)).state.items[0].quantity,
      4,
      name
    )
  }
})
