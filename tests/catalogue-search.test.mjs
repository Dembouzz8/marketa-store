import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = fs
  .readFileSync(path.join(root, "src/lib/catalogue.ts"), "utf8")
  .replace(/\r\n/g, "\n")

const moduleUrl = (contents) =>
  `data:text/javascript;base64,${Buffer.from(contents).toString("base64")}`

const storefrontStub = moduleUrl(`
  export const STORE_CATEGORIES = []
  export function getCategoryDatabaseValues() { return [] }
`)

const supabaseStub = moduleUrl(`
  function builderFor(request) {
    const builder = {
      select(fields, options) { request.select = { fields, options }; return builder },
      eq(column, value) { request.filters.push(["eq", column, value]); return builder },
      gt(column, value) { request.filters.push(["gt", column, value]); return builder },
      gte(column, value) { request.filters.push(["gte", column, value]); return builder },
      in(column, value) { request.filters.push(["in", column, value]); return builder },
      ilike(column, value) { request.filters.push(["ilike", column, value]); return builder },
      lte(column, value) { request.filters.push(["lte", column, value]); return builder },
      maybeSingle() { request.maybeSingle = true; return Promise.resolve(globalThis.__catalogueResult) },
      or(value) { request.or.push(value); return builder },
      order(column, options) { request.order.push([column, options]); return builder },
      range(from, to) {
        request.range = [from, to]
        return Promise.resolve(globalThis.__catalogueResult)
      },
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

const transpiled = ts.transpileModule(source, {
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
globalThis.__catalogueResult = { data: [], error: null, count: 0 }

const {
  buildCatalogueSearchFilter,
  catalogueHref,
  getCatalogue,
  normalizeSearchTerm,
  parseCatalogueParams,
} = await import(moduleUrl(executableSource))

function firstIlikePattern(filter) {
  const match = filter.match(/^name\.ilike\."((?:\\.|[^"])*)"/u)
  assert.ok(match, `missing quoted name ILIKE operand in ${filter}`)

  let decoded = ""
  for (let index = 0; index < match[1].length; index += 1) {
    if (match[1][index] === "\\") {
      index += 1
      assert.ok(index < match[1].length, "unterminated PostgREST escape")
    }
    decoded += match[1][index]
  }
  return decoded
}

function postgresLikeRegex(pattern) {
  let expression = "^"
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === "\\") {
      index += 1
      assert.ok(index < pattern.length, "unterminated PostgreSQL LIKE escape")
      expression += pattern[index].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    } else if (character === "%") {
      expression += ".*"
    } else if (character === "_") {
      expression += "."
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    }
  }
  return new RegExp(`${expression}$`, "iu")
}

test("search normalization preserves visible punctuation and existing bounds", () => {
  assert.equal(normalizeSearchTerm("Men's"), "Men's")
  assert.equal(normalizeSearchTerm("men's"), "men's")
  assert.equal(normalizeSearchTerm("  Alpha   Beta  "), "Alpha Beta")
  assert.equal(normalizeSearchTerm("\tAlpha\nBeta\u200B"), "Alpha Beta")
  assert.equal(normalizeSearchTerm(""), "")
  assert.equal(normalizeSearchTerm("'\",().:%_*\\"), "'\",().:%_*\\")
  assert.equal(normalizeSearchTerm("x".repeat(101)).length, 100)
})

test("catalogue URL and parsing retain an apostrophe-bearing search", () => {
  const params = parseCatalogueParams({ q: "  Men's  " })
  assert.equal(params.q, "Men's")
  assert.equal(
    catalogueHref(params),
    "/products?q=Men%27s"
  )
})

test("search filter quotes PostgREST grammar and treats customer punctuation literally", () => {
  const cases = [
    ["Men's", "Men's jacket", "Mens jacket"],
    ["men's", "MEN'S SHOES", "mens shoes"],
    ["Alpha", "Alphabet", "Beta"],
    ["Alpha Beta", "The Alpha Beta set", "Alpha-Beta"],
    ["'", "Men's", "Mens"],
    ['"', 'The "quoted" product', "The quoted product"],
    [",", "red, blue", "red blue"],
    ["(", "size (large)", "size large"],
    ["%", "100% cotton", "100 percent cotton"],
    ["_", "under_score", "underscore"],
    ["*", "star*item", "star item"],
    ["\\", "path\\name", "pathname"],
    [".:()", "literal .:() marks", "literal marks"],
  ]

  for (const [term, matching, nonmatching] of cases) {
    const filter = buildCatalogueSearchFilter(term)
    const pattern = firstIlikePattern(filter)
    const regex = postgresLikeRegex(pattern)
    assert.equal(regex.test(matching), true, `expected literal match for ${term}`)
    assert.equal(regex.test(nonmatching), false, `unexpected wildcard expansion for ${term}`)
    assert.equal((filter.match(/\.ilike\./gu) ?? []).length, 3)
  }
})

test("malicious-looking filter input remains one quoted literal operand per search column", () => {
  const input = '") ,vendor_id.not.is.null,or(name.ilike.*)\\%_'
  const filter = buildCatalogueSearchFilter(input)
  const pattern = firstIlikePattern(filter)

  assert.equal(postgresLikeRegex(pattern).test(`prefix ${input} suffix`), true)
  assert.equal(postgresLikeRegex(pattern).test("unrelated product"), false)
  assert.match(
    filter,
    /^name\.ilike\."(?:\\.|[^"])*",description\.ilike\."(?:\\.|[^"])*",category\.ilike\."(?:\\.|[^"])*"$/u
  )
})

test("actual Supabase query builder preserves the quoted OR filter", async () => {
  const captured = []
  const client = createClient("https://example.supabase.co", "public-anon-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input) => {
        captured.push(String(input))
        return new Response("[]", {
          status: 200,
          headers: {
            "content-range": "0-0/0",
            "content-type": "application/json",
          },
        })
      },
    },
  })
  const filter = buildCatalogueSearchFilter('Men\'s, 100% (A_B) \\ "quoted"')

  const { error } = await client
    .from("public_storefront_products")
    .select("id", { count: "exact" })
    .or(filter)
    .range(24, 47)

  assert.equal(error, null)
  assert.equal(captured.length, 1)
  const request = new URL(captured[0])
  assert.equal(request.pathname, "/rest/v1/public_storefront_products")
  assert.equal(request.searchParams.get("or"), `(${filter})`)
  assert.equal(request.searchParams.get("offset"), "24")
  assert.equal(request.searchParams.get("limit"), "24")
})

test("catalogue request keeps database counting and pagination for punctuation searches", async () => {
  globalThis.__catalogueRequests.length = 0
  globalThis.__catalogueResult = { data: [], error: null, count: 49 }
  const params = parseCatalogueParams({ q: " Men's ", page: "2" })

  const result = await getCatalogue(params, [
    { id: "11111111-1111-4111-8111-111111111111", name: "Vendor" },
  ])

  assert.equal(globalThis.__catalogueRequests.length, 1)
  const request = globalThis.__catalogueRequests[0]
  assert.equal(request.table, "public_storefront_products")
  assert.deepEqual(request.range, [24, 47])
  assert.deepEqual(request.select.options, { count: "exact" })
  assert.deepEqual(request.or, [buildCatalogueSearchFilter("Men's")])
  assert.equal(result.total, 49)
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 3)
})

test("empty search skips OR filtering while punctuation-only search stays bounded", async () => {
  globalThis.__catalogueResult = { data: [], error: null, count: 8 }

  globalThis.__catalogueRequests.length = 0
  await getCatalogue(parseCatalogueParams({ q: "   " }), [
    { id: "11111111-1111-4111-8111-111111111111", name: "Vendor" },
  ])
  assert.deepEqual(globalThis.__catalogueRequests[0].or, [])

  globalThis.__catalogueRequests.length = 0
  await getCatalogue(parseCatalogueParams({ q: "()," }), [
    { id: "11111111-1111-4111-8111-111111111111", name: "Vendor" },
  ])
  assert.deepEqual(globalThis.__catalogueRequests[0].or, [buildCatalogueSearchFilter("(),")])
})
