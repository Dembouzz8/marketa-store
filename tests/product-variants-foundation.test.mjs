import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261012120923_add_product_variants_foundation.sql"
const productFormFile = "src/components/vendor/product-form.tsx"
const productsTableFile = "src/components/vendor/products-table.tsx"
const productsPageFile = "src/app/vendor/products/page.tsx"
const checkoutFile = "supabase/functions/handle-checkout/index.ts"
const finalizerFile =
  "supabase/migrations/20261007135410_add_atomic_paid_order_stock_finalization.sql"

const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migration = read(migrationFile)
const productForm = read(productFormFile)
const productsTable = read(productsTableFile)
const productsPage = read(productsPageFile)
const checkout = read(checkoutFile)
const finalizer = read(finalizerFile)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function normalizeLabel(value) {
  if (value === null) return null
  const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase()
  return normalized || null
}

test("migration is transactional, bounded, and fail-closed", () => {
  assert.match(migration, /^-- Product Variants Batch 2A\.2:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s';/)
  assert.match(migration, /set local statement_timeout = '120s';/)
  assert.match(migration, /do \$preflight\$/)
  assert.match(migration, /do \$postcondition\$/)
  assert.match(migration, /foundation objects already exist/)
  assert.match(migration, /product policies changed/)
  assert.match(migration, /\ncommit;\s*$/)
})

test("products gain inert variant mode and database-managed stock version", () => {
  assert.match(
    migration,
    /add column variant_mode text not null default 'none'/
  )
  assert.match(migration, /add column stock_version bigint not null default 0/)
  assert.match(
    migration,
    /check \(variant_mode in \('none', 'size', 'colour', 'size_colour'\)\)/
  )
  assert.match(migration, /check \(variant_mode = 'none' or stock = 0\)/)
  assert.match(migration, /where product\.variant_mode <> 'none'[\s\S]*or product\.stock_version <> 0/)
})

test("existing vendor product writes map exactly to authenticated column grants", () => {
  const payload = between(productForm, "const payload = {", "}\n\n        saveStage")
  for (const column of [
    "vendor_id",
    "name",
    "description",
    "price",
    "stock",
    "category",
    "images",
    "is_active",
  ]) {
    assert.match(payload, new RegExp(`\\b${column}(?:\\s*:|,)`), column)
  }
  assert.match(productsTable, /\.update\(\{ stock: nextStock \}\)/)
  assert.match(productsPage, /\.update\(\{ is_active: isActive \}\)/)

  for (const command of ["insert", "update"]) {
    const grant = between(
      migration,
      `grant ${command} (`,
      ") on public.products to authenticated;"
    )
    for (const column of [
      "vendor_id",
      "name",
      "description",
      "price",
      "stock",
      "category",
      "images",
      "is_active",
    ]) {
      assert.match(grant, new RegExp(`\\b${column}\\b`), `${command}:${column}`)
    }
    assert.doesNotMatch(grant, /\bvariant_mode\b|\bstock_version\b/)
  }
})

test("anonymous reads remain and all anonymous mutation authority is removed", () => {
  assert.match(migration, /revoke all privileges on table public\.products[\s\S]*from public, anon, authenticated, service_role;/)
  assert.match(migration, /grant select on table public\.products to anon, authenticated, service_role;/)
  const postcondition = between(migration, "do $postcondition$", "$postcondition$;")
  for (const privilege of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    assert.match(
      postcondition,
      new RegExp(`has_table_privilege\\('anon', 'public\\.products', '${privilege}'\\)`)
    )
  }
})

test("column ACL cleanup removes inherited mutation paths before exact grants", () => {
  for (const table of ["products", "product_variants"]) {
    for (const privilege of ["insert", "update", "references"]) {
      assert.match(
        migration,
        new RegExp(
          `revoke ${privilege} \\([\\s\\S]*?\\) on public\\.${table} from public, anon, authenticated, service_role;`
        ),
        `${table}:${privilege}`
      )
    }
  }

  assert.match(
    migration,
    /from pg_catalog\.pg_attribute as attribute[\s\S]*attribute\.attacl[\s\S]*acl\.grantee = 0[\s\S]*PUBLIC column privileges remain/
  )
})

test("PUBLIC column ACL inspection is null-aware and uses no empty ACL array", () => {
  const publicColumnAclCheck = between(
    migration,
    "from pg_catalog.pg_attribute as attribute\n    cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl",
    "raise exception 'Product variants foundation postcondition: PUBLIC column privileges remain.';"
  )

  assert.match(publicColumnAclCheck, /attribute\.attacl is not null/)
  assert.match(publicColumnAclCheck, /acl\.grantee = 0/)
  assert.doesNotMatch(
    migration,
    /coalesce\(attribute\.attacl,\s*array\[\]::pg_catalog\.aclitem\[\]\)/
  )
})

test("variant control columns are unavailable to authenticated and service roles", () => {
  const postcondition = between(migration, "for column_record in", "if not pg_catalog.has_table_privilege('service_role'")
  assert.match(postcondition, /expected_authenticated_write := column_record\.attname in/)
  assert.match(postcondition, /expected_service_update := column_record\.attname in \('stock', 'updated_at'\)/)
  assert.match(postcondition, /has_column_privilege\([\s\S]*'INSERT'/)
  assert.match(postcondition, /has_column_privilege\([\s\S]*'UPDATE'/)
  assert.doesNotMatch(
    between(migration, "grant insert (", ") on public.products to authenticated;"),
    /variant_mode|stock_version/
  )
  assert.doesNotMatch(
    between(migration, "grant update (", ") on public.products to authenticated;"),
    /variant_mode|stock_version/
  )
})

test("effective product column privileges match the approved role matrix", () => {
  const productChecks = between(
    migration,
    "for column_record in\n    select attribute.attname\n    from pg_catalog.pg_attribute as attribute\n    where attribute.attrelid = 'public.products'::pg_catalog.regclass",
    "if not pg_catalog.has_table_privilege('service_role'"
  )

  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const privilege of ["INSERT", "UPDATE", "REFERENCES"]) {
      assert.match(
        productChecks,
        new RegExp(
          `has_column_privilege\\([\\s\\S]*?'${role}',[\\s\\S]*?'public\\.products',[\\s\\S]*?'${privilege}'`
        ),
        `${role}:${privilege}`
      )
    }
  }

  assert.match(productChecks, /expected_authenticated_write/)
  assert.match(productChecks, /expected_service_update/)
})

test("product ownership is immutable while unchanged vendor_id updates remain valid", () => {
  const helper = between(
    migration,
    "create function public.enforce_product_foundation_authority()",
    "$function$;"
  )
  assert.match(helper, /new\.vendor_id is distinct from old\.vendor_id/)
  assert.match(helper, /Product ownership cannot be reassigned/)
  assert.doesNotMatch(helper, /new\.vendor_id = old\.vendor_id/)
  assert.match(
    migration,
    /grant update \([\s\S]*vendor_id[\s\S]*\) on public\.products to authenticated;/
  )
})

test("stock versions increment only for genuine product stock changes", () => {
  const helper = between(
    migration,
    "create function public.enforce_product_foundation_authority()",
    "$function$;"
  )
  assert.match(helper, /if new\.stock is distinct from old\.stock then/)
  assert.match(helper, /new\.stock_version := old\.stock_version \+ 1/)
  assert.match(helper, /elsif new\.stock_version is distinct from old\.stock_version then/)
  assert.match(helper, /Product stock version is database-managed/)
  assert.match(migration, /proconfig is distinct from array\['search_path=""'\]::text\[\]/)
  assert.match(migration, /unexpected triggers exist/)
})

test("pre-existing triggers are snapshotted and all five new triggers are exact", () => {
  const preflight = between(migration, "do $preflight$", "$preflight$;")
  const postcondition = between(migration, "do $postcondition$", "$postcondition$;")

  assert.match(preflight, /marketa\.variant_foundation\.existing_trigger_count/)
  assert.match(preflight, /marketa\.variant_foundation\.existing_trigger_hash/)
  assert.match(preflight, /pg_get_triggerdef\(trigger_record\.oid, true\)/)

  for (const trigger of [
    "products_foundation_authority_guard",
    "product_variants_foundation_guard",
    "product_variants_updated_at",
    "order_items_foundation_variant_guard",
    "order_items_variant_identity_immutable",
  ]) {
    assert.match(postcondition, new RegExp(`'${trigger}'::text`), trigger)
  }

  assert.match(postcondition, /trigger_record\.tgfoid = expected_trigger\.function_oid/)
  assert.match(postcondition, /trigger_record\.tgtype = expected_trigger\.trigger_type/)
  assert.match(postcondition, /trigger_record\.tgenabled = 'O'/)
  assert.match(postcondition, /trigger_record\.tgnargs = 0/)
  assert.match(postcondition, /pre-existing triggers changed/)
  assert.match(postcondition, /existing_trigger_count'[\s\S]*::bigint \+ 3/)
  assert.match(postcondition, /existing_trigger_count'[\s\S]*::bigint \+ 5/)
  assert.doesNotMatch(postcondition, /<> 6/)
})

test("product variants use product-wide pricing and isolated ownership", () => {
  const table = between(
    migration,
    "create table public.product_variants (",
    ");\n\ncreate unique index product_variants_normalized_combination_key"
  )
  for (const column of [
    "id uuid",
    "product_id uuid",
    "vendor_id uuid",
    "size text",
    "colour text",
    "stock integer",
    "stock_version bigint",
    "is_active boolean",
  ]) {
    assert.ok(table.includes(column), column)
  }
  assert.doesNotMatch(table, /\bprice\b/)
  assert.match(table, /foreign key \(product_id, vendor_id\)[\s\S]*references public\.products \(id, vendor_id\)/)
  assert.match(migration, /alter table public\.product_variants enable row level security/)
  assert.match(migration, /create policy product_variants_public_read/)
  assert.match(migration, /create policy vendor_select_own_product_variants/)
  assert.doesNotMatch(migration, /create policy .*product_variants[\s\S]{0,120}for (insert|update|delete)/i)
})

test("catalog name arrays are cast to text before text-array comparisons", () => {
  assert.match(
    migration,
    /array_agg\(\s*policy\.policyname::text\s+order by policy\.policyname\s*\)[\s\S]*is distinct from array\[[\s\S]*\]::text\[\]/
  )
  assert.match(
    migration,
    /array_agg\(\s*attribute\.attname::text order by trigger_column\.ordinality\s*\)[\s\S]*array\[\]::text\[\]\) = expected_trigger\.update_columns/
  )
})

test("normalization and NULLS NOT DISTINCT enforce combination uniqueness", () => {
  assert.match(migration, /regexp_replace\([\s\S]*'\[\[:space:\]\]\+'[\s\S]*'g'/)
  assert.match(migration, /lower\(/)
  assert.match(migration, /btrim\(/)
  assert.match(
    migration,
    /create unique index product_variants_normalized_combination_key[\s\S]*nulls not distinct;/
  )

  assert.equal(normalizeLabel("  Extra   Large "), "extra large")
  assert.equal(normalizeLabel("EXTRA LARGE"), "extra large")
  assert.equal(normalizeLabel("   "), null)
  assert.deepEqual(
    [normalizeLabel(" M "), normalizeLabel(null)],
    [normalizeLabel("m"), normalizeLabel(null)]
  )
})

test("variant labels follow the parent mode and variant stock has its own version", () => {
  const helper = between(
    migration,
    "create function public.enforce_product_variant_foundation()",
    "$function$;"
  )
  assert.match(helper, /parent_mode = 'none'/)
  assert.match(helper, /parent_mode = 'size'/)
  assert.match(helper, /parent_mode = 'colour'/)
  assert.match(helper, /parent_mode = 'size_colour'/)
  assert.match(helper, /new\.stock_version := old\.stock_version \+ 1/)
  assert.match(helper, /new\.product_id is distinct from old\.product_id/)
  assert.match(helper, /new\.vendor_id is distinct from old\.vendor_id/)
})

test("foundation order-item validation is nonlocking and rejects premature variants", () => {
  const helper = between(
    migration,
    "create function public.guard_foundation_order_item_variant()",
    "$function$;"
  )
  assert.doesNotMatch(helper, /for\s+update/i)
  assert.match(helper, /new\.product_variant_id is not null/)
  assert.match(helper, /new\.variant_size_snapshot is not null/)
  assert.match(helper, /new\.variant_colour_snapshot is not null/)
  assert.match(helper, /Variant purchasing is not available/)
  assert.match(helper, /parent_mode is distinct from 'none'/)
})

test("ordinary checkout order-item insertion remains compatible", () => {
  const orderItems = between(
    checkout,
    "const orderItems = validatedItems.map",
    "if (itemsError)"
  )
  assert.match(orderItems, /product_id: item\.product_id/)
  assert.match(orderItems, /quantity: item\.quantity/)
  assert.doesNotMatch(orderItems, /product_variant_id|variant_size_snapshot|variant_colour_snapshot/)
  assert.match(migration, /if new\.product_id is null then/)
  assert.match(migration, /parent_mode is distinct from 'none'/)
})

test("direct and composite FKs protect historical variant references", () => {
  assert.match(
    migration,
    /constraint order_items_product_variant_id_fkey[\s\S]*foreign key \(product_variant_id\)[\s\S]*references public\.product_variants \(id\)[\s\S]*on delete restrict/
  )
  assert.match(
    migration,
    /constraint order_items_product_variant_product_id_fkey[\s\S]*foreign key \(product_variant_id, product_id\)[\s\S]*references public\.product_variants \(id, product_id\)[\s\S]*on delete restrict/
  )
  assert.match(
    migration,
    /order_items_product_id_fkey'[\s\S]*FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE SET NULL/
  )
})

test("variant identity snapshots are immutable without blocking ordinary product SET NULL", () => {
  const helper = between(
    migration,
    "create function public.protect_order_item_variant_identity()",
    "$function$;"
  )
  assert.match(helper, /new\.product_variant_id is distinct from old\.product_variant_id/)
  assert.match(helper, /new\.variant_size_snapshot is distinct from old\.variant_size_snapshot/)
  assert.match(helper, /new\.variant_colour_snapshot is distinct from old\.variant_colour_snapshot/)
  assert.doesNotMatch(helper, /new\.product_id is distinct from old\.product_id/)
})

test("foundation exposes no variant mutation or conversion path", () => {
  assert.match(
    migration,
    /revoke all privileges on table public\.product_variants[\s\S]*from public, anon, authenticated, service_role;/
  )
  assert.match(
    migration,
    /grant select on table public\.product_variants[\s\S]*to anon, authenticated, service_role;/
  )
  assert.doesNotMatch(migration, /grant (insert|update|delete).*product_variants/i)
  assert.doesNotMatch(migration, /create function public\..*convert/i)
  assert.doesNotMatch(migration, /reservation|low_stock_cutoff/i)
})

test("variant mutations remain unavailable through effective column privileges", () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      migration,
      new RegExp(
        `has_table_privilege\\('${role}', 'public\\.product_variants', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\\)`
      ),
      `${role}:table mutations`
    )
  }

  const variantChecks = between(
    migration,
    "for column_record in\n    select attribute.attname\n    from pg_catalog.pg_attribute as attribute\n    where attribute.attrelid = 'public.product_variants'::pg_catalog.regclass",
    "if pg_catalog.current_setting("
  )

  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const privilege of ["INSERT", "UPDATE", "REFERENCES"]) {
      assert.match(
        variantChecks,
        new RegExp(
          `has_column_privilege\\([\\s\\S]*?'${role}',[\\s\\S]*?'public\\.product_variants',[\\s\\S]*?'${privilege}'`
        ),
        `${role}:${privilege}`
      )
    }
  }

  assert.match(variantChecks, /variant column privilege mismatch for %/)
})

test("Ops 4 finalizer and contained stock function are hash-protected and not replaced", () => {
  assert.match(migration, /marketa\.variant_foundation\.finalizer_hash/)
  assert.match(migration, /marketa\.variant_foundation\.decrement_hash/)
  assert.doesNotMatch(migration, /create or replace function public\.finalize_paystack_paid_order/i)
  assert.doesNotMatch(migration, /create or replace function public\.decrement_stock/i)
  assert.match(finalizer, /OPS_4C_STOCK_BOUNDARY_START/)
  assert.match(finalizer, /update public\.products as product[\s\S]*set stock = product\.stock - requirement\.required_quantity::integer/)
})

test("migration contains no business-row DML", () => {
  assert.doesNotMatch(migration, /\bupdate\s+public\.(products|order_items|orders|payments|payment_events|payout_ledger)\b/i)
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.(products|order_items|orders|payments|payment_events|payout_ledger)\b/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.(products|order_items|orders|payments|payment_events|payout_ledger)\b/i)
})

test("postconditions use effective table and column privilege checks", () => {
  assert.match(migration, /has_table_privilege\(/)
  assert.match(migration, /has_column_privilege\(/)
  assert.match(migration, /column privilege mismatch for %/)
  assert.match(migration, /anonymous product privileges are incorrect/)
  assert.match(migration, /service-role product privileges are incorrect/)
})
