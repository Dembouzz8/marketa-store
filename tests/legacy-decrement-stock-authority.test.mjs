import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260928120000_contain_legacy_decrement_stock_authority.sql"
const migrationSource = fs.readFileSync(path.join(root, migrationFile), "utf8")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const preflight = between(migrationSource, "do $preflight$", "$preflight$;")
const containment = between(
  migrationSource,
  "do $containment$",
  "$containment$;"
)
const functionSource = between(
  migrationSource,
  "create or replace function public.decrement_stock(",
  "\n      $function$\n    $ddl$;"
)
const postcondition = between(
  migrationSource,
  "do $postcondition$",
  "$postcondition$;"
)
const outsideFunction = migrationSource.replace(functionSource, "")

test("migration is transactional and pins the audited legacy definition", () => {
  assert.match(migrationSource, /^-- Ops 1A:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /set local search_path = pg_catalog, public/)
  assert.match(migrationSource, /do \$preflight\$/)
  assert.match(migrationSource, /do \$snapshot\$/)
  assert.match(migrationSource, /do \$containment\$/)
  assert.match(migrationSource, /do \$postcondition\$/)
  assert.match(migrationSource, /\ncommit;\s*$/)
  assert.match(
    preflight,
    /to_regprocedure\(\s*'public\.decrement_stock\(uuid,integer\)'/
  )
  assert.match(preflight, /f0b1f309f7f6b59f6e111d6dc6755962/)
  assert.match(preflight, /procedure\.prosecdef/)
  assert.match(preflight, /procedure\.proconfig is null/)
  assert.match(preflight, /decrement_stock has an unexpected overload/)
})

test("an absent legacy function is recorded as contained and remains absent", () => {
  const absentBranch = between(
    preflight,
    "if function_oid is null then",
    "else"
  )
  assert.match(absentBranch, /marketa_ops1a\.legacy_function_existed/)
  assert.match(absentBranch, /'false'/)
  assert.doesNotMatch(absentBranch, /create or replace function|alter function|grant|revoke/i)
  assert.match(
    containment,
    /if pg_catalog\.current_setting\(\s*'marketa_ops1a\.legacy_function_existed'\s*\)::boolean then/
  )
  assert.match(
    postcondition,
    /if not legacy_function_existed then[\s\S]*if function_oid is not null then[\s\S]*absent decrement_stock was unexpectedly created/
  )
})

test("the exact audited legacy function is the only definition eligible for hardening", () => {
  const legacyBranch = between(
    preflight,
    "else\n    if not exists (",
    "perform pg_catalog.set_config(\n      'marketa_ops1a.legacy_function_existed',\n      'true'"
  )
  assert.match(legacyBranch, /procedure\.proowner = 'postgres'::pg_catalog\.regrole/)
  assert.match(legacyBranch, /procedure\.prosecdef/)
  assert.match(legacyBranch, /procedure\.proconfig is null/)
  assert.match(legacyBranch, /f0b1f309f7f6b59f6e111d6dc6755962/)
  assert.match(legacyBranch, /decrement_stock grants no longer match the audited live baseline/)
  assert.match(containment, /create or replace function public\.decrement_stock/)
  assert.match(containment, /security invoker/)
  assert.match(containment, /set search_path = ''/)
})

test("an unexpected existing definition fails before mutation or ACL changes", () => {
  const definitionFailure = preflight.indexOf(
    "decrement_stock no longer matches the audited live definition"
  )
  const baselineHash = preflight.indexOf("f0b1f309f7f6b59f6e111d6dc6755962")
  const legacyExistsTrue = preflight.indexOf(
    "'marketa_ops1a.legacy_function_existed',\n      'true'"
  )

  assert.notEqual(definitionFailure, -1)
  assert.ok(baselineHash < definitionFailure)
  assert.ok(definitionFailure < legacyExistsTrue)
  assert.doesNotMatch(preflight, /alter function|grant execute|revoke all privileges/i)
  assert.match(containment, /legacy_function_existed/)
})

test("function uses invoker rights with an empty fixed search path", () => {
  assert.match(functionSource, /language plpgsql/)
  assert.match(functionSource, /volatile/)
  assert.match(functionSource, /security invoker/)
  assert.match(functionSource, /set search_path = ''/)
  assert.doesNotMatch(functionSource, /security definer/)
  assert.match(postcondition, /and not procedure\.prosecdef/)
  assert.match(
    postcondition,
    /array\['search_path=""'\]::text\[\]/
  )
  assert.match(preflight, /role\.rolname = 'service_role'/)
  assert.match(preflight, /role\.rolbypassrls/)
  assert.match(
    preflight,
    /has_table_privilege\(\s*'service_role',\s*'public\.products',\s*'SELECT'/
  )
  assert.match(
    preflight,
    /has_table_privilege\(\s*'service_role',\s*'public\.products',\s*'UPDATE'/
  )
})

test("nonpositive and null quantities fail before the product row lock or mutation", () => {
  const guardIndex = functionSource.indexOf(
    "if p_quantity is null or p_quantity <= 0 then"
  )
  const lockIndex = functionSource.indexOf("for update;")
  const updateIndex = functionSource.indexOf("update public.products")

  assert.notEqual(guardIndex, -1)
  assert.ok(guardIndex < lockIndex)
  assert.ok(guardIndex < updateIndex)
  assert.match(
    functionSource,
    /if p_quantity is null or p_quantity <= 0 then\s+return false;/
  )
})

test("positive decrements retain the row lock and bounded false outcomes", () => {
  assert.match(
    functionSource,
    /select product\.stock\s+into v_stock\s+from public\.products as product\s+where product\.id = p_product_id\s+for update;/
  )
  assert.match(
    functionSource,
    /if v_stock is null or v_stock < p_quantity then\s+return false;/
  )
  assert.match(
    functionSource,
    /update public\.products as product\s+set stock = product\.stock - p_quantity,\s+updated_at = pg_catalog\.now\(\)/
  )
  assert.match(functionSource, /return true;/)
})

test("execute authority is removed from browsers and limited to service_role", () => {
  assert.match(
    containment,
    /revoke all privileges on function public\.decrement_stock\(uuid, integer\) from public, anon, authenticated, service_role/
  )
  assert.match(
    containment,
    /grant execute on function public\.decrement_stock\(uuid, integer\) to service_role/
  )
  assert.doesNotMatch(
    containment,
    /grant execute on function public\.decrement_stock\(uuid, integer\)[\s\S]{0,80}to (?:public|anon|authenticated)/
  )
  assert.match(postcondition, /'public',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /'anon',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /'authenticated',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /'service_role',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /acl\.grantee not in \(/)
})

test("migration neither invokes the function nor changes product rows", () => {
  assert.doesNotMatch(
    outsideFunction,
    /(?:select|perform)\s+public\.decrement_stock\s*\(/i
  )
  assert.doesNotMatch(
    outsideFunction,
    /(?:update|insert\s+into|delete\s+from)\s+public\.products\b/i
  )
  assert.match(migrationSource, /lock table public\.products in share mode/)
  assert.match(migrationSource, /marketa_ops1a\.product_row_count/)
  assert.match(migrationSource, /marketa_ops1a\.product_rows/)
  assert.match(postcondition, /product rows changed during the migration/)
})

test("Batch 4A product and Batch 4B1 Storage boundaries are snapshotted unchanged", () => {
  assert.match(preflight, /Batch 4A product RLS baseline changed/)
  assert.match(preflight, /Batch 4A product activation default changed/)
  assert.match(preflight, /Batch 4A vendor activation boundary changed/)
  assert.match(preflight, /Batch 4B1 Storage boundary changed/)
  assert.match(migrationSource, /marketa_ops1a\.products_security/)
  assert.match(migrationSource, /marketa_ops1a\.storage_security/)
  assert.match(postcondition, /Batch 4A product security boundary changed/)
  assert.match(postcondition, /Batch 4B1 Storage security boundary changed/)
  assert.doesNotMatch(
    migrationSource,
    /(?:create|alter|drop)\s+policy\b/i
  )
  assert.doesNotMatch(migrationSource, /alter\s+table\s+(?:public\.products|public\.vendors|storage\.objects)/i)
})

test("migration stays outside checkout, payment, payout, refund, and workflow code", () => {
  for (const forbidden of [
    "handle-checkout",
    "paystack",
    "payment_status",
    "payout",
    "refund",
    "n8n",
    "vendor_verifications",
    "orders",
  ]) {
    assert.equal(migrationSource.toLowerCase().includes(forbidden), false, forbidden)
  }
})
