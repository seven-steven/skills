import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveScriptsDir } from "../scripts/lib/resolve-scripts-dir.mjs";

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- resolveScriptsDir ---

test("resolveScriptsDir - finds anchor via cwd-relative path", () => {
  withTmpDir((dir) => {
    const scriptsDir = path.join(dir, "skills", "daily-report", "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, "cache.mjs"), "// anchor", "utf8");
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), scriptsDir);
  });
});

test("resolveScriptsDir - finds anchor via plugin-cache root", () => {
  withTmpDir((dir) => {
    const scriptsDir = path.join(dir, "cache", "v1", "daily-report", "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, "cache.mjs"), "// anchor", "utf8");
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), scriptsDir);
  });
});

test("resolveScriptsDir - skips node_modules matches", () => {
  withTmpDir((dir) => {
    const nmDir = path.join(dir, "node_modules", "daily-report", "scripts");
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, "cache.mjs"), "// anchor", "utf8");
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), "");
  });
});

test("resolveScriptsDir - returns empty string when no anchor exists", () => {
  withTmpDir((dir) => {
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), "");
  });
});

test("resolveScriptsDir - skips a plugin-cache version marked .orphaned_at", () => {
  withTmpDir((dir) => {
    // 名字按字母序排：DFS 会先进入 orphaned，必须被跳过；返回 active 的路径
    const orphanedScripts = path.join(dir, "aaa-orphaned", "daily-report", "scripts");
    const activeScripts = path.join(dir, "bbb-active", "daily-report", "scripts");
    fs.mkdirSync(orphanedScripts, { recursive: true });
    fs.mkdirSync(activeScripts, { recursive: true });
    fs.writeFileSync(path.join(orphanedScripts, "cache.mjs"), "// anchor", "utf8");
    fs.writeFileSync(path.join(activeScripts, "cache.mjs"), "// anchor", "utf8");
    fs.writeFileSync(path.join(dir, "aaa-orphaned", ".orphaned_at"), "1", "utf8");
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), activeScripts);
  });
});

test("resolveScriptsDir - returns empty string when every candidate is orphaned", () => {
  withTmpDir((dir) => {
    const scriptsDir = path.join(dir, "v1", "daily-report", "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, "cache.mjs"), "// anchor", "utf8");
    fs.writeFileSync(path.join(dir, "v1", ".orphaned_at"), "1", "utf8");
    assert.equal(resolveScriptsDir({ searchRoots: [dir] }), "");
  });
});