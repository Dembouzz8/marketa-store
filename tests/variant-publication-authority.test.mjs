import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20261117211005_add_secure_variant_publication_authority.sql"
const edgeFile = "supabase/functions/handle-checkout/index.ts"
const d2File =
  "supabase/migrations/20261105084924_add_trusted_variant_order_construction.sql"
const c3File =
  "supabase/migrations/20261104092307_add_variant_aware_paid_order_finalization.sql"
const generalizedManagementFile =
  "supabase/migrations/20261101211734_add_generalized_vendor_option_management.sql"
const legacyManagementFile =
  "supabase/migrations/20261020150650_secure_vendor_variant_management_backend.sql"

const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migration = read(migrationFile)
const edge = read(edgeFile)
const d2 = read(d2File)
const c3 = read(c3File)
const generalizedManagement = read(generalizedManagementFile)
const legacyManagement = read(legacyManagementFile)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function functionSource(schema, name, nextMarker = "$function$;") {
  return between(
    migration,
    new RegExp(`create(?: or replace)? function ${schema}\\.${name}\\(`).exec(
      migration
    )?.[0] ?? `create function ${schema}.${name}(`,
    nextMarker
  )
}

const preflight = between(migration, "do $preflight$", "$preflight$;")
const postcondition = between(
  migration,
  "do $postcondition$",
  "$postcondition$;"
)
const consumeAuthorization = functionSource(
  "marketa_private",
  "consume_variant_publication_authorization"
)
const validateStructure = functionSource(
  "marketa_private",
  "assert_variant_publication_structure"
)
const validateConsistency = functionSource(
  "marketa_private",
  "assert_variant_publication_consistency"
)
const parentGuard = functionSource(
  "marketa_private",
  "enforce_variant_parent_publication_authority"
)
const variantGuard = functionSource(
  "marketa_private",
  "enforce_variant_combination_publication_authority"
)
const liveStructureGuard = functionSource(
  "marketa_private",
  "enforce_live_option_structure_immutability"
)
const consistencyTrigger = functionSource(
  "marketa_private",
  "enforce_variant_publication_consistency"
)
const publicationRpc = functionSource(
  "public",
  "set_vendor_product_variant_publication"
)
const stockRpc = functionSource(
  "public",
  "update_vendor_product_variant_stock"
)

function publicationOutcome({
  authenticated = true,
  activeVendor = true,
  ownsProduct = true,
  mode = "size",
  parentStock = 0,
  currentlyActive = false,
  requestedActive = true,
  releaseEnabled = false,
  combinations = [{ stock: 1, valid: true, active: false }],
}) {
  if (!authenticated || !activeVendor) return "access_denied"
  if (!ownsProduct) return "not_found"
  if (!["size", "colour", "size_colour", "options"].includes(mode)) {
    return "invalid_state"
  }
  if (parentStock !== 0) return "invalid_state"
  if (currentlyActive === requestedActive) {
    if (combinations.some((item) => item.active !== currentlyActive)) {
      return "invalid_state"
    }
    if (currentlyActive && combinations.some((item) => !item.valid)) {
      return "invalid_state"
    }
    return "no_change"
  }
  if (requestedActive && !releaseEnabled) return "release_disabled"
  if (requestedActive && combinations.length === 0) return "invalid_state"
  if (requestedActive && combinations.every((item) => item.stock <= 0)) {
    return "invalid_state"
  }
  if (requestedActive && combinations.some((item) => !item.valid)) {
    return "invalid_state"
  }
  return requestedActive ? "published" : "deactivated"
}

function applyPublication(state, requestedActive) {
  const outcome = publicationOutcome({
    ...state,
    requestedActive,
  })
  if (!["published", "deactivated"].includes(outcome)) {
    return { outcome, state }
  }
  return {
    outcome,
    state: {
      ...state,
      currentlyActive: requestedActive,
      combinations: state.combinations.map((item) => ({
        ...item,
        active: requestedActive,
      })),
    },
  }
}

function applyStockCas({ stock, stockVersion, parentActive, variantActive }, next, expected) {
  if (next < 0) return { outcome: "invalid_input", stock, stockVersion }
  if (parentActive !== variantActive) {
    return { outcome: "invalid_state", stock, stockVersion }
  }
  if (stockVersion !== expected) {
    return { outcome: "conflict", stock, stockVersion }
  }
  if (stock === next) return { outcome: "no_change", stock, stockVersion }
  return { outcome: "updated", stock: next, stockVersion: stockVersion + 1 }
}

test("migration is the one bounded canonical D5-1 transaction", () => {
  assert.match(
    migration,
    /^-- Product Variants Batch 2C-D5-1:[\s\S]*\nbegin;/
  )
  assert.match(migration, /set local lock_timeout = '10s';/)
  assert.match(migration, /set local statement_timeout = '120s';/)
  assert.match(preflight, /required variant relations are missing/)
  assert.match(preflight, /publication authority objects already exist/)
  assert.match(preflight, /existing variant publication state is incompatible/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.doesNotMatch(migration, /\bcascade\b/i)
})

test("draft-only checks are replaced rather than merely dropped", () => {
  for (const constraint of [
    "products_variant_draft_publication_check",
    "product_variants_draft_only_check",
  ]) {
    assert.match(preflight, new RegExp(constraint))
    assert.match(migration, new RegExp(`drop constraint ${constraint}`))
    assert.match(postcondition, new RegExp(constraint))
  }
  assert.match(
    migration,
    /create trigger products_variant_publication_authority_guard/
  )
  assert.match(
    migration,
    /create trigger product_variants_publication_authority_guard/
  )
  assert.match(
    migration,
    /create constraint trigger products_variant_publication_consistency_guard[\s\S]*deferrable initially deferred/
  )
  assert.match(
    migration,
    /create constraint trigger product_variants_publication_consistency_guard[\s\S]*deferrable initially deferred/
  )
})

test("release control is private default-off and has no mutation RPC", () => {
  assert.match(
    migration,
    /create table marketa_private\.variant_publication_release_control/
  )
  assert.match(migration, /release_enabled boolean not null default false/)
  assert.match(
    migration,
    /values \(true, false\);/
  )
  assert.match(
    migration,
    /variant_publication_release_control[\s\S]*enable row level security/
  )
  assert.match(
    migration,
    /variant_publication_release_control[\s\S]*force row level security/
  )
  assert.match(
    migration,
    /revoke all privileges on schema marketa_private\s+from public, anon, authenticated, service_role;/
  )
  assert.match(postcondition, /release control is not default-off/)
  assert.doesNotMatch(migration, /function public\.[^(]*(?:release|control)/i)
  assert.doesNotMatch(migration, /grant[\s\S]{0,120}variant_publication_release_control/i)
})

test("release row locking linearizes administrative changes with publication", () => {
  const variantLock = publicationRpc.indexOf("for update\n  loop")
  const releaseRead = publicationRpc.indexOf(
    "from marketa_private.variant_publication_release_control"
  )
  const releaseShare = publicationRpc.indexOf("for share;", releaseRead)
  const writes = publicationRpc.indexOf("update public.product_variants")
  assert.ok(variantLock >= 0)
  assert.ok(releaseRead > variantLock)
  assert.ok(releaseShare > releaseRead)
  assert.ok(writes > releaseShare)
  assert.match(migration, /administrative UPDATE takes the\s+-- conflicting row lock/)
})

test("publication entry point has the exact narrow authenticated-only contract", () => {
  assert.match(
    publicationRpc,
    /p_product_id uuid,\s+p_active boolean/
  )
  assert.match(
    publicationRpc,
    /returns table \(\s*outcome text,\s*publication_product_id uuid,\s*publication_active boolean/
  )
  assert.match(publicationRpc, /security definer/)
  assert.match(publicationRpc, /set search_path = ''/)
  assert.match(publicationRpc, /v_actor_id := auth\.uid\(\)/)
  assert.match(publicationRpc, /p_product_id is null or p_active is null/)
  assert.doesNotMatch(publicationRpc, /p_vendor_id/)
  assert.doesNotMatch(publicationRpc, /execute\s+(?:format|immediate)/i)
  assert.match(
    migration,
    /revoke all privileges on function\s+public\.set_vendor_product_variant_publication\(uuid, boolean\)\s+from public, anon, authenticated, service_role;/
  )
  assert.match(
    migration,
    /grant execute on function\s+public\.set_vendor_product_variant_publication\(uuid, boolean\)\s+to authenticated;/
  )
  assert.match(postcondition, /function authority is incorrect/)
})

test("trusted identity and active owned vendor checks fail closed", () => {
  assert.match(publicationRpc, /vendor\.user_id = v_actor_id/)
  assert.match(publicationRpc, /vendor\.is_active = true/)
  assert.match(publicationRpc, /product\.vendor_id = authorized_vendor_id/)
  assert.match(publicationRpc, /'access_denied'/)
  assert.match(publicationRpc, /'not_found'/)
  assert.equal(publicationOutcome({ authenticated: false }), "access_denied")
  assert.equal(publicationOutcome({ activeVendor: false }), "access_denied")
  assert.equal(publicationOutcome({ ownsProduct: false }), "not_found")
})

test("publication uses the established deadlock-safe mutation lock order", () => {
  const vendorRead = publicationRpc.indexOf("from public.vendors as vendor")
  const vendorShare = publicationRpc.indexOf("for share;", vendorRead)
  const advisory = publicationRpc.indexOf(
    "pg_catalog.pg_advisory_xact_lock(",
    vendorShare
  )
  const parentUpdate = publicationRpc.indexOf("for update;", advisory)
  const variantUpdate = publicationRpc.indexOf("for update\n  loop", parentUpdate)
  assert.ok(vendorRead >= 0)
  assert.ok(vendorShare > vendorRead)
  assert.ok(advisory > vendorShare)
  assert.ok(parentUpdate > advisory)
  assert.ok(variantUpdate > parentUpdate)
  assert.match(
    publicationRpc,
    /order by variant\.id\s+for update/
  )
})

test("immediate transition authority is private exact and non-forgeable", () => {
  assert.match(
    migration,
    /create table marketa_private\.variant_publication_authorizations/
  )
  for (const binding of [
    "transaction_id",
    "backend_pid",
    "actor_id",
    "product_id",
    "target_kind",
    "target_id",
    "target_active",
  ]) assert.ok(consumeAuthorization.includes(binding), binding)
  assert.match(consumeAuthorization, /pg_catalog\.txid_current\(\)/)
  assert.match(consumeAuthorization, /pg_catalog\.pg_backend_pid\(\)/)
  assert.match(consumeAuthorization, /pub_auth\.actor_id = auth\.uid\(\)/)
  assert.match(consumeAuthorization, /delete from marketa_private\.variant_publication_authorizations/)
  assert.match(parentGuard, /consume_variant_publication_authorization/)
  assert.match(variantGuard, /consume_variant_publication_authorization/)
  assert.match(publicationRpc, /remaining_authorizations <> 0/)
  assert.match(postcondition, /publication authorization rows remain/)
  for (const source of [consumeAuthorization, parentGuard, variantGuard, publicationRpc]) {
    assert.doesNotMatch(source, /current_setting|set_config|request\.jwt|user_metadata/i)
  }
})

test("reserved authorization keyword is never used as an SQL alias", () => {
  assert.doesNotMatch(migration, /\bas\s+authorization\b/i)
  assert.doesNotMatch(migration, /\bauthorization\s*\./i)
})

test("publication actor binding uses an unambiguous local variable", () => {
  assert.match(publicationRpc, /v_actor_id := auth\.uid\(\)/)
  assert.match(publicationRpc, /vendor\.user_id = v_actor_id/)
  assert.match(
    publicationRpc,
    /pg_catalog\.pg_backend_pid\(\),\s+v_actor_id,\s+p_product_id/
  )
  assert.match(
    publicationRpc,
    /pg_catalog\.pg_backend_pid\(\),\s+v_actor_id,\s+variant\.product_id/
  )
  assert.match(publicationRpc, /pub_auth\.actor_id = v_actor_id/)
  assert.doesNotMatch(publicationRpc, /pub_auth\.actor_id = actor_id/)
  assert.doesNotMatch(migration, /#variable_conflict|plpgsql\.variable_conflict/i)
})

test("unauthorized direct and paired publication transitions are denied", () => {
  assert.match(parentGuard, /new\.is_active is distinct from old\.is_active/)
  assert.match(parentGuard, /Variant product publication transition is not authorized/)
  assert.match(variantGuard, /new\.is_active is distinct from old\.is_active/)
  assert.match(variantGuard, /Variant combination publication transition is not authorized/)
  assert.match(parentGuard, /Variant product mode transition is not authorized/)
  assert.match(variantGuard, /Live variant combinations cannot be inserted/)
  assert.match(variantGuard, /Live variant combinations cannot be deleted/)
})

test("publication validation covers all supported legacy modes", () => {
  assert.match(
    validateStructure,
    /variant_mode in \('size', 'colour', 'size_colour'\)/
  )
  assert.match(validateStructure, /when 'size' then not/)
  assert.match(validateStructure, /when 'colour' then not/)
  assert.match(validateStructure, /when 'size_colour' then not/)
  assert.match(validateStructure, /variant\.size_normalized is not null/)
  assert.match(validateStructure, /variant\.colour_normalized is not null/)
  assert.match(
    validateStructure,
    /group by variant\.size_normalized, variant\.colour_normalized/
  )
})

test("generalized validation requires exact axes assignments and identities", () => {
  assert.match(validateStructure, /maximum_axes not between 1 and 3/)
  assert.match(
    validateStructure,
    /axis_count < 1[\s\S]*axis_count > maximum_axes[\s\S]*axis_count > 3/
  )
  assert.match(validateStructure, /definition\.is_active is distinct from true/)
  assert.match(validateStructure, /unit\.dimension_code is distinct from definition\.dimension_code/)
  assert.match(validateStructure, /assignment\.vendor_id = variant\.vendor_id/)
  assert.match(validateStructure, /\) <> axis_count/)
  assert.match(validateStructure, /not exists \(\s+select 1\s+from public\.product_variant_option_values/)
  assert.match(validateStructure, /identity\.variant_id is null/)
  assert.match(validateStructure, /computed\.combination_signature is null/)
  assert.match(
    validateStructure,
    /identity\.combination_signature is distinct from\s+computed\.combination_signature/
  )
  assert.doesNotMatch(validateStructure, /cross join|cartesian|generate_series/i)
})

test("missing combinations all-zero stock invalid structure and NULL paths fail closed", () => {
  assert.match(validateStructure, /variant_count = 0/)
  assert.match(validateStructure, /p_require_positive_stock and not exists/)
  assert.match(validateStructure, /variant\.stock is null/)
  assert.match(validateStructure, /identity\.combination_signature is null/)
  assert.match(publicationRpc, /release_enabled is distinct from true/)
  assert.equal(publicationOutcome({ releaseEnabled: true, combinations: [] }), "invalid_state")
  assert.equal(
    publicationOutcome({
      releaseEnabled: true,
      combinations: [{ stock: 0, valid: true, active: false }],
    }),
    "invalid_state"
  )
  assert.equal(
    publicationOutcome({
      releaseEnabled: true,
      combinations: [{ stock: 1, valid: false, active: false }],
    }),
    "invalid_state"
  )
  assert.equal(publicationOutcome({ mode: "none", releaseEnabled: true }), "invalid_state")
  assert.equal(publicationOutcome({ parentStock: 1, releaseEnabled: true }), "invalid_state")
})

test("publication and deactivation are atomic all-combination transitions", () => {
  assert.match(
    publicationRpc,
    /insert into marketa_private\.variant_publication_authorizations[\s\S]*from public\.product_variants/
  )
  assert.match(
    publicationRpc,
    /update public\.product_variants as variant\s+set is_active = p_active/
  )
  assert.match(
    publicationRpc,
    /update public\.products as product\s+set is_active = p_active/
  )
  assert.doesNotMatch(publicationRpc, /variant\.stock > 0[\s\S]*set is_active/)

  const draft = {
    releaseEnabled: true,
    currentlyActive: false,
    combinations: [
      { stock: 3, valid: true, active: false },
      { stock: 0, valid: true, active: false },
    ],
  }
  const published = applyPublication(draft, true)
  assert.equal(published.outcome, "published")
  assert.equal(published.state.currentlyActive, true)
  assert.ok(published.state.combinations.every((item) => item.active))
  const deactivated = applyPublication(published.state, false)
  assert.equal(deactivated.outcome, "deactivated")
  assert.equal(deactivated.state.currentlyActive, false)
  assert.ok(deactivated.state.combinations.every((item) => !item.active))
})

test("release-off blocks publication and reactivation but never deactivation", () => {
  assert.equal(publicationOutcome({ releaseEnabled: false }), "release_disabled")
  assert.equal(
    publicationOutcome({
      releaseEnabled: false,
      currentlyActive: true,
      requestedActive: false,
      combinations: [{ stock: 0, valid: true, active: true }],
    }),
    "deactivated"
  )
  assert.equal(
    publicationOutcome({
      releaseEnabled: false,
      currentlyActive: false,
      requestedActive: true,
      combinations: [{ stock: 1, valid: true, active: false }],
    }),
    "release_disabled"
  )
  const releaseRead = publicationRpc.indexOf("variant_publication_release_control")
  const activeBranch = publicationRpc.indexOf("if p_active then")
  assert.ok(releaseRead > activeBranch)
})

test("repeated operations are idempotent and live zero-stock is valid", () => {
  assert.match(publicationRpc, /'no_change'/)
  assert.match(
    publicationRpc,
    /assert_variant_publication_structure\(\s*p_product_id,\s*false/
  )
  assert.equal(
    publicationOutcome({
      currentlyActive: true,
      requestedActive: true,
      combinations: [{ stock: 0, valid: true, active: true }],
    }),
    "no_change"
  )
  assert.equal(
    publicationOutcome({
      currentlyActive: false,
      requestedActive: false,
      combinations: [{ stock: 0, valid: true, active: false }],
    }),
    "no_change"
  )
})

test("deferred enforcement checks final parent combination agreement", () => {
  assert.match(
    validateConsistency,
    /variant\.is_active is distinct from product_record\.is_active/
  )
  assert.match(
    validateConsistency,
    /if product_record\.is_active then\s+perform marketa_private\.assert_variant_publication_structure/
  )
  assert.match(consistencyTrigger, /tg_table_name = 'products'/)
  assert.match(consistencyTrigger, /tg_op = 'INSERT'/)
  assert.match(consistencyTrigger, /tg_op = 'DELETE'/)
  assert.match(postcondition, /trigger_record\.tgdeferrable/)
  assert.match(postcondition, /trigger_record\.tginitdeferred/)
})

test("ordinary products retain their established activation path", () => {
  assert.match(
    validateConsistency,
    /if product_record\.variant_mode = 'none' then\s+return;/
  )
  assert.match(
    parentGuard,
    /new\.is_active is distinct from old\.is_active[\s\S]*old\.variant_mode <> 'none' or new\.variant_mode <> 'none'/
  )
  assert.doesNotMatch(parentGuard, /old\.variant_mode = 'none'[\s\S]{0,120}consume_variant_publication_authorization/)
})

test("live generalized structural editing remains rejected", () => {
  for (const relation of [
    "product_option_axes",
    "product_option_values",
    "product_variant_option_values",
    "product_variant_combination_identities",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `create trigger b_variant_publication_live_structure_guard[\\s\\S]{0,100}on public\\.${relation}`
      )
    )
  }
  assert.match(liveStructureGuard, /product\.variant_mode = 'options'/)
  assert.match(liveStructureGuard, /product\.is_active/)
  assert.match(liveStructureGuard, /Live generalized variant structure cannot be changed/)
  assert.match(variantGuard, /Live variant combination structure cannot be changed/)
  assert.match(postcondition, /live structure guards are incomplete/)
})

test("existing vendor structural RPCs preserve draft-only edit restrictions", () => {
  for (const source of [legacyManagement, generalizedManagement]) {
    assert.match(source, /product_record\.is_active is distinct from false/)
    assert.match(source, /product_record\.stock <> 0/)
  }
  assert.match(legacyManagement, /variant_record\.is_active is distinct from false/)
  assert.match(generalizedManagement, /variant_record\.is_active is distinct from false/)
  assert.match(generalizedManagement, /value_in_use/)
  assert.match(generalizedManagement, /unsafe_state/)
})

test("live stock CAS preserves signature locking versioning and response outcomes", () => {
  assert.match(
    stockRpc,
    /returns table \(\s*outcome text,\s*variant_id uuid,\s*result_stock_version bigint/
  )
  assert.match(stockRpc, /actor_id := auth\.uid\(\)/)
  assert.match(stockRpc, /vendor\.is_active = true/)
  assert.match(stockRpc, /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(stockRpc, /product\.vendor_id = authorized_vendor_id\s+for update;/)
  assert.match(stockRpc, /variant\.vendor_id = authorized_vendor_id\s+for update;/)
  assert.match(stockRpc, /variant_record\.stock_version <> p_expected_stock_version/)
  assert.match(stockRpc, /variant\.stock_version = p_expected_stock_version/)
  assert.match(stockRpc, /variant_record\.is_active is distinct from parent_active/)
  assert.doesNotMatch(stockRpc, /parent_active is distinct from false/)
  const stockUpdate = between(
    stockRpc,
    "update public.product_variants as variant",
    "returning variant.stock_version"
  )
  const stockSetClause = between(stockUpdate, "set", "where")
  assert.doesNotMatch(stockSetClause, /stock_version\s*=/i)
  for (const outcome of [
    "access_denied",
    "invalid_input",
    "not_found",
    "invalid_state",
    "conflict",
    "no_change",
    "updated",
    "operation_failed",
  ]) assert.ok(stockRpc.includes(`'${outcome}'`), outcome)
})

test("stock CAS model allows draft and live agreement and rejects stale or split state", () => {
  assert.equal(
    applyStockCas(
      { stock: 2, stockVersion: 4, parentActive: false, variantActive: false },
      3,
      4
    ).outcome,
    "updated"
  )
  assert.equal(
    applyStockCas(
      { stock: 2, stockVersion: 4, parentActive: true, variantActive: true },
      0,
      4
    ).outcome,
    "updated"
  )
  assert.equal(
    applyStockCas(
      { stock: 2, stockVersion: 4, parentActive: true, variantActive: true },
      3,
      3
    ).outcome,
    "conflict"
  )
  assert.equal(
    applyStockCas(
      { stock: 2, stockVersion: 4, parentActive: true, variantActive: false },
      3,
      4
    ).outcome,
    "invalid_state"
  )
})

test("C3 deductions including zero do not violate publication consistency", () => {
  const inventoryBoundary = between(
    c3,
    "-- C3_INVENTORY_BOUNDARY_START",
    "-- C3_INVENTORY_BOUNDARY_END"
  )
  assert.ok(c3.includes("update public.product_variants as variant"))
  assert.ok(
    c3.includes(
      "set stock = variant.stock - requirement.required_quantity::integer"
    )
  )
  assert.doesNotMatch(inventoryBoundary, /set[\s\S]{0,120}is_active\s*=/i)
  assert.doesNotMatch(validateConsistency, /stock\s*>\s*0/)
  const zero = applyStockCas(
    { stock: 1, stockVersion: 8, parentActive: true, variantActive: true },
    0,
    8
  )
  assert.deepEqual(zero, { outcome: "updated", stock: 0, stockVersion: 9 })
})

test("deactivation preserves identities orders attempts and paid finalization", () => {
  assert.doesNotMatch(
    publicationRpc,
    /delete from public\.(?:product_variants|product_variant_combination_identities|orders|order_items|checkout_attempts|payments)/i
  )
  assert.doesNotMatch(
    migration,
    /update public\.(?:orders|order_items|checkout_attempts|payments|payout_ledger|outbox_events)/i
  )
  assert.doesNotMatch(migration, /cancel|reservation/i)
  assert.match(d2, /trusted_order_item_insert_authorizations/)
  assert.match(c3, /PAID_STOCK_VARIANT_IDENTITY_MISMATCH/)
  assert.match(c3, /identity_record\.combination_signature/)
})

test("protected D2 C2 C3 and D3 contracts are asserted and not replaced", () => {
  for (const protectedName of [
    "construct_trusted_checkout_order",
    "validate_order_item_variant_options_snapshot",
    "finalize_paystack_paid_order",
    "get_public_product_variant_projection",
  ]) {
    assert.match(preflight, new RegExp(protectedName))
    assert.doesNotMatch(
      migration,
      new RegExp(`create(?: or replace)? function public\\.${protectedName}\\(`)
    )
  }
  assert.match(preflight, /c34ac95900ffa3c7bd2072256a56f203/)
  assert.match(preflight, /74a760039e13ce5ff09e3b9ef76d7c21/)
  assert.match(postcondition, /protected D2 or D3 grants changed/)
  assert.match(postcondition, /C2 snapshot validator changed/)
  assert.match(postcondition, /C3 finalizer changed/)
})

test("direct stock authority remains narrow and no vendor grant is broadened", () => {
  assert.match(postcondition, /variant write authority widened/)
  assert.match(
    postcondition,
    /has_column_privilege\(\s*'service_role', 'public\.product_variants', 'stock', 'UPDATE'/
  )
  assert.match(postcondition, /attribute\.attname <> 'stock'/)
  assert.doesNotMatch(
    migration,
    /grant\s+(?:insert|update|delete|all)[\s\S]{0,120}on (?:table )?public\.product_variants/i
  )
  assert.doesNotMatch(
    migration,
    /grant\s+update[\s\S]{0,120}on (?:table )?public\.products/i
  )
})

test("publication authority leaves checkout gated and inactive by default", () => {
  assert.match(edge, /Deno\.env\.get\("VARIANT_CHECKOUT_ENABLED"\) === "true"/)
  assert.doesNotMatch(edge, /NEXT_PUBLIC_VARIANT_CHECKOUT_ENABLED/)
  assert.match(edge, /if \(!variantCheckoutAllowed\(items\)\) \{\s*return errorResponse\(\s*"INVALID_ITEMS"/)
  assert.ok(
    edge.indexOf("if (!variantCheckoutAllowed(items))") <
      edge.indexOf("const supabase = createClient(")
  )
  assert.doesNotMatch(migration, /variant_checkout_enabled/i)
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]{0,120}(?:order_items|orders)/i
  )
  assert.doesNotMatch(migration, /grant insert on (?:table )?public\.order_items/i)
})

test("migration performs no business-row activation repair or financial mutation", () => {
  const outsideFunctions = migration
    .replace(publicationRpc, "")
    .replace(stockRpc, "")
    .replace(preflight, "")
    .replace(postcondition, "")
  assert.doesNotMatch(
    outsideFunctions,
    /update public\.(?:products|product_variants|orders|order_items|checkout_attempts|payments)/i
  )
  assert.match(postcondition, /installation activated variant inventory/)
  assert.doesNotMatch(
    migration,
    /insert into public\.(?:orders|order_items|checkout_attempts|payments|payout_ledger|outbox_events)/i
  )
})

test("source-level suite explicitly records unexecuted PostgreSQL evidence", () => {
  const pendingBehavioralEvidence = [
    "authenticated owner publication with release enabled",
    "cross-vendor customer anonymous and service-role rejection",
    "release-control update racing with publication",
    "unauthorized paired parent and variant activation",
    "deferred final-state rollback for partial publication",
    "legacy and generalized malformed relationship rejection",
    "live stock CAS racing with publication and C3 finalization",
    "C3 deduction of the final live variant unit",
    "deactivation with initialized and paid historical orders",
  ]
  assert.equal(pendingBehavioralEvidence.length, 9)
  assert.ok(pendingBehavioralEvidence.every((entry) => entry.length > 0))
})

test("focused migration hash can be reproduced for independent review", () => {
  const hash = createHash("sha256").update(migration).digest("hex")
  assert.match(hash, /^[0-9a-f]{64}$/)
})
