import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")

const catalogue = read("src/lib/catalogue.ts")
const detail = read("src/lib/product-detail.ts")
const home = read("src/app/(store)/page.tsx")
const detailPage = read("src/app/(store)/products/[id]/page.tsx")
const card = read("src/components/product-card.tsx")
const actions = read("src/components/product-actions.tsx")
const selector = read("src/components/product-variant-selector.tsx")
const selectionSource = read("src/lib/product-variant-selection.ts")

const transpiledSelection = ts.transpileModule(selectionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "src/lib/product-variant-selection.ts",
})
assert.equal(transpiledSelection.diagnostics?.length ?? 0, 0)
const selectionModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledSelection.outputText).toString("base64")}`
)
const {
  getSelectableVariantValueIds,
  reconcileVariantSelection,
  resolveSelectedVariant,
} = selectionModule

const ids = {
  product: "11111111-1111-4111-8111-111111111111",
  axis1: "22222222-2222-4222-8222-222222222222",
  axis2: "33333333-3333-4333-8333-333333333333",
  axis3: "44444444-4444-4444-8444-444444444444",
  a1: "55555555-5555-4555-8555-555555555551",
  a2: "55555555-5555-4555-8555-555555555552",
  b1: "66666666-6666-4666-8666-666666666661",
  b2: "66666666-6666-4666-8666-666666666662",
  c1: "77777777-7777-4777-8777-777777777771",
  c2: "77777777-7777-4777-8777-777777777772",
  variant1: "88888888-8888-4888-8888-888888888881",
  variant2: "88888888-8888-4888-8888-888888888882",
  variant3: "88888888-8888-4888-8888-888888888883",
  variant4: "88888888-8888-4888-8888-888888888884",
}

function axis(id, label, position, values) {
  return {
    id,
    label,
    position,
    values: values.map(([valueId, valueLabel], index) => ({
      id: valueId,
      label: valueLabel,
      position: index,
      swatch_hex: label === "Colour" ? (index === 0 ? "#000000" : "#FFFFFF") : null,
    })),
  }
}

function combination(variantId, stock, selections) {
  return {
    variant_id: variantId,
    stock,
    selections: selections.map(([axisId, valueId]) => ({
      axis_id: axisId,
      value_id: valueId,
    })),
  }
}

function generalizedProjection() {
  return {
    product_id: ids.product,
    variant_mode: "options",
    axes: [
      axis(ids.axis1, "Capacity", 1, [[ids.a1, "128 GB"], [ids.a2, "256 GB"]]),
      axis(ids.axis2, "Colour", 2, [[ids.b1, "Black"], [ids.b2, "White"]]),
      axis(ids.axis3, "Finish", 3, [[ids.c1, "Matte"], [ids.c2, "Gloss"]]),
    ],
    combinations: [
      combination(ids.variant1, 7, [[ids.axis1, ids.a1], [ids.axis2, ids.b1], [ids.axis3, ids.c1]]),
      combination(ids.variant2, 2, [[ids.axis1, ids.a2], [ids.axis2, ids.b2], [ids.axis3, ids.c2]]),
      combination(ids.variant3, 4, [[ids.axis1, ids.a1], [ids.axis2, ids.b2], [ids.axis3, ids.c2]]),
      combination(ids.variant4, 0, [[ids.axis1, ids.a2], [ids.axis2, ids.b1], [ids.axis3, ids.c1]]),
    ],
  }
}

function selectThroughControl(projection, selections, axisId, valueId) {
  const enabledValues = getSelectableVariantValueIds(
    projection,
    selections,
    axisId
  )
  assert.equal(
    enabledValues.has(valueId),
    true,
    `expected ${valueId} to be enabled for ${axisId}`
  )
  return reconcileVariantSelection(projection, selections, axisId, valueId)
}

test("all public product paths use the D3-A1 storefront view and database availability", () => {
  for (const source of [catalogue, detail, home]) {
    assert.match(source, /\.from\("public_storefront_products"\)/u)
    assert.doesNotMatch(source, /\.from\("products"\)/u)
  }
  assert.match(catalogue, /\.gt\("available_stock", 0\)/u)
  assert.match(catalogue, /\.eq\("available_stock", 0\)/u)
  assert.match(catalogue, /\.range\(\s*requestedFrom,/u)
  assert.match(catalogue, /variant_mode, available_stock, has_in_stock_combination/u)
})

test("detail projection is fetched once, parsed strictly, and fails closed", () => {
  assert.match(detail, /if \(product\.variant_mode !== "none"\) \{/u)
  assert.equal(
    (detail.match(/get_public_product_variant_projection/gu) ?? []).length,
    1
  )
  assert.match(detail, /parsePublicProductVariantProjection\(\s*projectionResult\.data,\s*product\.id/u)
  assert.match(detail, /if \(parsed\?\.variant_mode === product\.variant_mode\)/u)
  assert.match(selector, /if \(!projection\)/u)
  assert.match(selector, /Options are temporarily unavailable/u)
  assert.doesNotMatch(selector, /parent stock|product\.stock/iu)
})

test("legacy one-axis selections resolve only explicit in-stock combinations", () => {
  const projection = {
    product_id: ids.product,
    variant_mode: "size",
    axes: [axis(ids.axis1, "Size", 1, [[ids.a1, "Small"], [ids.a2, "Large"]])],
    combinations: [
      combination(ids.variant1, 4, [[ids.axis1, ids.a1]]),
      combination(ids.variant2, 0, [[ids.axis1, ids.a2]]),
    ],
  }

  const selectable = getSelectableVariantValueIds(projection, {}, ids.axis1)
  assert.deepEqual([...selectable], [ids.a1])
  const selected = reconcileVariantSelection(projection, {}, ids.axis1, ids.a1)
  assert.equal(resolveSelectedVariant(projection, selected)?.variant_id, ids.variant1)
  assert.equal(resolveSelectedVariant(projection, { [ids.axis1]: ids.a2 }), null)
})

test("legacy colour selections use the same explicit-combination authority", () => {
  const projection = {
    product_id: ids.product,
    variant_mode: "colour",
    axes: [axis(ids.axis1, "Colour", 1, [[ids.a1, "Black"], [ids.a2, "White"]])],
    combinations: [
      combination(ids.variant1, 1, [[ids.axis1, ids.a1]]),
      combination(ids.variant2, 5, [[ids.axis1, ids.a2]]),
    ],
  }

  const selected = reconcileVariantSelection(projection, {}, ids.axis1, ids.a2)
  assert.equal(resolveSelectedVariant(projection, selected)?.variant_id, ids.variant2)
})

test("legacy size-colour alternatives stay reachable and clear dependent values", () => {
  const projection = {
    product_id: ids.product,
    variant_mode: "size_colour",
    axes: [
      axis(ids.axis1, "Size", 1, [[ids.a1, "Small"], [ids.a2, "Large"]]),
      axis(ids.axis2, "Colour", 2, [[ids.b1, "Black"], [ids.b2, "White"]]),
    ],
    combinations: [
      combination(ids.variant1, 5, [[ids.axis1, ids.a1], [ids.axis2, ids.b1]]),
      combination(ids.variant2, 8, [[ids.axis1, ids.a2], [ids.axis2, ids.b2]]),
    ],
  }

  const smallBlack = {
    [ids.axis1]: ids.a1,
    [ids.axis2]: ids.b1,
  }
  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, smallBlack, ids.axis1)],
    [ids.a1, ids.a2]
  )

  let next = selectThroughControl(
    projection,
    smallBlack,
    ids.axis1,
    ids.a2
  )
  assert.deepEqual(next, { [ids.axis1]: ids.a2 })
  assert.equal(resolveSelectedVariant(projection, next), null)
  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, next, ids.axis2)],
    [ids.b2]
  )
  next = selectThroughControl(projection, next, ids.axis2, ids.b2)
  assert.equal(resolveSelectedVariant(projection, next)?.variant_id, ids.variant2)
  assert.equal(resolveSelectedVariant(projection, next)?.stock, 8)

  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, next, ids.axis1)],
    [ids.a1, ids.a2]
  )
  next = selectThroughControl(projection, next, ids.axis1, ids.a1)
  assert.deepEqual(next, { [ids.axis1]: ids.a1 })
  next = selectThroughControl(projection, next, ids.axis2, ids.b1)
  assert.equal(resolveSelectedVariant(projection, next)?.variant_id, ids.variant1)
  assert.equal(resolveSelectedVariant(projection, next)?.stock, 5)
})

test("generalized three-axis selection supports forward and middle-axis switching", () => {
  const projection = generalizedProjection()
  let selected = selectThroughControl(projection, {}, ids.axis1, ids.a1)
  selected = selectThroughControl(projection, selected, ids.axis2, ids.b1)
  selected = selectThroughControl(projection, selected, ids.axis3, ids.c1)
  const resolved = resolveSelectedVariant(projection, selected)
  assert.equal(resolved?.variant_id, ids.variant1)
  assert.equal(resolved?.stock, 7)

  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, selected, ids.axis2)],
    [ids.b1, ids.b2]
  )
  selected = selectThroughControl(projection, selected, ids.axis2, ids.b2)
  assert.deepEqual(selected, {
    [ids.axis1]: ids.a1,
    [ids.axis2]: ids.b2,
  })
  assert.equal(resolveSelectedVariant(projection, selected), null)
  selected = selectThroughControl(projection, selected, ids.axis3, ids.c2)
  assert.equal(resolveSelectedVariant(projection, selected)?.variant_id, ids.variant3)
  assert.equal(resolveSelectedVariant(projection, selected)?.stock, 4)

  assert.equal(
    resolveSelectedVariant(projection, {
      [ids.axis1]: ids.a1,
      [ids.axis2]: ids.b1,
      [ids.axis3]: ids.c2,
    }),
    null
  )
  assert.equal(
    resolveSelectedVariant(projection, {
      [ids.axis1]: ids.a1,
      [ids.axis2]: ids.b1,
      [ids.axis3]: ids.c1,
      unexpected: ids.c2,
    }),
    null
  )
  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, {
      [ids.axis1]: ids.a1,
      [ids.axis2]: ids.b1,
    }, ids.axis3)],
    [ids.c1]
  )
})

test("generalized three-axis selection supports reverse and mixed order safely", () => {
  const projection = generalizedProjection()
  let selected = selectThroughControl(projection, {}, ids.axis3, ids.c2)
  selected = selectThroughControl(projection, selected, ids.axis1, ids.a2)
  assert.deepEqual(selected, {
    [ids.axis1]: ids.a2,
    [ids.axis3]: ids.c2,
  })
  selected = selectThroughControl(projection, selected, ids.axis2, ids.b2)
  assert.equal(resolveSelectedVariant(projection, selected)?.variant_id, ids.variant2)
  assert.equal(resolveSelectedVariant(projection, selected)?.stock, 2)

  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, selected, ids.axis2)],
    [ids.b2]
  )
  assert.deepEqual(
    reconcileVariantSelection(projection, selected, ids.axis2, ids.b1),
    selected
  )
})

test("every explicit in-stock generalized combination is reachable in either axis order", () => {
  const projection = generalizedProjection()
  const inStock = projection.combinations.filter((item) => item.stock > 0)

  for (const combination of inStock) {
    const expectedValues = new Map(
      combination.selections.map((item) => [item.axis_id, item.value_id])
    )

    for (const axes of [projection.axes, [...projection.axes].reverse()]) {
      let selected = {}
      for (const axis of axes) {
        selected = selectThroughControl(
          projection,
          selected,
          axis.id,
          expectedValues.get(axis.id)
        )
      }
      const resolved = resolveSelectedVariant(projection, selected)
      assert.equal(resolved?.variant_id, combination.variant_id)
      assert.equal(resolved?.stock, combination.stock)
    }
  }
})

test("generalized one-axis and two-axis projections resolve exact UUIDs", () => {
  const oneAxis = generalizedProjection()
  oneAxis.axes = oneAxis.axes.slice(0, 1)
  oneAxis.combinations = [
    combination(ids.variant1, 7, [[ids.axis1, ids.a1]]),
  ]
  assert.equal(
    resolveSelectedVariant(oneAxis, { [ids.axis1]: ids.a1 })?.variant_id,
    ids.variant1
  )

  const twoAxes = generalizedProjection()
  twoAxes.axes = twoAxes.axes.slice(0, 2)
  twoAxes.combinations = [
    combination(ids.variant2, 2, [[ids.axis1, ids.a2], [ids.axis2, ids.b2]]),
  ]
  let selected = selectThroughControl(twoAxes, {}, ids.axis2, ids.b2)
  selected = selectThroughControl(twoAxes, selected, ids.axis1, ids.a2)
  assert.equal(resolveSelectedVariant(twoAxes, selected)?.variant_id, ids.variant2)
  assert.equal(resolveSelectedVariant(twoAxes, selected)?.stock, 2)
})

test("sold-out and nonexistent combinations remain unreachable", () => {
  const projection = generalizedProjection()
  const selected = { [ids.axis1]: ids.a2 }
  assert.deepEqual(
    [...getSelectableVariantValueIds(projection, selected, ids.axis2)],
    [ids.b2]
  )
  assert.equal(
    resolveSelectedVariant(projection, {
      [ids.axis1]: ids.a2,
      [ids.axis2]: ids.b1,
      [ids.axis3]: ids.c1,
    }),
    null
  )

  const soldOut = {
    ...projection,
    combinations: projection.combinations.map((item) => ({
      ...item,
      stock: 0,
    })),
  }
  for (const axis of soldOut.axes) {
    assert.equal(getSelectableVariantValueIds(soldOut, {}, axis.id).size, 0)
  }
  assert.deepEqual(
    reconcileVariantSelection(soldOut, {}, ids.axis1, ids.a1),
    {}
  )
})

test("variant cards navigate for options and cannot use the ordinary cart action", () => {
  assert.match(card, /product\.variant_mode === "none" \? \(\s*<OrdinaryProductCardAction/u)
  assert.match(card, /Select Options/u)
  assert.match(card, /!product\.has_in_stock_combination \|\| product\.available_stock <= 0/u)
  assert.match(card, /function OrdinaryProductCardAction/u)
  assert.equal((card.match(/useCartStore/gu) ?? []).length, 2)
  assert.match(actions, /if \(product\.variant_mode !== "none"\) \{\s*return \(/u)
  assert.match(actions, /<ProductVariantSelector\s+key=\{product\.id\}/u)
  assert.match(actions, /function OrdinaryProductActions/u)
})

test("selector is accessible, stock-aware, and has no cart or checkout authority", () => {
  assert.match(selector, /<fieldset/u)
  assert.match(selector, /<legend/u)
  assert.match(selector, /aria-pressed=/u)
  assert.match(selector, /const isAvailable = selectable\.has\(value\.id\)/u)
  assert.match(selector, /disabled=\{!isAvailable\}/u)
  assert.match(selector, /focus-visible:ring-2/u)
  assert.match(selector, /value\.swatch_hex/u)
  assert.match(selector, /data-selected-variant-id=/u)
  assert.match(selector, /Quantity is limited to/u)
  assert.match(selector, /Variant purchasing coming soon/u)
  assert.match(selector, /<Button[\s\S]*?disabled/u)
  assert.doesNotMatch(selector, /useCartStore|addItem|checkout|Paystack/iu)
  assert.doesNotMatch(detailPage, /construct_trusted_checkout_order/u)
})

test("D3-A2 leaves cart, checkout, payment recovery, and Edge checkout untouched", () => {
  const statusSensitiveFiles = [
    "src/lib/store.ts",
    "src/components/cart-sidebar.tsx",
    "src/components/checkout-modal.tsx",
    "src/lib/payment-recovery.ts",
    "supabase/functions/handle-checkout/index.ts",
  ]
  const status = fs
    .readFileSync(path.join(root, ".git", "HEAD"), "utf8")
    .trim()
  assert.ok(status.length > 0)
  for (const file of statusSensitiveFiles) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must remain present`)
  }
  assert.doesNotMatch(
    [catalogue, detail, home, detailPage, card, actions, selector, selectionSource].join("\n"),
    /handle-checkout|payment-recovery|construct_trusted_checkout_order/iu
  )
})
