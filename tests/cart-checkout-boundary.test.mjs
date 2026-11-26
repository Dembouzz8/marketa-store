import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) =>
  fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")

function transpile(file) {
  const result = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  })
  assert.equal(result.diagnostics?.length ?? 0, 0)
  return result.outputText
}

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
}

function replaceImport(source, specifier, replacement) {
  return source.replace(
    new RegExp(
      `from ["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "u"
    ),
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
const checkoutSeparationUrl = moduleUrl(
  replaceImport(
    transpile("src/lib/checkout-separation.ts"),
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

let paymentRecoverySource = transpile("src/lib/payment-recovery.ts")
paymentRecoverySource = replaceImport(
  paymentRecoverySource,
  "@/lib/checkout-separation",
  checkoutSeparationUrl
)

const { createCartStore, evaluateOrdinaryCartCheckout } = await import(moduleUrl(storeSource))
const cartStorage = await import(cartStorageUrl)
const checkoutSeparation = await import(checkoutSeparationUrl)
const paymentRecovery = await import(moduleUrl(paymentRecoverySource))
const checkoutGate = await import(moduleUrl(transpile("src/lib/customer-variant-checkout-gate.ts")))

const ids = {
  productA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  productB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  variantA: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  variantB: "11111111-1111-4111-8111-111111111111",
  axis: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  valueA: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  valueB: "22222222-2222-4222-8222-222222222222",
  order: "ffffffff-ffff-4fff-8fff-ffffffffffff",
}

function ordinaryItem(productId = ids.productA, quantity = 2) {
  return {
    kind: "ordinary",
    cartLineId: `ordinary:${productId.toLowerCase()}`,
    product: {
      id: productId,
      name: "Ordinary product",
      price: 12500.5,
      images: [],
    },
    quantity,
    stock_snapshot: 12,
  }
}

function variantItem({
  productId = ids.productA,
  variantProductId = productId,
  variantId = ids.variantA,
  valueId = ids.valueA,
  quantity = 1,
  productName = "Variant product",
  axisLabel = "Size",
  valueLabel = "Large",
  price = 9000,
  stock = 4,
} = {}) {
  return {
    kind: "variant",
    cartLineId: `variant:${variantProductId}:${variantId}`,
    product: {
      id: productId,
      name: productName,
      price,
      images: [],
    },
    quantity,
    variant: {
      product_id: variantProductId,
      variant_id: variantId,
      variant_mode: "size",
      stock_snapshot: stock,
      selected_options: [
        {
          axis_id: ids.axis,
          value_id: valueId,
          axis_label: axisLabel,
          value_label: valueLabel,
        },
      ],
    },
  }
}

function assertContained(result, reason) {
  assert.equal(result.status, "contained")
  if (reason) assert.equal(result.reason, reason)
  assert.equal(Object.hasOwn(result, "requestItems"), false)
  assert.equal(Object.hasOwn(result, "fingerprint"), false)
}

function createSessionStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
    values,
  }
}

test("A-B: ordinary preparation preserves exact legacy items and fingerprint bytes", () => {
  const items = [ordinaryItem(ids.productB, 1), ordinaryItem(ids.productA, 3)]
  const result = checkoutSeparation.prepareCheckoutSeparation(items)

  assert.equal(result.status, "ordinary")
  assert.deepEqual(result.requestItems, [
    { product_id: ids.productB, quantity: 1 },
    { product_id: ids.productA, quantity: 3 },
  ])
  assert.equal(
    result.fingerprint,
    `[{"product_id":"${ids.productA}","quantity":3},{"product_id":"${ids.productB}","quantity":1}]`
  )
  assert.equal(paymentRecovery.createCartFingerprint(items), result.fingerprint)
  assert.doesNotMatch(result.fingerprint, /kind|cartLineId|stock|price|label/u)

  const evaluation = evaluateOrdinaryCartCheckout(items, true, "healthy")
  assert.equal(evaluation.eligible, true)
})

test("C-D: variant-only carts retain exact internal identity and expose no request", () => {
  const variant = variantItem()
  const result = checkoutSeparation.prepareCheckoutSeparation([variant])

  assertContained(result, "VARIANT_CART")
  assert.deepEqual(result.identities, [
    {
      kind: "variant",
      product_id: ids.productA,
      product_variant_id: ids.variantA,
      quantity: 1,
    },
  ])
  assert.equal(
    paymentRecovery.createCartFingerprint([variant]),
    checkoutSeparation.prepareCheckoutSeparation([variant], true).fingerprint
  )
  assert.equal(
    evaluateOrdinaryCartCheckout([variant], true, "healthy").reason,
    "VARIANT_UNSUPPORTED"
  )
})

test("E: mixed carts are contained without producing an ordinary subset", () => {
  const result = checkoutSeparation.prepareCheckoutSeparation([
    ordinaryItem(),
    variantItem(),
  ])

  assertContained(result, "MIXED_CART")
  assert.deepEqual(
    result.identities.map((identity) => identity.kind),
    ["ordinary", "variant"]
  )
})

test("F-G: unknown kinds and malformed runtime values reject safely", () => {
  assertContained(
    checkoutSeparation.prepareCheckoutSeparation([
      { ...ordinaryItem(), kind: "future-kind" },
    ]),
    "UNKNOWN_KIND"
  )

  for (const malformed of [null, undefined, {}, "cart", [null], [42]]) {
    assert.doesNotThrow(() =>
      checkoutSeparation.prepareCheckoutSeparation(malformed)
    )
    assertContained(checkoutSeparation.prepareCheckoutSeparation(malformed))
  }
})

test("H: one malformed sibling rejects the whole cart", () => {
  const malformed = { ...ordinaryItem(ids.productB), quantity: 0 }
  const result = checkoutSeparation.prepareCheckoutSeparation([
    ordinaryItem(),
    malformed,
  ])

  assertContained(result, "INVALID_ITEM")
  assert.deepEqual(result.identities, [])
})

test("I: invalid variant identity never falls back to the parent product", () => {
  const result = checkoutSeparation.prepareCheckoutSeparation([
    variantItem({ variantProductId: ids.productB }),
  ])

  assertContained(result, "INVALID_ITEM")
  assert.notEqual(paymentRecovery.createCartFingerprint([variantItem()]), null)
})

test("J: variants of one parent remain distinct by exact variant UUID", () => {
  const result = checkoutSeparation.prepareCheckoutSeparation([
    variantItem(),
    variantItem({ variantId: ids.variantB, valueId: ids.valueB }),
  ])

  assertContained(result, "VARIANT_CART")
  assert.deepEqual(
    result.identities.map((identity) => identity.product_variant_id),
    [ids.variantA, ids.variantB]
  )
})

test("K: display labels and selected-option snapshots do not determine identity", () => {
  const original = checkoutSeparation.prepareCheckoutSeparation([variantItem()])
  const relabelled = checkoutSeparation.prepareCheckoutSeparation([
    variantItem({
      productName: "Renamed display product",
      valueId: ids.valueB,
      axisLabel: "Fit",
      valueLabel: "Roomy",
    }),
  ])

  assertContained(original, "VARIANT_CART")
  assertContained(relabelled, "VARIANT_CART")
  assert.deepEqual(relabelled.identities, original.identities)
})

test("L: display prices and stock snapshots never enter ordinary wire items", () => {
  const original = checkoutSeparation.prepareCheckoutSeparation([
    ordinaryItem(),
  ])
  const changedSnapshots = ordinaryItem()
  changedSnapshots.product.price = 1
  changedSnapshots.stock_snapshot = 0
  const changed = checkoutSeparation.prepareCheckoutSeparation([
    changedSnapshots,
  ])

  assert.equal(original.status, "ordinary")
  assert.equal(changed.status, "ordinary")
  assert.deepEqual(changed.requestItems, original.requestItems)
  assert.deepEqual(Object.keys(changed.requestItems[0]).sort(), [
    "product_id",
    "quantity",
  ])
})

test("M: duplicate ordinary or exact variant identities reject", () => {
  assertContained(
    checkoutSeparation.prepareCheckoutSeparation([
      ordinaryItem(ids.productA, 1),
      ordinaryItem(ids.productA, 2),
    ]),
    "DUPLICATE_IDENTITY"
  )
  assertContained(
    checkoutSeparation.prepareCheckoutSeparation([
      variantItem(),
      variantItem({ quantity: 2 }),
    ]),
    "DUPLICATE_IDENTITY"
  )
})

test("N: the modal re-reads and revalidates the live cart at final preparation", () => {
  const checkout = read("src/components/checkout-modal.tsx")
  const paymentStart = checkout.indexOf("const handlePayment = async")
  const paymentSource = checkout.slice(paymentStart)
  const sessionRead = paymentSource.indexOf("await supabase.auth.getSession()")
  const currentRead = paymentSource.indexOf(
    "const currentItems = useCartStore.getState().items"
  )
  const evaluation = paymentSource.indexOf(
    "evaluateOrdinaryCartCheckout(\n        currentItems"
  )
  const preparation = paymentSource.indexOf(
    "prepareCheckoutSeparation("
  )
  const attempt = paymentSource.indexOf(
    "obtainCheckoutAttempt(cartFingerprint)"
  )
  const request = paymentSource.indexOf("await fetch(webhookUrl")

  assert.ok(paymentStart >= 0)
  assert.ok(sessionRead >= 0 && sessionRead < currentRead)
  assert.ok(currentRead < evaluation)
  assert.ok(evaluation < preparation)
  assert.ok(preparation < attempt)
  assert.ok(attempt < request)
  assert.match(paymentSource, /items: checkoutPreparation\.requestItems/u)
})

test("O: contained preparation has no storage, attempt, or fetch side effects", () => {
  const originalSessionStorage = globalThis.sessionStorage
  const originalFetch = globalThis.fetch
  let storageWrites = 0
  let fetches = 0
  globalThis.sessionStorage = {
    getItem() {
      return null
    },
    setItem() {
      storageWrites += 1
    },
    removeItem() {
      storageWrites += 1
    },
  }
  globalThis.fetch = async () => {
    fetches += 1
    throw new Error("unexpected fetch")
  }

  try {
    assertContained(
      checkoutSeparation.prepareCheckoutSeparation([variantItem()]),
      "VARIANT_CART"
    )
    assert.equal(storageWrites, 0)
    assert.equal(fetches, 0)
  } finally {
    globalThis.sessionStorage = originalSessionStorage
    globalThis.fetch = originalFetch
  }

  const checkout = read("src/components/checkout-modal.tsx")
  assert.match(
    checkout,
    /prepareCheckoutSeparation\([\s\S]*status === "contained"[\s\S]*obtainCheckoutAttempt\(cartFingerprint\)[\s\S]*fetch\(webhookUrl/u
  )
})

test("P: ordinary checkout attempt reuse and pending recovery remain compatible", () => {
  const originalSessionStorage = globalThis.sessionStorage
  const storage = createSessionStorage()
  globalThis.sessionStorage = storage

  try {
    const fingerprint = paymentRecovery.createCartFingerprint([
      ordinaryItem(),
    ])
    assert.notEqual(fingerprint, null)

    const first = paymentRecovery.obtainCheckoutAttempt(fingerprint)
    const second = paymentRecovery.obtainCheckoutAttempt(fingerprint)
    assert.equal(second.checkout_attempt_id, first.checkout_attempt_id)
    assert.equal(second.cart_fingerprint, fingerprint)

    assert.equal(
      paymentRecovery.savePendingCheckout({
        order_id: ids.order,
        reference: "marketa_test_reference",
        cart_fingerprint: fingerprint,
        created_at: new Date().toISOString(),
      }),
      true
    )
    const pending = paymentRecovery.readPendingCheckout(
      ids.order,
      "marketa_test_reference"
    )
    assert.equal(pending.cart_fingerprint, fingerprint)
    assert.equal(
      paymentRecovery.pendingCheckoutMatchesCart(pending, fingerprint),
      true
    )
  } finally {
    globalThis.sessionStorage = originalSessionStorage
  }
})

test("payment-success cleanup still requires matching healthy cart evidence", () => {
  const successSource = read("src/app/(store)/payment-success/page.tsx")
  assert.match(successSource, /persistenceHealth\.status !== "healthy"/u)
  assert.match(successSource, /pendingCheckoutMatchesCart\(/u)
  assert.match(successSource, /clearCart\(\) === "applied"/u)
  assert.match(
    successSource,
    /pendingCheckoutMatchesCart[\s\S]*clearCart[\s\S]*removePendingCheckout/u
  )
})

test("both checkout layers independently enforce the ordinary-cart guard", () => {
  const sidebar = read("src/components/cart-sidebar.tsx")
  const checkout = read("src/components/checkout-modal.tsx")

  assert.match(
    sidebar,
    /const handleProceedToCheckout[\s\S]*evaluateOrdinaryCartCheckout\([\s\S]*if \(!currentEvaluation\.eligible\)/u
  )
  assert.match(
    checkout,
    /const handlePayment[\s\S]*evaluateOrdinaryCartCheckout\([\s\S]*if \(!currentEvaluation\.eligible\)[\s\S]*prepareCheckoutSeparation\(/u
  )
  assert.match(checkout, /obtainCheckoutAttempt\(cartFingerprint\)/u)
})

test("variant cart control is opt-in and variant checkout remains disabled", () => {
  const selector = read("src/components/product-variant-selector.tsx")
  const actions = read("src/components/product-actions.tsx")
  const detailPage = read("src/app/(store)/products/[id]/page.tsx")

  assert.match(selector, /if \(!cartEnabled \|\| !projection \|\| !selectedVariant\) return/u)
  assert.match(selector, /cartEnabled \? \(/u)
  assert.match(detailPage, /process\.env\.CUSTOMER_VARIANT_CART_ENABLED/u)
  assert.doesNotMatch(selector, /Paystack|authorization_url/iu)
  assert.match(actions, /product\.variant_mode !== "none"/u)
  assert.match(actions, /<ProductVariantSelector/u)
  assert.doesNotMatch(actions, /buildVariantCartItem/u)
})

test("checkout gate accepts only exact true and stays server-controlled", () => {
  for (const value of [undefined, null, false, "TRUE", "1", " true", "false"]) {
    assert.equal(checkoutGate.isCustomerVariantCheckoutEnabled(value), false)
  }
  assert.equal(checkoutGate.isCustomerVariantCheckoutEnabled("true"), true)
  const layout = read("src/app/(store)/layout.tsx")
  const sidebar = read("src/components/cart-sidebar.tsx")
  const modal = read("src/components/checkout-modal.tsx")
  const edge = read("supabase/functions/handle-checkout/index.ts")
  assert.match(layout, /process\.env\.CUSTOMER_VARIANT_CHECKOUT_ENABLED/u)
  assert.doesNotMatch(layout, /NEXT_PUBLIC_CUSTOMER_VARIANT_CHECKOUT_ENABLED/u)
  assert.match(sidebar, /variantCheckoutEnabled=\{variantCheckoutEnabled\}/u)
  assert.match(modal, /prepareCheckoutSeparation\([\s\S]*variantCheckoutEnabled/u)
  assert.match(edge, /Deno\.env\.get\("VARIANT_CHECKOUT_ENABLED"\) === "true"/u)
  assert.match(edge, /if \(!variantCheckoutAllowed\(items\)\)/u)
})

test("gate ON prepares exact variant and mixed payloads without display authority", () => {
  const first = variantItem({ quantity: 2 })
  const second = variantItem({ variantId: ids.variantB, valueId: ids.valueB })
  const variants = checkoutSeparation.prepareCheckoutSeparation([first, second], true)
  assert.equal(variants.status, "variant")
  assert.deepEqual(variants.requestItems, [
    { product_id: ids.productA, product_variant_id: ids.variantA, quantity: 2 },
    { product_id: ids.productA, product_variant_id: ids.variantB, quantity: 1 },
  ])
  const mixed = checkoutSeparation.prepareCheckoutSeparation([
    ordinaryItem(ids.productB), first,
  ], true)
  assert.equal(mixed.status, "variant")
  assert.deepEqual(mixed.requestItems, [
    { product_id: ids.productB, quantity: 2 },
    { product_id: ids.productA, product_variant_id: ids.variantA, quantity: 2 },
  ])
  assert.doesNotMatch(JSON.stringify(mixed.requestItems), /price|stock|label|vendor_id/u)
  assert.equal(evaluateOrdinaryCartCheckout([first, second], true, "healthy", true).eligible, true)
  assert.equal(evaluateOrdinaryCartCheckout([ordinaryItem(ids.productB), first], true, "healthy", true).eligible, true)
  assert.equal(evaluateOrdinaryCartCheckout([first], true, "healthy").reason, "VARIANT_UNSUPPORTED")
})

test("invalid or ambiguous variant identity never produces a checkout request", () => {
  const base = variantItem()
  const badLines = [
    { ...base, variant: { ...base.variant, variant_id: undefined } },
    { ...base, cartLineId: `variant:${ids.productA}:${ids.variantB}` },
    { ...base, variant: { ...base.variant, product_id: ids.productB } },
    { ...base, variant: { ...base.variant, selected_options: [] } },
  ]
  for (const line of badLines) {
    assertContained(checkoutSeparation.prepareCheckoutSeparation([line], true), "INVALID_ITEM")
    assert.equal(evaluateOrdinaryCartCheckout([line], true, "healthy", true).eligible, false)
  }
  assertContained(checkoutSeparation.prepareCheckoutSeparation([base, base], true), "DUPLICATE_IDENTITY")
})

test("variant fingerprints are stable, distinct, and ordinary bytes unchanged", () => {
  const first = variantItem()
  const second = variantItem({ variantId: ids.variantB, valueId: ids.valueB })
  const firstFingerprint = paymentRecovery.createCartFingerprint([first])
  assert.equal(firstFingerprint, checkoutSeparation.prepareCheckoutSeparation([first], true).fingerprint)
  assert.notEqual(firstFingerprint, paymentRecovery.createCartFingerprint([second]))
  assert.equal(firstFingerprint, paymentRecovery.createCartFingerprint([
    variantItem({ productName: "Updated display", valueLabel: "Other label", price: 1, stock: 1 }),
  ]))
  assert.equal(paymentRecovery.createCartFingerprint([first, second]), paymentRecovery.createCartFingerprint([second, first]))
  assert.equal(paymentRecovery.createCartFingerprint([ordinaryItem(ids.productB), first]), paymentRecovery.createCartFingerprint([first, ordinaryItem(ids.productB)]))
  const ordinary = ordinaryItem()
  assert.equal(paymentRecovery.createCartFingerprint([ordinary]), checkoutSeparation.createOrdinaryCartFingerprint([ordinary]))
  assert.equal(paymentRecovery.createCartFingerprint([]), "[]")
})

test("variant checkout attempts reuse only matching identity; stale carts survive recovery", () => {
  const originalSessionStorage = globalThis.sessionStorage
  globalThis.sessionStorage = createSessionStorage()
  try {
    const firstFingerprint = paymentRecovery.createCartFingerprint([variantItem()])
    const secondFingerprint = paymentRecovery.createCartFingerprint([
      variantItem({ variantId: ids.variantB, valueId: ids.valueB }),
    ])
    const firstAttempt = paymentRecovery.obtainCheckoutAttempt(firstFingerprint)
    assert.equal(paymentRecovery.obtainCheckoutAttempt(firstFingerprint).checkout_attempt_id, firstAttempt.checkout_attempt_id)
    assert.notEqual(paymentRecovery.obtainCheckoutAttempt(secondFingerprint).checkout_attempt_id, firstAttempt.checkout_attempt_id)
    const pending = {
      order_id: ids.order,
      reference: "marketa_variant_test",
      cart_fingerprint: firstFingerprint,
      created_at: new Date().toISOString(),
    }
    assert.equal(paymentRecovery.pendingCheckoutMatchesCart(pending, secondFingerprint), false)
    assert.equal(paymentRecovery.pendingCheckoutMatchesCart(pending, firstFingerprint), true)
  } finally {
    globalThis.sessionStorage = originalSessionStorage
  }
})

test("confirmed variant payment clears only the matching persisted cart", async () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const controller = cartStorage.createCartPersistStorage({ getStorage: () => storage })
  const store = createCartStore({ controller, skipHydration: true })
  await store.persist.rehydrate()
  assert.equal(store.getState().addItem(variantItem()), "applied")
  const pending = {
    order_id: ids.order,
    reference: "marketa_variant_test",
    cart_fingerprint: paymentRecovery.createCartFingerprint(store.getState().items),
    created_at: new Date().toISOString(),
  }
  assert.equal(store.getState().addItem(variantItem({ variantId: ids.variantB, valueId: ids.valueB })), "applied")
  const changedFingerprint = paymentRecovery.createCartFingerprint(store.getState().items)
  assert.equal(paymentRecovery.pendingCheckoutMatchesCart(pending, changedFingerprint), false)
  assert.equal(store.getState().items.length, 2)
  assert.equal(store.getState().removeItem(`variant:${ids.productA}:${ids.variantB}`), "applied")
  const restoredFingerprint = paymentRecovery.createCartFingerprint(store.getState().items)
  assert.equal(paymentRecovery.pendingCheckoutMatchesCart(pending, restoredFingerprint), true)
  assert.equal(controller.health.getSnapshot().status, "healthy")
  assert.equal(store.getState().clearCart(), "applied")
  assert.deepEqual(store.getState().items, [])
  assert.deepEqual(JSON.parse(values.get(cartStorage.CART_STORAGE_KEY)).state.items, [])
})
