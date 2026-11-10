import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

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

function replaceImport(source, specifier, replacement) {
  return source.replace(
    new RegExp(`from ["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "u"),
    `from "${replacement}"`
  )
}

const parserUrl = moduleUrl(transpile("src/lib/public-product-variants.ts"))
const cartModelUrl = moduleUrl(
  replaceImport(
    transpile("src/lib/cart-model.ts"),
    "@/lib/public-product-variants",
    parserUrl
  )
)
const cartStorageUrl = moduleUrl(
  replaceImport(
    transpile("src/lib/cart-storage.ts"),
    "@/lib/cart-model",
    cartModelUrl
  )
)

let storeSource = transpile("src/lib/store.ts")
storeSource = replaceImport(storeSource, "@/lib/cart-model", cartModelUrl)
storeSource = replaceImport(storeSource, "@/lib/cart-storage", cartStorageUrl)
storeSource = replaceImport(
  storeSource,
  "zustand/middleware",
  pathToFileURL(path.join(root, "node_modules/zustand/esm/middleware.mjs")).href
)
storeSource = replaceImport(
  storeSource,
  "zustand/vanilla",
  pathToFileURL(path.join(root, "node_modules/zustand/esm/vanilla.mjs")).href
)
storeSource = replaceImport(
  storeSource,
  "zustand",
  pathToFileURL(path.join(root, "node_modules/zustand/esm/index.mjs")).href
)

const cartStorage = await import(cartStorageUrl)
const {
  MAX_CART_TOTAL_KOBO,
  calculateCartTotal,
  cartPersistenceMessage,
  createCartStore,
  createCartVisibilityStore,
  evaluateOrdinaryCartCheckout,
} = await import(moduleUrl(storeSource))

const ids = {
  product: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  product2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  variant: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  variant2: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  axis: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  value: "ffffffff-ffff-4fff-8fff-ffffffffffff",
}

function ordinaryItem(overrides = {}) {
  const product = {
    id: ids.product,
    name: "Ordinary product",
    price: 12500.5,
    images: ["https://example.test/product.jpg"],
    ...(overrides.product ?? {}),
  }
  return {
    kind: "ordinary",
    cartLineId: `ordinary:${product.id}`,
    product,
    quantity: 1,
    stock_snapshot: 20,
    ...overrides,
    product,
  }
}

function variantItem(variantId = ids.variant, overrides = {}) {
  return {
    kind: "variant",
    cartLineId: `variant:${ids.product}:${variantId}`,
    product: {
      id: ids.product,
      name: "Variant product",
      price: 9000,
      images: ["https://example.test/variant.jpg"],
    },
    quantity: 1,
    variant: {
      product_id: ids.product,
      variant_id: variantId,
      variant_mode: "size",
      stock_snapshot: 8,
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

function legacyItem(overrides = {}) {
  return {
    product: {
      id: ids.product,
      vendor_id: ids.product2,
      name: "Legacy ordinary product",
      description: "Legacy description",
      price: 12500.5,
      stock: 20,
      category: "Tests",
      images: ["https://example.test/legacy.jpg"],
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      variant_mode: "none",
      ...overrides,
    },
    quantity: 2,
  }
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  const operations = { get: 0, set: 0, remove: 0 }
  const failures = { get: false, set: false, remove: false }
  const storage = {
    getItem(name) {
      operations.get += 1
      if (failures.get) throw new Error("read failed")
      return values.get(name) ?? null
    },
    setItem(name, value) {
      operations.set += 1
      if (failures.set) throw new Error("write failed")
      values.set(name, value)
    },
    removeItem(name) {
      operations.remove += 1
      if (failures.remove) throw new Error("remove failed")
      values.delete(name)
    },
  }
  return { failures, operations, storage, values }
}

function createTestStore(initial = {}) {
  const memory = createMemoryStorage(initial)
  const controller = cartStorage.createCartPersistStorage({
    getStorage: () => memory.storage,
  })
  const store = createCartStore({ controller, skipHydration: true })
  return { controller, memory, store }
}

function envelope(state, version = 1) {
  return JSON.stringify({ state, version })
}

test("empty hydration completes before mutations become available", async () => {
  const { controller, store } = createTestStore()
  assert.equal(store.getState().addItem(ordinaryItem()), "blocked")
  assert.equal(store.getState().items.length, 0)

  await store.persist.rehydrate()
  assert.equal(store.persist.hasHydrated(), true)
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(store.getState().addItem(ordinaryItem()), "applied")
  assert.equal(store.getState().items.length, 1)
})

test("version-0 ordinary carts migrate into the active version-1 store", async () => {
  const { memory, store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: envelope(
      { items: [legacyItem(), { product: { id: "bad" }, quantity: 1 }] },
      0
    ),
  })

  await store.persist.rehydrate()
  const [item] = store.getState().items
  assert.equal(item.kind, "ordinary")
  assert.equal(item.cartLineId, `ordinary:${ids.product}`)
  assert.equal(item.quantity, 2)
  assert.equal(store.getState().isCartOpen, false)

  const persisted = JSON.parse(memory.values.get(cartStorage.CART_STORAGE_KEY))
  assert.equal(persisted.version, 1)
  assert.equal(persisted.state.items.length, 1)
  assert.equal("addItem" in persisted.state, false)
})

test("version-1 reload preserves valid ordinary items and ignores persisted actions", async () => {
  const rawItem = ordinaryItem({ quantity: 3, cartLineId: "forged" })
  const { store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: envelope({
      items: [rawItem, { kind: "ordinary", product: { id: "bad" } }],
      isCartOpen: true,
      clearCart: "untrusted-action",
    }),
  })

  await store.persist.rehydrate()
  const [item] = store.getState().items
  assert.equal(store.getState().items.length, 1)
  assert.equal(item.cartLineId, `ordinary:${ids.product}`)
  assert.equal(item.quantity, 3)
  assert.equal(store.getState().isCartOpen, false)
  assert.equal(typeof store.getState().clearCart, "function")
})

test("same ordinary identity merges while independent variants stay separate", async () => {
  const { store } = createTestStore()
  await store.persist.rehydrate()

  assert.equal(store.getState().addItem(ordinaryItem({ quantity: 2 })), "applied")
  assert.equal(store.getState().addItem(ordinaryItem({ quantity: 3 })), "applied")
  assert.equal(store.getState().items[0].quantity, 5)

  assert.equal(store.getState().addItem(variantItem()), "applied")
  assert.equal(store.getState().addItem(variantItem(ids.variant2)), "applied")
  assert.equal(store.getState().items.length, 3)
  assert.notEqual(
    store.getState().items[1].cartLineId,
    store.getState().items[2].cartLineId
  )
})

test("quantity updates and removals target exactly one cartLineId", async () => {
  const { store } = createTestStore()
  await store.persist.rehydrate()
  store.getState().addItem(variantItem())
  store.getState().addItem(variantItem(ids.variant2))

  const [first, second] = store.getState().items
  assert.equal(store.getState().updateQuantity(second.cartLineId, 4), "applied")
  assert.equal(store.getState().items[0].quantity, 1)
  assert.equal(store.getState().items[1].quantity, 4)
  assert.equal(store.getState().removeItem(first.cartLineId), "applied")
  assert.deepEqual(
    store.getState().items.map((item) => item.cartLineId),
    [second.cartLineId]
  )
})

test("clearCart persists an empty cart that remains empty after reload", async () => {
  const { memory, store } = createTestStore()
  await store.persist.rehydrate()

  assert.equal(store.getState().addItem(ordinaryItem()), "applied")
  assert.equal(store.getState().addItem(variantItem()), "applied")
  assert.equal(store.getState().items.length, 2)

  assert.equal(store.getState().clearCart(), "applied")
  assert.deepEqual(store.getState().items, [])

  const persisted = JSON.parse(
    memory.values.get(cartStorage.CART_STORAGE_KEY)
  )
  assert.equal(persisted.version, 1)
  assert.deepEqual(persisted.state.items, [])

  const reloadController = cartStorage.createCartPersistStorage({
    getStorage: () => memory.storage,
  })
  const reloadedStore = createCartStore({
    controller: reloadController,
    skipHydration: true,
  })
  await reloadedStore.persist.rehydrate()

  assert.equal(reloadController.health.getSnapshot().status, "healthy")
  assert.deepEqual(reloadedStore.getState().items, [])
})

test("clearCart fails closed until storage is hydrated, compatible, and healthy", async () => {
  const beforeHydration = createTestStore()
  assert.equal(beforeHydration.store.getState().clearCart(), "blocked")
  assert.equal(beforeHydration.memory.operations.set, 0)

  const futureRaw = ` {"version":99,"future_payload":{"cart":["opaque"]}} `
  const incompatible = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: futureRaw,
  })
  await incompatible.store.persist.rehydrate()

  assert.equal(incompatible.store.getState().clearCart(), "blocked")
  assert.equal(incompatible.memory.operations.set, 0)
  assert.equal(
    incompatible.memory.values.get(cartStorage.CART_STORAGE_KEY),
    futureRaw
  )

  const storedCart = envelope({ items: [ordinaryItem()] })
  const failedWrite = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: storedCart,
  })
  await failedWrite.store.persist.rehydrate()
  failedWrite.memory.failures.set = true

  assert.equal(
    failedWrite.store.getState().clearCart(),
    "persistence-failed"
  )
  assert.equal(
    failedWrite.controller.health.getSnapshot().status,
    "unavailable"
  )
  assert.equal(
    failedWrite.memory.values.get(cartStorage.CART_STORAGE_KEY),
    storedCart
  )
  assert.equal(
    evaluateOrdinaryCartCheckout(
      failedWrite.store.getState().items,
      failedWrite.store.persist.hasHydrated(),
      failedWrite.controller.health.getSnapshot().status
    ).reason,
    "STORAGE_UNSAFE"
  )

  failedWrite.memory.failures.set = false
  failedWrite.controller.storage.setItem(cartStorage.CART_STORAGE_KEY, {
    state: { items: [ordinaryItem()] },
    version: 1,
  })
  await failedWrite.store.persist.rehydrate()

  assert.equal(
    failedWrite.controller.health.getSnapshot().status,
    "healthy"
  )
  assert.equal(
    evaluateOrdinaryCartCheckout(
      failedWrite.store.getState().items,
      failedWrite.store.persist.hasHydrated(),
      failedWrite.controller.health.getSnapshot().status
    ).eligible,
    true
  )
})

test("unknown kinds are rejected and quantity updates remain within 1 to 99", async () => {
  const { store } = createTestStore()
  await store.persist.rehydrate()

  assert.equal(
    store.getState().addItem({ ...ordinaryItem(), kind: "future-kind" }),
    "invalid"
  )
  assert.deepEqual(store.getState().items, [])

  store.getState().addItem(ordinaryItem())
  const lineId = store.getState().items[0].cartLineId
  assert.equal(store.getState().updateQuantity(lineId, 1000), "applied")
  assert.equal(store.getState().items[0].quantity, 99)
  assert.equal(store.getState().updateQuantity(lineId, 0), "applied")
  assert.deepEqual(store.getState().items, [])
})

test("corrupt storage hydrates safely and a later valid mutation repairs it", async () => {
  const { controller, memory, store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: "{not-json",
  })
  const visibility = createCartVisibilityStore()
  const visibilityChanges = []
  const unsubscribe = visibility.subscribe((state) => {
    visibilityChanges.push(state.isCartOpen)
  })

  await store.persist.rehydrate()
  assert.equal(store.persist.hasHydrated(), true)
  assert.equal(controller.health.getSnapshot().status, "corrupt")
  assert.equal(memory.operations.set, 0)
  assert.equal(
    memory.values.get(cartStorage.CART_STORAGE_KEY),
    "{not-json"
  )
  assert.match(
    cartPersistenceMessage(true, controller.health.getSnapshot().status),
    /could not be read/u
  )

  visibility.getState().setCartOpen(true)
  assert.equal(visibility.getState().isCartOpen, true)
  assert.equal(memory.operations.set, 0)
  assert.equal(controller.health.getSnapshot().status, "corrupt")
  assert.equal(
    memory.values.get(cartStorage.CART_STORAGE_KEY),
    "{not-json"
  )

  visibility.getState().setCartOpen(false)
  assert.equal(visibility.getState().isCartOpen, false)
  assert.deepEqual(visibilityChanges, [true, false])
  assert.equal(memory.operations.set, 0)
  assert.equal(controller.health.getSnapshot().status, "corrupt")
  assert.equal(
    memory.values.get(cartStorage.CART_STORAGE_KEY),
    "{not-json"
  )
  unsubscribe()

  assert.equal(store.getState().addItem(ordinaryItem()), "applied")
  assert.equal(memory.operations.set, 1)
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(
    JSON.parse(memory.values.get(cartStorage.CART_STORAGE_KEY)).version,
    1
  )
})

test("failed writes are observable and block subsequent cart mutations", async () => {
  const { controller, memory, store } = createTestStore()
  const visibility = createCartVisibilityStore()
  await store.persist.rehydrate()
  memory.failures.set = true

  assert.equal(
    store.getState().addItem(ordinaryItem()),
    "persistence-failed"
  )
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(store.getState().addItem(ordinaryItem()), "blocked")
  assert.equal(memory.operations.set, 1)

  visibility.getState().setCartOpen(true)
  visibility.getState().setCartOpen(false)
  assert.equal(memory.operations.set, 1)
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.match(
    cartPersistenceMessage(true, controller.health.getSnapshot().status),
    /storage is unavailable/u
  )
  assert.equal(
    evaluateOrdinaryCartCheckout(
      store.getState().items,
      store.persist.hasHydrated(),
      controller.health.getSnapshot().status
    ).reason,
    "STORAGE_UNSAFE"
  )
})

test("read failures block mutations without overwriting the saved value", async () => {
  const raw = envelope({ items: [ordinaryItem()] })
  const { controller, memory, store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: raw,
  })
  memory.failures.get = true

  await store.persist.rehydrate()
  assert.equal(controller.health.getSnapshot().status, "unavailable")
  assert.equal(store.getState().addItem(ordinaryItem()), "blocked")
  assert.equal(memory.values.get(cartStorage.CART_STORAGE_KEY), raw)
  assert.equal(memory.operations.set, 0)
})

test("future records remain byte-preserved and incompatible with mutations", async () => {
  const raw = ` {"version":99,"future_payload":{"cart":["opaque"]}} `
  const { controller, memory, store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: raw,
  })
  const visibility = createCartVisibilityStore()

  await store.persist.rehydrate()
  assert.equal(store.persist.hasHydrated(), true)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  assert.deepEqual(store.getState().items, [])
  assert.equal(store.getState().addItem(ordinaryItem()), "blocked")
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(cartStorage.CART_STORAGE_KEY), raw)

  visibility.getState().setCartOpen(true)
  assert.equal(visibility.getState().isCartOpen, true)
  visibility.getState().setCartOpen(false)
  assert.equal(visibility.getState().isCartOpen, false)
  assert.equal(memory.operations.set, 0)
  assert.equal(controller.health.getSnapshot().status, "incompatible")
  assert.equal(memory.values.get(cartStorage.CART_STORAGE_KEY), raw)
  assert.match(
    cartPersistenceMessage(true, controller.health.getSnapshot().status),
    /newer version/u
  )
})

test("healthy cart visibility is reactive and never changes persisted cart bytes", async () => {
  const originalRaw = envelope({ items: [ordinaryItem({ quantity: 2 })] })
  const { controller, memory, store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: originalRaw,
  })
  const visibility = createCartVisibilityStore()
  const visibilityChanges = []
  const unsubscribe = visibility.subscribe((state) => {
    visibilityChanges.push(state.isCartOpen)
  })

  await store.persist.rehydrate()
  assert.equal(store.getState().totalItems(), 2)
  assert.equal(store.getState().isCartOpen, false)
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(memory.operations.set, 0)

  visibility.getState().setCartOpen(true)
  visibility.getState().setCartOpen(false)
  assert.deepEqual(visibilityChanges, [true, false])
  assert.equal(memory.operations.set, 0)
  assert.equal(memory.values.get(cartStorage.CART_STORAGE_KEY), originalRaw)
  assert.equal(store.getState().totalItems(), 2)
  unsubscribe()

  const reloadController = cartStorage.createCartPersistStorage({
    getStorage: () => memory.storage,
  })
  const reloadedStore = createCartStore({
    controller: reloadController,
    skipHydration: true,
  })
  await reloadedStore.persist.rehydrate()
  assert.equal(reloadedStore.getState().totalItems(), 2)

  assert.equal(store.getState().addItem(ordinaryItem()), "applied")
  assert.equal(memory.operations.set, 1)
  const lineId = store.getState().items[0].cartLineId
  assert.equal(store.getState().updateQuantity(lineId, 4), "applied")
  assert.equal(memory.operations.set, 2)
  assert.equal(store.getState().removeItem(lineId), "applied")
  assert.equal(memory.operations.set, 3)
  assert.equal(store.getState().addItem(ordinaryItem()), "applied")
  assert.equal(memory.operations.set, 4)
  assert.equal(store.getState().clearCart(), "applied")
  assert.equal(memory.operations.set, 5)

  const persisted = JSON.parse(
    memory.values.get(cartStorage.CART_STORAGE_KEY)
  )
  assert.deepEqual(persisted.state.items, [])
  assert.equal("isCartOpen" in persisted.state, false)
})

test("hydrated item totals provide the navbar count and exact ordinary subtotal", async () => {
  const { store } = createTestStore({
    [cartStorage.CART_STORAGE_KEY]: envelope({
      items: [ordinaryItem({ quantity: 3 })],
    }),
  })
  await store.persist.rehydrate()

  assert.equal(store.getState().totalItems(), 3)
  assert.deepEqual(store.getState().totalPrice(), {
    valid: true,
    totalKobo: BigInt(3_750_150),
    total: 37_501.5,
  })
})

test("aggregate totals enforce the exact ceiling without clamping", () => {
  const ceilingLine = ordinaryItem({
    quantity: 99,
    product: { price: 101_010_101.01 },
  })
  const exact = calculateCartTotal([ceilingLine])
  assert.equal(exact.valid, true)
  assert.equal(exact.totalKobo, MAX_CART_TOTAL_KOBO)

  const oneKoboOver = calculateCartTotal([
    ceilingLine,
    ordinaryItem({
      cartLineId: `ordinary:${ids.product2}`,
      product: { id: ids.product2, price: 0.01 },
    }),
  ])
  assert.deepEqual(oneKoboOver, { valid: false, reason: "OVER_LIMIT" })

  const multiLineOverflow = calculateCartTotal([
    ordinaryItem({ quantity: 50, product: { price: 101_010_101.01 } }),
    ordinaryItem({
      cartLineId: `ordinary:${ids.product2}`,
      quantity: 50,
      product: { id: ids.product2, price: 101_010_101.01 },
    }),
  ])
  assert.deepEqual(multiLineOverflow, {
    valid: false,
    reason: "OVER_LIMIT",
  })
})

test("aggregate totals reject inexact, non-finite and out-of-policy unit prices", () => {
  for (const price of [0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      calculateCartTotal([ordinaryItem({ product: { price } })]),
      { valid: false, reason: "INVALID_PRICE" }
    )
  }

  assert.deepEqual(
    calculateCartTotal([
      ordinaryItem({ product: { price: 101_010_101.02 } }),
    ]),
    { valid: false, reason: "INVALID_PRICE" }
  )
  assert.deepEqual(
    calculateCartTotal([ordinaryItem({ quantity: Number.MAX_SAFE_INTEGER })]),
    { valid: false, reason: "INVALID_QUANTITY" }
  )
})

test("ordinary checkout eligibility requires hydration, healthy storage and safe totals", () => {
  const item = ordinaryItem()
  assert.equal(
    evaluateOrdinaryCartCheckout([item], false, "healthy").reason,
    "NOT_HYDRATED"
  )
  assert.equal(
    evaluateOrdinaryCartCheckout([item], true, "unavailable").reason,
    "STORAGE_UNSAFE"
  )
  assert.equal(
    evaluateOrdinaryCartCheckout([item], true, "healthy").eligible,
    true
  )
})
