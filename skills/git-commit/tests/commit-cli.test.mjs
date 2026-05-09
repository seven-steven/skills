import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMIT_MJS = join(__dirname, "../scripts/commit.mjs");

function run(input) {
  return spawnSync(process.execPath, [COMMIT_MJS], { input, encoding: "utf8" });
}

function initGitRepo(dir) {
  spawnSync("git", ["init", "--quiet", dir]);
  spawnSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "Test"]);
  spawnSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
  stageChange(dir, "file.txt", "hello");
}

function stageChange(dir, filename, content) {
  writeFileSync(join(dir, filename), content);
  spawnSync("git", ["-C", dir, "add", "."]);
}

// ── no input ─────────────────────────────────────────────────────────────────

test("commit-cli - empty stdin → exit 2, usage on stderr", () => {
  const r = run("");
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("usage:"), `stderr: ${r.stderr}`);
});

// ── validation failure ────────────────────────────────────────────────────────

test("commit-cli - invalid message → exit 1, stderr has error, no git commit", () => {
  const r = run("This is not angular format.");
  assert.equal(r.status, 1);
  assert.ok(r.stderr.length > 0, "expected error on stderr");
});

test("commit-cli - unknown type → exit 1, stderr mentions unknown type", () => {
  const r = run("bug: fix something");
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("unknown type"), `stderr: ${r.stderr}`);
});

test("commit-cli - Co-Authored-By trailer → exit 1", () => {
  const r = run("feat(api): add login\n\nBody text.\n\nCo-Authored-By: user <u@x.com>");
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Co-Authored-By"), `stderr: ${r.stderr}`);
});

// ── happy path ────────────────────────────────────────────────────────────────

test("commit-cli - argv and stdin valid messages in git repo → exit 0, commits created", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-test-"));
  try {
    initGitRepo(dir);

    const argvCommit = spawnSync(process.execPath, [COMMIT_MJS, "feat(api): add login endpoint"], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(argvCommit.status, 0, `stderr: ${argvCommit.stderr}`);

    stageChange(dir, "file.txt", "hello again");
    const stdinCommit = spawnSync(process.execPath, [COMMIT_MJS], {
      input: "fix(api): update login endpoint",
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(stdinCommit.status, 0, `stderr: ${stdinCommit.stderr}`);

    const log = spawnSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
    assert.ok(log.stdout.includes("feat(api): add login endpoint"), `log: ${log.stdout}`);
    assert.ok(log.stdout.includes("fix(api): update login endpoint"), `log: ${log.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commit-cli - multi-line message in git repo → commit body preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-test-"));
  try {
    initGitRepo(dir);
    const msg = "fix(core): resolve crash\n\nThis was caused by a null pointer.";
    const r = spawnSync(process.execPath, [COMMIT_MJS], {
      input: msg,
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const log = spawnSync("git", ["-C", dir, "log", "-1", "--format=%B"], { encoding: "utf8" });
    assert.ok(log.stdout.includes("fix(core): resolve crash"), `log: ${log.stdout}`);
    assert.ok(log.stdout.includes("null pointer"), `log: ${log.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── temp file cleanup ─────────────────────────────────────────────────────────

test("commit-cli - temp file is removed after successful commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-test-"));
  try {
    const before = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("claude-commit-")));

    initGitRepo(dir);
    spawnSync(process.execPath, [COMMIT_MJS], {
      input: "chore(ci): update config",
      encoding: "utf8",
      cwd: dir,
    });

    const after = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("claude-commit-")));
    const leftover = [...after].filter((f) => !before.has(f));
    assert.equal(leftover.length, 0, `temp files not cleaned up: ${leftover.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
