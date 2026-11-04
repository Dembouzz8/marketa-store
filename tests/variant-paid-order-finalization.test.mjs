import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261104092307_add_variant_aware_paid_order_finalization.sql"
const migration = fs.readFileSync(path.join(root, migrationFile), "utf8")
const previousMigration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261007135410_add_atomic_paid_order_stock_finalization.sql"
  ),
  "utf8"
)

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `Missing ${startMarker}`)
  assert.notEqual(end, -1, `Missing ${endMarker}`)
  assert.ok(end > start, `${startMarker} must precede ${endMarker}`)
  return source.slice(start, end)
}

const preflight = section(migration, "-- C3_PREFLIGHT_START", "-- C3_PREFLIGHT_END")
const rpcSource = section(migration, "-- C3_RPC_START", "-- C3_RPC_END")
const inventoryBoundary = section(
  rpcSource,
  "-- C3_INVENTORY_BOUNDARY_START",
  "-- C3_INVENTORY_BOUNDARY_END"
)
const stockSuccess = section(
  rpcSource,
  "-- C3_STOCK_SUCCESS_START",
  "-- C3_STOCK_SUCCESS_END"
)
const postcondition = section(
  migration,
  "-- C3_POSTCONDITION_START",
  "-- C3_POSTCONDITION_END"
)
const previousRpc = section(
  previousMigration,
  "-- OPS_4C_RPC_START",
  "-- OPS_4C_RPC_END"
)

test("non-inventory finalizer logic is copied exactly from the deployed source", () => {
  assert.equal(
    rpcSource.slice(
      rpcSource.indexOf("create or replace function"),
      rpcSource.indexOf("  v_initial_item_count bigint;")
    ),
    previousRpc.slice(
      previousRpc.indexOf("create or replace function"),
      previousRpc.indexOf("  v_initial_item_count bigint;")
    )
  )
  assert.equal(
    rpcSource.slice(
      rpcSource.indexOf("begin\n  if p_payload_sha256"),
      rpcSource.indexOf("    -- C3_INVENTORY_BOUNDARY_START")
    ),
    previousRpc.slice(
      previousRpc.indexOf("begin\n  if p_payload_sha256"),
      previousRpc.indexOf("    -- OPS_4C_STOCK_BOUNDARY_START")
    )
  )
  assert.equal(
    rpcSource.slice(
      rpcSource.indexOf("    -- C3_INVENTORY_BOUNDARY_END") +
        "    -- C3_INVENTORY_BOUNDARY_END".length,
      rpcSource.indexOf("      -- C3_STOCK_SUCCESS_START")
    ),
    previousRpc.slice(
      previousRpc.indexOf("    -- OPS_4C_STOCK_BOUNDARY_END") +
        "    -- OPS_4C_STOCK_BOUNDARY_END".length,
      previousRpc.indexOf("      -- OPS_4C_STOCK_SUCCESS_START")
    )
  )
  assert.equal(
    rpcSource.slice(
      rpcSource.indexOf("      -- C3_STOCK_SUCCESS_END") +
        "      -- C3_STOCK_SUCCESS_END".length
    ),
    previousRpc.slice(
      previousRpc.indexOf("      -- OPS_4C_STOCK_SUCCESS_END") +
        "      -- OPS_4C_STOCK_SUCCESS_END".length
    )
  )
})

test("C3 is one bounded migration replacing only the existing finalizer", () => {
  assert.match(migration, /^-- Product Variants Batch 2C-C3:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.match(migration, /set local statement_timeout = '120s'/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal(
    (migration.match(/create or replace function public\./gi) ?? []).length,
    1
  )
  assert.equal(
    (migration.match(/finalize_paystack_paid_order\(/gi) ?? []).length >= 2,
    true
  )
  assert.doesNotMatch(migration, /create\s+(?:table|trigger|policy)\b/i)
  assert.doesNotMatch(migration, /alter\s+table\b/i)
})

test("preflight pins deployed financial purchase and snapshot contracts", () => {
  for (const hash of [
    "37c763494aed0f4e13daa004b88b6dee",
    "0094f1ea6602edbfe18ac8f9619677b8",
    "b7ef9997e19e38d33274104723faccee",
    "c34ac95900ffa3c7bd2072256a56f203",
    "ba55da82735b982b5d2f3f5ca04d223c",
  ]) assert.ok(preflight.includes(hash), hash)

  for (const contract of [
    "product_variants_id_product_id_vendor_id_key",
    "order_items_product_variant_product_vendor_fkey",
    "order_items_variant_identity_check",
    "product_variant_option_values_variant_fkey",
    "product_variant_combination_identities_product_signature_key",
    "product_variants_stock_check",
    "product_variants_foundation_guard",
    "order_items_foundation_variant_guard",
  ]) assert.ok(preflight.includes(contract), contract)
  assert.match(preflight, /FOREIGN KEY \(variant_id, product_id\) REFERENCES product_variants\(id, product_id\) ON UPDATE RESTRICT ON DELETE CASCADE/)
  assert.match(preflight, /UNIQUE \(product_id, combination_signature\)/)
})

test("finalizer signature metadata and execution boundary stay unchanged", () => {
  assert.match(rpcSource, /returns table \(\s*outcome text,\s*order_id uuid,\s*retryable boolean\s*\)/)
  assert.match(rpcSource, /language plpgsql\s+volatile\s+security invoker\s+set search_path = ''/)
  assert.match(rpcSource, /alter function public\.finalize_paystack_paid_order\([\s\S]*\) owner to postgres/)
  assert.match(rpcSource, /revoke all privileges[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(rpcSource, /grant execute[\s\S]*to service_role/)
  assert.doesNotMatch(rpcSource, /security definer/i)
  assert.match(preflight, /pg_catalog\.aclexplode/)
  assert.match(postcondition, /pg_catalog\.aclexplode/)
  assert.match(postcondition, /acl\.grantee not in/)
})

test("private generalized identity access is read-only and service-role-only", () => {
  for (const table of [
    "product_variant_option_values",
    "product_variant_combination_identities",
  ]) {
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to service_role`))
    assert.match(postcondition, new RegExp(`'service_role', 'public\\.${table}', 'SELECT'`))
    assert.match(postcondition, new RegExp(`'service_role', 'public\\.${table}', 'INSERT,UPDATE,DELETE'`))
    for (const role of ["public", "anon", "authenticated"]) {
      assert.match(postcondition, new RegExp(`'${role}', 'public\\.${table}', 'SELECT,INSERT,UPDATE,DELETE'`))
    }
  }
  assert.equal(
    (migration.match(/grant\s+update\s*\(stock\)\s+on\s+table\s+public\.product_variants\s+to\s+service_role;/gi) ?? []).length,
    1
  )
  assert.doesNotMatch(migration, /grant\s+(?:insert|delete|all)/i)
  assert.deepEqual(
    (migration.match(/grant\s+update[\s\S]*?;/gi) ?? []).map((statement) =>
      statement.replace(/\s+/g, " ").toLowerCase()
    ),
    ["grant update (stock) on table public.product_variants to service_role;"]
  )
  assert.match(preflight, /has_any_column_privilege/)
  assert.match(postcondition, /has_any_column_privilege/)
})

test("C3 preserves narrow product authority and adds only variant stock authority", () => {
  assert.match(
    preflight,
    /has_column_privilege\(\s*'service_role', 'public\.products', 'stock', 'UPDATE'\s*\)/
  )
  assert.match(
    preflight,
    /has_column_privilege\(\s*'service_role', 'public\.products', 'updated_at', 'UPDATE'\s*\)/
  )
  assert.match(
    preflight,
    /has_table_privilege\('service_role', 'public\.products', 'UPDATE'\)/
  )
  assert.doesNotMatch(
    preflight,
    /not pg_catalog\.has_table_privilege\('service_role', 'public\.products', 'UPDATE'\)/
  )
  assert.match(
    preflight,
    /has_any_column_privilege\(\s*'service_role', 'public\.product_variants', 'UPDATE'\s*\)/
  )
  assert.match(
    migration,
    /grant update \(stock\) on table public\.product_variants to service_role;/
  )
  assert.match(
    postcondition,
    /has_column_privilege\(\s*'service_role', 'public\.product_variants', 'stock', 'UPDATE'\s*\)/
  )
  assert.match(
    postcondition,
    /attribute\.attname <> 'stock'[\s\S]*has_column_privilege\(\s*'service_role',[\s\S]*'public\.product_variants',[\s\S]*attribute\.attname,[\s\S]*'UPDATE'/
  )
  assert.match(
    postcondition,
    /role_record\.rolname in \('anon', 'authenticated'\)[\s\S]*has_any_column_privilege\([\s\S]*'public\.product_variants', 'UPDATE'/
  )
  assert.match(
    postcondition,
    /'public', 'public\.product_variants', 'UPDATE'/
  )
})

test("inventory RLS and database-managed variant triggers remain pinned", () => {
  for (const source of [preflight, postcondition]) {
    for (const table of [
      "products",
      "product_variants",
      "order_items",
      "product_variant_option_values",
      "product_variant_combination_identities",
    ]) assert.ok(source.includes(`'public.${table}'::pg_catalog.regclass`), table)
    assert.match(source, /not relation\.relrowsecurity/)
    assert.match(source, /relation\.relforcerowsecurity/)
    assert.match(source, /product_variants_updated_at/)
    assert.match(source, /public\.handle_updated_at\(\)/)
  }
  assert.match(postcondition, /product_variants_foundation_guard/)
  assert.match(postcondition, /public\.enforce_product_variant_foundation\(\)/)
  assert.doesNotMatch(rpcSource, /set[\s\S]{0,100}stock_version\s*=/i)
  assert.doesNotMatch(
    stockSuccess,
    /update public\.product_variants as variant[\s\S]*set[\s\S]*updated_at\s*=/i
  )
})

test("exact inventory updates need only the approved narrow columns", () => {
  assert.match(
    stockSuccess,
    /update public\.products as product\s+set stock = product\.stock - requirement\.required_quantity::integer,\s+updated_at = v_now/
  )
  assert.match(
    stockSuccess,
    /update public\.product_variants as variant\s+set stock = variant\.stock - requirement\.required_quantity::integer/
  )
  assert.doesNotMatch(
    stockSuccess,
    /update public\.product_variants as variant[\s\S]*?set[\s\S]*?(?:stock_version|updated_at)\s*=/i
  )
})

test("ordinary and variant requirements aggregate independently with numeric sums", () => {
  assert.equal(
    (inventoryBoundary.match(/sum\(item\.quantity::numeric\)/g) ?? []).length,
    4
  )
  assert.equal(
    (inventoryBoundary.match(/item\.product_variant_id is null/g) ?? []).length >= 2,
    true
  )
  assert.equal(
    (inventoryBoundary.match(/item\.product_variant_id is not null/g) ?? []).length >= 2,
    true
  )
  assert.match(inventoryBoundary, /group by item\.product_id/)
  assert.match(
    inventoryBoundary,
    /group by item\.product_variant_id, item\.product_id, item\.vendor_id/
  )
  assert.match(inventoryBoundary, /required_quantity > 2147483647/)
  assert.doesNotMatch(inventoryBoundary, /sum\(item\.quantity\)::integer/)
})

test("deterministic lock order is parent then variant then order item NOWAIT", () => {
  const productLock = inventoryBoundary.indexOf("perform product.id")
  const variantLock = inventoryBoundary.indexOf("perform variant.id")
  const itemLock = inventoryBoundary.indexOf("perform item.id")
  assert.ok(productLock >= 0 && variantLock > productLock && itemLock > variantLock)
  assert.match(inventoryBoundary, /order by product\.id\s+for update of product/)
  assert.match(inventoryBoundary, /order by variant\.id\s+for update of variant/)
  assert.match(inventoryBoundary, /order by item\.id\s+for update of item nowait/)
  assert.doesNotMatch(rpcSource, /pg_advisory/i)
  assert.doesNotMatch(inventoryBoundary, /skip locked/i)
})

test("requirements and inventory identities are rederived after locks", () => {
  for (const comparison of [
    "v_rechecked_parent_product_ids",
    "v_rechecked_ordinary_product_ids",
    "v_rechecked_ordinary_quantities",
    "v_rechecked_variant_ids",
    "v_rechecked_variant_product_ids",
    "v_rechecked_variant_vendor_ids",
    "v_rechecked_variant_quantities",
    "v_rechecked_item_count",
  ]) assert.ok(inventoryBoundary.includes(`${comparison}`), comparison)
  assert.match(inventoryBoundary, /v_rechecked_parent_product_ids\s+is distinct from v_stock_parent_product_ids/)
  assert.match(inventoryBoundary, /v_rechecked_variant_ids is distinct from v_stock_variant_ids/)
  assert.match(inventoryBoundary, /PAID_STOCK_REQUIREMENTS_CHANGED/)
})

test("variant identity uses immutable IDs and persisted signature without mutable labels", () => {
  assert.match(inventoryBoundary, /validate_order_item_variant_options_snapshot/)
  assert.match(inventoryBoundary, /identity_record\.combination_signature/)
  assert.match(inventoryBoundary, /product_variant_option_values as assignment/)
  assert.match(inventoryBoundary, /snapshot_option\.value ->> 'axis_id'/)
  assert.match(inventoryBoundary, /snapshot_option\.value ->> 'value_id'/)
  assert.match(inventoryBoundary, /assignment\.axis_id::text/)
  assert.match(inventoryBoundary, /assignment\.value_id::text/)
  assert.doesNotMatch(inventoryBoundary, /display_label|axis_display_name|unit_name|size_system_name/)
  assert.match(inventoryBoundary, /product\.variant_mode = 'options'/)
  assert.match(inventoryBoundary, /product\.variant_mode in \('size', 'colour', 'size_colour'\)/)
  assert.match(
    inventoryBoundary,
    /pg_catalog\.bool_and\(\s*coalesce\(case[\s\S]*end, false\)\s*\)/
  )
  assert.match(inventoryBoundary, /identity_record\.variant_id is not null/)
  assert.match(
    inventoryBoundary,
    /identity_record\.combination_signature is not null/
  )
  assert.match(
    inventoryBoundary,
    /variant_options_snapshot ->> 'combination_signature'\s+is not null/
  )
  assert.match(
    inventoryBoundary,
    /identity_record\.combination_signature\s+is not distinct from\s+item\.variant_options_snapshot ->> 'combination_signature'/
  )
})

test("missing or inconsistent variants reconcile before any stock write", () => {
  for (const diagnostic of [
    "PAID_STOCK_PRODUCT_UNAVAILABLE",
    "PAID_STOCK_VARIANT_UNAVAILABLE",
    "PAID_STOCK_VARIANT_IDENTITY_MISMATCH",
    "PAID_STOCK_INSUFFICIENT",
    "PAID_STOCK_REQUIREMENTS_CHANGED",
  ]) assert.ok(inventoryBoundary.includes(`'${diagnostic}'`), diagnostic)
  assert.match(inventoryBoundary, /finalization_state = 'reconciliation_required'/)
  assert.match(inventoryBoundary, /processing_state = 'reconciliation_required'/)
  assert.match(inventoryBoundary, /select 'RECONCILIATION_REQUIRED'::text, v_order\.id, false/)
  assert.doesNotMatch(inventoryBoundary, /update public\.products as product/)
  assert.doesNotMatch(inventoryBoundary, /update public\.product_variants as variant/)
  assert.doesNotMatch(inventoryBoundary, /insert into public\.payout_ledger/)
})

test("ordinary and variant stock mutate exactly once in the financial subtransaction", () => {
  assert.equal((rpcSource.match(/update public\.products as product/g) ?? []).length, 1)
  assert.equal((rpcSource.match(/update public\.product_variants as variant/g) ?? []).length, 1)
  assert.match(stockSuccess, /stock = product\.stock - requirement\.required_quantity::integer/)
  assert.match(stockSuccess, /stock = variant\.stock - requirement\.required_quantity::integer/)
  assert.match(stockSuccess, /v_updated_ordinary_count <> v_rechecked_ordinary_count/)
  assert.match(stockSuccess, /v_updated_variant_count <> v_rechecked_variant_count/)
  assert.doesNotMatch(stockSuccess, /product\.stock[^\n]*v_rechecked_variant/)
  assert.doesNotMatch(stockSuccess, /stock_version\s*=/)
})

test("variant stock trigger remains the sole stock-version increment authority", () => {
  assert.match(preflight, /product_variants_foundation_guard/)
  assert.match(preflight, /ba55da82735b982b5d2f3f5ca04d223c/)
  assert.match(stockSuccess, /advances stock_version once/)
  assert.doesNotMatch(rpcSource, /set[\s\S]{0,100}stock_version\s*=/i)
})

test("stock writes precede unchanged credit confirmation payment event and outbox writes", () => {
  const begin = rpcSource.indexOf("    begin\n      -- C3_STOCK_SUCCESS_START")
  const ordinary = rpcSource.indexOf("update public.products as product", begin)
  const variant = rpcSource.indexOf("update public.product_variants as variant", begin)
  const credit = rpcSource.indexOf("insert into public.payout_ledger", begin)
  const confirmation = rpcSource.indexOf("set status = 'confirmed'", begin)
  const payment = rpcSource.indexOf("finalization_state = 'completed'", begin)
  const event = rpcSource.indexOf("processing_state = 'completed'", payment)
  const outbox = rpcSource.indexOf("insert into public.outbox_events", event)
  const handler = rpcSource.indexOf("when unique_violation then", outbox)
  for (const position of [begin, ordinary, variant, credit, confirmation, payment, event, outbox, handler]) {
    assert.notEqual(position, -1)
  }
  assert.ok(begin < ordinary && ordinary < variant && variant < credit)
  assert.ok(credit < confirmation && confirmation < payment)
  assert.ok(payment < event && event < outbox && outbox < handler)
  assert.match(rpcSource, /OUTBOX_INTENT_CONFLICT/)
  assert.match(rpcSource, /SALE_CREDIT_UNIQUE_CONFLICT/)
})

test("payment replay short circuits remain ahead of inventory consumption", () => {
  const inventory = rpcSource.indexOf("-- C3_INVENTORY_BOUNDARY_START")
  for (const outcome of [
    "EVENT_ALREADY_COMPLETED",
    "ALREADY_FINALIZED",
    "LEGACY_ALREADY_FINALIZED",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
  ]) {
    const position = rpcSource.indexOf(`'${outcome}'`)
    assert.notEqual(position, -1, outcome)
    assert.ok(position < inventory, outcome)
  }
  assert.match(rpcSource, /provider,\s*environment,\s*event_type,\s*payload_sha256/)
  assert.match(rpcSource, /PAYMENT_IDENTITY_CONFLICT/)
})

test("legacy V1 and ordinary V2 financial paths still converge on inventory", () => {
  const beforeInventory = rpcSource.slice(
    0,
    rpcSource.indexOf("-- C3_INVENTORY_BOUNDARY_START")
  )
  assert.match(
    beforeInventory,
    /if v_order\.financial_contract_version = 2 then[\s\S]*v_contract_version := 2;[\s\S]*elsif v_order\.financial_contract_version is null then[\s\S]*v_contract_version := 1;/
  )
  assert.doesNotMatch(inventoryBoundary, /product\.is_active|vendor\.is_active/)
})

test("purchase guard remains closed and C3 adds no variant order creation path", () => {
  assert.match(preflight, /b7ef9997e19e38d33274104723faccee/)
  assert.match(postcondition, /b7ef9997e19e38d33274104723faccee/)
  assert.match(postcondition, /c34ac95900ffa3c7bd2072256a56f203/)
  assert.match(postcondition, /ba55da82735b982b5d2f3f5ca04d223c/)
  assert.match(postcondition, /order_items_foundation_variant_guard/)
  assert.doesNotMatch(migration, /drop\s+trigger\s+order_items_foundation_variant_guard/i)
  assert.doesNotMatch(migration, /grant\s+insert\s+on\s+(?:table\s+)?public\.order_items/i)
  assert.doesNotMatch(migration, /create\s+(?:or replace\s+)?function\s+public\.(?!finalize_paystack_paid_order)/i)
})

test("migration performs no business-row backfill", () => {
  const outsideRpc = migration
    .replace(preflight, "")
    .replace(rpcSource, "")
    .replace(postcondition, "")
  assert.doesNotMatch(outsideRpc, /update\s+public\.(?:products|product_variants|orders|order_items|payments)/i)
  assert.doesNotMatch(outsideRpc, /insert\s+into\s+public\.(?:orders|order_items|payments|payout_ledger|outbox_events)/i)
  assert.doesNotMatch(outsideRpc, /delete\s+from\s+public\./i)
})

function deriveInventory(items) {
  const ordinary = new Map()
  const variants = new Map()
  for (const item of items) {
    assert.ok(item.productId)
    assert.ok(item.vendorId)
    assert.ok(item.quantity > 0n)
    const target = item.variantId ? variants : ordinary
    const key = item.variantId ?? item.productId
    const current = target.get(key) ?? {
      productId: item.productId,
      vendorId: item.vendorId,
      quantity: 0n,
    }
    if (item.variantId) current.variantId = item.variantId
    current.quantity += item.quantity
    target.set(key, current)
  }
  const sort = (entries) => [...entries.values()].sort((a, b) =>
    (a.variantId ?? a.productId).localeCompare(b.variantId ?? b.productId)
  )
  return { ordinary: sort(ordinary), variants: sort(variants) }
}

function applyInventory(inventory, productStock, variantStock) {
  const nextProducts = new Map(productStock)
  const nextVariants = new Map(variantStock)
  for (const row of inventory.ordinary) {
    const available = nextProducts.get(row.productId)
    if (available === undefined || available < row.quantity) return null
  }
  for (const row of inventory.variants) {
    const available = nextVariants.get(row.variantId)
    if (available === undefined || available < row.quantity) return null
  }
  for (const row of inventory.ordinary) {
    nextProducts.set(row.productId, nextProducts.get(row.productId) - row.quantity)
  }
  for (const row of inventory.variants) {
    nextVariants.set(row.variantId, nextVariants.get(row.variantId) - row.quantity)
  }
  return { products: nextProducts, variants: nextVariants }
}

function aggregateIdentityValidity(items) {
  if (items.length === 0) return false
  return items.every((item) => {
    if (item.kind === "ordinary") {
      return item.sizeSnapshot === null &&
        item.colourSnapshot === null &&
        item.optionsSnapshot === null
    }
    if (item.kind === "legacy") {
      return ["size", "colour", "size_colour"].includes(item.mode) &&
        (item.sizeSnapshot !== null || item.colourSnapshot !== null)
    }
    if (item.kind !== "generalized") return false
    return item.snapshotValid === true &&
      item.snapshotVariantId === item.variantId &&
      item.snapshotProductId === item.productId &&
      item.snapshotVendorId === item.vendorId &&
      item.identityExists === true &&
      item.identitySignature !== null &&
      item.snapshotSignature !== null &&
      item.identitySignature === item.snapshotSignature &&
      item.assignmentsComplete === true
  })
}

const validOrdinaryIdentity = {
  kind: "ordinary",
  sizeSnapshot: null,
  colourSnapshot: null,
  optionsSnapshot: null,
}

const validGeneralizedIdentity = {
  kind: "generalized",
  snapshotValid: true,
  variantId: "variant-1",
  productId: "product-1",
  vendorId: "vendor-1",
  snapshotVariantId: "variant-1",
  snapshotProductId: "product-1",
  snapshotVendorId: "vendor-1",
  identityExists: true,
  identitySignature: "axis-1=value-1",
  snapshotSignature: "axis-1=value-1",
  assignmentsComplete: true,
}

test("identity aggregation fails closed for every missing or stale generalized fact", () => {
  assert.equal(aggregateIdentityValidity([validOrdinaryIdentity]), true)
  assert.equal(aggregateIdentityValidity([validGeneralizedIdentity]), true)
  assert.equal(
    aggregateIdentityValidity([validOrdinaryIdentity, validGeneralizedIdentity]),
    true
  )

  const missingIdentity = {
    ...validGeneralizedIdentity,
    identityExists: false,
    identitySignature: null,
  }
  assert.equal(aggregateIdentityValidity([missingIdentity]), false)
  assert.equal(
    aggregateIdentityValidity([validOrdinaryIdentity, missingIdentity]),
    false
  )
  assert.equal(
    aggregateIdentityValidity([validGeneralizedIdentity, missingIdentity]),
    false
  )
  assert.equal(
    aggregateIdentityValidity([
      validOrdinaryIdentity,
      validGeneralizedIdentity,
      missingIdentity,
    ]),
    false
  )
  assert.equal(
    aggregateIdentityValidity([{
      ...validGeneralizedIdentity,
      identitySignature: "axis-1=stale-value",
    }]),
    false
  )
  assert.equal(
    aggregateIdentityValidity([{
      ...validGeneralizedIdentity,
      snapshotSignature: null,
    }]),
    false
  )
  assert.equal(
    aggregateIdentityValidity([{
      ...validGeneralizedIdentity,
      assignmentsComplete: false,
    }]),
    false
  )
  assert.equal(aggregateIdentityValidity([]), false)
})

test("legacy size colour and size-colour identity behavior stays valid", () => {
  for (const legacy of [
    { mode: "size", sizeSnapshot: "M", colourSnapshot: null },
    { mode: "colour", sizeSnapshot: null, colourSnapshot: "Blue" },
    { mode: "size_colour", sizeSnapshot: "M", colourSnapshot: "Blue" },
  ]) {
    assert.equal(aggregateIdentityValidity([{
      kind: "legacy",
      optionsSnapshot: null,
      ...legacy,
    }]), true)
  }
})

test("pure model covers ordinary variant mixed repeated multi-vendor inventory", () => {
  const inventory = deriveInventory([
    { productId: "p1", vendorId: "v1", quantity: 2n },
    { productId: "p1", vendorId: "v1", quantity: 3n },
    { productId: "p2", variantId: "x2", vendorId: "v1", quantity: 1n },
    { productId: "p2", variantId: "x1", vendorId: "v1", quantity: 2n },
    { productId: "p2", variantId: "x1", vendorId: "v1", quantity: 3n },
    { productId: "p3", variantId: "x3", vendorId: "v2", quantity: 4n },
  ])
  assert.deepEqual(inventory.ordinary.map((row) => [row.productId, row.quantity]), [["p1", 5n]])
  assert.deepEqual(inventory.variants.map((row) => [row.variantId, row.quantity]), [
    ["x1", 5n], ["x2", 1n], ["x3", 4n],
  ])
  const result = applyInventory(
    inventory,
    new Map([["p1", 5n], ["p2", 99n], ["p3", 99n]]),
    new Map([["x1", 5n], ["x2", 2n], ["x3", 4n]])
  )
  assert.equal(result.products.get("p1"), 0n)
  assert.equal(result.products.get("p2"), 99n)
  assert.equal(result.variants.get("x1"), 0n)
})

test("pure model rejects either insufficient source without partial deduction", () => {
  const inventory = deriveInventory([
    { productId: "p1", vendorId: "v1", quantity: 2n },
    { productId: "p2", variantId: "x1", vendorId: "v1", quantity: 3n },
  ])
  const products = new Map([["p1", 1n], ["p2", 50n]])
  const variants = new Map([["x1", 3n]])
  assert.equal(applyInventory(inventory, products, variants), null)
  assert.equal(products.get("p1"), 1n)
  assert.equal(variants.get("x1"), 3n)
  assert.equal(
    applyInventory(inventory, new Map([["p1", 2n]]), new Map([["x1", 2n]])),
    null
  )
})

test("static suite records the runtime-only C3 proof matrix without claiming execution", () => {
  const runtimeOnly = [
    "ordinary-only finalization",
    "one-axis variant finalization",
    "three-axis variant finalization",
    "mixed and multi-vendor finalization",
    "duplicate provider event and different delivery for the same payment",
    "two sessions purchasing the last variant unit",
    "vendor stock update racing with finalization",
    "identity mismatch and missing variant reconciliation",
    "failure after stock, payout credit, and outbox operations",
    "exact trigger-driven stock_version advancement",
    "transaction rollback and baseline restoration",
  ]
  assert.equal(runtimeOnly.length, 11)
  assert.ok(runtimeOnly.every((entry) => entry.length > 0))
})

test("focused artifact hash can be reproduced for review", () => {
  const hash = createHash("sha256").update(migration).digest("hex")
  assert.match(hash, /^[0-9a-f]{64}$/)
})
