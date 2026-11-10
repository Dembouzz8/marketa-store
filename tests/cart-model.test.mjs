import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
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

const parserUrl = `data:text/javascript;base64,${Buffer.from(
  transpile("src/lib/public-product-variants.ts")
).toString("base64")}`
const cartOutput = transpile("src/lib/cart-model.ts").replace(
  /from ["']@\/lib\/public-product-variants["']/u,
  `from "${parserUrl}"`
)
assert.doesNotMatch(cartOutput, /@\/lib\/public-product-variants/u)

const cartModel = await import(
  `data:text/javascript;base64,${Buffer.from(cartOutput).toString("base64")}`
)
const {
  buildOrdinaryCartItem,
  buildVariantCartItem,
  normalizeCartItemsV1,
  normalizeCartUuid,
  normalizeLegacyCartItems,
  ordinaryCartLineId,
  variantCartLineId,
} = cartModel

const ids = {
  product: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  otherProduct: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  axisA: "33333333-3333-4333-8333-333333333333",
  axisB: "11111111-1111-4111-8111-111111111111",
  axisC: "22222222-2222-4222-8222-222222222222",
  valueA: "66666666-6666-4666-8666-666666666666",
  valueB: "44444444-4444-4444-8444-444444444444",
  valueC: "55555555-5555-4555-8555-555555555555",
  variant: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
  otherVariant: "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",
}

function product(overrides = {}) {
  return {
    id: ids.product,
    vendor_id: "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE",
    name: "Synthetic product",
    description: "Fixture only",
    price: 12_500,
    stock: 17,
    category: "Tests",
    images: ["https://example.test/product.jpg"],
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    variant_mode: "none",
    available_stock: 17,
    has_in_stock_combination: false,
    ...overrides,
  }
}

function axis(id, label, position, valueId, valueLabel) {
  return {
    id,
    label,
    position,
    values: [
      {
        id: valueId,
        label: valueLabel,
        position: 0,
        swatch_hex: null,
      },
    ],
  }
}

function projection(axisCount = 1, overrides = {}) {
  const axes = [
    axis(ids.axisA, "Capacity", 1, ids.valueA, "256 GB"),
    axis(ids.axisB, "Colour", 2, ids.valueB, "Black"),
    axis(ids.axisC, "Finish", 3, ids.valueC, "Matte"),
  ].slice(0, axisCount)
  return {
    product_id: ids.product,
    variant_mode: "options",
    axes,
    combinations: [
      {
        variant_id: ids.variant,
        stock: 6,
        selections: axes.map((item) => ({
          axis_id: item.id,
          value_id: item.values[0].id,
        })),
      },
    ],
    ...overrides,
  }
}

function legacyProjection(mode) {
  const axes =
    mode === "size"
      ? [axis(ids.axisA, "Size", 1, ids.valueA, "Large")]
      : mode === "colour"
        ? [axis(ids.axisB, "Colour", 1, ids.valueB, "Blue")]
        : [
            axis(ids.axisA, "Size", 1, ids.valueA, "Large"),
            axis(ids.axisB, "Colour", 2, ids.valueB, "Blue"),
          ]

  return {
    product_id: ids.product,
    variant_mode: mode,
    axes,
    combinations: [
      {
        variant_id: ids.variant,
        stock: 4,
        selections: axes.map((item) => ({
          axis_id: item.id,
          value_id: item.values[0].id,
        })),
      },
    ],
  }
}

function v1Ordinary(overrides = {}) {
  return {
    kind: "ordinary",
    cartLineId: "untrusted",
    product: {
      id: ids.product,
      name: "Synthetic product",
      price: 12_500,
      images: ["https://example.test/product.jpg"],
    },
    quantity: 2,
    stock_snapshot: 17,
    ...overrides,
  }
}

function builtVariant(axisCount = 1) {
  return buildVariantCartItem({
    product: product({
      variant_mode: "options",
      has_in_stock_combination: true,
    }),
    projection: projection(axisCount),
    variantId: ids.variant,
    quantity: 2,
  })
}

test("ordinary and variant UUID identities are normalized and collision-safe", () => {
  const productId = ids.product.toLowerCase()
  const variantId = ids.variant.toLowerCase()
  assert.equal(normalizeCartUuid(ids.product), productId)
  assert.equal(ordinaryCartLineId(ids.product), `ordinary:${productId}`)
  assert.equal(
    variantCartLineId(ids.product, ids.variant),
    `variant:${productId}:${variantId}`
  )
  assert.notEqual(
    ordinaryCartLineId(ids.product),
    variantCartLineId(ids.product, ids.variant)
  )
  assert.equal(
    variantCartLineId(ids.product, ids.variant),
    variantCartLineId(productId, variantId)
  )
  assert.notEqual(
    variantCartLineId(ids.product, ids.variant),
    variantCartLineId(ids.product, ids.otherVariant)
  )
})

test("identity helpers reject malformed UUIDs and never derive variants from labels", () => {
  for (const invalid of [null, "", "not-a-uuid", "Small", `${ids.product}:extra`]) {
    assert.equal(normalizeCartUuid(invalid), null)
    assert.equal(ordinaryCartLineId(invalid), null)
  }
  assert.equal(variantCartLineId(ids.product, "Large / Blue"), null)
  assert.equal(variantCartLineId("product", ids.variant), null)
})

test("ordinary builder creates a minimal immutable display snapshot", () => {
  const input = product()
  const before = structuredClone(input)
  const result = buildOrdinaryCartItem({ product: input, quantity: 3 })

  assert.deepEqual(input, before)
  assert.deepEqual(result, {
    kind: "ordinary",
    cartLineId: `ordinary:${ids.product.toLowerCase()}`,
    product: {
      id: ids.product.toLowerCase(),
      name: input.name,
      price: input.price,
      images: input.images,
    },
    quantity: 3,
    stock_snapshot: 17,
  })
  assert.notStrictEqual(result.product.images, input.images)
  assert.equal("vendor_id" in result.product, false)
})

test("ordinary builder rejects variants, bad UUIDs, invalid prices, and invalid quantities", () => {
  assert.equal(
    buildOrdinaryCartItem({
      product: product({ variant_mode: "options" }),
      quantity: 1,
    }),
    null
  )
  assert.equal(
    buildOrdinaryCartItem({ product: product({ id: "bad" }), quantity: 1 }),
    null
  )
  for (const price of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      buildOrdinaryCartItem({ product: product({ price }), quantity: 1 }),
      null
    )
  }
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      buildOrdinaryCartItem({ product: product(), quantity }),
      null
    )
  }
  assert.equal(
    buildOrdinaryCartItem({ product: product(), quantity: 100 }).quantity,
    99
  )
})

test("price validation preserves exact decimals and bounds every 1-to-99 line subtotal", () => {
  const largeValidPrice = 101_010_101.01
  for (const price of [0, 0.29, 12_500.55, largeValidPrice]) {
    const result = buildOrdinaryCartItem({
      product: product({ price }),
      quantity: 99,
    })
    assert.ok(result, `expected ${price} to remain valid`)
    assert.equal(Number.isFinite(result.product.price * result.quantity), true)
  }

  for (const [price, quantity] of [
    [Number.MAX_VALUE, 2],
    [Number.MAX_VALUE, 99],
    [largeValidPrice + 0.01, 99],
    [1.001, 1],
  ]) {
    assert.equal(
      buildOrdinaryCartItem({ product: product({ price }), quantity }),
      null
    )
  }
})

test("builders reject null, primitive, and missing runtime input without throwing", () => {
  for (const input of [
    null,
    undefined,
    42,
    "product",
    [],
    {},
    { product: null, quantity: 1 },
    { product: undefined, quantity: 1 },
    { product: 42, quantity: 1 },
    { product: "product", quantity: 1 },
    { product: [], quantity: 1 },
    { product: {}, quantity: 1 },
  ]) {
    assert.doesNotThrow(() => buildOrdinaryCartItem(input))
    assert.equal(buildOrdinaryCartItem(input), null)
    assert.doesNotThrow(() => buildVariantCartItem(input))
    assert.equal(buildVariantCartItem(input), null)
  }

  const variantProduct = product({ variant_mode: "options" })
  for (const invalidProjection of [null, undefined, 3, [], {}, { axes: [] }]) {
    const input = {
      product: variantProduct,
      projection: invalidProjection,
      variantId: ids.variant,
      quantity: 1,
    }
    assert.doesNotThrow(() => buildVariantCartItem(input))
    assert.equal(buildVariantCartItem(input), null)
  }
})

test("variant builder rejects product/projection mismatch and mode mismatch", () => {
  const variantProduct = product({
    variant_mode: "options",
    has_in_stock_combination: true,
  })
  assert.equal(
    buildVariantCartItem({
      product: variantProduct,
      projection: projection(1, { product_id: ids.otherProduct }),
      variantId: ids.variant,
      quantity: 1,
    }),
    null
  )
  assert.equal(
    buildVariantCartItem({
      product: product({ variant_mode: "size", has_in_stock_combination: true }),
      projection: projection(),
      variantId: ids.variant,
      quantity: 1,
    }),
    null
  )
})

test("variant builder requires an exact known in-stock variant UUID", () => {
  const variantProduct = product({
    variant_mode: "options",
    stock: 999,
    has_in_stock_combination: true,
  })
  assert.equal(
    buildVariantCartItem({
      product: variantProduct,
      projection: projection(),
      variantId: ids.otherVariant,
      quantity: 1,
    }),
    null
  )
  assert.equal(
    buildVariantCartItem({
      product: variantProduct,
      projection: projection(1, {
        combinations: [
          {
            ...projection().combinations[0],
            stock: 0,
          },
        ],
      }),
      variantId: ids.variant,
      quantity: 1,
    }),
    null,
    "parent stock must not provide a variant fallback"
  )
  assert.equal(
    buildVariantCartItem({
      product: variantProduct,
      projection: projection(),
      variantId: "256 GB / Black",
      quantity: 1,
    }),
    null
  )
})

test("variant builder derives correct one-, two-, and three-axis snapshots", () => {
  for (const axisCount of [1, 2, 3]) {
    const result = builtVariant(axisCount)
    assert.ok(result)
    assert.equal(result.kind, "variant")
    assert.equal(result.variant.product_id, ids.product.toLowerCase())
    assert.equal(result.variant.variant_id, ids.variant.toLowerCase())
    assert.equal(result.variant.stock_snapshot, 6)
    assert.equal(result.variant.selected_options.length, axisCount)
    assert.equal(
      result.cartLineId,
      `variant:${ids.product.toLowerCase()}:${ids.variant.toLowerCase()}`
    )
  }
})

test("variant builder accepts strict legacy size, colour, and size-colour projections", () => {
  for (const mode of ["size", "colour", "size_colour"]) {
    const sourceProjection = legacyProjection(mode)
    const before = structuredClone(sourceProjection)
    const result = buildVariantCartItem({
      product: product({ variant_mode: mode }),
      projection: sourceProjection,
      variantId: ids.variant,
      quantity: 1,
    })

    assert.ok(result, `expected ${mode} projection to remain valid`)
    assert.equal(result.variant.variant_mode, mode)
    assert.equal(
      result.variant.selected_options.length,
      mode === "size_colour" ? 2 : 1
    )
    assert.deepEqual(sourceProjection, before)
  }
})

test("selected options use projection labels and canonical UUID ordering", () => {
  const sourceProjection = projection(3)
  const result = buildVariantCartItem({
    product: product({
      variant_mode: "options",
      has_in_stock_combination: true,
    }),
    projection: sourceProjection,
    variantId: ids.variant,
    quantity: 1,
  })
  assert.deepEqual(
    result.variant.selected_options.map((option) => option.axis_id),
    [ids.axisB, ids.axisC, ids.axisA].map((id) => id.toLowerCase())
  )
  assert.deepEqual(
    result.variant.selected_options.map((option) => option.axis_label),
    ["Colour", "Finish", "Capacity"]
  )
})

test("variant builder rejects duplicate axes and invalid projection labels", () => {
  const duplicateAxisProjection = projection(2)
  duplicateAxisProjection.axes[1].id = duplicateAxisProjection.axes[0].id
  duplicateAxisProjection.combinations[0].selections[1].axis_id =
    duplicateAxisProjection.axes[0].id
  assert.equal(
    buildVariantCartItem({
      product: product({ variant_mode: "options" }),
      projection: duplicateAxisProjection,
      variantId: ids.variant,
      quantity: 1,
    }),
    null
  )

  for (const label of ["", " padded ", "x".repeat(81)]) {
    const invalidLabelProjection = projection()
    invalidLabelProjection.axes[0].label = label
    assert.equal(
      buildVariantCartItem({
        product: product({ variant_mode: "options" }),
        projection: invalidLabelProjection,
        variantId: ids.variant,
        quantity: 1,
      }),
      null
    )
  }
})

test("variant builder rejects every parser-invalid projection provenance case", () => {
  const invalidLegacyLabels = legacyProjection("size_colour")
  invalidLegacyLabels.axes[0].label = "Capacity"

  const reversedPositions = projection(2)
  reversedPositions.axes[0].position = 2
  reversedPositions.axes[1].position = 1

  const reusedValue = projection(2)
  reusedValue.axes[1].values[0].id = reusedValue.axes[0].values[0].id
  reusedValue.combinations[0].selections[1].value_id =
    reusedValue.axes[0].values[0].id

  for (const [variantMode, invalidProjection] of [
    ["size_colour", invalidLegacyLabels],
    ["options", reversedPositions],
    ["options", reusedValue],
  ]) {
    assert.equal(
      buildVariantCartItem({
        product: product({ variant_mode: variantMode }),
        projection: invalidProjection,
        variantId: ids.variant,
        quantity: 1,
      }),
      null
    )
  }
})

test("legacy normalization converts ordinary entries with or without explicit none mode", () => {
  const withMode = { product: product(), quantity: 2 }
  const withoutModeProduct = product()
  delete withoutModeProduct.variant_mode
  const result = normalizeLegacyCartItems([
    withMode,
    { product: withoutModeProduct, quantity: 3 },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].quantity, 5)
  assert.deepEqual(result[0].product, {
    id: ids.product.toLowerCase(),
    name: "Synthetic product",
    price: 12_500,
    images: ["https://example.test/product.jpg"],
  })
})

test("legacy normalization rejects explicit variant modes and never infers variants", () => {
  const result = normalizeLegacyCartItems([
    { product: product({ variant_mode: "size" }), quantity: 1 },
    {
      product: {
        ...product(),
        size: "Large",
        colour: "Blue",
      },
      quantity: 1,
    },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, "ordinary")
})

test("legacy duplicate merge preserves first snapshot, sums, and clamps to 99", () => {
  const result = normalizeLegacyCartItems([
    { product: product({ name: "First snapshot" }), quantity: 60 },
    { product: product({ name: "Later snapshot" }), quantity: 60 },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].quantity, 99)
  assert.equal(result[0].product.name, "First snapshot")
})

test("legacy invalid quantities and display prices are dropped without sibling loss", () => {
  const candidates = [
    { product: product(), quantity: 0 },
    { product: product(), quantity: -1 },
    { product: product(), quantity: 1.5 },
    { product: product(), quantity: Number.NaN },
    { product: product({ price: -1 }), quantity: 1 },
    { product: product({ price: Number.POSITIVE_INFINITY }), quantity: 1 },
    { product: product({ price: Number.MAX_VALUE }), quantity: 1 },
    { product: product({ price: 1.001 }), quantity: 1 },
    {
      product: product({ id: ids.otherProduct, name: "Valid sibling" }),
      quantity: 500,
    },
  ]
  const result = normalizeLegacyCartItems(candidates)
  assert.equal(result.length, 1)
  assert.equal(result[0].product.name, "Valid sibling")
  assert.equal(result[0].quantity, 99)
})

test("legacy normalization preserves a large line-safe decimal price", () => {
  const result = normalizeLegacyCartItems([
    { product: product({ price: 101_010_101.01 }), quantity: 99 },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].product.price, 101_010_101.01)
  assert.equal(Number.isFinite(result[0].product.price * result[0].quantity), true)
})

test("version-1 normalization validates kinds and corrects tampered identities", () => {
  const valid = v1Ordinary({
    cartLineId: `variant:${ids.product}:${ids.variant}`,
    extra: "ignored",
    product: {
      ...v1Ordinary().product,
      extra: "ignored",
    },
  })
  const result = normalizeCartItemsV1([
    { ...valid, kind: "mystery" },
    valid,
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].cartLineId, `ordinary:${ids.product.toLowerCase()}`)
  assert.equal("extra" in result[0], false)
  assert.equal("extra" in result[0].product, false)
})

test("version-1 variant validation canonicalizes snapshots and ignores extra fields", () => {
  const built = builtVariant(3)
  const untrusted = structuredClone(built)
  untrusted.cartLineId = "tampered"
  untrusted.extra = true
  untrusted.variant.extra = true
  untrusted.variant.selected_options.reverse()
  for (const option of untrusted.variant.selected_options) option.extra = true

  const result = normalizeCartItemsV1([untrusted])
  assert.equal(result.length, 1)
  assert.equal(
    result[0].cartLineId,
    `variant:${ids.product.toLowerCase()}:${ids.variant.toLowerCase()}`
  )
  assert.deepEqual(
    result[0].variant.selected_options.map((option) => option.axis_id),
    [ids.axisB, ids.axisC, ids.axisA].map((id) => id.toLowerCase())
  )
  assert.equal("extra" in result[0], false)
  assert.equal("extra" in result[0].variant, false)
  assert.equal("extra" in result[0].variant.selected_options[0], false)
})

test("version-1 rejects product mismatch, duplicate axes, invalid labels, and bad mode counts", () => {
  const base = builtVariant(2)
  const mismatch = structuredClone(base)
  mismatch.variant.product_id = ids.otherProduct
  const duplicateAxes = structuredClone(base)
  duplicateAxes.variant.selected_options[1].axis_id =
    duplicateAxes.variant.selected_options[0].axis_id
  const invalidLabel = structuredClone(base)
  invalidLabel.variant.selected_options[0].value_label = " padded "
  const badModeCount = structuredClone(base)
  badModeCount.variant.variant_mode = "size"

  assert.deepEqual(
    normalizeCartItemsV1([mismatch, duplicateAxes, invalidLabel, badModeCount]),
    []
  )
})

test("version-1 rejects duplicate value UUIDs across distinct normalized axes", () => {
  const base = builtVariant(2)
  const sameCase = structuredClone(base)
  sameCase.variant.selected_options[1].value_id =
    sameCase.variant.selected_options[0].value_id
  const mixedCase = structuredClone(base)
  mixedCase.variant.selected_options[1].value_id =
    mixedCase.variant.selected_options[0].value_id.toUpperCase()

  const validSibling = v1Ordinary({
    product: { ...v1Ordinary().product, id: ids.otherProduct },
  })
  const result = normalizeCartItemsV1([
    sameCase,
    mixedCase,
    validSibling,
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, "ordinary")
  assert.equal(result[0].product.id, ids.otherProduct.toLowerCase())
})

test("version-1 price validation rejects unsafe values without sibling loss", () => {
  const validSibling = v1Ordinary({
    product: {
      ...v1Ordinary().product,
      id: ids.otherProduct,
      price: 101_010_101.01,
    },
    quantity: 99,
  })
  const result = normalizeCartItemsV1([
    v1Ordinary({
      product: { ...v1Ordinary().product, price: Number.MAX_VALUE },
    }),
    v1Ordinary({
      product: { ...v1Ordinary().product, price: 101_010_101.02 },
    }),
    v1Ordinary({
      product: { ...v1Ordinary().product, price: 1.001 },
    }),
    validSibling,
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].product.price, 101_010_101.01)
  assert.equal(Number.isFinite(result[0].product.price * result[0].quantity), true)
})

test("version-1 preserves valid siblings and applies persisted quantity policy", () => {
  const result = normalizeCartItemsV1([
    null,
    v1Ordinary({ quantity: Number.NaN }),
    v1Ordinary({ quantity: 0 }),
    v1Ordinary({
      product: { ...v1Ordinary().product, id: ids.otherProduct },
      quantity: 500,
    }),
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].product.id, ids.otherProduct.toLowerCase())
  assert.equal(result[0].quantity, 99)
})

test("version-1 duplicate reconciliation preserves first snapshots", () => {
  const ordinary = normalizeCartItemsV1([
    v1Ordinary({ quantity: 60 }),
    v1Ordinary({
      quantity: 60,
      product: { ...v1Ordinary().product, name: "Later snapshot" },
    }),
  ])
  assert.equal(ordinary.length, 1)
  assert.equal(ordinary[0].quantity, 99)
  assert.equal(ordinary[0].product.name, "Synthetic product")

  const firstVariant = builtVariant(2)
  const matchingVariant = structuredClone(firstVariant)
  matchingVariant.quantity = 3
  matchingVariant.variant.selected_options[0].axis_label = "Changed display label"
  const contradictoryVariant = structuredClone(firstVariant)
  contradictoryVariant.quantity = 50
  contradictoryVariant.variant.selected_options[0].value_id = ids.valueC
  const variants = normalizeCartItemsV1([
    firstVariant,
    matchingVariant,
    contradictoryVariant,
  ])
  assert.equal(variants.length, 1)
  assert.equal(variants[0].quantity, 5)
  assert.equal(
    variants[0].variant.selected_options[0].axis_label,
    firstVariant.variant.selected_options[0].axis_label
  )
})

test("version-1 normalization is idempotent", () => {
  const once = normalizeCartItemsV1([
    v1Ordinary({ quantity: 2 }),
    builtVariant(3),
  ])
  const twice = normalizeCartItemsV1(once)
  assert.deepEqual(twice, once)
})
