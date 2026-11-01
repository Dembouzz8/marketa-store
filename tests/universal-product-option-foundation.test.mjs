import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migrationPath =
  "supabase/migrations/20261029094125_add_universal_product_option_foundation.sql"
const migration = readFileSync(migrationPath, "utf8")
const normalized = migration.replace(/\r\n/g, "\n")
const legacyRpcMigration = readFileSync(
  "supabase/migrations/20261020150650_secure_vendor_variant_management_backend.sql",
  "utf8"
).replace(/\r\n/g, "\n")

const disposableRuntimeCases = [
  {
    case: "same combination in two sessions",
    authority: "privileged disposable fixture SQL",
  },
  {
    case: "two sessions crossing the 100-combination boundary",
    authority: "privileged disposable fixture SQL",
  },
  {
    case: "axis or assignment edits racing with variant creation",
    authority: "privileged disposable fixture SQL plus existing RPC",
  },
  {
    case: "legacy RPC mutation while generalized structures exist",
    authority: "authenticated existing RPC with privileged fixture setup",
  },
  {
    case: "all five existing vendor RPCs as authenticated",
    authority: "authenticated existing RPC",
  },
  {
    case: "stock-only variant update avoids generalized validation",
    authority: "authenticated existing stock RPC plus privileged observation",
  },
  {
    case: "transaction rollback and baseline restoration",
    authority: "isolated disposable harness",
  },
]

function section(start, end) {
  const startIndex = normalized.indexOf(start)
  assert.notEqual(startIndex, -1, `missing section start: ${start}`)
  const endIndex = normalized.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing section end: ${end}`)
  return normalized.slice(startIndex, endIndex)
}

function normalizeCategory(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const categoryAliases = new Map([
  ["fashion", "fashion"],
  ["electronics", "electronics"],
  ["beauty", "beauty-and-personal-care"],
  ["food", "food-and-groceries"],
  ["food-and-drinks", "food-and-groceries"],
  ["home-and-living", "home-and-kitchen"],
  ["sports", "sports-and-fitness"],
])

test("migration is transactional and keeps generic purchasing disabled", () => {
  assert.match(normalized, /^-- Product Variants Batch 2C-B1:[\s\S]*\nbegin;/)
  assert.match(normalized, /\ncommit;\s*$/)
  assert.doesNotMatch(normalized, /add value|variant_mode[^\n]*options/i)
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.(?:configure_vendor_product_variant_mode|create_vendor_product_variant|update_vendor_product_variant_labels|update_vendor_product_variant_stock|delete_vendor_product_variant)/i
  )
  assert.doesNotMatch(
    normalized,
    /create or replace function public\.finalize_paystack_paid_order/i
  )
})

test("canonical category inventory is explicit and legacy category remains authoritative", () => {
  const categories = section(
    "insert into public.catalogue_categories",
    "insert into public.catalogue_category_aliases"
  )
  for (const code of [
    "fashion",
    "phones-and-tablets",
    "computing",
    "electronics",
    "home-and-kitchen",
    "appliances",
    "beauty-and-personal-care",
    "food-and-groceries",
    "baby-kids-and-toys",
    "health-and-wellness",
    "sports-and-fitness",
    "automotive-accessories",
  ]) {
    assert.match(categories, new RegExp(`'${code}'`))
  }
  assert.doesNotMatch(categories, /'other'|'others'/)
  assert.match(normalized, /alter table public\.products\s+add column category_code text;/)
  assert.match(
    normalized,
    /and not attribute\.attnotnull[\s\S]*where product\.category_code is not null/
  )
  assert.doesNotMatch(normalized, /update\s+public\.products\s+set\s+category_code/i)
  assert.doesNotMatch(normalized, /drop\s+column\s+category/i)
})

test("current production values have exact approved aliases while Others remains unresolved", () => {
  const productionValues = ["Beauty", "Electronics", "Fashion", "Food"]
  assert.deepEqual(
    productionValues.map((value) => categoryAliases.get(normalizeCategory(value))),
    [
      "beauty-and-personal-care",
      "electronics",
      "fashion",
      "food-and-groceries",
    ]
  )
  assert.equal(categoryAliases.get(normalizeCategory("Food & Drinks")), "food-and-groceries")
  assert.equal(categoryAliases.get(normalizeCategory("Home & Living")), "home-and-kitchen")
  assert.equal(categoryAliases.get(normalizeCategory("Sports")), "sports-and-fitness")
  assert.equal(categoryAliases.has(normalizeCategory("Others")), false)
  assert.doesNotMatch(normalized, /\('others',/)
})

test("all foundation relations are additive and RLS protected", () => {
  const relations = [
    "catalogue_categories",
    "catalogue_category_aliases",
    "option_definitions",
    "option_units",
    "option_size_systems",
    "category_option_templates",
    "product_option_axes",
    "product_option_values",
    "product_variant_option_values",
    "product_variant_combination_identities",
    "product_option_policy",
  ]

  for (const relation of relations) {
    assert.match(normalized, new RegExp(`create table public\\.${relation} \\(`))
    assert.match(
      normalized,
      new RegExp(`alter table public\\.${relation} enable row level security;`)
    )
  }

  assert.match(
    normalized,
    /revoke all privileges on table[\s\S]*from public, anon, authenticated, service_role;/
  )
  assert.match(
    normalized,
    /has_any_column_privilege\(\s*'public', 'public\.' \|\| relation_name/
  )
  assert.doesNotMatch(normalized, /create policy/i)
  assert.doesNotMatch(normalized, /grant (?:select|insert|update|delete)/i)
})

test("curated definitions use explicit units and size systems without conversion", () => {
  assert.match(normalized, /value_kind in \('label', 'measurement', 'colour'\)/)
  assert.match(normalized, /requires_unit boolean not null default false/)
  assert.match(normalized, /requires_size_system boolean not null default false/)
  assert.match(normalized, /\('manufacturer_unspecified', 'Manufacturer Unspecified', 7\)/)
  assert.match(normalized, /unit_dimension is distinct from definition_record\.dimension_code/)
  assert.doesNotMatch(normalized, /convert|conversion_rate|multiplier/i)
})

test("duplicate axes and values are rejected after normalization", () => {
  assert.match(
    normalized,
    /constraint product_option_axes_product_option_key unique \(product_id, option_code\)/
  )
  assert.match(
    normalized,
    /constraint product_option_axes_product_position_key unique \(product_id, position\)/
  )
  assert.match(
    normalized,
    /normalized_label text generated always as \([\s\S]*pg_catalog\.lower\([\s\S]*pg_catalog\.regexp_replace/
  )
  assert.match(
    normalized,
    /constraint product_option_values_axis_label_key unique \(axis_id, normalized_label\)/
  )
})

test("composite foreign keys prevent cross-product and cross-vendor assignments", () => {
  assert.match(
    normalized,
    /foreign key \(product_id, vendor_id\)\s+references public\.products \(id, vendor_id\)/
  )
  assert.match(
    normalized,
    /foreign key \(axis_id, product_id, vendor_id\)\s+references public\.product_option_axes \(id, product_id, vendor_id\)/
  )
  assert.match(
    normalized,
    /foreign key \(variant_id, product_id\)\s+references public\.product_variants \(id, product_id\)/
  )
  assert.match(
    normalized,
    /foreign key \(value_id, axis_id, product_id, vendor_id\)\s+references public\.product_option_values \(id, axis_id, product_id, vendor_id\)/
  )
  assert.match(
    normalized,
    /foreign key \(variant_id, product_id\)\s+references public\.product_variants \(id, product_id\)[\s\S]*on delete cascade/
  )
})

test("source declares the three-axis and one-hundred-combination policy", () => {
  assert.match(normalized, /max_axes smallint not null default 3/)
  assert.match(normalized, /check \(max_axes between 1 and 3\)/)
  assert.match(normalized, /max_combinations integer not null default 100/)
  assert.match(normalized, /check \(max_combinations between 1 and 100\)/)
  assert.match(normalized, /check \(position between 1 and 3\)/)
  assert.match(normalized, /if variant_count > maximum_combinations then/)
})

test("option structural writes and variant membership changes take the product lock", () => {
  const lockFunction = section(
    "create function public.lock_product_option_structure()",
    "create function public.validate_product_option_axis()"
  )
  assert.match(lockFunction, /security invoker/)
  assert.match(lockFunction, /set search_path = ''/)
  assert.match(lockFunction, /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(
    lockFunction,
    /pg_catalog\.hashtextextended\(locked_product_id::text, 0\)/
  )
  assert.match(lockFunction, /order by candidate\.product_id/)

  for (const [trigger, relation] of [
    ["a_product_option_axes_serialization_guard", "product_option_axes"],
    ["a_product_option_values_serialization_guard", "product_option_values"],
    ["a_product_variant_values_serialization_guard", "product_variant_option_values"],
  ]) {
    assert.match(
      normalized,
      new RegExp(
        `create trigger ${trigger}\\s+before insert or update or delete on public\\.${relation}[\\s\\S]*?execute function public\\.lock_product_option_structure\\(\\);`
      )
    )
  }

  assert.match(
    normalized,
    /create trigger a_product_variants_option_serialization_guard\s+before insert or delete on public\.product_variants[\s\S]*?execute function public\.lock_product_option_structure\(\);/
  )
})

test("completeness is deferred so a valid draft can be assembled in one transaction", () => {
  for (const trigger of [
    "product_option_axes_completeness_guard",
    "product_variant_values_completeness_guard",
    "product_variants_option_completeness_guard",
    "product_option_policy_guard",
  ]) {
    assert.match(
      normalized,
      new RegExp(
        `create constraint trigger ${trigger}[\\s\\S]*deferrable initially deferred`
      )
    )
  }
  assert.match(
    normalized,
    /Every product variant must select one value for every option axis\./
  )
})

test("stock and label updates do not queue generalized variant validation", () => {
  const triggers = section(
    "create trigger a_product_option_axes_serialization_guard",
    "create index product_option_axes_product_id_idx"
  )
  const immediateStart = triggers.indexOf(
    "create trigger a_product_variants_option_serialization_guard"
  )
  const immediateEnd = triggers.indexOf(";", immediateStart)
  const immediate = triggers.slice(immediateStart, immediateEnd + 1)
  assert.match(immediate, /before insert or delete on public\.product_variants/)
  assert.doesNotMatch(immediate, /update|stock|stock_version|size|colour/)

  const deferredStart = triggers.indexOf(
    "create constraint trigger product_variants_option_completeness_guard"
  )
  const deferredEnd = triggers.indexOf(";", deferredStart)
  const deferred = triggers.slice(deferredStart, deferredEnd + 1)
  assert.match(deferred, /after insert or delete on public\.product_variants/)
  assert.doesNotMatch(deferred, /update|stock|stock_version|size|colour/)
  assert.match(normalized, /trigger_record\.tgtype = 15/)
  assert.match(normalized, /trigger_record\.tgtype = 13/)
})

test("persisted canonical identity has database-enforced product uniqueness", () => {
  const identityTable = section(
    "create table public.product_variant_combination_identities (",
    "alter table public.products"
  )
  assert.match(identityTable, /variant_id uuid primary key/)
  assert.match(identityTable, /combination_signature text not null/)
  assert.match(
    identityTable,
    /unique \(product_id, combination_signature\)/
  )

  assert.match(
    normalized,
    /assignment\.axis_id::text \|\| '=' \|\| assignment\.value_id::text/
  )
  assert.match(normalized, /'\|' order by assignment\.axis_id/)
  assert.match(
    normalized,
    /delete from public\.product_variant_combination_identities[\s\S]*insert into public\.product_variant_combination_identities/
  )
  assert.match(normalized, /Duplicate product option combination\./)
})

test("serialized deferred validation checks the authoritative combination count", () => {
  const completeness = section(
    "create function public.assert_product_option_completeness(p_product_id uuid)",
    "create function public.enforce_product_option_completeness()"
  )
  const lockIndex = completeness.indexOf("pg_catalog.pg_advisory_xact_lock(")
  const countIndex = completeness.indexOf(
    "select pg_catalog.count(*)::integer\n  into variant_count"
  )
  const limitIndex = completeness.indexOf(
    "if variant_count > maximum_combinations then"
  )
  const identityIndex = completeness.indexOf(
    "insert into public.product_variant_combination_identities"
  )
  assert.notEqual(lockIndex, -1)
  assert.ok(lockIndex < countIndex)
  assert.ok(countIndex < limitIndex)
  assert.ok(limitIndex < identityIndex)
  assert.match(
    completeness,
    /combination identity is incomplete\./
  )
  assert.match(normalized, /supports PostgreSQL READ COMMITTED/)
  assert.doesNotMatch(normalized, /pg_catalog\.position/)
})

test("existing vendor RPCs retain the compatible lock order", () => {
  for (const name of [
    "configure_vendor_product_variant_mode",
    "create_vendor_product_variant",
    "update_vendor_product_variant_labels",
    "update_vendor_product_variant_stock",
    "delete_vendor_product_variant",
  ]) {
    const start = legacyRpcMigration.indexOf(`create function public.${name}(`)
    assert.notEqual(start, -1, `missing legacy RPC ${name}`)
    const end = legacyRpcMigration.indexOf("$function$;", start)
    assert.notEqual(end, -1, `missing legacy RPC terminator ${name}`)
    const rpc = legacyRpcMigration.slice(start, end)
    const vendorShare = rpc.indexOf("for share;")
    const productAdvisory = rpc.indexOf("pg_catalog.pg_advisory_xact_lock(")
    const productUpdate = rpc.indexOf("for update;", productAdvisory)
    assert.ok(vendorShare !== -1 && vendorShare < productAdvisory)
    assert.ok(productAdvisory < productUpdate)
  }
})

test("legacy products, modes, variants, stock, and RPCs remain unchanged", () => {
  assert.match(normalized, /marketa\.options_b1\.products_hash/)
  assert.match(normalized, /marketa\.options_b1\.variants_hash/)
  assert.match(normalized, /marketa\.options_b1\.vendor_rpc_hash/)
  assert.match(
    normalized,
    /product\.variant_mode not in \('none', 'size', 'colour', 'size_colour'\)/
  )
  assert.doesNotMatch(normalized, /alter table public\.product_variants\s+(?:drop|alter column)/i)
  assert.doesNotMatch(normalized, /update\s+public\.product_variants/i)
  assert.doesNotMatch(normalized, /update\s+public\.products/i)
})

test("only the deferred wrapper is a hardened definer with no callable authority", () => {
  const helperSection = section(
    "create function public.lock_product_option_structure()",
    "create trigger a_product_option_axes_serialization_guard"
  )
  assert.equal((helperSection.match(/security invoker/g) ?? []).length, 5)
  assert.equal((helperSection.match(/security definer/g) ?? []).length, 1)
  assert.equal((helperSection.match(/set search_path = ''/g) ?? []).length, 6)
  assert.equal(
    (helperSection.match(/from public, anon, authenticated, service_role;/g) ?? [])
      .length,
    6
  )
  const deferredWrapper = section(
    "create function public.enforce_product_option_completeness()",
    "create function public.enforce_product_option_policy()"
  )
  assert.match(deferredWrapper, /security definer/)
  assert.match(deferredWrapper, /set search_path = ''/)
  assert.match(
    deferredWrapper,
    /perform public\.assert_product_option_completeness/
  )
  assert.doesNotMatch(deferredWrapper, /auth\.|current_user|session_user/)
  assert.match(
    normalized,
    /alter function public\.enforce_product_option_completeness\(\) owner to postgres;/
  )
  assert.match(
    normalized,
    /revoke all privileges on function public\.enforce_product_option_completeness\(\)\s+from public, anon, authenticated, service_role;/
  )
  assert.match(
    normalized,
    /function_record\.prosecdef is distinct from \([\s\S]*public\.enforce_product_option_completeness\(\)/
  )
})

test("static checks explicitly defer concurrency proof to disposable runtime", () => {
  assert.deepEqual(
    disposableRuntimeCases.map((entry) => entry.case),
    [
      "same combination in two sessions",
      "two sessions crossing the 100-combination boundary",
      "axis or assignment edits racing with variant creation",
      "legacy RPC mutation while generalized structures exist",
      "all five existing vendor RPCs as authenticated",
      "stock-only variant update avoids generalized validation",
      "transaction rollback and baseline restoration",
    ]
  )
  assert.equal(
    disposableRuntimeCases.filter((entry) =>
      entry.authority.includes("privileged disposable fixture SQL")
    ).length,
    3
  )
  assert.equal(
    disposableRuntimeCases.filter((entry) =>
      entry.authority.includes("authenticated existing RPC")
    ).length,
    2
  )
})

test("foundation exposes no new customer purchasing or publication path", () => {
  assert.doesNotMatch(normalized, /grant execute/i)
  assert.doesNotMatch(normalized, /grant select/i)
  assert.doesNotMatch(normalized, /authorization_url|paystack|checkout_attempt/i)
  assert.doesNotMatch(normalized, /selected_options_snapshot/i)
  assert.match(
    normalized,
    /generic purchasing mode was introduced/
  )
})
