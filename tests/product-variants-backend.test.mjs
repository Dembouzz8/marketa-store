import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261020150650_secure_vendor_variant_management_backend.sql"
const foundationFile =
  "supabase/migrations/20261012120923_add_product_variants_foundation.sql"
const checkoutFile = "supabase/functions/handle-checkout/index.ts"
const finalizerFile =
  "supabase/migrations/20261007135410_add_atomic_paid_order_stock_finalization.sql"
const checkoutAttemptFoundationFile =
  "supabase/migrations/20260726150000_add_checkout_attempt_idempotency_foundation.sql"
const activationAuthorityFile =
  "supabase/migrations/20260926231820_add_vendor_activation_authority.sql"

const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migration = read(migrationFile)
const foundation = read(foundationFile)
const checkout = read(checkoutFile)
const finalizer = read(finalizerFile)
const checkoutAttemptFoundation = read(checkoutAttemptFoundationFile)
const activationAuthority = read(activationAuthorityFile)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function functionSource(name, replace = false) {
  const prefix = `${replace ? "create or replace" : "create"} function public.${name}(`
  return between(migration, prefix, "$function$;")
}

const configure = functionSource("configure_vendor_product_variant_mode")
const createVariant = functionSource("create_vendor_product_variant")
const updateLabels = functionSource("update_vendor_product_variant_labels")
const updateStock = functionSource("update_vendor_product_variant_stock")
const deleteVariant = functionSource("delete_vendor_product_variant")
const orderItemGuard = functionSource(
  "guard_foundation_order_item_variant",
  true
)
const preflight = between(migration, "do $preflight$", "$preflight$;")
const postcondition = between(
  migration,
  "do $postcondition$",
  "$postcondition$;"
)

const rpcNames = [
  "configure_vendor_product_variant_mode",
  "create_vendor_product_variant",
  "update_vendor_product_variant_labels",
  "update_vendor_product_variant_stock",
  "delete_vendor_product_variant",
]

const rpcSources = [
  configure,
  createVariant,
  updateLabels,
  updateStock,
  deleteVariant,
]

function canConvert({
  ownsProduct,
  vendorActive,
  productActive,
  stock,
  mode,
  orderItemReferences,
  variantCount,
}) {
  return (
    ownsProduct &&
    vendorActive &&
    productActive === false &&
    stock === 0 &&
    mode === "none" &&
    orderItemReferences === 0 &&
    variantCount === 0
  )
}

function applyStockUpdate({ stock, stockVersion }, nextStock, expectedVersion) {
  if (nextStock < 0) return { outcome: "invalid_input", stock, stockVersion }
  if (stockVersion !== expectedVersion) {
    return { outcome: "conflict", stock, stockVersion }
  }
  if (stock === nextStock) return { outcome: "no_change", stock, stockVersion }
  return { outcome: "updated", stock: nextStock, stockVersion: stockVersion + 1 }
}

test("migration is a bounded transactional and fail-closed change", () => {
  assert.match(migration, /^-- Product Variants Batch 2B1:[\s\S]*\nbegin;/)
  assert.match(migration, /set local lock_timeout = '10s';/)
  assert.match(migration, /set local statement_timeout = '120s';/)
  assert.match(preflight, /required tables are missing/)
  assert.match(preflight, /required functions are missing/)
  assert.match(preflight, /RPC name collision/)
  assert.match(preflight, /procedure\.proname in/)
  assert.match(preflight, /publication guard collision/)
  assert.match(postcondition, /RPC inventory is incomplete/)
  assert.match(postcondition, /unexpected RPC overload exists/)
  assert.match(migration, /\ncommit;\s*$/)
})

test("migration starts from the exact empty foundation state", () => {
  assert.match(preflight, /from public\.product_variants[\s\S]*?\) <> 0/)
  assert.match(preflight, /where product\.variant_mode <> 'none'/)
  assert.match(preflight, /products_inventory_authority_check/)
  assert.match(preflight, /CHECK \(variant_mode = ''none''::text OR stock = 0\)/)
  assert.match(preflight, /vendors_user_id_key/)
  assert.match(preflight, /UNIQUE \(user_id\)/)
  assert.match(preflight, /RLS policy inventory changed/)
})

test("publication guards keep variant products and variants as drafts", () => {
  assert.match(
    migration,
    /add constraint products_variant_draft_publication_check\s+check \(variant_mode = 'none' or is_active is false\)\s+not valid;/
  )
  assert.match(
    migration,
    /add constraint product_variants_draft_only_check\s+check \(is_active is false\)\s+not valid;/
  )
  assert.match(
    migration,
    /validate constraint products_variant_draft_publication_check;/
  )
  assert.match(
    migration,
    /validate constraint product_variants_draft_only_check;/
  )
  assert.match(postcondition, /publication guards are incorrect/)

  const ordinaryProduct = { variant_mode: "none", is_active: true }
  const draftVariantProduct = { variant_mode: "size", is_active: false }
  assert.equal(
    ordinaryProduct.variant_mode === "none" || ordinaryProduct.is_active === false,
    true
  )
  assert.equal(
    draftVariantProduct.variant_mode === "none" ||
      draftVariantProduct.is_active === false,
    true
  )
  assert.equal("size" === "none" || true === false, false)
})

test("ordinary checkout and conversion share a deadlock-safe synchronization key", () => {
  assert.match(orderItemGuard, /pg_catalog\.pg_advisory_xact_lock_shared\(/)
  assert.match(
    orderItemGuard,
    /pg_catalog\.hashtextextended\(new\.product_id::text, 0\)/
  )
  assert.doesNotMatch(orderItemGuard, /\n\s*for update;/)
  assert.match(configure, /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(
    configure,
    /pg_catalog\.hashtextextended\(p_product_id::text, 0\)/
  )
  assert.ok(
    configure.indexOf("pg_catalog.pg_advisory_xact_lock(") <
      configure.indexOf("for update;")
  )
  assert.match(orderItemGuard, /security invoker/)
  assert.match(postcondition, /synchronized order-item guard is incorrect/)
})

test("variant-backed order items remain rejected and ordinary items require ordinary products", () => {
  assert.match(orderItemGuard, /new\.product_variant_id is not null/)
  assert.match(orderItemGuard, /new\.variant_size_snapshot is not null/)
  assert.match(orderItemGuard, /new\.variant_colour_snapshot is not null/)
  assert.match(orderItemGuard, /Variant purchasing is not available/)
  assert.match(orderItemGuard, /parent_mode is distinct from 'none'/)
  assert.match(orderItemGuard, /Ordinary order items require an ordinary product/)
})

test("all management RPCs use trusted identity and active vendor ownership", () => {
  for (const [name, source] of [
    [rpcNames[0], configure],
    [rpcNames[1], createVariant],
    [rpcNames[2], updateLabels],
    [rpcNames[3], updateStock],
    [rpcNames[4], deleteVariant],
  ]) {
    assert.match(source, /security definer/)
    assert.match(source, /set search_path = ''/)
    assert.match(source, /actor_id := auth\.uid\(\)/)
    assert.match(source, /vendor\.user_id = actor_id/)
    assert.match(source, /vendor\.is_active = true/)
    assert.doesNotMatch(source, /execute\s+format|execute\s+immediate/i, name)
    assert.doesNotMatch(source, /p_vendor_id/, name)
  }
})

test("active-vendor authorization is locked for the complete operation", () => {
  for (const [index, source] of rpcSources.entries()) {
    const vendorRead = source.indexOf("from public.vendors as vendor")
    const activeCheck = source.indexOf("vendor.is_active = true", vendorRead)
    const vendorShare = source.indexOf("for share;", activeCheck)
    const advisory = source.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      vendorShare
    )
    const productUpdate = source.indexOf("for update;", advisory)

    assert.notEqual(vendorRead, -1, rpcNames[index])
    assert.ok(activeCheck > vendorRead, rpcNames[index])
    assert.ok(vendorShare > activeCheck, rpcNames[index])
    assert.ok(advisory > vendorShare, rpcNames[index])
    assert.ok(productUpdate > advisory, rpcNames[index])
    assert.equal((source.match(/for share;/g) ?? []).length, 1, rpcNames[index])
  }

  assert.match(postcondition, /position\('for share' in function_definition\)/)
  assert.match(
    postcondition,
    /'pg_catalog\.pg_advisory_xact_lock' in function_definition/
  )
})

test("all RPCs preserve one deadlock-safe lock order", () => {
  for (const [index, source] of rpcSources.entries()) {
    const vendorShare = source.indexOf("for share;")
    const advisory = source.indexOf("pg_catalog.pg_advisory_xact_lock(")
    const productUpdate = source.indexOf("for update;", advisory)
    const secondUpdate = source.indexOf("for update;", productUpdate + 1)

    assert.ok(vendorShare < advisory, rpcNames[index])
    assert.ok(advisory < productUpdate, rpcNames[index])
    if (index >= 2) {
      assert.ok(productUpdate < secondUpdate, rpcNames[index])
    } else {
      assert.equal(secondUpdate, -1, rpcNames[index])
    }
    assert.equal(
      (source.match(/pg_catalog\.pg_advisory_xact_lock\(/g) ?? []).length,
      1,
      rpcNames[index]
    )
  }
})

test("vendor deactivation cannot complete across an authorized RPC", () => {
  // FOR SHARE and an UPDATE of the same vendor row conflict. If the RPC locks
  // first, deactivation waits for the RPC transaction. If deactivation commits
  // first, the locked SELECT rechecks is_active and returns no authorized row.
  const authorizationRace = ({ deactivationCommitted, rpcHasShareLock }) => {
    if (deactivationCommitted) return "access_denied"
    if (rpcHasShareLock) return "deactivation_waits"
    return "authorization_unresolved"
  }

  assert.equal(
    authorizationRace({ deactivationCommitted: true, rpcHasShareLock: false }),
    "access_denied"
  )
  assert.equal(
    authorizationRace({ deactivationCommitted: false, rpcHasShareLock: true }),
    "deactivation_waits"
  )
  assert.match(
    activationAuthority,
    /from public\.vendors as vendor[\s\S]*for update;/
  )
  assert.doesNotMatch(activationAuthority, /set is_active = false/)
})

test("RPC execution is authenticated-only and direct variant writes stay denied", () => {
  const revokeBlock = between(
    migration,
    "revoke all privileges on function\n  public.configure_vendor_product_variant_mode",
    "grant execute on function"
  )
  const grantBlock = between(
    migration,
    "grant execute on function",
    "do $postcondition$"
  )
  for (const name of rpcNames) {
    assert.match(revokeBlock, new RegExp(`public\\.${name}\\(`))
    assert.match(grantBlock, new RegExp(`public\\.${name}\\(`))
  }
  assert.match(revokeBlock, /from public, anon, authenticated, service_role;/)
  assert.match(grantBlock, /to authenticated;/)
  assert.doesNotMatch(grantBlock, /to\s+(?:public|anon|service_role)\b/)
  assert.doesNotMatch(
    migration,
    /grant\s+(?:insert|update|delete|all)[\s\S]{0,120}on (?:table )?public\.product_variants/i
  )
  for (const catalogBlock of [preflight, postcondition]) {
    assert.match(
      catalogBlock,
      /'public', 'anon', 'authenticated', 'service_role'/
    )
    assert.match(catalogBlock, /'INSERT', 'UPDATE', 'REFERENCES'/)
    assert.match(
      catalogBlock,
      /has_column_privilege\(\s*role_name,\s*'public\.product_variants'/
    )
    assert.match(
      catalogBlock,
      /has_column_privilege\(\s*role_name,\s*'public\.products'/
    )
    assert.match(catalogBlock, /'variant_mode', 'stock_version'/)
  }
  assert.match(postcondition, /direct mutation authority widened/)
})

test("conversion is a one-way atomic transition for an eligible owned draft", () => {
  assert.match(
    configure,
    /p_variant_mode not in \('size', 'colour', 'size_colour'\)/
  )
  assert.match(configure, /product\.vendor_id = authorized_vendor_id/)
  assert.match(configure, /for update;/)
  assert.match(configure, /product_record\.variant_mode <> 'none'/)
  assert.match(configure, /product_record\.is_active is distinct from false/)
  assert.match(configure, /product_record\.stock <> 0/)
  assert.match(configure, /from public\.product_variants as variant/)
  assert.match(
    configure,
    /set variant_mode = p_variant_mode,\s+is_active = false/
  )
  assert.doesNotMatch(configure, /p_variant_mode[^\n]*'none'/)
  assert.doesNotMatch(configure, /set stock\s*=/)
})

test("conversion model rejects every ineligible state", () => {
  const eligible = {
    ownsProduct: true,
    vendorActive: true,
    productActive: false,
    stock: 0,
    mode: "none",
    orderItemReferences: 0,
    variantCount: 0,
  }
  assert.equal(canConvert(eligible), true)

  for (const mutation of [
    { ownsProduct: false },
    { vendorActive: false },
    { productActive: true },
    { stock: 1 },
    { mode: "size" },
    { orderItemReferences: 1 },
    { variantCount: 1 },
  ]) {
    assert.equal(canConvert({ ...eligible, ...mutation }), false)
  }
})

test("any order-item linkage blocks conversion without status guessing", () => {
  const historyCheck = between(
    configure,
    "if exists (\n    select 1\n    from public.order_items as item",
    "return query select 'order_history_exists'"
  )
  assert.match(historyCheck, /item\.product_id = p_product_id/)
  assert.doesNotMatch(historyCheck, /orders|payments|status|payment_status/i)

  for (const state of [
    "pending_checkout",
    "paid_unfinalized",
    "confirmed",
    "cancelled",
    "reconciliation_required",
  ]) {
    assert.equal(
      canConvert({
        ownsProduct: true,
        vendorActive: true,
        productActive: false,
        stock: 0,
        mode: "none",
        orderItemReferences: state ? 1 : 0,
        variantCount: 0,
      }),
      false,
      state
    )
  }
})

test("checkout sequencing covers every payable state through order items", () => {
  const orderInsert = checkout.indexOf('.from("orders")\n    .insert({')
  const attemptInsert = checkout.indexOf('.from("checkout_attempts")\n    .insert({')
  const itemInsert = checkout.indexOf('.from("order_items")\n    .insert(orderItems)')
  const paystackInitialize = checkout.indexOf(
    'fetch(\n      "https://api.paystack.co/transaction/initialize"'
  )

  assert.notEqual(orderInsert, -1)
  assert.ok(attemptInsert > orderInsert)
  assert.ok(itemInsert > attemptInsert)
  assert.ok(paystackInitialize > itemInsert)
  assert.match(
    checkoutAttemptFoundation,
    /checkout_attempts_order_checkout_attempt_fkey[\s\S]*references public\.orders \(id, checkout_attempt_id\)[\s\S]*on delete cascade/
  )
  assert.match(
    configure,
    /from public\.order_items as item\s+where item\.product_id = p_product_id/
  )
  assert.doesNotMatch(
    between(
      configure,
      "from public.order_items as item",
      "return query select 'order_history_exists'"
    ),
    /status|payment|checkout_attempts|orders/i
  )
  assert.match(finalizer, /from public\.order_items as item\s+where item\.order_id = v_order\.id/)
})

test("the transient pre-item checkout window is synchronized and cannot become payable", () => {
  // An order and checkout_attempt can exist briefly before order_items. The
  // conversion query cannot see that state directly. The exclusive conversion
  // lock and shared order-item trigger lock decide which path wins: either the
  // item exists before conversion validates, or the later item insert rejects
  // the converted product before Paystack initialization.
  assert.match(configure, /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(orderItemGuard, /pg_catalog\.pg_advisory_xact_lock_shared\(/)
  assert.match(orderItemGuard, /parent_mode is distinct from 'none'/)
  assert.ok(
    checkout.indexOf('.insert(orderItems)') <
      checkout.indexOf('https://api.paystack.co/transaction/initialize')
  )
  const itemFailure = between(
    checkout,
    "if (itemsError) {",
    "const callbackUrl = new URL"
  )
  assert.match(itemFailure, /await cleanupOrder\(\)/)
  assert.match(
    checkout,
    /\.from\("orders"\)\s+\.delete\(\)\s+\.eq\("id", orderId\)/
  )
})

test("variant creation is draft-only and delegates label integrity to the foundation", () => {
  assert.match(createVariant, /p_stock is null or p_stock < 0/)
  assert.match(createVariant, /product_record\.variant_mode = 'none'/)
  assert.match(createVariant, /product_record\.is_active is distinct from false/)
  assert.match(createVariant, /product_record\.stock <> 0/)
  assert.match(
    createVariant,
    /insert into public\.product_variants \(\s*product_id, vendor_id, size, colour, stock, is_active\s*\)/
  )
  assert.match(createVariant, /p_product_id, authorized_vendor_id, p_size, p_colour, p_stock, false/)
  assert.match(createVariant, /when unique_violation/)
  assert.match(createVariant, /'duplicate_combination'/)

  assert.match(foundation, /product_variants_label_required_check/)
  assert.match(foundation, /pg_catalog\.lower\([\s\S]*pg_catalog\.btrim\(size\)/)
  assert.match(foundation, /pg_catalog\.lower\([\s\S]*pg_catalog\.btrim\(colour\)/)
  assert.match(foundation, /nulls not distinct/)
})

test("foundation mode rules support size, colour, and combined variants", () => {
  const variantGuard = between(
    foundation,
    "create function public.enforce_product_variant_foundation()",
    "$function$;"
  )
  assert.match(variantGuard, /parent_mode = 'size'/)
  assert.match(variantGuard, /parent_mode = 'colour'/)
  assert.match(variantGuard, /parent_mode = 'size_colour'/)
  assert.match(variantGuard, /Size variants require size only/)
  assert.match(variantGuard, /Colour variants require colour only/)
  assert.match(variantGuard, /Size-and-colour variants require both labels/)
})

test("label edits cannot mutate inventory or reassign ownership", () => {
  assert.match(updateLabels, /set size = p_size,\s+colour = p_colour/)
  assert.doesNotMatch(updateLabels, /set[\s\S]{0,80}\bstock\s*=/)
  assert.doesNotMatch(updateLabels, /set[\s\S]{0,80}\bstock_version\s*=/)
  assert.doesNotMatch(updateLabels, /set[\s\S]{0,80}\bproduct_id\s*=/)
  assert.doesNotMatch(updateLabels, /set[\s\S]{0,80}\bvendor_id\s*=/)
  assert.match(updateLabels, /variant\.vendor_id = authorized_vendor_id/)
  assert.match(updateLabels, /when unique_violation/)
})

test("stock edits use compare-and-swap and the database-managed version", () => {
  assert.match(updateStock, /p_expected_stock_version bigint/)
  assert.match(updateStock, /variant_record\.stock_version <> p_expected_stock_version/)
  assert.match(updateStock, /return query select 'conflict'/)
  assert.match(updateStock, /variant_record\.stock = p_stock/)
  assert.match(updateStock, /return query select 'no_change'/)
  assert.match(
    updateStock,
    /set stock = p_stock\s+where variant\.id = p_variant_id\s+and variant\.stock_version = p_expected_stock_version/
  )
  assert.doesNotMatch(updateStock, /\bset\s+stock_version\s*=/)
  assert.doesNotMatch(updateStock, /update public\.products/)

  assert.deepEqual(
    applyStockUpdate({ stock: 4, stockVersion: 7 }, 6, 6),
    { outcome: "conflict", stock: 4, stockVersion: 7 }
  )
  assert.deepEqual(
    applyStockUpdate({ stock: 4, stockVersion: 7 }, 4, 7),
    { outcome: "no_change", stock: 4, stockVersion: 7 }
  )
  assert.deepEqual(
    applyStockUpdate({ stock: 4, stockVersion: 7 }, 6, 7),
    { outcome: "updated", stock: 6, stockVersion: 8 }
  )
})

test("variant removal is locked, versioned, owned, and history-safe", () => {
  assert.match(deleteVariant, /variant\.vendor_id = authorized_vendor_id/)
  assert.match(deleteVariant, /for update;/)
  assert.match(deleteVariant, /variant_record\.stock_version <> p_expected_stock_version/)
  assert.match(
    deleteVariant,
    /from public\.order_items as item\s+where item\.product_variant_id = p_variant_id/
  )
  assert.match(deleteVariant, /'historical_reference'/)
  assert.match(deleteVariant, /when foreign_key_violation/)
  assert.match(
    deleteVariant,
    /delete from public\.product_variants as variant\s+where variant\.id = p_variant_id\s+and variant\.stock_version = p_expected_stock_version/
  )
})

test("parent stock stays zero for every variant management operation", () => {
  for (const [name, source] of [
    ["configure", configure],
    ["create", createVariant],
    ["labels", updateLabels],
    ["stock", updateStock],
    ["delete", deleteVariant],
  ]) {
    assert.doesNotMatch(source, /update public\.products[\s\S]*set stock\s*=/, name)
  }
  assert.match(foundation, /check \(variant_mode = 'none' or stock = 0\)/)
})

test("ordinary product checkout behavior remains source-compatible", () => {
  assert.match(
    checkout,
    /\.select\("id, vendor_id, price_text:price::text, stock, is_active"\)/
  )
  assert.match(checkout, /product\.is_active !== true/)
  assert.match(checkout, /stock < cartItem\.quantity/)
  assert.match(checkout, /\.from\("order_items"\)\s*\.insert\(orderItems\)/)
  assert.doesNotMatch(checkout, /product_variant_id|variant_size_snapshot|variant_colour_snapshot/)
  assert.doesNotMatch(migration, /create or replace function public\.finalize_paystack_paid_order/)
  assert.doesNotMatch(migration, /create or replace function public\.decrement_stock/)
})

test("Ops 4 definitions are pinned and remain outside this migration", () => {
  assert.match(preflight, /37c763494aed0f4e13daa004b88b6dee/)
  assert.match(preflight, /0094f1ea6602edbfe18ac8f9619677b8/)
  assert.match(postcondition, /37c763494aed0f4e13daa004b88b6dee/)
  assert.match(preflight, /marketa\.variant_2b1\.decrement_hash/)
  assert.match(postcondition, /marketa\.variant_2b1\.decrement_hash/)
  assert.match(migration, /\), 'absent'\)/)
  assert.match(finalizer, /create or replace function public\.finalize_paystack_paid_order/)
  assert.doesNotMatch(
    migration,
    /create (?:or replace )?function public\.decrement_stock/
  )
  assert.doesNotMatch(
    migration,
    /create or replace function public\.finalize_paystack_paid_order/
  )
})

test("legacy decrement_stock remains replay-safe when absent", () => {
  assert.match(
    preflight,
    /where procedure\.oid = pg_catalog\.to_regprocedure\(\s*'public\.decrement_stock\(uuid,integer\)'\s*\)/
  )
  assert.match(preflight, /\), 'absent'\)/)
  assert.match(postcondition, /\), 'absent'\)/)
  assert.doesNotMatch(migration, /create .*decrement_stock/i)
  assert.doesNotMatch(migration, /alter function public\.decrement_stock/i)
  assert.doesNotMatch(migration, /grant .*decrement_stock/i)
})

test("migration snapshots policies and business rows and creates no initial variants", () => {
  for (const key of [
    "products_rows",
    "order_items_rows",
    "orders_rows",
    "payout_rows",
    "product_policies",
    "variant_policies",
  ]) {
    assert.match(preflight, new RegExp(`marketa\\.variant_2b1\\.${key}`))
    assert.match(postcondition, new RegExp(`marketa\\.variant_2b1\\.${key}`))
  }
  assert.match(postcondition, /where product\.variant_mode <> 'none'/)
  assert.match(postcondition, /exists \(select 1 from public\.product_variants\)/)
  assert.doesNotMatch(
    between(migration, "begin;", "create function public.configure_vendor_product_variant_mode"),
    /insert into public\.product_variants/
  )
})

test("backend adds no variant pricing, SKU, reservation, or customer purchase path", () => {
  const rpcSources = [
    configure,
    createVariant,
    updateLabels,
    updateStock,
    deleteVariant,
  ].join("\n")
  assert.doesNotMatch(rpcSources, /variant_price|\bsku\b|reservation|reserved_stock/i)
  assert.doesNotMatch(rpcSources, /customer|cart|paystack|authorization_url/i)
  assert.doesNotMatch(
    between(migration, "grant execute on function", "do $postcondition$"),
    /to\s+(?:anon|public|service_role)\b/i
  )
  assert.equal(
    (migration.match(/create (?:or replace )?function public\./g) ?? []).length,
    6
  )
})

test("controlled outcomes cover validation, ownership, conflict, and success", () => {
  for (const outcome of [
    "access_denied",
    "invalid_input",
    "not_found",
    "invalid_state",
    "operation_failed",
    "configured",
    "created",
    "updated",
    "deleted",
    "duplicate_combination",
    "conflict",
    "no_change",
    "order_history_exists",
    "historical_reference",
  ]) {
    assert.match(migration, new RegExp(`'${outcome}'`), outcome)
  }
})
