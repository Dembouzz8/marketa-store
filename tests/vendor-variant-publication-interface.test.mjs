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
const publicationPanelFile =
  "src/components/vendor/variant-publication-panel.tsx"
const publicationActionFile = "src/lib/vendor/variant-publication.ts"
const editPageFile = "src/app/vendor/products/[id]/edit/page.tsx"

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

function loadComponent(
  file,
  extraMocks = {},
  reactImplementation = reactMock,
  extraGlobals = {}
) {
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
    react: reactImplementation,
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
      process,
      ...extraGlobals,
    },
    { filename: file }
  )

  return compiledModule.exports
}

function createStatefulReact() {
  const states = []
  const refs = []
  let stateIndex = 0
  let refIndex = 0

  return {
    beginRender() {
      stateIndex = 0
      refIndex = 0
    },
    react: {
      useEffect() {},
      useMemo: (factory) => factory(),
      useRef(initial) {
        const index = refIndex++
        refs[index] ??= { current: initial }
        return refs[index]
      },
      useState(initial) {
        const index = stateIndex++
        if (!(index in states)) {
          states[index] = typeof initial === "function" ? initial() : initial
        }
        return [
          states[index],
          (value) => {
            states[index] =
              typeof value === "function" ? value(states[index]) : value
          },
        ]
      },
      useTransition: () => [false, (callback) => callback()],
    },
  }
}

function publicationActionHarness({
  gate = "true",
  user = { id: "77777777-7777-4777-8777-777777777777" },
  userError = null,
  rpcData = null,
  rpcError = null,
  clientError = null,
} = {}) {
  const calls = {
    createClient: 0,
    rpc: [],
    revalidate: [],
  }
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user }, error: userError }),
    },
    rpc: async (...args) => {
      calls.rpc.push(args)
      return { data: rpcData, error: rpcError }
    },
  }
  const loadedModule = loadComponent(
    publicationActionFile,
    {
      "next/cache": {
        revalidatePath(pathname) {
          calls.revalidate.push(pathname)
        },
      },
      "@/lib/supabase-server": {
        async createSupabaseServerClient() {
          calls.createClient += 1
          if (clientError) throw clientError
          return supabase
        },
      },
    },
    reactMock,
    {
      process: {
        env:
          gate === null
            ? {}
            : { VARIANT_PUBLICATION_UI_ENABLED: gate },
      },
    }
  )

  return {
    action: loadedModule.setVariantProductPublication,
    calls,
  }
}

const publicationProductId = "11111111-1111-4111-8111-111111111111"

function publicationRow(outcome, active, productId = publicationProductId) {
  return [
    {
      outcome,
      publication_product_id: productId,
      publication_active: active,
    },
  ]
}

function buttonWithText(tree, label) {
  return nodes(
    tree,
    (node) => node.type === "button" && textContent(node).trim() === label
  )
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

test("D5-2A structural and stock safeguards remain isolated from publication authority", () => {
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
  assert.match(checkout, /Deno\.env\.get\("VARIANT_CHECKOUT_ENABLED"\) === "true"/)
  assert.match(checkout, /catch \{\s*return false/)
})

test("publication server gate fails closed before client creation or RPC invocation", async () => {
  for (const gate of [null, "false", "TRUE", "1"]) {
    const { action, calls } = publicationActionHarness({ gate })
    const result = await action(publicationProductId, true)

    assert.equal(result.status, "error")
    assert.equal(result.outcome, "gate_disabled")
    assert.equal(calls.createClient, 0)
    assert.equal(calls.rpc.length, 0)
  }
})

test("publication action revalidates the authenticated session", async () => {
  for (const authentication of [
    { user: null, userError: null },
    { user: null, userError: { message: "expired" } },
  ]) {
    const { action, calls } = publicationActionHarness(authentication)
    const result = await action(publicationProductId, true)

    assert.equal(result.status, "error")
    assert.equal(result.outcome, "access_denied")
    assert.equal(calls.createClient, 1)
    assert.equal(calls.rpc.length, 0)
  }
})

test("publication action validates inputs and invokes the exact RPC once", async () => {
  for (const [productId, active] of [
    ["not-a-uuid", true],
    [publicationProductId, "true"],
  ]) {
    const invalid = publicationActionHarness()
    const result = await invalid.action(productId, active)
    assert.equal(result.outcome, "invalid_input")
    assert.equal(invalid.calls.createClient, 0)
    assert.equal(invalid.calls.rpc.length, 0)
  }

  const { action, calls } = publicationActionHarness({
    rpcData: publicationRow("published", true),
  })
  const result = await action(publicationProductId, true)

  assert.equal(result.status, "success")
  assert.equal(result.outcome, "published")
  assert.equal(calls.rpc.length, 1)
  assert.equal(calls.rpc[0][0], "set_vendor_product_variant_publication")
  assert.equal(calls.rpc[0][1].p_product_id, publicationProductId)
  assert.equal(calls.rpc[0][1].p_active, true)
  assert.equal(Object.keys(calls.rpc[0][1]).length, 2)
})

test("confirmed publication outcomes require exact ID and active state", async () => {
  for (const scenario of [
    { requested: true, outcome: "published", active: true },
    { requested: false, outcome: "deactivated", active: false },
    { requested: true, outcome: "no_change", active: true },
    { requested: false, outcome: "no_change", active: false },
  ]) {
    const { action, calls } = publicationActionHarness({
      rpcData: publicationRow(scenario.outcome, scenario.active),
    })
    const result = await action(publicationProductId, scenario.requested)

    assert.equal(result.status, "success")
    assert.equal(result.outcome, scenario.outcome)
    assert.equal(result.productId, publicationProductId)
    assert.equal(result.active, scenario.requested)
    assert.deepEqual(calls.revalidate, [
      `/vendor/products/${publicationProductId}/edit`,
      "/vendor/products",
    ])
  }
})

test("controlled publication failures remain non-successful and sanitized", async () => {
  for (const outcome of [
    "release_disabled",
    "invalid_state",
    "access_denied",
    "not_found",
    "invalid_input",
    "operation_failed",
  ]) {
    const { action, calls } = publicationActionHarness({
      rpcData: publicationRow(outcome, false),
    })
    const result = await action(publicationProductId, true)

    assert.equal(result.status, "error")
    assert.equal(result.outcome, outcome)
    assert.equal(calls.rpc.length, 1)
    assert.equal(calls.revalidate.length, 0)
    if (outcome === "release_disabled") {
      assert.match(result.message, /not available yet/i)
      assert.doesNotMatch(result.message, /will be available|coming soon/i)
    }
  }

  const databaseFailure = publicationActionHarness({
    rpcError: { message: "sensitive database detail" },
  })
  const databaseResult = await databaseFailure.action(publicationProductId, true)
  assert.equal(databaseResult.outcome, "operation_failed")
  assert.doesNotMatch(databaseResult.message, /sensitive database detail/)

  const clientFailure = publicationActionHarness({
    clientError: new Error("sensitive client detail"),
  })
  const clientResult = await clientFailure.action(publicationProductId, true)
  assert.equal(clientResult.outcome, "operation_failed")
  assert.doesNotMatch(clientResult.message, /sensitive client detail/)
})

test("malformed ambiguous or mismatched RPC responses fail closed", async () => {
  const malformedResponses = [
    null,
    [],
    [
      ...publicationRow("published", true),
      ...publicationRow("published", true),
    ],
    [{ outcome: "unexpected", publication_product_id: publicationProductId, publication_active: true }],
    publicationRow(
      "published",
      true,
      "99999999-9999-4999-8999-999999999999"
    ),
    publicationRow("published", false),
    publicationRow("deactivated", true),
  ]

  for (const rpcData of malformedResponses) {
    const { action, calls } = publicationActionHarness({ rpcData })
    const result = await action(publicationProductId, true)

    assert.equal(result.status, "error")
    assert.equal(result.outcome, "unconfirmed")
    assert.equal(calls.revalidate.length, 0)
  }
})

test("server rendering gate and ordinary-product exclusion are explicit", () => {
  const page = read(editPageFile)
  const action = read(publicationActionFile)
  const panel = read(publicationPanelFile)

  assert.match(
    page,
    /process\.env\.VARIANT_PUBLICATION_UI_ENABLED === "true"/
  )
  assert.match(page, /const isVariantProduct = product\.variant_mode !== "none"/)
  assert.match(page, /\{isVariantProduct \? \([\s\S]*<VariantPublicationPanel/)
  assert.match(
    action,
    /process\.env\.VARIANT_PUBLICATION_UI_ENABLED !== "true"[\s\S]*gate_disabled/
  )
  assert.doesNotMatch(
    [page, action, panel].join("\n"),
    /NEXT_PUBLIC_VARIANT_PUBLICATION|supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY|service_role/
  )
  assert.equal(
    (action.match(/"set_vendor_product_variant_publication"/g) ?? []).length,
    1
  )
  assert.doesNotMatch(action, /\.from\("products"\)[\s\S]*\.update\(/)
  assert.doesNotMatch(action, /\.from\("product_variants"\)[\s\S]*\.update\(/)
})

test("publication panel shows authoritative states and hides disabled controls", () => {
  const actionMock = {
    setVariantProductPublication: async () => {
      throw new Error("disabled controls must not call the action")
    },
  }
  const { VariantPublicationPanel } = loadComponent(publicationPanelFile, {
    "@/lib/vendor/variant-publication": actionMock,
  })
  const baseProps = {
    productId: publicationProductId,
    combinationCount: 2,
    hasAvailableStock: true,
  }
  const disabled = VariantPublicationPanel({
    ...baseProps,
    publicationState: "draft",
    enabled: false,
  })
  const unavailable = VariantPublicationPanel({
    ...baseProps,
    publicationState: "unavailable",
    enabled: true,
  })
  const draft = VariantPublicationPanel({
    ...baseProps,
    publicationState: "draft",
    enabled: true,
  })
  const published = VariantPublicationPanel({
    ...baseProps,
    publicationState: "published",
    enabled: true,
  })

  assert.match(textContent(disabled), /Draft/)
  assert.match(textContent(disabled), /Publication controls are not enabled/)
  assert.equal(buttonWithText(disabled, "Publish Product").length, 0)
  assert.equal(buttonWithText(disabled, "Unpublish Product").length, 0)
  assert.match(textContent(unavailable), /State unavailable/)
  assert.equal(buttonWithText(unavailable, "Publish Product").length, 0)
  assert.equal(buttonWithText(unavailable, "Unpublish Product").length, 0)
  assert.equal(buttonWithText(draft, "Publish Product").length, 1)
  assert.match(textContent(published), /Published/)
  assert.equal(buttonWithText(published, "Unpublish Product").length >= 1, true)
})

test("publish confirmation blocks rapid duplicates and refreshes authoritative state", async () => {
  const harness = createStatefulReact()
  let resolveAction
  let actionCalls = 0
  let refreshCalls = 0
  const actionPromise = new Promise((resolve) => {
    resolveAction = resolve
  })
  const loadedModule = loadComponent(
    publicationPanelFile,
    {
      "next/navigation": {
        useRouter: () => ({
          refresh() {
            refreshCalls += 1
          },
        }),
      },
      "@/lib/vendor/variant-publication": {
        setVariantProductPublication: async (productId, active) => {
          actionCalls += 1
          assert.equal(productId, publicationProductId)
          assert.equal(active, true)
          return actionPromise
        },
      },
    },
    harness.react
  )
  const render = () => {
    harness.beginRender()
    return loadedModule.VariantPublicationPanel({
      productId: publicationProductId,
      publicationState: "draft",
      enabled: true,
      combinationCount: 1,
      hasAvailableStock: true,
    })
  }

  let tree = render()
  buttonWithText(tree, "Publish Product")[0].props.onClick()
  tree = render()
  const dialog = nodes(tree, (node) => node.type === "dialog")[0]
  assert.equal(dialog.props.open, true)
  assert.match(textContent(dialog), /Publish this product\?/)

  const confirmation = buttonWithText(tree, "Publish Product").at(-1)
  confirmation.props.onClick()
  confirmation.props.onClick()
  assert.equal(actionCalls, 1)

  resolveAction({
    status: "success",
    outcome: "published",
    message: "Product published.",
    productId: publicationProductId,
    active: true,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = render()

  assert.equal(refreshCalls, 1)
  assert.match(textContent(tree), /Product published\./)
})

test("published products require explicit unpublish confirmation", async () => {
  const harness = createStatefulReact()
  const requests = []
  let refreshCalls = 0
  const loadedModule = loadComponent(
    publicationPanelFile,
    {
      "next/navigation": {
        useRouter: () => ({ refresh: () => { refreshCalls += 1 } }),
      },
      "@/lib/vendor/variant-publication": {
        async setVariantProductPublication(productId, active) {
          requests.push({ productId, active })
          return {
            status: "success",
            outcome: "deactivated",
            message: "Product unpublished.",
            productId,
            active,
          }
        },
      },
    },
    harness.react
  )
  const render = () => {
    harness.beginRender()
    return loadedModule.VariantPublicationPanel({
      productId: publicationProductId,
      publicationState: "published",
      enabled: true,
      combinationCount: 1,
      hasAvailableStock: true,
    })
  }

  let tree = render()
  buttonWithText(tree, "Unpublish Product")[0].props.onClick()
  tree = render()
  const dialog = nodes(tree, (node) => node.type === "dialog")[0]
  assert.equal(dialog.props.open, true)
  assert.match(textContent(dialog), /Unpublish this product\?/)
  buttonWithText(tree, "Unpublish Product").at(-1).props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(requests.length, 1)
  assert.equal(requests[0].productId, publicationProductId)
  assert.equal(requests[0].active, false)
  assert.equal(refreshCalls, 1)
})

test("publication panel converts rejected action transport into controlled feedback", async () => {
  const harness = createStatefulReact()
  let refreshCalls = 0
  const loadedModule = loadComponent(
    publicationPanelFile,
    {
      "next/navigation": {
        useRouter: () => ({ refresh: () => { refreshCalls += 1 } }),
      },
      "@/lib/vendor/variant-publication": {
        async setVariantProductPublication() {
          throw new Error("sensitive transport detail")
        },
      },
    },
    harness.react
  )
  const render = () => {
    harness.beginRender()
    return loadedModule.VariantPublicationPanel({
      productId: publicationProductId,
      publicationState: "draft",
      enabled: true,
      combinationCount: 1,
      hasAvailableStock: true,
    })
  }

  let tree = render()
  buttonWithText(tree, "Publish Product")[0].props.onClick()
  tree = render()
  buttonWithText(tree, "Publish Product").at(-1).props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = render()

  assert.match(
    textContent(tree),
    /Unable to update publication right now\. Please try again\./
  )
  assert.doesNotMatch(textContent(tree), /sensitive transport detail/)
  assert.equal(refreshCalls, 0)
})
