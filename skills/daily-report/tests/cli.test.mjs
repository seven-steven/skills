import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dir, "..", "scripts");

function run(script, args = [], { input, cacheDir } = {}) {
  const env = { ...process.env };
  if (cacheDir) env.DAILY_REPORT_CACHE_DIR = cacheDir;
  return spawnSync("node", [path.join(SCRIPTS, script), ...args], {
    input,
    encoding: "utf8",
    env,
  });
}

// ── cache.mjs ──────────────────────────────────────────────────────────────────

test("cache.mjs resolve - returns an absolute path", () => {
  const r = run("cache.mjs", ["resolve"]);
  assert.equal(r.status, 0);
  assert.ok(path.isAbsolute(r.stdout.trim()), `expected absolute path, got: ${r.stdout.trim()}`);
});

test("cache.mjs write then read - round-trips a project name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-cli-"));
  try {
    run("cache.mjs", ["write", "/repo/test", "TestProject"], { cacheDir: dir });
    const r = run("cache.mjs", ["read", "/repo/test"], { cacheDir: dir });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "TestProject");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cache.mjs write-reported then read-reported - round-trips a commit ID array", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-cli-"));
  try {
    const ids = ["a".repeat(40), "b".repeat(40)];
    const write = run("cache.mjs", ["write-reported", "/repo/test", JSON.stringify(ids)], { cacheDir: dir });
    const read = run("cache.mjs", ["read-reported", "/repo/test"], { cacheDir: dir });
    assert.equal(write.status, 0, write.stderr);
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), ids);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cache.mjs write-reported - rejects malformed JSON", () => {
  const r = run("cache.mjs", ["write-reported", "/repo/test", "not-json"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid reported commit IDs/);
});

test("cache.mjs read - exits 0 and prints nothing for unknown repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-cli-"));
  try {
    const r = run("cache.mjs", ["read", "/no/such/repo"], { cacheDir: dir });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cache.mjs - unknown action exits 1 with error message", () => {
  const r = run("cache.mjs", ["not-a-real-action", "/repo"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Unknown action"));
});

test("cache.mjs - read-commit and write-commit actions are removed", () => {
  const r = run("cache.mjs", ["read-commit", "/repo"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("Unknown action"), `expected 'Unknown action', got: ${r.stderr}`);
});

// ── validate.mjs ───────────────────────────────────────────────────────────────

test("validate.mjs - exits 0 and prints 格式校验通过 for valid input", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能；\n" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("格式校验通过"));
});

test("validate.mjs - exits 1 and prints 格式校验失败 for invalid input", () => {
  const r = run("validate.mjs", [], { input: "bad line\n" });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("格式校验失败："));
});

test("validate.mjs - accepts two-segment line", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能开发；" });
  assert.equal(r.status, 0);
});

test("validate.mjs - accepts three-segment line", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-用户模块-完成登录功能；" });
  assert.equal(r.status, 0);
});

test("validate.mjs - accepts multi-line valid input", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能开发；\n- ProjectB-后端模块-修复接口BUG；" });
  assert.equal(r.status, 0);
});

test("validate.mjs - rejects empty input", () => {
  const r = run("validate.mjs", [], { input: "" });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("输出不能为空"));
});

test("validate.mjs - ignores trailing blank lines", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能开发；\n\n   \n" });
  assert.equal(r.status, 0);
});

test("validate.mjs - preserves work content with internal hyphens as third segment", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-Module-fix-the-bug；" });
  assert.equal(r.status, 0);
});

test("validate.mjs - accepts Unicode and Chinese project names", () => {
  const r = run("validate.mjs", [], { input: "- 数字地球-GIS模块-接入图层；" });
  assert.equal(r.status, 0);
});

test("validate.mjs - flags missing '- ' prefix", () => {
  const r = run("validate.mjs", [], { input: "ProjectA-完成功能；" });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("- "));
});

test("validate.mjs - flags missing '；' suffix", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能" });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("；"));
});

test("validate.mjs - flags CRLF line endings", () => {
  const r = run("validate.mjs", [], { input: "- ProjectA-完成功能；\r\n" });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("\\r"));
});