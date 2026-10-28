import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

const managerFile = "src/components/vendor/product-variants-manager.tsx"
const manager = read(managerFile)
const productForm = read("src/components/vendor/product-form.tsx")
const productsTable = read("src/components/vendor/products-table.tsx")
const productsPage = read("src/app/vendor/products/page.tsx")
const editPage = read("src/app/vendor/products/[id]/edit/page.tsx")
const browserHelper = read("src/lib/supabase-browser.ts")
const types = read("src/types/index.ts")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function component() {
  return null
}

function loadValidationHelpers() {
  const output = ts.transpileModule(manager, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const compiledModule = { exports: {} }
  const mocks = {
    "lucide-react": {
      Loader2: component,
      Pencil: component,
      Trash2: component,
    },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    react: {
      useMemo: (factory) => factory(),
      useState: (initial) => [initial, () => {}],
    },
    "@/components/ui/button": { Button: component },
    "@/components/ui/input": { Input: component },
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient: () => ({}),
    },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "react/jsx-runtime": {
      jsx: () => null,
      jsxs: () => null,
      Fragment: Symbol.for("react.fragment"),
    },
  }

  vm.runInNewContext(
    output,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require(name) {
        if (name in mocks) return mocks[name]
        throw new Error(`Unexpected import: ${name}`)
      },
    },
    { filename: managerFile }
  )

  return compiledModule.exports
}

const { parseVariantStock, validateVariantLabels } = loadValidationHelpers()

test("vendor-only types mirror product and product-variant authority", () => {
  assert.match(
    types,
    /export type ProductVariantMode = "none" \| "size" \| "colour" \| "size_colour"/
  )
  assert.match(types, /export interface VendorProduct extends Product/)
  assert.match(types, /variant_mode: ProductVariantMode/)
  assert.match(types, /stock_version: number/)
  assert.match(types, /export interface ProductVariant/)
  for (const field of [
    "id",
    "product_id",
    "vendor_id",
    "size",
    "colour",
    "size_normalized",
    "colour_normalized",
    "stock",
    "stock_version",
    "is_active",
    "created_at",
    "updated_at",
  ]) {
    assert.match(types, new RegExp(`\\b${field}:`), field)
  }
  assert.doesNotMatch(
    between(types, "export interface Product {", "export type ProductVariantMode"),
    /variant_mode|stock_version/
  )
})

test("configuration requires visible draft eligibility and irreversible confirmation", () => {
  assert.match(
    manager,
    /mode === "none" && product\.is_active === false && product\.stock === 0/
  )
  assert.match(
    manager,
    /!isEligibleByVisibleState \|\|\s*!modeConfirmed \|\|\s*configurationUncertain \|\|\s*pendingOperation/
  )
  assert.match(manager, /cannot currently\s+be changed or reverted/)
  assert.match(manager, /!modeConfirmed/)
  assert.match(manager, /order history or existing variants/)
})

test("ordinary product server mutations atomically reject variant or stale rows", () => {
  const deletion = between(
    productsPage,
    "async function deleteProduct",
    "async function toggleProductActive"
  )
  assert.match(deletion, /\.delete\(\)/)
  assert.match(deletion, /\.eq\("id", productId\)/)
  assert.match(deletion, /\.eq\("vendor_id", actionVendor\.id\)/)
  assert.match(deletion, /\.eq\("variant_mode", "none"\)/)
  assert.match(deletion, /\.select\("id"\)\s*\.maybeSingle\(\)/)
  assert.match(deletion, /if \(!deletedProduct\)/)
  assert.match(deletion, /changed or is no longer eligible for ordinary-product deletion/)
  assert.ok(
    deletion.indexOf("if (!deletedProduct)") <
      deletion.indexOf('return { error: null }')
  )

  const activation = between(
    productsPage,
    "async function toggleProductActive",
    "  return ("
  )
  assert.match(activation, /\.update\(\{ is_active: isActive \}\)/)
  assert.match(activation, /\.eq\("id", productId\)/)
  assert.match(activation, /\.eq\("vendor_id", actionVendor\.id\)/)
  assert.match(activation, /\.eq\("variant_mode", "none"\)/)
  assert.match(activation, /\.eq\("is_active", !isActive\)/)
  assert.match(activation, /\.select\("id"\)\s*\.maybeSingle\(\)/)
  assert.match(activation, /if \(!updatedProduct\)/)
  assert.match(activation, /changed or is no longer eligible for ordinary-product status updates/)
  assert.ok(
    activation.indexOf("if (!updatedProduct)") <
      activation.indexOf('return { error: null }')
  )

  for (const action of [deletion, activation]) {
    assert.match(action, /if \(!actionVendor\.is_active\)/)
  }
})

test("uncertain mode configuration requires reload and cannot automatically retry", () => {
  const configuration = between(
    manager,
    "const configureMode = async () => {",
    "const createVariant = async"
  )
  assert.match(configuration, /configurationUncertain/)
  assert.match(configuration, /setConfigurationUncertain\(true\)/)
  assert.match(configuration, /could not be confirmed and may have completed/)
  assert.doesNotMatch(configuration, /configureMode\(\)/)
  assert.equal(
    (configuration.match(/"configure_vendor_product_variant_mode"/g) ?? []).length,
    1
  )
  assert.match(manager, /configurationUncertain && \(/)
  assert.match(manager, /window\.location\.reload\(\)/)
})

test("size-only validation sends size and null colour", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(validateVariantLabels("size", " Large ", ""))),
    { ok: true, labels: { size: "Large", colour: null } }
  )
  assert.equal(validateVariantLabels("size", "   ", "").ok, false)
  assert.equal(validateVariantLabels("size", "Large", "Blue").ok, false)
})

test("colour-only validation sends null size and colour", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(validateVariantLabels("colour", "", " Navy "))),
    { ok: true, labels: { size: null, colour: "Navy" } }
  )
  assert.equal(validateVariantLabels("colour", "", "  ").ok, false)
  assert.equal(validateVariantLabels("colour", "Large", "Navy").ok, false)
})

test("combined mode requires both labels and enforces the 80-character limit", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(validateVariantLabels("size_colour", "Large", "Navy"))
    ),
    { ok: true, labels: { size: "Large", colour: "Navy" } }
  )
  assert.equal(validateVariantLabels("size_colour", "Large", "").ok, false)
  assert.equal(validateVariantLabels("size_colour", "", "Navy").ok, false)
  assert.equal(validateVariantLabels("size", "x".repeat(80), "").ok, true)
  assert.equal(validateVariantLabels("size", "x".repeat(81), "").ok, false)
})

test("stock validation accepts only PostgreSQL integer-range whole numbers", () => {
  assert.equal(parseVariantStock("0"), 0)
  assert.equal(parseVariantStock("2147483647"), 2_147_483_647)
  for (const value of [
    "",
    "-1",
    "1.5",
    "NaN",
    "2147483648",
    "9007199254740993",
  ]) {
    assert.equal(parseVariantStock(value), null, value)
  }
})

test("manager calls only the five approved RPC signatures with exact parameters", () => {
  for (const name of [
    "configure_vendor_product_variant_mode",
    "create_vendor_product_variant",
    "update_vendor_product_variant_labels",
    "update_vendor_product_variant_stock",
    "delete_vendor_product_variant",
  ]) {
    assert.equal((manager.match(new RegExp(`"${name}"`, "g")) ?? []).length, 1, name)
  }

  assert.match(manager, /p_product_id: product\.id,\s+p_variant_mode: selectedMode/)
  assert.match(
    manager,
    /p_product_id: product\.id,\s+p_size: labelResult\.labels\.size,\s+p_colour: labelResult\.labels\.colour,\s+p_stock: stock/
  )
  assert.match(
    manager,
    /update_vendor_product_variant_labels[\s\S]*p_variant_id: variant\.id,\s+p_size: labelResult\.labels\.size,\s+p_colour: labelResult\.labels\.colour/
  )
  assert.match(
    manager,
    /update_vendor_product_variant_stock[\s\S]*p_variant_id: variant\.id,\s+p_stock: stock,\s+p_expected_stock_version: variant\.stock_version/
  )
  assert.match(
    manager,
    /delete_vendor_product_variant[\s\S]*p_variant_id: variant\.id,\s+p_expected_stock_version: variant\.stock_version/
  )
})

test("documented outcomes have function-specific controlled messages", () => {
  const configuration = between(
    manager,
    "const configureMessages",
    "const createMessages"
  )
  for (const outcome of [
    "access_denied",
    "invalid_input",
    "not_found",
    "invalid_state",
    "order_history_exists",
    "operation_failed",
  ]) {
    assert.match(configuration, new RegExp(`${outcome}:`), outcome)
  }

  assert.match(manager, /duplicate_combination: "That size or colour combination already exists\."/)
  assert.match(manager, /historical_reference:/)
  assert.match(manager, /result\.outcome === "configured"/)
  assert.match(manager, /result\.outcome === "created"/)
  assert.match(manager, /result\.outcome === "updated"/)
  assert.match(manager, /result\.outcome === "deleted"/)
  assert.doesNotMatch(manager, /error\.message/)
})

test("stock conflict and no-change refetch without automatic replay", () => {
  const conflict = between(
    manager,
    '} else if (result.outcome === "conflict") {',
    "} else {"
  )
  assert.match(conflict, /await refreshVariants\(\)/)
  assert.doesNotMatch(conflict, /update_vendor_product_variant_stock|updateStock\(/)

  const noChange = between(
    manager,
    '} else if (result.outcome === "no_change") {',
    '} else if (result.outcome === "conflict") {'
  )
  assert.match(noChange, /await refreshVariants\(\)/)
  assert.match(noChange, /stock quantity is unchanged/)
})

test("historical-reference and deletion conflicts cannot remove local rows", () => {
  assert.match(manager, /historical_reference:/)
  assert.match(manager, /result\.outcome === "deleted"[\s\S]*await refreshVariants\(\)/)
  assert.match(
    manager,
    /result\.outcome === "conflict"[\s\S]*await refreshVariants\(\)/
  )
  assert.doesNotMatch(manager, /setVariants\([^\n]*filter/)
})

test("variant reads and writes use the authenticated SSR browser session", () => {
  assert.match(manager, /createSupabaseBrowserClient\(\)/)
  assert.match(manager, /\.from\("product_variants"\)/)
  assert.match(manager, /\.eq\("product_id", product\.id\)/)
  assert.match(manager, /\.eq\("vendor_id", product\.vendor_id\)/)
  assert.match(editPage, /createSupabaseServerClient\(\)/)
  assert.match(editPage, /supabase\.auth\.getUser\(\)/)
  assert.match(editPage, /\.from\("product_variants"\)/)
  assert.match(editPage, /error: variantsError/)
  assert.match(editPage, /initialLoadFailed=\{Boolean\(variantsError\)\}/)
  assert.match(manager, /initialLoadFailed \? \(/)
  assert.match(manager, /Variant management is unavailable until the product data is reloaded\./)
  assert.match(browserHelper, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.doesNotMatch(manager, /service.role|service_role|SUPABASE_SERVICE/i)
})

test("variant parents have no ordinary stock publication or parent-delete controls", () => {
  assert.match(productsTable, /const isVariantProduct = variantMode !== "none"/)
  assert.match(productsTable, /isVariantProduct \? \([\s\S]*Managed per combination/)
  assert.match(productsTable, /isVariantProduct \? \([\s\S]*Draft only/)
  assert.match(productsTable, /\{!isVariantProduct && \([\s\S]*setDeleteTarget\(product\)/)
  assert.match(productForm, /const isVariantProduct = Boolean/)
  assert.match(productForm, /Managed per size or colour combination/)
  assert.match(productForm, /Draft only — variant publication is not available yet/)
  assert.match(
    productForm,
    /\.\.\.\(isVariantProduct\s*\? \{\}\s*: \{\s*stock: Number\(stock\),\s*is_active: isActive/
  )
})

test("ordinary product behavior and active-vendor authority remain in place", () => {
  assert.match(productsPage, /const products = \(productsData \?\? \[\]\) as VendorProduct\[\]/)
  assert.match(productsTable, /product\.variant_mode \?\? "none"/)
  assert.match(productsTable, /handleStockSave/)
  assert.match(productsTable, /handleToggleActive/)
  assert.match(productsTable, /setDeleteTarget\(product\)/)
  assert.match(productForm, /useState\(product\?\.is_active \?\? false\)/)
  assert.match(productForm, /supabase\.from\("products"\)\.insert\(payload\)/)
  assert.match(productsPage, /if \(!actionVendor\.is_active\)/)
})

test("Batch 2B2 adds no customer purchasing or payment integration", () => {
  const changedUi = [manager, productForm, productsTable, productsPage, editPage].join("\n")
  for (const excluded of [
    "handle-checkout",
    "paystack",
    "payment-status",
    "finalize_paystack_paid_order",
    "product_variant_id",
    "variant_size_snapshot",
    "variant_colour_snapshot",
  ]) {
    assert.equal(changedUi.toLowerCase().includes(excluded), false, excluded)
  }
  assert.match(manager, /Customer variant purchasing\s+is not available yet/)
})
