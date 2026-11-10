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

const { evaluateOrdinaryCartCheckout } = await import(moduleUrl(storeSource))
const paymentRecovery = await import(
  moduleUrl(transpile("src/lib/payment-recovery.ts"))
)

const ids = {
  productA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  productB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  variant: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  axis: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  value: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  order: "ffffffff-ffff-4fff-8fff-ffffffffffff",
}

function ordinaryItem(productId = ids.productA, quantity = 2) {
  return {
    kind: "ordinary",
    cartLineId: `ordinary:${productId}`,
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

function variantItem() {
  return {
    kind: "variant",
    cartLineId: `variant:${ids.productA}:${ids.variant}`,
    product: {
      id: ids.productA,
      name: "Variant product",
      price: 9000,
      images: [],
    },
    quantity: 1,
    variant: {
      product_id: ids.productA,
      variant_id: ids.variant,
      variant_mode: "size",
      stock_snapshot: 4,
      selected_options: [
        {
          axis_id: ids.axis,
          value_id: ids.value,
          axis_label: "Size",
          value_label: "Large",
        },
      ],
    },
  }
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

test("ordinary carts remain checkout-eligible with the original payload boundary", () => {
  const evaluation = evaluateOrdinaryCartCheckout(
    [ordinaryItem()],
    true,
    "healthy"
  )
  assert.equal(evaluation.eligible, true)

  const checkoutSource = read("src/components/checkout-modal.tsx")
  assert.match(
    checkoutSource,
    /items:\s*currentItems\.map\(\(item\) => \(\{\s*product_id: item\.product\.id,\s*quantity: item\.quantity,/u
  )
  assert.doesNotMatch(checkoutSource, /variant_id:\s*item/u)
  assert.doesNotMatch(checkoutSource, /D2|construct_variant/iu)
})

test("variant and mixed carts are blocked without a parent-only fallback", () => {
  const variant = variantItem()
  assert.deepEqual(
    evaluateOrdinaryCartCheckout([variant], true, "healthy").reason,
    "VARIANT_UNSUPPORTED"
  )
  assert.deepEqual(
    evaluateOrdinaryCartCheckout(
      [ordinaryItem(), variant],
      true,
      "healthy"
    ).reason,
    "VARIANT_UNSUPPORTED"
  )
  assert.equal(paymentRecovery.createCartFingerprint([variant]), null)
})

test("unknown item kinds fail closed before checkout", () => {
  const unknown = {
    ...ordinaryItem(),
    kind: "future-kind",
  }
  assert.equal(
    evaluateOrdinaryCartCheckout([unknown], true, "healthy").reason,
    "UNKNOWN_KIND"
  )
  assert.equal(paymentRecovery.createCartFingerprint([unknown]), null)
})

test("ordinary fingerprint bytes remain compatible with the pre-V1 format", () => {
  const items = [ordinaryItem(ids.productB, 1), ordinaryItem(ids.productA, 3)]
  const fingerprint = paymentRecovery.createCartFingerprint(items)
  assert.equal(
    fingerprint,
    `[{"product_id":"${ids.productA}","quantity":3},{"product_id":"${ids.productB}","quantity":1}]`
  )
  assert.doesNotMatch(fingerprint, /kind|cartLineId|stock|price|label/u)
})

test("ordinary checkout attempts and pending recovery retain their existing format", () => {
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
    assert.equal(
      paymentRecovery.readPendingCheckout(
        ids.order,
        "marketa_test_reference"
      ).cart_fingerprint,
      fingerprint
    )
  } finally {
    globalThis.sessionStorage = originalSessionStorage
  }
})

test("payment-success cleanup requires a matching non-null ordinary fingerprint", () => {
  const ordinaryFingerprint = paymentRecovery.createCartFingerprint([
    ordinaryItem(),
  ])
  const pending = {
    order_id: ids.order,
    reference: "marketa_test_reference",
    cart_fingerprint: ordinaryFingerprint,
    created_at: "2026-01-01T00:00:00.000Z",
  }

  assert.equal(
    paymentRecovery.pendingCheckoutMatchesCart(
      pending,
      ordinaryFingerprint
    ),
    true
  )
  assert.equal(
    paymentRecovery.pendingCheckoutMatchesCart(
      pending,
      paymentRecovery.createCartFingerprint([
        ordinaryItem(ids.productB),
      ])
    ),
    false
  )
  assert.equal(
    paymentRecovery.pendingCheckoutMatchesCart(
      pending,
      paymentRecovery.createCartFingerprint([variantItem()])
    ),
    false
  )

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
    /const handlePayment[\s\S]*evaluateOrdinaryCartCheckout\([\s\S]*if \(!currentEvaluation\.eligible\)/u
  )
  assert.match(checkout, /if \(cartFingerprint === null\)/u)
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
