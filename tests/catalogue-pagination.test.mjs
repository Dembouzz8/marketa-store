import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalogueSource = fs
  .readFileSync(path.join(root, "src/lib/catalogue.ts"), "utf8")
  .replace(/\r\n/g, "\n")
const pageSource = fs
  .readFileSync(path.join(root, "src/app/(store)/products/page.tsx"), "utf8")
  .replace(/\r\n/g, "\n")

const moduleUrl = (contents) =>
  `data:text/javascript;base64,${Buffer.from(contents).toString("base64")}`

const storefrontStub = moduleUrl(`
  export const STORE_CATEGORIES = [
    { slug: "fashion", databaseValues: ["Fashion", "Men's Fashion"] },
  ]
  export function getCategoryDatabaseValues(slug) {
    return STORE_CATEGORIES.find((category) => category.slug === slug)?.databaseValues ?? []
  }
`)

const supabaseStub = moduleUrl(`
  function takeResult() {
    const result = globalThis.__catalogueResults.shift()
    if (!result) throw new Error("Unexpected catalogue query")
    return Promise.resolve(result)
  }

  function builderFor(request) {
    const builder = {
      select(fields, options) { request.select = { fields, options }; return builder },
      eq(column, value) { request.filters.push(["eq", column, value]); return builder },
      gt(column, value) { request.filters.push(["gt", column, value]); return builder },
      gte(column, value) { request.filters.push(["gte", column, value]); return builder },
      in(column, value) { request.filters.push(["in", column, value]); return builder },
      lte(column, value) { request.filters.push(["lte", column, value]); return builder },
      or(value) { request.or.push(value); return builder },
      order(column, options) { request.order.push([column, options]); return builder },
      range(from, to) { request.range = [from, to]; return takeResult() },
      then(resolve, reject) { request.awaited = true; return takeResult().then(resolve, reject) },
    }
    return builder
  }

  export const supabase = {
    from(table) {
      const request = { table, filters: [], or: [], order: [] }
      globalThis.__catalogueRequests.push(request)
      return builderFor(request)
    },
  }
`)

const transpiled = ts.transpileModule(catalogueSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "src/lib/catalogue.ts",
})
assert.equal(transpiled.diagnostics?.length ?? 0, 0)

const executableSource = transpiled.outputText
  .replace("@/lib/storefront", storefrontStub)
  .replace("@/lib/supabase", supabaseStub)

globalThis.__catalogueRequests = []
globalThis.__catalogueResults = []

const {
  CATALOGUE_PAGE_SIZE,
  catalogueHref,
  getCatalogue,
  parseCatalogueParams,
} = await import(moduleUrl(executableSource))

const vendor = { id: "11111111-1111-4111-8111-111111111111", name: "Vendor" }
const product = {
  id: "22222222-2222-4222-8222-222222222222",
  vendor_id: vendor.id,
  name: "Product",
}

function setResults(...results) {
  globalThis.__catalogueRequests.length = 0
  globalThis.__catalogueResults = [...results]
}

function pgrst103() {
  return {
    data: null,
    error: {
      code: "PGRST103",
      message: "Requested range not satisfiable",
      details: "The requested offset is beyond the result set.",
      hint: null,
    },
    count: null,
  }
}

function success(count, data = []) {
  return { data, error: null, count }
}

function canonicalHref(params, result) {
  return params.page === result.page
    ? null
    : catalogueHref(params, { page: result.page })
}

test("page parsing is deterministic and keeps range arithmetic bounded", () => {
  assert.equal(parseCatalogueParams({ page: "1" }).page, 1)
  assert.equal(parseCatalogueParams({ page: "2" }).page, 2)
  assert.equal(parseCatalogueParams({ page: "0" }).page, 1)
  assert.equal(parseCatalogueParams({ page: "-2" }).page, 1)
  assert.equal(parseCatalogueParams({ page: "two" }).page, 1)
  assert.equal(parseCatalogueParams({ page: "2.5" }).page, 1)
  assert.equal(parseCatalogueParams({ page: "9".repeat(1000) }).page, 1)
})

test("valid pages retain one database query and exact count calculations", async () => {
  setResults(success(25, [product]))
  const firstParams = parseCatalogueParams({ page: "1" })
  const first = await getCatalogue(firstParams, [vendor])

  assert.equal(globalThis.__catalogueRequests.length, 1)
  assert.deepEqual(globalThis.__catalogueRequests[0].range, [0, 23])
  assert.deepEqual(globalThis.__catalogueRequests[0].select.options, {
    count: "exact",
  })
  assert.equal(first.total, 25)
  assert.equal(first.totalPages, 2)
  assert.equal(first.page, 1)
  assert.equal(first.products.length, 1)
  assert.equal(canonicalHref(firstParams, first), null)

  setResults(success(25, [product]))
  const lastParams = parseCatalogueParams({ page: "2" })
  const last = await getCatalogue(lastParams, [vendor])
  assert.equal(globalThis.__catalogueRequests.length, 1)
  assert.deepEqual(globalThis.__catalogueRequests[0].range, [24, 47])
  assert.equal(last.page, 2)
  assert.equal(last.totalPages, 2)
  assert.equal(canonicalHref(lastParams, last), null)
})

test("exactly 24 and 25 rows produce the correct final pages", async () => {
  setResults(success(24, [product]))
  const exactPage = await getCatalogue(parseCatalogueParams({ page: "1" }), [vendor])
  assert.equal(exactPage.totalPages, 1)

  setResults(success(25, [product]))
  const spillPage = await getCatalogue(parseCatalogueParams({ page: "2" }), [vendor])
  assert.equal(spillPage.totalPages, 2)
  assert.equal(spillPage.page, 2)
})

test("PGRST103 recovery uses one count-only query and preserves filters in the redirect", async () => {
  setResults(pgrst103(), success(2, null))
  const params = parseCatalogueParams({
    q: "Men's",
    category: "fashion",
    vendor: vendor.id,
    minPrice: "100",
    maxPrice: "50000",
    availability: "in-stock",
    sort: "price-asc",
    page: "2",
  })
  const result = await getCatalogue(params, [vendor])

  assert.equal(globalThis.__catalogueRequests.length, 2)
  assert.deepEqual(globalThis.__catalogueRequests[0].range, [24, 47])
  assert.deepEqual(globalThis.__catalogueRequests[1].select, {
    fields: "id",
    options: { count: "exact", head: true },
  })
  assert.equal(globalThis.__catalogueRequests[1].awaited, true)
  assert.equal(result.total, 2)
  assert.equal(result.totalPages, 1)
  assert.equal(result.page, 1)
  assert.deepEqual(result.products, [])
  assert.equal(
    canonicalHref(params, result),
    `/products?q=Men%27s&category=fashion&vendor=${vendor.id}&minPrice=100&maxPrice=50000&availability=in-stock&sort=price-asc`
  )
})

test("pages beyond the final page canonicalize without an unnecessary third query", async () => {
  setResults(pgrst103(), success(49, null))
  const params = parseCatalogueParams({ q: "Product", page: "9" })
  const result = await getCatalogue(params, [vendor])

  assert.equal(globalThis.__catalogueRequests.length, 2)
  assert.equal(result.totalPages, 3)
  assert.equal(result.page, 3)
  assert.equal(canonicalHref(params, result), "/products?q=Product&page=3")
})

test("an empty result set canonicalizes to page one and then renders empty without a loop", async () => {
  setResults(pgrst103(), success(0, null))
  const staleParams = parseCatalogueParams({ q: "No match", page: "8" })
  const stale = await getCatalogue(staleParams, [vendor])
  assert.equal(stale.total, 0)
  assert.equal(stale.page, 1)
  assert.equal(canonicalHref(staleParams, stale), "/products?q=No+match")

  setResults(success(0, []))
  const canonicalParams = parseCatalogueParams({ q: "No match", page: "1" })
  const canonical = await getCatalogue(canonicalParams, [vendor])
  assert.equal(canonical.products.length, 0)
  assert.equal(canonical.page, 1)
  assert.equal(canonicalHref(canonicalParams, canonical), null)
})

test("other database failures and unverified PGRST103 responses remain errors", async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    setResults({
      data: null,
      error: { code: "XX000", message: "Database failure", details: null, hint: null },
      count: null,
    })
    await assert.rejects(
      getCatalogue(parseCatalogueParams({ page: "2" }), [vendor]),
      /Unable to load catalogue: Database failure/u
    )
    assert.equal(globalThis.__catalogueRequests.length, 1)

    setResults(pgrst103(), {
      data: null,
      error: { code: "42501", message: "Count denied", details: null, hint: null },
      count: null,
    })
    await assert.rejects(
      getCatalogue(parseCatalogueParams({ page: "2" }), [vendor]),
      /Unable to load catalogue: Requested range not satisfiable/u
    )

    setResults(pgrst103(), success(30, null))
    await assert.rejects(
      getCatalogue(parseCatalogueParams({ page: "2" }), [vendor]),
      /Unable to load catalogue: Requested range not satisfiable/u
    )
  } finally {
    console.error = originalConsoleError
  }
})

test("successive count changes move toward a canonical page without looping", async () => {
  setResults(pgrst103(), success(49, null))
  const pageNineParams = parseCatalogueParams({ q: "Product", page: "9" })
  const pageNine = await getCatalogue(pageNineParams, [vendor])
  assert.equal(pageNine.page, 3)

  setResults(pgrst103(), success(24, null))
  const pageThreeParams = parseCatalogueParams({ q: "Product", page: "3" })
  const pageThree = await getCatalogue(pageThreeParams, [vendor])
  assert.equal(pageThree.page, 1)

  setResults(success(24, [product]))
  const pageOneParams = parseCatalogueParams({ q: "Product", page: "1" })
  const pageOne = await getCatalogue(pageOneParams, [vendor])
  assert.equal(pageOne.page, 1)
  assert.equal(canonicalHref(pageOneParams, pageOne), null)
})

test("page component redirects only when getCatalogue returns a different canonical page", () => {
  assert.match(pageSource, /if \(params\.page !== result\.page\) \{/u)
  assert.match(
    pageSource,
    /redirect\(catalogueHref\(params, \{ page: result\.page \}\)\)/u
  )
  assert.doesNotMatch(pageSource, /result\.total > 0/u)
})

test("catalogue page size and database-side range remain unchanged", () => {
  assert.equal(CATALOGUE_PAGE_SIZE, 24)
  assert.match(catalogueSource, /requestedFrom \+ CATALOGUE_PAGE_SIZE - 1/u)
})
