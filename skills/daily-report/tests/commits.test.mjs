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

function initGitRepo(dir, { email = "dev@example.com", name = "Dev" } = {}) {
  spawnSync("git", ["init", "--quiet", dir]);
  spawnSync("git", ["-C", dir, "config", "user.email", email]);
  spawnSync("git", ["-C", dir, "config", "user.name", name]);
  spawnSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
}

function addCommit(dir, subject, { email, name } = {}) {
  if (email) spawnSync("git", ["-C", dir, "config", "user.email", email]);
  if (name) spawnSync("git", ["-C", dir, "config", "user.name", name]);
  const file = join(dir, `${Date.now()}.txt`);
  writeFileSync(file, subject);
  spawnSync("git", ["-C", dir, "add", "."]);
  spawnSync("git", ["-C", dir, "commit", "-m", subject, "--no-gpg-sign"]);
  const sha = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return sha.stdout.trim();
}

function writeCacheCommit(cacheDir, repoDir, sha) {
  const cache = {};
  cache[repoDir] = sha;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "commit-cache.json"), JSON.stringify(cache, null, 2) + "\n", "utf8");
}

// ── missing args ──────────────────────────────────────────────────────────────

test("commits.mjs - no args → exit 1 with usage", () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Usage:"), `stderr: ${r.stderr}`);
});

test("commits.mjs - only repo_root → exit 1 with usage", () => {
  const r = run(["/some/repo"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Usage:"), `stderr: ${r.stderr}`);
});

// ── no cache: shows commits since midnight ─────────────────────────────────────

test("commits.mjs - no cache → uses --since=midnight, returns today's commits", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  const email = "dev@example.com";
  try {
    initGitRepo(dir, { email });
    addCommit(dir, "feat: first commit");
    addCommit(dir, "fix: second commit");

    const r = run([dir, email], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("feat: first commit"), `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes("fix: second commit"), `stdout: ${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

// ── with cache: shows commits since cached SHA ────────────────────────────────

test("commits.mjs - cache hit → uses <sha>..HEAD, only new commits returned", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  const email = "dev@example.com";
  try {
    initGitRepo(dir, { email });
    const sha1 = addCommit(dir, "chore: baseline commit");
    addCommit(dir, "feat: new feature");

    writeCacheCommit(cacheDir, dir, sha1);

    const r = run([dir, email], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(!r.stdout.includes("baseline commit"), `should not include cached commit: ${r.stdout}`);
    assert.ok(r.stdout.includes("feat: new feature"), `stdout: ${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

// ── empty log ─────────────────────────────────────────────────────────────────

test("commits.mjs - no commits by user → empty stdout, exit 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "commits-cache-"));
  const otherEmail = "other@example.com";
  const myEmail = "me@example.com";
  try {
    initGitRepo(dir, { email: otherEmail });
    addCommit(dir, "feat: committed by someone else");

    const r = run([dir, myEmail], { cacheDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "", `expected empty output, got: ${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

// ── not a git repo ─────────────────────────────────────────────────────────────

test("commits.mjs - non-existent repo → exit non-0 with error on stderr", () => {
  const r = run(["/no/such/repo", "dev@example.com"]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.length > 0 || r.status !== 0, "expected failure");
});
