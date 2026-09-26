import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260926231820_add_vendor_activation_authority.sql"
const testFile = "tests/vendor-activation-authority.test.mjs"
const migrationSource = fs.readFileSync(path.join(root, migrationFile), "utf8")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const preflight = between(migrationSource, "do $preflight$", "$preflight$;")
const snapshot = between(migrationSource, "do $snapshot$", "$snapshot$;")
const functionSource = between(
  migrationSource,
  "create function public.activate_vendor_application(",
  "$function$;"
)
const postcondition = between(
  migrationSource,
  "do $postcondition$",
  "$postcondition$;"
)
const schemaChange = between(
  migrationSource,
  "alter table public.vendors",
  "create function public.activate_vendor_application("
)
const outsideFunction = migrationSource.replace(functionSource, "")

test("migration is transactional and fails closed against the audited baseline", () => {
  assert.match(migrationSource, /^-- Batch 4C1:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /set local search_path = pg_catalog, public/)
  assert.match(migrationSource, /do \$preflight\$/)
  assert.match(migrationSource, /do \$postcondition\$/)
  assert.match(migrationSource, /\ncommit;\s*$/)
  assert.match(preflight, /class\.relname = 'vendors'[\s\S]*class\.relrowsecurity/)
  assert.match(preflight, /'public\.vendor_applications'::pg_catalog\.regclass/)
  assert.match(preflight, /'public\.admin_users'::pg_catalog\.regclass/)
  assert.match(preflight, /attribute\.attname = 'is_active'/)
  assert.match(preflight, /attribute\.atttypid = 'boolean'::pg_catalog\.regtype/)
  assert.match(preflight, /attribute\.attnotnull/)
  assert.match(preflight, /\) = 'false'/)
  assert.match(preflight, /vendors\.user_id is not the expected NOT NULL unique UUID/)
  assert.match(preflight, /vendor_applications_provisioned_check/)
  assert.match(preflight, /auth_user_id IS NOT NULL/)
  assert.match(preflight, /vendor_id IS NOT NULL/)
  assert.match(preflight, /provisioned_at IS NOT NULL/)
  assert.match(preflight, /Batch 4A product RLS baseline changed/)
  assert.match(preflight, /Batch 4B1 Storage RLS baseline changed/)
})

test("migration adds nullable unlinked audit columns with no defaults or backfill", () => {
  assert.match(
    migrationSource,
    /alter table public\.vendors\s+add column activated_at timestamptz,\s+add column activated_by uuid,/
  )
  assert.doesNotMatch(
    migrationSource,
    /add column activated_(?:at|by)[^,;\n]*\bdefault\b/i
  )
  assert.doesNotMatch(
    migrationSource,
    /activated_by[^,;\n]*references|foreign key\s*\(\s*activated_by\s*\)/i
  )
  assert.doesNotMatch(
    schemaChange,
    /update\s+public\.vendors|insert\s+into\s+public\.vendors|delete\s+from\s+public\.vendors/i
  )
  assert.match(snapshot, /marketa_batch4c1\.vendor_rows/)
  assert.match(postcondition, /existing vendor rows were rewritten/)
})

test("activation audit fields have a validated pair-consistency constraint", () => {
  assert.match(
    migrationSource,
    /constraint vendors_activation_audit_pair_check\s+check \(\s*\(\s*activated_at is null\s+and activated_by is null\s*\)\s*or \(\s*activated_at is not null\s+and activated_by is not null/s
  )
  assert.match(postcondition, /vendors_activation_audit_pair_check/)
  assert.match(postcondition, /constraint_record\.convalidated/)
  assert.match(
    postcondition,
    /activated_atisnullandactivated_byisnulloractivated_atisnotnullandactivated_byisnotnull/
  )
  assert.doesNotMatch(
    schemaChange,
    /is_active[^\n]{0,100}activated_(?:at|by)|activated_(?:at|by)[^\n]{0,100}is_active/
  )
})

test("RPC has the exact approved signature and bounded result contract", () => {
  assert.match(
    functionSource,
    /p_application_id uuid,\s+p_admin_user_id uuid\s*\)/
  )
  assert.match(
    functionSource,
    /returns table \(\s*outcome text,\s*application_id uuid,\s*vendor_id uuid,\s*is_active boolean,\s*activated_at timestamptz\s*\)/
  )
  assert.match(functionSource, /language plpgsql/)
  assert.match(functionSource, /security definer/)
  assert.match(functionSource, /set search_path = ''/)
  assert.doesNotMatch(functionSource, /\bexecute\b|format\s*\(/i)

  for (const outcome of [
    "activated",
    "already_active",
    "unauthorized",
    "invalid_input",
    "unavailable",
    "invalid_state",
    "operation_failed",
  ]) {
    assert.match(functionSource, new RegExp(`outcome := '${outcome}'`))
  }
})

test("RPC independently authorizes and locks current admin membership", () => {
  assert.match(
    functionSource,
    /if p_application_id is null or p_admin_user_id is null then[\s\S]*outcome := 'invalid_input'/
  )
  assert.match(functionSource, /from public\.admin_users as administrator/)
  assert.match(functionSource, /administrator\.user_id = p_admin_user_id/)
  assert.match(functionSource, /for share/)
  assert.match(functionSource, /if not found then[\s\S]*outcome := 'unauthorized'/)
})

test("RPC locks the application and derives and locks its linked vendor", () => {
  assert.match(
    functionSource,
    /from public\.vendor_applications as application[\s\S]*application\.id = p_application_id[\s\S]*for update/
  )
  assert.match(
    functionSource,
    /from public\.vendors as vendor[\s\S]*vendor\.id = v_application\.vendor_id[\s\S]*for update/
  )
  assert.doesNotMatch(functionSource, /p_vendor_id/)
  assert.match(functionSource, /v_vendor\.id is distinct from v_application\.vendor_id/)
  assert.match(functionSource, /v_vendor\.user_id is null/)
  assert.match(
    functionSource,
    /v_vendor\.user_id is distinct from v_application\.auth_user_id/
  )
})

test("RPC requires the exact approved and provisioned activation tuple", () => {
  assert.match(functionSource, /v_application\.status <> 'approved'/)
  assert.match(
    functionSource,
    /v_application\.provisioning_status <> 'provisioned'/
  )
  assert.match(functionSource, /v_application\.vendor_id is null/)
  assert.match(functionSource, /v_application\.auth_user_id is null/)
  assert.match(functionSource, /v_application\.provisioned_at is null/)
  assert.match(functionSource, /where vendor\.id = v_application\.vendor_id/)
})

test("successful activation atomically writes only activation state and audit fields", () => {
  assert.match(functionSource, /if v_vendor\.is_active then/)
  assert.match(
    functionSource,
    /v_activated_at := pg_catalog\.transaction_timestamp\(\)/
  )
  assert.match(
    functionSource,
    /update public\.vendors as vendor\s+set is_active = true,\s+activated_at = v_activated_at,\s+activated_by = p_admin_user_id/
  )
  assert.match(
    functionSource,
    /returning\s+vendor\.id,\s+vendor\.is_active,\s+vendor\.activated_at\s+into vendor_id, is_active, activated_at/
  )
  assert.match(functionSource, /outcome := 'activated'/)
  assert.match(
    functionSource,
    /exception\s+when others then[\s\S]*outcome := 'operation_failed'/
  )
  assert.doesNotMatch(functionSource, /sqlerrm|sqlstate(?!\s+'P1001')/i)
})

test("already-active behavior is idempotent and preserves legacy audit metadata", () => {
  const branch = between(
    functionSource,
    "if v_vendor.is_active then",
    "end if;"
  )
  assert.match(branch, /outcome := 'already_active'/)
  assert.match(branch, /activated_at := v_vendor\.activated_at/)
  assert.doesNotMatch(branch, /update|activated_by\s*:=|activated_at\s*:=\s*pg_catalog/)
})

test("RPC and migration preserve all frozen data boundaries", () => {
  for (const forbidden of [
    "vendor_verifications",
    "products",
    "storage.",
    "orders",
    "payout",
    "checkout",
  ]) {
    assert.equal(functionSource.toLowerCase().includes(forbidden), false, forbidden)
  }
  assert.doesNotMatch(functionSource, /update\s+public\.vendor_applications/i)
  assert.doesNotMatch(functionSource, /deactiv|suspend|reactivat/i)
  assert.doesNotMatch(
    outsideFunction,
    /(?:update|insert\s+into|delete\s+from)\s+public\.(?:vendor_applications|products|vendor_verifications|orders|payout_ledger)/i
  )
  assert.doesNotMatch(
    outsideFunction,
    /(?:update|insert\s+into|delete\s+from)\s+storage\.(?:objects|buckets)/i
  )
  assert.match(snapshot, /marketa_batch4c1\.application_rows/)
  assert.match(postcondition, /application rows were rewritten/)
  assert.match(postcondition, /product RLS changed/)
  assert.match(postcondition, /Storage RLS changed/)
})

test("RPC execution is restricted to the service role", () => {
  assert.match(
    migrationSource,
    /alter function public\.activate_vendor_application\(uuid, uuid\)\s+owner to postgres/
  )
  assert.match(
    migrationSource,
    /revoke all privileges on function\s+public\.activate_vendor_application\(uuid, uuid\)\s+from public, anon, authenticated/
  )
  assert.match(
    migrationSource,
    /grant execute on function\s+public\.activate_vendor_application\(uuid, uuid\)\s+to service_role/
  )
  assert.match(postcondition, /acl\.grantee = 0/)
  assert.match(postcondition, /'anon',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /'authenticated',[\s\S]*'EXECUTE'/)
  assert.match(postcondition, /'service_role',[\s\S]*'EXECUTE'/)
})

test("postconditions verify audit metadata, grants, RPC structure, and frozen RLS", () => {
  assert.match(postcondition, /activation audit columns are incorrect/)
  assert.match(postcondition, /activated_by has an unexpected foreign key/)
  assert.match(postcondition, /authenticated can update activation columns/)
  assert.match(postcondition, /vendor table grants changed/)
  assert.match(postcondition, /activation RPC metadata is incorrect/)
  assert.match(postcondition, /activation RPC grants are incorrect/)
  assert.match(postcondition, /activation RPC structure is incorrect/)
  assert.match(postcondition, /public\.admin_users/)
  assert.match(postcondition, /public\.vendor_applications/)
  assert.match(postcondition, /public\.vendors/)
  assert.match(postcondition, /marketa_batch4c1\.products_security/)
  assert.match(postcondition, /marketa_batch4c1\.storage_security/)
})

test("Batch 4C1 working-tree scope contains only the migration and focused test", () => {
  const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  })
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" }
  )
  const changed = new Set(
    `${tracked}\n${untracked}`
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean)
  )
  assert.deepEqual(
    changed,
    new Set([
      "tests/vendor-product-activation-boundary.test.mjs",
      "tests/vendor-product-image-storage-boundary.test.mjs",
      migrationFile,
      testFile,
    ])
  )
})
