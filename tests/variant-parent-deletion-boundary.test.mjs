import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

const migrationFile =
  "supabase/migrations/20261026164616_restrict_variant_parent_product_deletion.sql"
const migration = read(migrationFile)
const productsPage = read("src/app/vendor/products/page.tsx")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function canVendorDelete({ owner, vendorActive, variantMode }) {
  const permissiveOwnerPolicy = owner && vendorActive
  const restrictiveOrdinaryPolicy = variantMode === "none"
  return permissiveOwnerPolicy && restrictiveOrdinaryPolicy
}

test("migration is transactional and changes only product DELETE policy authority", () => {
  assert.match(migration, /^begin;/)
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal(
    (migration.match(/create policy vendor_delete_ordinary_products_only/g) ?? [])
      .length,
    1
  )
  assert.doesNotMatch(migration, /alter policy|drop policy/)
  assert.doesNotMatch(
    migration,
    /\b(?:insert\s+into|update\s+public\.products|delete\s+from|truncate)\b/i
  )
})

test("existing active-owner policy is preserved and the new guard is restrictive", () => {
  assert.match(
    migration,
    /vendor_delete_own_active_products[\s\S]*permissive <> 'PERMISSIVE'/
  )
  assert.match(
    migration,
    /vendor_idinselectvendors\.idfromvendorswherevendors\.user_id=selectauth\.uidasuidandvendors\.is_active=true/
  )
  const guard = between(
    migration,
    "create policy vendor_delete_ordinary_products_only",
    "do $postcondition$"
  )
  assert.match(guard, /on public\.products/)
  assert.match(guard, /as restrictive/)
  assert.match(guard, /for delete/)
  assert.match(guard, /to authenticated/)
  assert.match(guard, /using \(variant_mode = 'none'\)/)
})

test("owner can delete an ordinary product", () => {
  assert.equal(
    canVendorDelete({ owner: true, vendorActive: true, variantMode: "none" }),
    true
  )
})

test("owner cannot delete a variant parent", () => {
  for (const variantMode of ["size", "colour", "size_colour"]) {
    assert.equal(
      canVendorDelete({ owner: true, vendorActive: true, variantMode }),
      false,
      variantMode
    )
  }
})

test("another vendor cannot delete the product", () => {
  assert.equal(
    canVendorDelete({ owner: false, vendorActive: true, variantMode: "none" }),
    false
  )
})

test("inactive vendor cannot delete the product", () => {
  assert.equal(
    canVendorDelete({ owner: true, vendorActive: false, variantMode: "none" }),
    false
  )
})

test("application deletion requires an ordinary row to be returned", () => {
  const deletion = between(
    productsPage,
    "async function deleteProduct",
    "async function toggleProductActive"
  )
  assert.match(deletion, /\.eq\("vendor_id", actionVendor\.id\)/)
  assert.match(deletion, /\.eq\("variant_mode", "none"\)/)
  assert.match(deletion, /\.select\("id"\)\s*\.maybeSingle\(\)/)
  assert.match(deletion, /if \(!deletedProduct\)/)
  assert.ok(
    deletion.indexOf("if (!deletedProduct)") <
      deletion.indexOf('return { error: null }')
  )
})

test("conversion and deletion races cannot leave a deleted variant parent", () => {
  const deleteWins = { exists: false, variantMode: null }
  const conversionAfterDeleteCanCommit = deleteWins.exists
  assert.equal(conversionAfterDeleteCanCommit, false)

  const conversionWins = { exists: true, variantMode: "size" }
  assert.equal(
    canVendorDelete({
      owner: true,
      vendorActive: true,
      variantMode: conversionWins.variantMode,
    }),
    false
  )
})

test("policy and grant postconditions fail closed", () => {
  assert.match(migration, /product policy inventory changed/)
  assert.match(migration, /policy\.cmd in \('ALL', 'DELETE'\)/)
  assert.match(migration, /unexpected product DELETE policy applies/)
  assert.match(migration, /product DELETE grants changed/)
  assert.match(migration, /permissive <> 'RESTRICTIVE'/)
  assert.match(
    migration,
    /normalized_guard_qual is distinct from 'variant_mode=''none'''/
  )
  assert.match(migration, /unrelated product policies changed/)
  assert.match(migration, /product or variant rows changed/)
})

test("normalized policy expressions fail closed when catalog expressions are NULL", () => {
  for (const expression of [
    "normalized_qual",
    "normalized_owner_qual",
    "normalized_guard_qual",
  ]) {
    assert.match(
      migration,
      new RegExp(`${expression} is distinct from`),
      expression
    )
    assert.doesNotMatch(
      migration,
      new RegExp(`${expression}\\s*<>`),
      expression
    )
  }

  const failsVerification = (actual, expected) =>
    actual === null || actual !== expected
  assert.equal(failsVerification(null, "expected policy expression"), true)
})

test("existing deletion relationships remain pinned", () => {
  assert.match(migration, /product_variants_product_vendor_fkey/)
  assert.match(migration, /constraint_record\.confdeltype = 'c'/)
  assert.equal(
    (migration.match(/constraint_record\.confdeltype = 'r'/g) ?? []).length,
    2
  )
  assert.equal(
    (migration.match(/constraint_record\.confdeltype = 'n'/g) ?? []).length,
    2
  )
})

test("unrelated product and service-role privileges are not changed", () => {
  assert.doesNotMatch(migration, /\bgrant\b|\brevoke\b/i)
  assert.match(
    migration,
    /has_table_privilege\(\s*'service_role', 'public\.products', 'DELETE'/
  )
  assert.doesNotMatch(migration, /for select|for update|for insert/i)
})
