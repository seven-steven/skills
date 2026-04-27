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
