import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const migrationFile =
  "supabase/migrations/20260925160000_harden_product_image_storage_write_boundary.sql"
const productFormFile = "src/components/vendor/product-form.tsx"
const testFile = "tests/vendor-product-image-storage-boundary.test.mjs"

const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const migrationSource = read(migrationFile)
const productFormSource = read(productFormFile)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test("migration creates exactly the approved SELECT and INSERT policies", () => {
  const createdPolicies = [
    ...migrationSource.matchAll(/create policy\s+([a-z0-9_]+)/g),
  ].map((match) => match[1])

  assert.deepEqual(createdPolicies, [
    "vendor_select_own_active_product_images",
    "vendor_insert_own_active_product_images",
  ])
  assert.equal((migrationSource.match(/on storage\.objects/g) ?? []).length, 2)
  assert.doesNotMatch(migrationSource, /create policy[\s\S]{0,100}for update/i)
  assert.doesNotMatch(migrationSource, /create policy[\s\S]{0,100}for delete/i)
  assert.doesNotMatch(migrationSource, /create policy[\s\S]{0,100}to (?:anon|public)/i)
})

test("SELECT policy is authenticated-only and requires the active own-vendor namespace", () => {
  const policy = between(
    migrationSource,
    "create policy vendor_select_own_active_product_images",
    ";"
  )

  assert.match(policy, /on storage\.objects/)
  assert.match(policy, /for select/)
  assert.match(policy, /to authenticated/)
  assert.match(policy, /using \(/)
  assert.doesNotMatch(policy, /with check/)
  assert.match(policy, /bucket_id = 'product-images'/)
  assert.match(policy, /\(storage\.foldername\(name\)\)\[1\]/)
  assert.match(policy, /select vendors\.id::text as vendor_id_text/)
  assert.match(policy, /vendors\.user_id = \(select auth\.uid\(\)\)/)
  assert.match(policy, /vendors\.is_active = true/)
})

test("INSERT policy has the exact same authority in WITH CHECK", () => {
  const selectPolicy = between(
    migrationSource,
    "create policy vendor_select_own_active_product_images",
    ";"
  )
  const insertPolicy = between(
    migrationSource,
    "create policy vendor_insert_own_active_product_images",
    ";"
  )
  const selectPredicate = between(selectPolicy, "using (", "\n)")
  const insertPredicate = between(insertPolicy, "with check (", "\n)")

  assert.match(insertPolicy, /on storage\.objects/)
  assert.match(insertPolicy, /for insert/)
  assert.match(insertPolicy, /to authenticated/)
  assert.match(insertPolicy, /with check \(/)
  assert.doesNotMatch(insertPolicy, /\nusing \(/)
  assert.equal(
    insertPredicate.replace(/^with check \(/, ""),
    selectPredicate.replace(/^using \(/, "")
  )
})

test("migration fails closed around the audited Storage and vendor baseline", () => {
  assert.match(migrationSource, /^-- Batch 4B1:[\s\S]*\nbegin;/)
  assert.match(migrationSource, /set local lock_timeout = '10s'/)
  assert.match(migrationSource, /do \$preflight\$/)
  assert.match(migrationSource, /do \$postcondition\$/)
  assert.match(migrationSource, /class\.relrowsecurity/)
  assert.match(migrationSource, /bucket\.id = 'product-images'/)
  assert.match(migrationSource, /bucket\.public/)
  assert.match(migrationSource, /storage\.objects policies no longer match the audited empty baseline/)
  assert.match(migrationSource, /policy\.policyname = 'vendor_select_own'/)
  assert.match(migrationSource, /has_table_privilege\([\s\S]*'public\.vendors'[\s\S]*'SELECT'/)
  assert.match(migrationSource, /has_column_privilege\([\s\S]*'is_active'[\s\S]*'UPDATE'/)
  assert.match(migrationSource, /unexpected storage\.objects policy count/)
  assert.match(migrationSource, /policy_record\.permissive <> 'PERMISSIVE'/)
  assert.match(migrationSource, /policy_record\.roles is distinct from array\['authenticated'\]::name\[\]/)
  assert.match(migrationSource, /\ncommit;\s*$/)
})

test("policy postconditions validate each security term without brittle whole-expression equality", () => {
  const postcondition = between(
    migrationSource,
    "do $postcondition$",
    "$postcondition$;"
  )
  const selectCheck = between(
    postcondition,
    "and policy.policyname = 'vendor_select_own_active_product_images';",
    "raise exception using"
  )
  const insertCheck = between(
    postcondition,
    "and policy.policyname = 'vendor_insert_own_active_product_images';",
    "raise exception using"
  )

  assert.doesNotMatch(postcondition, /expected_expression\s+constant/)
  assert.doesNotMatch(postcondition, /normalized_expression\s*<>/)
  assert.equal((postcondition.match(/'objects\.',\s*''/g) ?? []).length, 2)

  for (const check of [selectCheck, insertCheck]) {
    assert.match(check, /position\('bucket_id=''product-images''' in normalized_expression\) = 0/)
    assert.match(check, /position\('foldernamename\[1\]' in normalized_expression\) = 0/)
    assert.match(check, /foldername_dependency_ok := exists \(/)
    assert.match(check, /from pg_catalog\.pg_policy as policy/)
    assert.match(check, /join pg_catalog\.pg_depend as dependency/)
    assert.match(check, /dependency\.classid = 'pg_policy'::pg_catalog\.regclass/)
    assert.match(check, /dependency\.objid = policy\.oid/)
    assert.match(check, /dependency\.refclassid = 'pg_proc'::pg_catalog\.regclass/)
    assert.match(check, /policy\.polrelid = 'storage\.objects'::pg_catalog\.regclass/)
    assert.match(check, /dependency\.refobjid =\s*pg_catalog\.to_regprocedure\('storage\.foldername\(text\)'\)/)
    assert.match(check, /or not foldername_dependency_ok/)
    assert.match(check, /position\('vendors\.id' in normalized_expression\) = 0/)
    assert.match(check, /position\('vendors\.user_id' in normalized_expression\) = 0/)
    assert.match(check, /position\('auth\.uid' in normalized_expression\) = 0/)
    assert.match(check, /position\('vendors\.is_active=true' in normalized_expression\) = 0/)
    assert.match(check, /position\('fromvendors' in normalized_expression\) = 0/)
    assert.match(check, /\(\^\|\[\^\[\:alnum\:\]_\]\)or\(\[\^\[\:alnum\:\]_\]\|\$\)/)
    assert.match(check, /policy_record\.permissive <> 'PERMISSIVE'/)
    assert.match(check, /policy_record\.roles is distinct from array\['authenticated'\]::name\[\]/)
  }

  assert.match(selectCheck, /policy_record\.cmd <> 'SELECT'/)
  assert.match(selectCheck, /policy\.polname = 'vendor_select_own_active_product_images'/)
  assert.match(selectCheck, /policy_record\.with_check is not null/)
  assert.match(selectCheck, /policy_record\.qual is null/)
  assert.match(insertCheck, /policy_record\.cmd <> 'INSERT'/)
  assert.match(insertCheck, /policy\.polname = 'vendor_insert_own_active_product_images'/)
  assert.match(insertCheck, /policy_record\.qual is not null/)
  assert.match(insertCheck, /policy_record\.with_check is null/)
  assert.equal(
    (postcondition.match(/pg_catalog\.to_regprocedure\('storage\.foldername\(text\)'\)/g) ?? []).length,
    2
  )
  assert.equal(
    (postcondition.match(/foldername_dependency_ok=%s/g) ?? []).length,
    2
  )
  assert.match(postcondition, /\) <> 2 then/)
})

test("migration performs no Storage row DML or unrelated policy changes", () => {
  assert.doesNotMatch(migrationSource, /\bupdate\s+storage\.(?:objects|buckets)\b/i)
  assert.doesNotMatch(migrationSource, /\binsert\s+into\s+storage\.(?:objects|buckets)\b/i)
  assert.doesNotMatch(migrationSource, /\bdelete\s+from\s+storage\.(?:objects|buckets)\b/i)
  assert.doesNotMatch(migrationSource, /alter\s+table\s+public\.vendors/i)
  assert.doesNotMatch(migrationSource, /(?:create|alter|drop)\s+policy[\s\S]{0,100}on\s+public\.(?:vendors|products)/i)
  for (const forbidden of [
    "public_active_vendors",
    "vendor_verifications",
    "auth.users",
    "orders",
    "payout",
    "refund",
    "checkout",
    "n8n",
    "inviteUserByEmail",
    "provisioning",
  ]) {
    assert.equal(migrationSource.includes(forbidden), false, forbidden)
  }
})

test("ProductForm generates MIME-derived random names under the vendor namespace", () => {
  assert.match(productFormSource, /"image\/jpeg": "jpg"/)
  assert.match(productFormSource, /"image\/png": "png"/)
  assert.match(productFormSource, /"image\/webp": "webp"/)
  assert.match(
    productFormSource,
    /const path = `\$\{vendorId\}\/\$\{crypto\.randomUUID\(\)\}\.\$\{extension\}`/
  )
  assert.doesNotMatch(productFormSource, /Date\.now\(\)-\$\{file\.name\}/)
  const uploadImages = between(
    productFormSource,
    "const uploadImages = async () =>",
    "const handleSubmit"
  )
  assert.equal(uploadImages.includes("file.name"), false)
})

test("ProductForm validates MIME, five MiB, and the four-image maximum", () => {
  assert.match(productFormSource, /const MAX_IMAGE_SIZE_BYTES = 5 \* 1024 \* 1024/)
  assert.match(productFormSource, /file\.size > MAX_IMAGE_SIZE_BYTES/)
  assert.match(productFormSource, /Each image must be 5 MiB or smaller\./)
  assert.match(productFormSource, /Only JPEG, PNG, and WebP images are supported\./)
  assert.match(productFormSource, /existingImages\.length \+ allowedFiles\.length > 4/)
  assert.match(productFormSource, /You can upload a maximum of 4 images\./)
})

test("ProductForm retains non-upsert upload and public URL generation", () => {
  assert.match(
    productFormSource,
    /\.from\("product-images"\)\s*\.upload\(path, file\)/
  )
  assert.equal(productFormSource.includes("upsert"), false)
  assert.match(
    productFormSource,
    /\.from\("product-images"\)\s*\.getPublicUrl\(path\)/
  )
  assert.doesNotMatch(productFormSource, /storage\s*\.from\([\s\S]*\.remove\(/)
})

test("Batch 4B1 working-tree scope excludes frozen systems", () => {
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
  const allowed = new Set([
    migrationFile,
    productFormFile,
    testFile,
    "tests/vendor-product-activation-boundary.test.mjs",
  ])

  for (const file of changed) {
    assert.ok(allowed.has(file), `Unexpected Batch 4B1 file: ${file}`)
  }
})
