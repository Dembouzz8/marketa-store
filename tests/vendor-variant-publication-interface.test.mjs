import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

const productsTableFile = "src/components/vendor/products-table.tsx"
const productFormFile = "src/components/vendor/product-form.tsx"
const legacyManagerFile =
  "src/components/vendor/product-variants-manager.tsx"
const optionsManagerFile =
  "src/components/vendor/product-options-manager.tsx"

const sources = {
  productsTable: read(productsTableFile),
  productForm: read(productFormFile),
  legacyManager: read(legacyManagerFile),
  optionsManager: read(optionsManagerFile),
}

function jsx(type, props, key) {
  return { type, props: props ?? {}, key }
}

function nodes(tree, predicate, found = []) {
  if (Array.isArray(tree)) {
    for (const child of tree) nodes(child, predicate, found)
    return found
  }
  if (!tree || typeof tree !== "object") return found
  if (predicate(tree)) found.push(tree)
  nodes(tree.props?.children, predicate, found)
  return found
}

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join("")
  if (typeof tree === "string" || typeof tree === "number") {
    return String(tree)
  }
  if (!tree || typeof tree !== "object") return ""
  return textContent(tree.props?.children)
}

function component() {
  return null
}

const reactMock = {
  useEffect() {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [
    typeof initial === "function" ? initial() : initial,
    () => {},
  ],
  useTransition: () => [false, (callback) => callback()],
}

const jsxRuntime = {
  jsx,
  jsxs: jsx,
  Fragment: Symbol.for("react.fragment"),
}

const uiMocks = {
  "@/components/ui/button": { Button: "button" },
  "@/components/ui/input": { Input: "input" },
  "@/components/ui/dialog": {
    Dialog: "dialog",
    DialogContent: "dialog-content",
    DialogDescription: "dialog-description",
    DialogFooter: "dialog-footer",
    DialogHeader: "dialog-header",
    DialogTitle: "dialog-title",
  },
  "@/components/ui/use-toast": { toast() {} },
}

function loadComponent(file, extraMocks = {}) {
  const source = read(file)
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const compiledModule = { exports: {} }
  const mocks = {
    react: reactMock,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: "link" },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "lucide-react": new Proxy(
      {},
      { get: () => component }
    ),
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient: () => ({}),
    },
    "@/lib/utils": {
      cn: (...values) => values.filter(Boolean).join(" "),
      formatNaira: (value) => `NGN ${value}`,
      getProductImage: () => "/product.jpg",
    },
    ...uiMocks,
    ...extraMocks,
  }

  vm.runInNewContext(
    output,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require(specifier) {
        if (specifier in mocks) return mocks[specifier]
        throw new Error(`Unexpected module: ${specifier}`)
      },
      console,
    },
    { filename: file }
  )

  return compiledModule.exports
}

function product(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    vendor_id: "22222222-2222-4222-8222-222222222222",
    name: "Test product",
    description: "Description",
    price: 5000,
    stock: 0,
    category: "Fashion",
    category_code: "fashion",
    images: [],
    is_active: false,
    variant_mode: "size",
    stock_version: 0,
    created_at: "2026-11-23T00:00:00.000Z",
    ...overrides,
  }
}

function variant(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    product_id: "11111111-1111-4111-8111-111111111111",
    vendor_id: "22222222-2222-4222-8222-222222222222",
    size: "M",
    colour: null,
    size_normalized: "m",
    colour_normalized: null,
    stock: 5,
    stock_version: 2,
    is_active: false,
    created_at: "2026-11-23T00:00:00.000Z",
    updated_at: "2026-11-23T00:00:00.000Z",
    ...overrides,
  }
}

function optionRows(active) {
  const axisId = "44444444-4444-4444-8444-444444444444"
  const valueId = "55555555-5555-4555-8555-555555555555"
  const variantId = "66666666-6666-4666-8666-666666666666"
  return {
    reference: [
      {
        outcome: "ok",
        reference_data: {
          categories: [{ code: "fashion", name: "Fashion", sort_order: 0 }],
          options: [
            {
              code: "size",
              name: "Size",
              value_kind: "label",
              dimension_code: null,
              requires_unit: false,
              requires_size_system: false,
              sort_order: 0,
            },
            {
              code: "colour",
              name: "Colour",
              value_kind: "colour",
              dimension_code: null,
              requires_unit: false,
              requires_size_system: false,
              sort_order: 1,
            },
          ],
          units: [],
          size_systems: [],
          templates: [
            {
              category_code: "fashion",
              option_code: "size",
              sort_order: 0,
              default_unit_code: null,
              default_size_system_code: null,
            },
            {
              category_code: "fashion",
              option_code: "colour",
              sort_order: 1,
              default_unit_code: null,
              default_size_system_code: null,
            },
          ],
        },
      },
    ],
    configuration: [
      {
        outcome: "ok",
        configuration: {
          product_id: "11111111-1111-4111-8111-111111111111",
          category_code: "fashion",
          variant_mode: "options",
          is_active: active,
          parent_stock: 0,
          axes: [
            {
              id: axisId,
              option_code: "size",
              display_name: "Size",
              position: 1,
              unit_code: null,
              size_system_code: null,
              values: [
                {
                  id: valueId,
                  display_label: "M",
                  numeric_value: null,
                  swatch_hex: null,
                  sort_order: 0,
                },
              ],
            },
          ],
          variants: [
            {
              id: variantId,
              stock: 5,
              stock_version: 2,
              is_active: active,
              selected_value_ids: [valueId],
            },
          ],
        },
      },
    ],
  }
}

test("variant state helpers distinguish Draft Published and unavailable", () => {
  const table = loadComponent(productsTableFile)
  const form = loadComponent(productFormFile)

  for (const helper of [
    table.getVariantPublicationState,
    form.getVariantFormPublicationState,
  ]) {
    assert.equal(helper(false), "draft")
    assert.equal(helper(true), "published")
    assert.equal(helper(undefined), "unavailable")
    assert.equal(helper(null), "unavailable")
  }
})

test("products table renders authoritative variant states without ordinary toggles", () => {
  const { ProductsTable } = loadComponent(productsTableFile)
  const tree = ProductsTable({
    products: [
      product({ id: "draft", name: "Draft variant", is_active: false }),
      product({ id: "published", name: "Published variant", is_active: true }),
      product({
        id: "ordinary",
        name: "Ordinary product",
        variant_mode: "none",
        stock: 8,
        is_active: true,
      }),
    ],
    canManage: true,
    onDelete: async () => ({ error: null }),
    onToggleActive: async () => ({ error: null }),
  })
  const text = textContent(tree)
  const activationToggles = nodes(
    tree,
    (node) => node.props?.["aria-label"] === "Toggle product status"
  )

  assert.match(text, /Draft variant[\s\S]*Draft/)
  assert.match(text, /Published variant[\s\S]*Published/)
  assert.match(text, /Ordinary product[\s\S]*Ordinary/)
  assert.equal(activationToggles.length, 1)
})

test("variant ProductForm shows read-only state while ordinary status remains interactive", () => {
  const { ProductForm } = loadComponent(productFormFile)
  const published = ProductForm({
    product: product({ is_active: true }),
    vendorId: "22222222-2222-4222-8222-222222222222",
    onSuccess: async () => {},
  })
  const ordinary = ProductForm({
    product: product({ variant_mode: "none", stock: 8, is_active: true }),
    vendorId: "22222222-2222-4222-8222-222222222222",
    onSuccess: async () => {},
  })

  assert.match(textContent(published), /Published/)
  assert.match(textContent(published), /Publication management is handled separately/)
  assert.equal(
    nodes(
      published,
      (node) =>
        node.type === "button" &&
        /^(?:Publish|Unpublish)$/.test(textContent(node).trim())
    ).length,
    0
  )
  assert.match(textContent(ordinary), /Active/)
})

test("published legacy products block structure while preserving stock CAS controls", () => {
  const manager = loadComponent(legacyManagerFile)
  const publishedVariant = variant({ is_active: true })
  const published = manager.ProductVariantsManager({
    product: product({ is_active: true }),
    initialVariants: [publishedVariant],
    initialLoadFailed: false,
  })
  const draft = manager.ProductVariantsManager({
    product: product({ is_active: false }),
    initialVariants: [variant({ is_active: false })],
    initialLoadFailed: false,
  })

  assert.equal(manager.canEditLegacyVariantStructure(true, [true]), false)
  assert.equal(manager.canEditLegacyVariantStructure(false, [false]), true)
  assert.equal(manager.canEditLegacyVariantStructure(undefined, [false]), false)
  assert.equal(manager.canEditLegacyVariantStructure(false, [true]), false)
  assert.match(textContent(published), /Unpublish this product before adding, renaming, or deleting combinations/)
  assert.match(textContent(published), /Edit stock/)
  assert.doesNotMatch(textContent(published), /Add combination/)
  assert.equal(
    nodes(published, (node) =>
      String(node.props?.["aria-label"] ?? "").startsWith("Edit labels")
    ).length,
    0
  )
  assert.match(textContent(draft), /Add combination/)
  assert.match(textContent(draft), /Edit stock/)
  assert.equal(
    nodes(draft, (node) =>
      String(node.props?.["aria-label"] ?? "").startsWith("Edit labels")
    ).length,
    1
  )
})

test("published universal options block structure while preserving stock CAS controls", () => {
  const manager = loadComponent(optionsManagerFile)
  const publishedRows = optionRows(true)
  const draftRows = optionRows(false)
  const published = manager.ProductOptionsManager({
    product: product({ variant_mode: "options", is_active: true }),
    initialReferenceRows: publishedRows.reference,
    initialConfigurationRows: publishedRows.configuration,
    initialLoadFailed: false,
  })
  const draft = manager.ProductOptionsManager({
    product: product({ variant_mode: "options", is_active: false }),
    initialReferenceRows: draftRows.reference,
    initialConfigurationRows: draftRows.configuration,
    initialLoadFailed: false,
  })

  assert.equal(
    manager.canEditUniversalOptionStructure(true, true, [true]),
    false
  )
  assert.equal(
    manager.canEditUniversalOptionStructure(false, false, [false]),
    true
  )
  assert.equal(
    manager.canEditUniversalOptionStructure(false, true, [false]),
    false
  )
  assert.match(textContent(published), /Unpublish this product before changing option axes/)
  assert.match(textContent(published), /Edit stock/)
  assert.doesNotMatch(textContent(published), /Add axis/)
  assert.doesNotMatch(textContent(published), /Create combination/)
  assert.match(textContent(draft), /Add axis/)
  assert.match(textContent(draft), /Create combination/)
  assert.match(textContent(draft), /Edit stock/)
})

test("stock CAS and conflict safeguards remain while publication authority is absent", () => {
  assert.match(
    sources.legacyManager,
    /update_vendor_product_variant_stock[\s\S]*p_expected_stock_version: variant\.stock_version/
  )
  assert.match(sources.legacyManager, /result\.outcome === "conflict"/)
  assert.match(
    sources.optionsManager,
    /update_vendor_product_variant_stock[\s\S]*p_expected_stock_version: variant\.stock_version/
  )
  assert.match(sources.optionsManager, /result\.outcome === "conflict"/)

  const productionSources = Object.values(sources).join("\n")
  assert.doesNotMatch(
    productionSources,
    /set_vendor_product_variant_publication/
  )
  assert.doesNotMatch(productionSources, /SUPABASE_SERVICE_ROLE_KEY|service_role/)
  assert.doesNotMatch(productionSources, />\s*(?:Publish|Unpublish)\s*</)

  const checkout = read("supabase/functions/handle-checkout/index.ts")
  assert.match(checkout, /const VARIANT_CHECKOUT_ENABLED = false/)
})
