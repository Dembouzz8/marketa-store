import { execFileSync } from "node:child_process"

// Historical closed-batch tests verify their implementation commit.
// Current working-tree scope belongs to the current implementation/review batch,
// not to previously closed batch tests.

const fullCommitPattern = /^[0-9a-f]{40}$/i

function unavailableCommit(error) {
  const stderr = error?.stderr?.toString?.("utf8") ?? ""
  return (
    error?.status === 1 ||
    (error?.status === 128 &&
      /not a valid object name|bad object|unknown revision|could not get object info/i.test(
        stderr
      ))
  )
}

export function historicalCommitFiles(repoRoot, commitSha) {
  if (!fullCommitPattern.test(commitSha)) {
    throw new TypeError("Historical commit must be a full 40-character SHA.")
  }

  const insideWorkTree = execFileSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim()
  if (insideWorkTree !== "true") {
    throw new Error("Historical scope requires a Git working tree.")
  }

  try {
    execFileSync("git", ["cat-file", "-e", `${commitSha}^{commit}`], {
      cwd: repoRoot,
      stdio: "pipe",
    })
  } catch (error) {
    if (unavailableCommit(error)) {
      return {
        available: false,
        reason: `Historical commit ${commitSha} is unavailable in this checkout.`,
      }
    }
    throw error
  }

  const output = execFileSync(
    "git",
    [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      commitSha,
      "--",
    ],
    { cwd: repoRoot }
  )

  const files = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"))
    .sort()

  return { available: true, files }
}
