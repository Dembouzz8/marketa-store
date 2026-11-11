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

const { evaluateOrdinaryCartCheckout } = await import(moduleUrl(storeSource))
const checkoutSeparation = await import(checkoutSeparationUrl)
const paymentRecovery = await import(moduleUrl(paymentRecoverySource))

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
  assert.equal(paymentRecovery.createCartFingerprint([variant]), null)
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
  assert.equal(paymentRecovery.createCartFingerprint([variantItem()]), null)
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
    "prepareCheckoutSeparation(currentItems)"
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
    /prepareCheckoutSeparation\(currentItems\)[\s\S]*status !== "ordinary"[\s\S]*obtainCheckoutAttempt\(cartFingerprint\)[\s\S]*fetch\(webhookUrl/u
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

test("payment-success cleanup still requires matching healthy ordinary evidence", () => {
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
    /const handlePayment[\s\S]*evaluateOrdinaryCartCheckout\([\s\S]*if \(!currentEvaluation\.eligible\)[\s\S]*prepareCheckoutSeparation\(currentItems\)/u
  )
  assert.match(checkout, /obtainCheckoutAttempt\(cartFingerprint\)/u)
})

test("the production variant selector remains purchase-disabled", () => {
  const selector = read("src/components/product-variant-selector.tsx")
  const actions = read("src/components/product-actions.tsx")

  assert.doesNotMatch(selector, /useCartStore|addItem|checkout|Paystack/iu)
  assert.match(actions, /product\.variant_mode !== "none"/u)
  assert.match(actions, /<ProductVariantSelector/u)
  assert.doesNotMatch(actions, /buildVariantCartItem/u)
})
