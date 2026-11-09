#!/usr/bin/env node
// Refuses a pull request whose changes make the suite smaller: a deleted test
// file, or fewer runnable cases than the base commit had. A suite that passes
// because tests were removed is invisible to the run that reports on it, so the
// comparison has to happen between the two commits.
//
// The base commit arrives in PR_AUDIT_BASE (the merge checkout's first parent).
// Without it there is nothing to compare, and the check stays out of the way.
import { execFileSync } from "node:child_process";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const TEST_FILE = /(^|\/)(tests|__tests__)\/|\.test\.[cm]?[jt]sx?$/;
const CASE = /(?:^|[^\w.$])(?:it|test)(?:\.(?:only|concurrent|each))?\s*\(/g;
const SKIP = /(?:^|[^\w.$])(?:it|test)\.(?:skip|todo|failing)\b/g;

function git(args, allowFailure = false) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 << 20,
      stdio: ["ignore", "pipe", allowFailure ? "ignore" : "inherit"],
    }).trim();
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

/** Runnable cases in one revision of one file, or 0 when the file is absent there. */
function cases(rev, path) {
  const src = git(["show", `${rev}:${path}`], true);
  if (src === null) return 0;
  const total = (src.match(CASE) ?? []).length;
  const skipped = (src.match(SKIP) ?? []).length;
  return Math.max(0, total - skipped);
}

const envBase = (process.env.PR_AUDIT_BASE ?? "").trim();
if (!envBase) {
  console.log("PR_AUDIT_BASE is unset, so there is no base commit to compare; skipping.");
  process.exit(0);
}

const base = git(["rev-parse", "--verify", `${envBase}^{commit}`], true);
if (base === null) {
  console.error(`PR_AUDIT_BASE=${envBase} is not a commit in this clone, so the diff cannot be audited.`);
  process.exit(1);
}
const head = git(["rev-parse", "HEAD"]);

// Renames arrive as a delete plus an add, so a moved test file is measured where
// its cases landed instead of counting as a loss.
const touched = git([
  "diff",
  "--name-status",
  "--no-renames",
  "--diff-filter=MDA",
  base,
  head,
])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split("\t");
    return { status, path };
  })
  .filter((row) => row.path && TEST_FILE.test(row.path));

let net = 0;
const shrunk = [];
for (const { status, path } of touched) {
  const before = status === "A" ? 0 : cases(base, path);
  const after = status === "D" ? 0 : cases(head, path);
  net += after - before;
  if (after < before) shrunk.push(`  ${path}: ${before - after} of ${before} case(s) gone`);
}

if (net < 0) {
  console.error(
    [
      `The suite shrank by ${-net} case(s) against ${base.slice(0, 8)}:`,
      ...shrunk,
      "",
      "A pull request cannot make the suite green by removing what it covers. Restore",
      "the cases, or land the removal on the base branch, where it is reviewed as the",
      "change it is rather than as a passing build.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `No shrinkage against ${base.slice(0, 8)}: ${touched.length} test file(s) touched, net ${net >= 0 ? "+" : ""}${net} case(s).`,
);
