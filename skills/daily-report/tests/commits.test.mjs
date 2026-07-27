import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMITS_MJS = join(__dirname, "../scripts/commits.mjs");

function run(args = [], { cacheDir } = {}) {
  const env = { ...process.env };
  if (cacheDir) env.DAILY_REPORT_CACHE_DIR = cacheDir;
  return spawnSync(process.execPath, [COMMITS_MJS, ...args], { encoding: "utf8", env });
}

function git(args, options = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function initGitRepo(dir, { email = "dev@example.com", name = "Dev" } = {}) {
  git(["init", "--quiet", dir]);
  git(["-C", dir, "config", "user.email", email]);
  git(["-C", dir, "config", "user.name", name]);
  git(["-C", dir, "config", "commit.gpgsign", "false"]);
}

let fileCounter = 0;
function addCommit(dir, subject, { email, name } = {}) {
  if (email) git(["-C", dir, "config", "user.email", email]);
  if (name) git(["-C", dir, "config", "user.name", name]);
  const file = join(dir, `${fileCounter++}.txt`);
  writeFileSync(file, subject);
  git(["-C", dir, "add", "."]);
  git(["-C", dir, "commit", "-m", subject, "--no-gpg-sign"]);
  return git(["-C", dir, "rev-parse", "HEAD"]);
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function writeReportedCommitIds(cacheDir, repoDir, ids, date = localDate()) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "commit-cache.json"), JSON.stringify({ [repoDir]: { date, commitIds: ids } }, null, 2) + "\n", "utf8");
}

function outputSubjects(result) {
  return result.stdout.split("\n").filter(Boolean).map((line) => line.split("\t")[1]);
}

// Error paths

test("commits.mjs - no args exits 1 with usage", () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Usage:"), `stderr: ${r.stderr}`);
});

test("commits.mjs - only repo root exits 1 with usage", () => {
  const r = run(["/some/repo"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Usage:"), `stderr: ${r.stderr}`);
});

test("commits.mjs - non-existent repo exits non-zero with stderr", () => {
  const r = run(["/no/such/repo", "dev@example.com"]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.length > 0, "expected git failure on stderr");
});

// Happy path and edge cases

test("commits.mjs - no cache lists all of today's matching commits with full SHA", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir);
    const firstSha = addCommit(dir, "feat: first commit");
    addCommit(dir, "fix: second commit");

    const r = run([dir, "dev@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`${firstSha}\\tfeat: first commit`));
    assert.deepEqual(outputSubjects(r), ["fix: second commit", "feat: first commit"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("commits.mjs - filters only IDs already reported today", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir);
    const oldSha = addCommit(dir, "chore: reported");
    addCommit(dir, "feat: unreported");
    writeReportedCommitIds(cacheDir, dir, [oldSha]);

    const r = run([dir, "dev@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(outputSubjects(r), ["feat: unreported"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("commits.mjs - --all includes a branch-only commit after the cached main tip", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir);
    const mainSha = addCommit(dir, "chore: main baseline");
    git(["-C", dir, "checkout", "-b", "feature", "--quiet"]);
    addCommit(dir, "feat: only on feature branch");
    git(["-C", dir, "checkout", "-", "--quiet"]);
    writeReportedCommitIds(cacheDir, dir, [mainSha]);

    const r = run([dir, "dev@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(outputSubjects(r), ["feat: only on feature branch"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("commits.mjs - filters an already reported branch-only commit without hiding later branch work", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir);
    addCommit(dir, "chore: main baseline");
    git(["-C", dir, "checkout", "-b", "feature", "--quiet"]);
    const reportedFeatureSha = addCommit(dir, "feat: already reported feature work");
    addCommit(dir, "fix: new feature work");
    git(["-C", dir, "checkout", "-", "--quiet"]);
    writeReportedCommitIds(cacheDir, dir, [reportedFeatureSha]);

    const r = run([dir, "dev@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(outputSubjects(r), ["fix: new feature work", "chore: main baseline"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("commits.mjs - returns empty stdout when every matching commit is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir);
    const sha = addCommit(dir, "feat: reported work");
    writeReportedCommitIds(cacheDir, dir, [sha]);
    const r = run([dir, "dev@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("commits.mjs - returns no commits authored by a different email", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  try {
    initGitRepo(dir, { email: "other@example.com" });
    addCommit(dir, "feat: someone else");
    const r = run([dir, "me@example.com"], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
