import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261106105539_add_public_product_variant_projection.sql"
const c3MigrationFile =
  "supabase/migrations/20261104092307_add_variant_aware_paid_order_finalization.sql"
const parserFile = "src/lib/public-product-variants.ts"
const typesFile = "src/types/index.ts"
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migration = read(migrationFile).replace(/\r\n/g, "\n")
const c3Migration = read(c3MigrationFile).replace(/\r\n/g, "\n")
const parserSource = read(parserFile).replace(/\r\n/g, "\n")
const types = read(typesFile).replace(/\r\n/g, "\n")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const rpc = between(
  migration,
  "create function public.get_public_product_variant_projection(",
  "$function$;"
)
const view = between(
  migration,
  "create view public.public_storefront_products",
  "comment on view public.public_storefront_products"
)
const jsonConstruction = rpc.slice(rpc.indexOf("select pg_catalog.jsonb_build_object("))

const transpiledParser = ts.transpileModule(parserSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: parserFile,
})
assert.equal(transpiledParser.diagnostics?.length ?? 0, 0)
const parserModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledParser.outputText).toString("base64")}`
)
const { parsePublicProductVariantProjection } = parserModule

const ids = {
  product: "11111111-1111-4111-8111-111111111111",
  product2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  variant1: "22222222-2222-4222-8222-222222222222",
  variant2: "33333333-3333-4333-8333-333333333333",
  axis1: "44444444-4444-4444-8444-444444444444",
  axis2: "55555555-5555-4555-8555-555555555555",
  value1: "66666666-6666-4666-8666-666666666666",
  value2: "77777777-7777-4777-8777-777777777777",
  value3: "88888888-8888-4888-8888-888888888888",
  value4: "99999999-9999-4999-8999-999999999999",
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const LEGACY_AXIS_DOMAIN = "marketa:d3-a1:legacy-axis:v1"
const LEGACY_VALUE_DOMAIN = "marketa:d3-a1:legacy-value:v1"

function md5Uuid(value) {
  const hash = createHash("md5").update(value, "utf8").digest("hex")
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20),
  ].join("-")
}

function legacyAxisId(productId, axisKey) {
  return md5Uuid(`${LEGACY_AXIS_DOMAIN}|product=${productId}|axis=${axisKey}`)
}

function legacyValueId(productId, axisKey, normalizedValue) {
  return md5Uuid(
    `${LEGACY_VALUE_DOMAIN}|product=${productId}|axis=${axisKey}` +
      `|value_bytes=${Buffer.byteLength(normalizedValue, "utf8")}` +
      `|value=${normalizedValue}`
  )
}

function legacyAxis(productId, axisKey, position) {
  const values =
    axisKey === "size"
      ? [
          { normalized: "large", label: "Large" },
          { normalized: "small", label: "Small" },
        ]
      : [
          { normalized: "black", label: "Black" },
          { normalized: "gold", label: "Gold" },
        ]

  return {
    id: legacyAxisId(productId, axisKey),
    label: axisKey === "size" ? "Size" : "Colour",
    position,
    values: values.map((value, index) => ({
      id: legacyValueId(productId, axisKey, value.normalized),
      label: value.label,
      position: index,
      swatch_hex: null,
    })),
  }
}

function validLegacyProjection(mode = "size", productId = ids.product) {
  const sizeAxis = legacyAxis(productId, "size", 1)
  const colourAxis = legacyAxis(productId, "colour", mode === "size_colour" ? 2 : 1)
  const axes =
    mode === "size"
      ? [sizeAxis]
      : mode === "colour"
        ? [colourAxis]
        : [sizeAxis, colourAxis]
  const selections = (valueIndex) =>
    axes.map((axis) => ({ axis_id: axis.id, value_id: axis.values[valueIndex].id }))

  return {
    product_id: productId,
    variant_mode: mode,
    axes,
    combinations: [
      {
        variant_id: ids.variant1,
        stock: 3,
        selections: selections(0),
      },
      {
        variant_id: ids.variant2,
        stock: 0,
        selections: selections(1),
      },
    ],
  }
}

function validGeneralizedProjection() {
  return {
    product_id: ids.product,
    variant_mode: "options",
    axes: [
      {
        id: ids.axis1,
        label: "Capacity",
        position: 1,
        values: [
          { id: ids.value1, label: "128 GB", position: 0, swatch_hex: null },
          { id: ids.value2, label: "256 GB", position: 1, swatch_hex: null },
        ],
      },
      {
        id: ids.axis2,
        label: "Colour",
        position: 2,
        values: [
          { id: ids.value3, label: "Black", position: 0, swatch_hex: "#000000" },
          { id: ids.value4, label: "Gold", position: 1, swatch_hex: "#D4AF37" },
        ],
      },
    ],
    combinations: [
      {
        variant_id: ids.variant1,
        stock: 8,
        selections: [
          { axis_id: ids.axis1, value_id: ids.value1 },
          { axis_id: ids.axis2, value_id: ids.value3 },
        ],
      },
      {
        variant_id: ids.variant2,
        stock: 2,
        selections: [
          { axis_id: ids.axis1, value_id: ids.value2 },
          { axis_id: ids.axis2, value_id: ids.value4 },
        ],
      },
    ],
  }
}

test("migration is transactional, additive, and bounded", () => {
  assert.match(migration, /^-- Product Variants Batch 2C-D3-A1:[\s\S]*\nbegin;/u)
  assert.match(migration, /set local lock_timeout = '10s';/u)
  assert.match(migration, /set local statement_timeout = '120s';/u)
  assert.match(migration, /\ncommit;\s*$/u)
  assert.doesNotMatch(migration, /alter table public\.(?:products|product_variants)/iu)
  assert.doesNotMatch(migration, /create policy|drop policy/iu)
  assert.doesNotMatch(migration, /create or replace function/iu)
})

test("storefront view is invoker-secured, barriered, and explicitly allowlisted", () => {
  assert.match(
    view,
    /with \(security_invoker = true, security_barrier = true\)[\s\S]*select\s+product\.id,\s+product\.vendor_id,\s+product\.name,/u
  )
  for (const field of [
    "description",
    "price",
    "stock",
    "category",
    "images",
    "is_active",
    "created_at",
    "variant_mode",
    "available_stock",
    "has_in_stock_combination",
  ]) {
    assert.match(view, new RegExp(`\\b${field}\\b`, "u"))
  }
  assert.doesNotMatch(view, /select\s+product\.\*/iu)
  assert.match(view, /where product\.is_active = true[\s\S]*public\.is_vendor_active\(product\.vendor_id\)/u)
  assert.doesNotMatch(view, /from public\.vendors/iu)
})

test("view keeps ordinary stock authority and never substitutes parent stock for variants", () => {
  assert.match(
    view,
    /when product\.variant_mode = 'none' then product\.stock::bigint/u
  )
  assert.match(
    view,
    /else coalesce\(\([\s\S]*jsonb_array_elements\([\s\S]*projection\.payload -> 'combinations'/u
  )
  assert.doesNotMatch(
    view,
    /else\s+(?:product\.)?stock\b|coalesce\([^;]*product\.stock/iu
  )
  assert.match(view, /where \(combination\.value ->> 'stock'\)::integer > 0/u)
})

test("projection RPC is hardened and explicitly granted only to customer roles", () => {
  assert.match(rpc, /returns jsonb[\s\S]*language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/u)
  assert.match(migration, /alter function public\.get_public_product_variant_projection\(uuid\)\s+owner to postgres;/u)
  assert.match(
    migration,
    /revoke all privileges on function[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute on function[\s\S]*to anon, authenticated;/u
  )
  assert.match(migration, /has_function_privilege\('public', function_oid, 'EXECUTE'\)/u)
  assert.match(migration, /has_function_privilege\('service_role', function_oid, 'EXECUTE'\)/u)
})

test("RPC explicitly excludes draft parents, inactive vendors, ordinary mode, and inactive variants", () => {
  assert.match(rpc, /product\.is_active = true/u)
  assert.match(rpc, /product\.variant_mode in \('size', 'colour', 'size_colour', 'options'\)/u)
  assert.match(rpc, /public\.is_vendor_active\(product\.vendor_id\)/u)
  assert.match(rpc, /where variant\.is_active = true/u)
  assert.match(rpc, /where exists \(select 1 from eligible_variants\)/u)
  assert.doesNotMatch(rpc, /auth\.uid|current_user|request\.headers/iu)
})

test("generalized variants require complete assignments and exact persisted identity", () => {
  assert.match(
    rpc,
    /select pg_catalog\.count\(\*\)[\s\S]*from public\.product_variant_option_values[\s\S]*= \([\s\S]*from public\.product_option_axes/u
  )
  assert.match(rpc, /from public\.product_variant_combination_identities as identity/u)
  assert.match(
    rpc,
    /identity\.combination_signature = \([\s\S]*pg_catalog\.string_agg\([\s\S]*assignment\.axis_id::text \|\| '=' \|\| assignment\.value_id::text,[\s\S]*'\|' order by assignment\.axis_id/u
  )
  assert.match(rpc, /axis\.id = assignment\.axis_id[\s\S]*value\.id = assignment\.value_id/u)
})

test("legacy identities are product-scoped UUIDs with separate axis and value domains", () => {
  assert.match(rpc, /marketa:d3-a1:legacy-axis:v1\|product=/u)
  assert.match(rpc, /marketa:d3-a1:legacy-value:v1\|product=/u)
  assert.match(rpc, /\|axis=size/u)
  assert.match(rpc, /\|axis=colour/u)
  assert.match(rpc, /\|value_bytes=' \|\| pg_catalog\.octet_length\(seed\.normalized_value\)::text/u)
  assert.match(rpc, /pg_catalog\.md5\([\s\S]*\)::uuid::text as axis_id/u)
  assert.match(rpc, /pg_catalog\.md5\([\s\S]*\)::uuid::text as value_id/u)
  assert.match(rpc, /product\.variant_mode = 'size'[\s\S]*product\.variant_mode = 'colour'[\s\S]*product\.variant_mode = 'size_colour'/u)
  assert.match(rpc, /catalog\.product_id = variant\.product_id/u)
  assert.match(rpc, /catalog\.normalized_value = variant\.size_normalized/u)
  assert.match(rpc, /catalog\.normalized_value = variant\.colour_normalized/u)
  assert.doesNotMatch(rpc, /seed\.axis_id \|\| ':' \|\| pg_catalog\.md5/u)
  assert.doesNotMatch(rpc, /cross join/iu)
})

test("legacy UUID derivation is stable, domain-separated, and product-isolated", () => {
  const sizeAxis = legacyAxisId(ids.product, "size")
  const colourAxis = legacyAxisId(ids.product, "colour")
  const small = legacyValueId(ids.product, "size", "small")

  assert.equal(sizeAxis, "31d22b4f-3b05-fd1e-bad0-9ac315c793ee")
  assert.equal(colourAxis, "1ec4b80f-5c00-377b-8772-8dba37e148b4")
  assert.equal(small, "a65fcef8-a7f0-70cf-4ad8-6aca9ef46be3")
  assert.equal(legacyValueId(ids.product, "size", "large"), "36b577c1-350d-2ade-dcd2-90642bc9079b")
  assert.equal(legacyValueId(ids.product, "colour", "black"), "a8cb1148-bc26-1c64-40ad-c50defecdf17")
  assert.equal(legacyAxisId(ids.product, "size"), sizeAxis)
  assert.equal(legacyValueId(ids.product, "size", "small"), small)
  assert.notEqual(sizeAxis, colourAxis)
  assert.notEqual(sizeAxis, small)
  assert.notEqual(small, legacyValueId(ids.product, "size", "large"))
  assert.notEqual(small, legacyValueId(ids.product, "colour", "small"))
  assert.notEqual(sizeAxis, legacyAxisId(ids.product2, "size"))
  assert.notEqual(small, legacyValueId(ids.product2, "size", "small"))
  for (const id of [sizeAxis, colourAxis, small]) assert.match(id, UUID_PATTERN)
})

test("JSON returns display-safe fields in deterministic axis/value/combination order", () => {
  assert.match(jsonConstruction, /'axes'[\s\S]*order by axis\.axis_position, axis\.axis_id/u)
  assert.match(jsonConstruction, /order by value\.value_position, value\.value_id/u)
  assert.match(jsonConstruction, /'combinations'[\s\S]*order by variant\.id/u)
  assert.match(jsonConstruction, /'selections'[\s\S]*order by selection\.axis_position, selection\.axis_id/u)
  for (const privateKey of [
    "normalized_label",
    "size_normalized",
    "colour_normalized",
    "combination_signature",
    "created_at",
    "updated_at",
    "vendor_id",
  ]) {
    assert.doesNotMatch(
      jsonConstruction,
      new RegExp(`['\"]${privateKey}['\"]\\s*,`, "iu")
    )
  }
})

test("migration does not expand private option-table authority", () => {
  for (const relation of [
    "product_option_axes",
    "product_option_values",
    "product_variant_option_values",
    "product_variant_combination_identities",
  ]) {
    assert.match(
      migration,
      new RegExp(`'${relation}'[\\s\\S]*private relation`, "u")
    )
  }
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all)(?:\s+privileges)?\s+on\s+(?:table\s+)?public\.product_(?:option|variant_option|variant_combination)/iu
  )
})

test("preflight and postcondition preserve the exact C3 private-table ACL matrix", () => {
  assert.match(
    c3Migration,
    /grant select on table public\.product_variant_option_values to service_role;[\s\S]*grant select on table public\.product_variant_combination_identities to service_role;/u
  )
  assert.match(
    c3Migration,
    /not pg_catalog\.has_table_privilege\(\s*'service_role', 'public\.product_variant_option_values', 'SELECT'[\s\S]*not pg_catalog\.has_table_privilege\(\s*'service_role', 'public\.product_variant_combination_identities', 'SELECT'/u
  )

  const matrixMatches = [...migration.matchAll(
    /-- D3_A1_PRIVATE_ACL_MATRIX_START\n([\s\S]*?)\s+-- D3_A1_PRIVATE_ACL_MATRIX_END/gu
  )]
  assert.equal(matrixMatches.length, 2)
  assert.equal(matrixMatches[0][1], matrixMatches[1][1])

  const matrix = matrixMatches[0][1]
  assert.match(
    matrix,
    /service_role_select_expected := relation_name in \(\s*'product_variant_option_values',\s*'product_variant_combination_identities'\s*\);/u
  )
  assert.match(
    matrix,
    /'service_role', 'public\.' \|\| relation_name, 'SELECT'\s*\) is distinct from service_role_select_expected/u
  )
  assert.match(
    matrix,
    /'service_role', 'public\.' \|\| relation_name,\s*'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'/u
  )
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      matrix,
      new RegExp(
        `'${role}', 'public\\.' \\|\\| relation_name,\\s*` +
          `'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'`,
        "u"
      )
    )
  }
  assert.match(matrix, /pg_catalog\.aclexplode\(relation\.relacl\)/u)
  assert.match(matrix, /acl\.grantee = 0/u)
  assert.match(matrix, /not in \('postgres', 'service_role'\)/u)
  assert.match(matrix, /acl\.privilege_type <> 'SELECT'/u)
  assert.match(matrix, /acl\.is_grantable/u)
  assert.match(
    matrix,
    /acl\.grantee = 'service_role'::pg_catalog\.regrole[\s\S]*acl\.privilege_type = 'SELECT'[\s\S]*not acl\.is_grantable/u
  )
  assert.match(matrix, /pg_catalog\.aclexplode\(attribute\.attacl\)/u)
  assert.doesNotMatch(
    migration,
    /revoke[\s\S]{0,160}on (?:table )?public\.product_variant_(?:option_values|combination_identities)[\s\S]{0,80}from service_role/iu
  )
})

test("client types describe only the sanitized public projection", () => {
  assert.match(types, /export type PublicProductVariantMode = Exclude<ProductVariantMode, "none">/u)
  assert.match(types, /export interface PublicProductVariantProjection \{/u)
  assert.match(types, /axes: PublicProductVariantAxis\[\]/u)
  assert.match(types, /combinations: PublicProductVariantCombination\[\]/u)
  assert.doesNotMatch(parserSource, /supabase|service_role|product_option_axes/u)
})

test("actual parser accepts UUID-based legacy modes and generalized projections", () => {
  for (const mode of ["size", "colour", "size_colour"]) {
    const projection = validLegacyProjection(mode)
    assert.deepEqual(
      parsePublicProductVariantProjection(projection, ids.product),
      projection
    )
  }
  assert.deepEqual(
    parsePublicProductVariantProjection(validGeneralizedProjection(), ids.product),
    validGeneralizedProjection()
  )
})

test("parser rejects former legacy text identities and malformed UUIDs", () => {
  const literalAxis = validLegacyProjection()
  literalAxis.axes[0].id = "size"
  literalAxis.combinations.forEach((combination) => {
    combination.selections[0].axis_id = "size"
  })
  assert.equal(parsePublicProductVariantProjection(literalAxis), null)

  const hashedTextValue = validLegacyProjection()
  hashedTextValue.axes[0].values[0].id = `size:${"a".repeat(32)}`
  hashedTextValue.combinations[0].selections[0].value_id = `size:${"a".repeat(32)}`
  assert.equal(parsePublicProductVariantProjection(hashedTextValue), null)

  const malformedUuid = validLegacyProjection("colour")
  malformedUuid.axes[0].id = "11111111-1111-1111-1111-11111111111z"
  assert.equal(parsePublicProductVariantProjection(malformedUuid), null)
})

test("variant UUID remains the authoritative explicit combination identity", () => {
  const projection = validLegacyProjection("size_colour")
  const parsed = parsePublicProductVariantProjection(projection, ids.product)
  assert.ok(parsed)
  assert.deepEqual(
    parsed.combinations.map((combination) => combination.variant_id),
    [ids.variant1, ids.variant2]
  )
  assert.equal(parsed.combinations[1].stock, 0)
  assert.match(jsonConstruction, /'variant_id', variant\.id/u)
  assert.doesNotMatch(migration, /variant_id['"]?\s*[:=]\s*(?:axis|value)/iu)
})

test("actual parser fails closed on malformed identities, stock, shape, or extra data", () => {
  const cases = []

  const ordinary = validLegacyProjection()
  ordinary.variant_mode = "none"
  cases.push(ordinary)

  const wrongProduct = validLegacyProjection()
  wrongProduct.product_id = "not-a-uuid"
  cases.push(wrongProduct)

  const badStock = validLegacyProjection()
  badStock.combinations[0].stock = -1
  cases.push(badStock)

  const fractionalStock = validLegacyProjection()
  fractionalStock.combinations[0].stock = 1.5
  cases.push(fractionalStock)

  const emptyAxes = validLegacyProjection()
  emptyAxes.axes = []
  cases.push(emptyAxes)

  const extraField = validLegacyProjection()
  extraField.private_data = true
  cases.push(extraField)

  const badSwatch = validGeneralizedProjection()
  badSwatch.axes[1].values[0].swatch_hex = "black"
  cases.push(badSwatch)

  for (const candidate of cases) {
    assert.equal(parsePublicProductVariantProjection(candidate, ids.product), null)
  }
  assert.equal(
    parsePublicProductVariantProjection(validLegacyProjection(), ids.variant1),
    null
  )
})

test("actual parser rejects incomplete, reordered, unknown, and duplicate combinations", () => {
  const missingSelection = validGeneralizedProjection()
  missingSelection.combinations[0].selections.pop()
  assert.equal(parsePublicProductVariantProjection(missingSelection), null)

  const reordered = validGeneralizedProjection()
  reordered.combinations[0].selections.reverse()
  assert.equal(parsePublicProductVariantProjection(reordered), null)

  const unknownValue = validGeneralizedProjection()
  unknownValue.combinations[0].selections[0].value_id = ids.value4
  assert.equal(parsePublicProductVariantProjection(unknownValue), null)

  const duplicateVariant = validGeneralizedProjection()
  duplicateVariant.combinations[1].variant_id = ids.variant1
  assert.equal(parsePublicProductVariantProjection(duplicateVariant), null)

  const duplicateIdentity = validGeneralizedProjection()
  duplicateIdentity.combinations[1].selections = structuredClone(
    duplicateIdentity.combinations[0].selections
  )
  assert.equal(parsePublicProductVariantProjection(duplicateIdentity), null)
})

test("actual parser rejects conflicting axis/value identity and ordering", () => {
  const axisOrder = validGeneralizedProjection()
  axisOrder.axes[1].position = 1
  assert.equal(parsePublicProductVariantProjection(axisOrder), null)

  const valueOrder = validGeneralizedProjection()
  valueOrder.axes[0].values[1].position = 0
  assert.equal(parsePublicProductVariantProjection(valueOrder), null)

  const reusedValue = validGeneralizedProjection()
  reusedValue.axes[1].values[0].id = ids.value1
  assert.equal(parsePublicProductVariantProjection(reusedValue), null)
})

test("static tests explicitly defer PostgreSQL publication and concurrency evidence", () => {
  const disposableMatrix = [
    "ordinary active product uses parent stock",
    "active legacy size, colour, and size-colour projections",
    "active generalized projection with complete persisted identity",
    "zero-stock combinations remain visible but unavailable",
    "draft parent, inactive vendor, and inactive variant exclusion",
    "missing assignment and stale identity exclusion",
    "anonymous and authenticated ACL behavior",
    "one-row storefront cardinality and database availability filters",
    "concurrent stock change produces a statement-consistent projection",
    "rollback restores draft-only constraints and all fixture baselines",
  ]
  assert.equal(disposableMatrix.length, 10)
  assert.match(
    migration,
    /Publication remains disabled by the existing draft-only constraints/u
  )
  assert.doesNotMatch(migration, /runtime (?:passed|verified)/iu)
})
