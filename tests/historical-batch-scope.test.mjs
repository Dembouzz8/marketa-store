import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { historicalCommitFiles } from "./helpers/historical-batch-scope.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const helperFile = "tests/helpers/historical-batch-scope.mjs"
const historicalTests = [
  {
    file: "tests/vendor-product-activation-boundary.test.mjs",
    sha: "945f5cd831b415fdf9b2efe3f3023d41e1d7b632",
  },
  {
    file: "tests/vendor-product-image-storage-boundary.test.mjs",
    sha: "6dbf02f998b020cf64b4b642ee3f57d65e623b5f",
  },
  {
    file: "tests/vendor-activation-authority.test.mjs",
    sha: "ed49e89d4f8596e8ef2b9d0efaf4df4531e49fb2",
  },
]

test("closed-batch scope reads fixed commit history and never the current working tree", () => {
  const helperSource = fs.readFileSync(path.join(root, helperFile), "utf8")
  assert.match(helperSource, /"diff-tree"/)
  assert.match(helperSource, /"-z"/)
  assert.doesNotMatch(helperSource, /["']status["']|--porcelain|ls-files/)

  for (const { file, sha } of historicalTests) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    assert.equal(source.includes(sha), true, file)
    assert.match(source, /historicalCommitFiles/)
    assert.doesNotMatch(
      source,
      /execFileSync|["']status["']|--porcelain|ls-files|"diff",\s*"--name-only"/
    )
  }
})

test("historical scope is deterministic for a known implementation commit", (t) => {
  const sha = "ed49e89d4f8596e8ef2b9d0efaf4df4531e49fb2"
  const first = historicalCommitFiles(root, sha)
  if (!first.available) {
    t.skip(first.reason)
    return
  }
  const second = historicalCommitFiles(root, sha)
  assert.equal(second.available, true)
  assert.deepEqual(first.files, second.files)
  assert.deepEqual(first.files, [
    "supabase/migrations/20260926231820_add_vendor_activation_authority.sql",
    "tests/vendor-activation-authority.test.mjs",
    "tests/vendor-product-activation-boundary.test.mjs",
    "tests/vendor-product-image-storage-boundary.test.mjs",
  ])
})

test("historical scope distinguishes unavailable commits and rejects malformed SHAs", () => {
  const unavailable = historicalCommitFiles(root, "0000000000000000000000000000000000000000")
  assert.equal(unavailable.available, false)
  assert.match(unavailable.reason, /unavailable in this checkout/)
  assert.throws(
    () => historicalCommitFiles(root, "not-a-commit"),
    /full 40-character SHA/
  )
})
