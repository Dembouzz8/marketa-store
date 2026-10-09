import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

const browserHelper = read("src/lib/supabase-browser.ts")
const vendorLogin = read("src/app/vendor/login/page.tsx")
const productForm = read("src/components/vendor/product-form.tsx")
const productsTable = read("src/components/vendor/products-table.tsx")

test("vendor login and browser product writes share the SSR cookie client", () => {
  assert.match(
    browserHelper,
    /import\s+\{\s*createBrowserClient\s*\}\s+from\s+["']@supabase\/ssr["']/
  )
  assert.match(browserHelper, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(browserHelper, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)

  for (const [file, source] of [
    ["vendor login", vendorLogin],
    ["product form", productForm],
    ["products table", productsTable],
  ]) {
    assert.match(source, /createSupabaseBrowserClient/, file)
    assert.doesNotMatch(source, /@\/lib\/supabase["']/, file)
    assert.doesNotMatch(source, /@supabase\/supabase-js/, file)
    assert.doesNotMatch(source, /\bcreateClient\s*\(/, file)
    assert.doesNotMatch(
      source,
      /SERVICE_ROLE|SECRET_KEY|service[_-]?role/i,
      file
    )
    assert.match(
      source,
      /useMemo\(\(\) => createSupabaseBrowserClient\(\), \[\]\)/,
      file
    )
  }

  assert.match(vendorLogin, /supabase\.auth\.signInWithPassword/)
  assert.match(productForm, /supabase\.storage/)
  assert.match(productForm, /supabase\.from\("products"\)/)
  assert.match(productsTable, /supabase\s*\.from\("products"\)/)
})

test("ProductForm uploads before mutation and reports controlled failures", () => {
  const upload = productForm.indexOf("const uploadedImages = await uploadImages(imageItems)")
  const productMutation = productForm.indexOf('.from("products")')
  assert.notEqual(upload, -1)
  assert.notEqual(productMutation, -1)
  assert.ok(upload < productMutation)

  assert.match(
    productForm,
    /We couldn't upload the product images\. Please try again\./
  )
  assert.match(productForm, /We couldn't save the product\. Please try again\./)
  assert.doesNotMatch(productForm, /error instanceof Error|error\.message/)
  assert.doesNotMatch(productForm, /console\.(?:log|error|warn)/)
})

test("browser session alignment preserves product and Storage boundaries", () => {
  assert.match(productForm, /vendor_id:\s*vendorId/)
  assert.match(productForm, /useState\(product\?\.is_active \?\? false\)/)
  assert.match(
    productForm,
    /const path = `\$\{vendorId\}\/\$\{crypto\.randomUUID\(\)\}\.\$\{extension\}`/
  )
  assert.match(productForm, /\.from\("product-images"\)\s*\.upload\(path, item\.file\)/)
  assert.doesNotMatch(productForm, /upsert\s*:/)
})
