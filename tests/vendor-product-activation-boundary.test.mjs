import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260925120000_harden_vendor_product_activation_boundary.sql"
const productsPageFile = "src/app/vendor/products/page.tsx"
const newProductPageFile = "src/app/vendor/products/new/page.tsx"
const editProductPageFile = "src/app/vendor/products/[id]/edit/page.tsx"
const productFormFile = "src/components/vendor/product-form.tsx"
const productsTableFile = "src/components/vendor/products-table.tsx"
const dashboardFile = "src/app/vendor/dashboard/page.tsx"

const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migrationSource = read(migrationFile)
const productsPageSource = read(productsPageFile)
const newProductPageSource = read(newProductPageFile)
const editProductPageSource = read(editProductPageFile)
const productFormSource = read(productFormFile)
const productsTableSource = read(productsTableFile)
const dashboardSource = read(dashboardFile)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
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
  if (typeof tree === "string" || typeof tree === "number") return String(tree)
  if (!tree || typeof tree !== "object") return ""
  return textContent(tree.props?.children)
}

function component() {
  return null
}

function renderProductsTable(canManage) {
  const output = ts.transpileModule(productsTableSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const compiledModule = { exports: {} }
  const mocks = {
    "next/link": { __esModule: true, default: component },
    "lucide-react": Object.fromEntries(
      ["Package", "Pencil", "Plus", "Search", "Trash2"].map((name) => [
        name,
        component,
      ])
    ),
    react: {
      useMemo: (factory) => factory(),
      useState: (initial) => [initial, () => {}],
      useTransition: () => [false, () => {}],
    },
    "@/components/ui/button": { Button: component },
    "@/components/ui/dialog": {
      Dialog: component,
      DialogContent: component,
      DialogDescription: component,
      DialogFooter: component,
      DialogHeader: component,
      DialogTitle: component,
    },
    "@/components/ui/input": { Input: component },
    "@/components/ui/use-toast": { toast: () => {} },
    "@/lib/supabase": {
      supabase: {
        from() {
          throw new Error("Rendering must not mutate products")
        },
      },
    },
    "@/lib/utils": {
      cn: (...values) => values.filter(Boolean).join(" "),
      formatNaira: (value) => String(value),
      getProductImage: () => "/product.jpg",
    },
    "react/jsx-runtime": {
      jsx,
      jsxs: jsx,
      Fragment: Symbol.for("react.fragment"),
    },
  }

  vm.runInNewContext(output, {
    module: compiledModule,
    exports: compiledModule.exports,
    require(name) {
      if (name in mocks) return mocks[name]
      throw new Error(`Unexpected import: ${name}`)
    },
  }, { filename: productsTableFile })

  const product = {
    id: "11111111-1111-4111-8111-111111111111",
    vendor_id: "22222222-2222-4222-8222-222222222222",
    name: "Test product",
    description: null,
    price: 1000,
    stock: 5,
    category: "Fashion",
    images: [],
    is_active: true,
    created_at: "2026-09-25T00:00:00.000Z",
  }
  const props = canManage
    ? {
        products: [product],
        canManage: true,
        onDelete: async () => ({ error: null }),
        onToggleActive: async () => ({ error: null }),
      }
    : { products: [product], canManage: false }

  return compiledModule.exports.ProductsTable(props)
}

test("migration removes the audited ALL policy and creates four operation policies", () => {
  assert.match(migrationSource, /drop policy vendor_manage_products on public\.products;/)
  for (const [name, command] of [
    ["vendor_select_own_products", "select"],
    ["vendor_insert_own_active_products", "insert"],
    ["vendor_update_own_active_products", "update"],
    ["vendor_delete_own_active_products", "delete"],
  ]) {
    const policy = between(
      migrationSource,
      `create policy ${name}`,
      ";"
    )
    assert.match(policy, new RegExp(`for ${command}\\b`))
    assert.match(policy, /to authenticated/)
  }
})

test("own-product SELECT preserves inactive seller read access", () => {
  const policy = between(
    migrationSource,
    "create policy vendor_select_own_products",
    ";"
  )
  assert.match(policy, /vendors\.user_id = \(select auth\.uid\(\)\)/)
  assert.equal(policy.includes("vendors.is_active"), false)
})

test("product INSERT requires an owned active vendor in WITH CHECK", () => {
  const policy = between(
    migrationSource,
    "create policy vendor_insert_own_active_products",
    ";"
  )
  assert.match(policy, /with check/)
  assert.match(policy, /vendors\.user_id = \(select auth\.uid\(\)\)/)
  assert.match(policy, /vendors\.is_active = true/)
})

test("product UPDATE gates both existing and resulting rows", () => {
  const policy = between(
    migrationSource,
    "create policy vendor_update_own_active_products",
    ";"
  )
  assert.match(policy, /using \([\s\S]*vendors\.is_active = true/)
  assert.match(policy, /with check \([\s\S]*vendors\.is_active = true/)
  assert.equal((policy.match(/vendors\.user_id = \(select auth\.uid\(\)\)/g) ?? []).length, 2)
})

test("product DELETE requires an owned active vendor", () => {
  const policy = between(
    migrationSource,
    "create policy vendor_delete_own_active_products",
    ";"
  )
  assert.match(policy, /for delete/)
  assert.match(policy, /vendors\.user_id = \(select auth\.uid\(\)\)/)
  assert.match(policy, /vendors\.is_active = true/)
  assert.equal(policy.includes("with check"), false)
})

test("public product reads require product and vendor activation", () => {
  const policy = between(
    migrationSource,
    "create policy products_public_read",
    ";"
  )
  assert.match(policy, /to public/)
  assert.match(policy, /is_active = true/)
  assert.match(policy, /public\.is_vendor_active\(vendor_id\)/)
  assert.equal(policy.includes("public_active_vendors"), false)
})

test("active-vendor helper is a narrow hardened SECURITY DEFINER boolean", () => {
  const helper = between(
    migrationSource,
    "create function public.is_vendor_active",
    "$function$;"
  )
  assert.match(helper, /\(p_vendor_id uuid\)/)
  assert.match(helper, /returns boolean/)
  assert.match(helper, /language sql/)
  assert.match(helper, /stable/)
  assert.match(helper, /security definer/)
  assert.match(helper, /set search_path = ''/)
  assert.match(helper, /from public\.vendors as vendor/)
  assert.match(helper, /where vendor\.id = p_vendor_id/)
  assert.match(helper, /select coalesce\(\([\s\S]*false\)/)
  assert.equal(helper.toLowerCase().includes("execute "), false)
  assert.match(
    migrationSource,
    /public\.is_vendor_active\(null\) is distinct from false/
  )
  assert.match(
    migrationSource,
    /public\.is_vendor_active\(vendor\.id\) is distinct from vendor\.is_active/
  )
})

test("helper grants execution only to anon and authenticated", () => {
  assert.doesNotMatch(migrationSource, /pg_catalog\.coalesce/)
  assert.match(
    migrationSource,
    /cross join lateral pg_catalog\.aclexplode\(\s*coalesce\(\s*procedure\.proacl,\s*pg_catalog\.acldefault/
  )
  assert.match(
    migrationSource,
    /revoke all privileges on function public\.is_vendor_active\(uuid\)[\s\S]*from public, anon, authenticated, service_role;/
  )
  assert.match(
    migrationSource,
    /grant execute on function public\.is_vendor_active\(uuid\)\s+to anon, authenticated;/
  )
  assert.doesNotMatch(
    migrationSource,
    /grant execute on function public\.is_vendor_active\(uuid\)[\s\S]{0,80}service_role;/
  )
})

test("product default becomes false without rewriting rows or nullability", () => {
  assert.match(
    migrationSource,
    /alter table public\.products\s+alter column is_active set default false;/
  )
  assert.doesNotMatch(migrationSource, /update\s+public\.products\b/i)
  assert.doesNotMatch(migrationSource, /alter column is_active set not null/i)
  assert.doesNotMatch(migrationSource, /alter column is_active drop not null/i)
})

test("migration preserves vendor activation and verification boundaries", () => {
  assert.doesNotMatch(migrationSource, /alter table public\.vendors/i)
  assert.doesNotMatch(migrationSource, /update\s+public\.vendors\b/i)
  assert.equal(migrationSource.includes("vendor_verifications"), false)
  assert.match(
    migrationSource,
    /has_column_privilege\([\s\S]*'authenticated'[\s\S]*'public\.vendors'[\s\S]*'is_active'[\s\S]*'UPDATE'/
  )
})

test("migration has defensive preflight, postconditions, and transaction boundaries", () => {
  assert.match(migrationSource, /^-- Batch 4A:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /do \$preflight\$/)
  assert.match(migrationSource, /do \$postcondition\$/)
  assert.match(migrationSource, /products\.is_active default or nullability no longer matches/)
  assert.match(migrationSource, /unexpected additional product policies exist/)
  assert.match(migrationSource, /public\.is_vendor_active is unexpectedly occupied/)
  assert.match(migrationSource, /\ncommit;\s*$/)
})

test("named product policy postconditions fail closed on absence, wrong names, or nonpermissive policies", () => {
  const postcondition = between(
    migrationSource,
    "do $postcondition$",
    "$postcondition$;"
  )
  const publicReadCheck = between(
    postcondition,
    "and policy.policyname = 'products_public_read';",
    "raise exception 'Batch 4A postcondition: public product visibility policy is incorrect.';"
  )
  assert.match(publicReadCheck, /policy_record\.policyname is null/)
  assert.match(publicReadCheck, /policy_record\.policyname <> 'products_public_read'/)
  assert.match(publicReadCheck, /policy_record\.permissive <> 'PERMISSIVE'/)

  const ownSelectCheck = between(
    postcondition,
    "and policy.policyname = 'vendor_select_own_products';",
    "raise exception 'Batch 4A postcondition: own-product SELECT policy is incorrect.';"
  )
  assert.match(ownSelectCheck, /policy_record\.policyname is null/)
  assert.match(ownSelectCheck, /policy_record\.policyname <> 'vendor_select_own_products'/)
  assert.match(ownSelectCheck, /policy_record\.permissive <> 'PERMISSIVE'/)
})

test("all mutation-policy postconditions require exact names and PERMISSIVE mode", () => {
  const mutationLoop = between(
    migrationSource,
    "for policy_record in",
    "if (\n    select pg_catalog.count(*)"
  )
  for (const name of [
    "vendor_insert_own_active_products",
    "vendor_update_own_active_products",
    "vendor_delete_own_active_products",
  ]) {
    assert.ok(mutationLoop.includes(`'${name}'`), name)
    assert.match(
      mutationLoop,
      new RegExp(`policy_record\\.policyname = '${name}'`)
    )
  }
  assert.match(mutationLoop, /policy_record\.policyname not in \(/)
  assert.match(mutationLoop, /policy_record\.permissive <> 'PERMISSIVE'/)
  assert.doesNotMatch(
    migrationSource,
    /foreach\s+policy_record\s+in\s+select/i
  )
  assert.match(
    migrationSource,
    /policyname in \([\s\S]*'vendor_insert_own_active_products'[\s\S]*'vendor_update_own_active_products'[\s\S]*'vendor_delete_own_active_products'[\s\S]*\)\s*\) <> 3/
  )
})

test("products page loads activation and keeps inactive product history visible", () => {
  assert.match(productsPageSource, /\.select\("id, is_active"\)/)
  assert.match(productsPageSource, /\.from\("products"\)[\s\S]*\.eq\("vendor_id", vendor\.id\)/)
  assert.match(productsPageSource, /You can review your products/)
  assert.match(productsPageSource, /<ProductsTable products=\{products\} canManage=\{false\} \/>/)
})

test("list mutation actions rederive and require an active vendor before mutation", () => {
  assert.equal((productsPageSource.match(/await getVendorContext\(\)/g) ?? []).length, 3)
  assert.equal((productsPageSource.match(/if \(!actionVendor\.is_active\)/g) ?? []).length, 2)
  const deleteAction = between(productsPageSource, "async function deleteProduct", "async function toggleProductActive")
  const toggleAction = between(productsPageSource, "async function toggleProductActive", "return (")
  assert.ok(deleteAction.indexOf("if (!actionVendor.is_active)") < deleteAction.indexOf('.from("products")'))
  assert.ok(toggleAction.indexOf("if (!actionVendor.is_active)") < toggleAction.indexOf('.from("products")'))
  assert.match(deleteAction, /\.eq\("vendor_id", actionVendor\.id\)/)
  assert.match(toggleAction, /\.eq\("vendor_id", actionVendor\.id\)/)
  assert.equal(productsPageSource.includes("error.message"), false)
})

test("new-product route blocks inactive vendors before rendering ProductForm", () => {
  assert.match(newProductPageSource, /\.select\("id, is_active"\)/)
  assert.ok(newProductPageSource.indexOf("if (!vendor.is_active)") < newProductPageSource.indexOf("<ProductForm"))
  assert.match(newProductPageSource, /Seller activation required/)
  assert.match(newProductPageSource, /href="\/vendor\/products"/)
})

test("edit route blocks inactive vendors before product lookup and form rendering", () => {
  assert.match(editProductPageSource, /\.select\("id, is_active"\)/)
  assert.ok(editProductPageSource.indexOf("if (!vendor.is_active)") < editProductPageSource.indexOf('.from("products")'))
  assert.ok(editProductPageSource.indexOf("if (!vendor.is_active)") < editProductPageSource.indexOf("<ProductForm"))
  assert.match(editProductPageSource, /\.eq\("vendor_id", vendor\.id\)/)
  assert.match(editProductPageSource, /Seller activation required/)
})

test("new products default inactive while existing edits preserve their value", () => {
  assert.match(
    productFormSource,
    /useState\(product\?\.is_active \?\? false\)/
  )
  assert.match(productFormSource, /is_active: isActive/)
  assert.equal(productFormSource.includes("product?.is_active ?? true"), false)
})

test("inactive products table renders history without management controls", () => {
  const tree = renderProductsTable(false)
  const hrefs = nodes(tree, (node) => typeof node.props?.href === "string").map(
    (node) => node.props.href
  )
  const labels = nodes(tree, (node) => typeof node.props?.["aria-label"] === "string").map(
    (node) => node.props["aria-label"]
  )
  assert.equal(hrefs.includes("/vendor/products/new"), false)
  assert.equal(hrefs.some((href) => href.endsWith("/edit")), false)
  assert.equal(labels.some((label) => label.startsWith("Edit ")), false)
  assert.equal(labels.some((label) => label.startsWith("Delete ")), false)
  assert.equal(labels.includes("Toggle product status"), false)
  assert.equal(nodes(tree, (node) => node.type === "button").length, 0)
  assert.match(textContent(tree), /Test product/)
  assert.match(textContent(tree), /Active/)
  assert.match(textContent(tree), /Read only/)
})

test("active products table retains create, stock, toggle, edit, and delete controls", () => {
  const tree = renderProductsTable(true)
  const hrefs = nodes(tree, (node) => typeof node.props?.href === "string").map(
    (node) => node.props.href
  )
  const labels = nodes(tree, (node) => typeof node.props?.["aria-label"] === "string").map(
    (node) => node.props["aria-label"]
  )
  assert.ok(hrefs.includes("/vendor/products/new"))
  assert.ok(hrefs.includes("/vendor/products/11111111-1111-4111-8111-111111111111/edit"))
  assert.ok(labels.includes("Toggle product status"))
  assert.ok(labels.includes("Edit Test product"))
  assert.ok(labels.includes("Delete Test product"))
  assert.ok(nodes(tree, (node) => node.type === "button").length > 0)
})

test("products table does not render its delete dialog in read-only mode", () => {
  const tree = renderProductsTable(false)
  assert.equal(textContent(tree).includes("Delete product?"), false)
  assert.match(productsTableSource, /\{canManage && \([\s\S]*<Dialog/)
})

test("dashboard is activation-aware without blocking seller access", () => {
  assert.match(dashboardSource, /\.select\("id, name, platform_fee_pct, is_active"\)/)
  assert.match(dashboardSource, /Seller account pending activation/)
  assert.match(dashboardSource, /vendor\.is_active[\s\S]*"Visible in storefront"[\s\S]*"Available after seller activation"/)
  assert.match(dashboardSource, /vendor\.is_active \? \([\s\S]*href="\/vendor\/products\/new"/)
  assert.match(dashboardSource, /Review Products/)
})

test("activation copy does not conflate activation with verification", () => {
  const changedUi = [
    productsPageSource,
    newProductPageSource,
    editProductPageSource,
    productsTableSource,
    dashboardSource,
  ].join("\n")
  assert.equal(changedUi.toLowerCase().includes("verif"), false)
  assert.equal(changedUi.includes("provisioning"), false)
})

test("Batch 4A working-tree scope excludes frozen systems", () => {
  const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  })
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" }
  )
  const changed = new Set(
    `${tracked}\n${untracked}`
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean)
  )
  const allowed = new Set([
    migrationFile,
    productsPageFile,
    newProductPageFile,
    editProductPageFile,
    productFormFile,
    productsTableFile,
    dashboardFile,
    "tests/vendor-product-activation-boundary.test.mjs",
  ])
  for (const file of changed) {
    assert.ok(allowed.has(file), `Unexpected Batch 4A file: ${file}`)
  }
})

test("migration leaves checkout, storefront projection, Auth, and provisioning untouched", () => {
  for (const forbidden of [
    "public_active_vendors",
    "vendor_verifications",
    "admin_users",
    "inviteUserByEmail",
    "auth.users",
    "orders",
    "payout",
    "refund",
    "n8n",
  ]) {
    assert.equal(migrationSource.includes(forbidden), false, forbidden)
  }
  assert.equal(migrationSource.includes("service_role"), true)
  assert.match(
    migrationSource,
    /revoke all privileges[\s\S]*service_role;[\s\S]*grant execute[\s\S]*to anon, authenticated;/
  )
})
