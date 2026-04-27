import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadJson,
  saveJson,
  normalizeKey,
  readProject,
  writeProject,
  readCommit,
  writeCommit,
  resolveScriptsDir,
} from "../scripts/lib/cache.mjs";

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- loadJson ---

test("loadJson - parses a valid JSON file", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "test.json");
    fs.writeFileSync(file, JSON.stringify({ a: "1" }, null, 2) + "\n", "utf8");
    assert.deepEqual(loadJson(file), { a: "1" });
  });
});

test("loadJson - returns {} for a missing file", () => {
  withTmpDir((dir) => {
    assert.deepEqual(loadJson(path.join(dir, "nonexistent.json")), {});
  });
});

test("loadJson - throws for malformed JSON", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, "not json", "utf8");
    assert.throws(() => loadJson(file));
  });
});

// --- saveJson ---

test("saveJson - writes 2-space-indented JSON with trailing newline", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "out.json");
    saveJson(file, { key: "val" });
    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw, '{\n  "key": "val"\n}\n');
  });
});

test("saveJson - creates missing parent directories", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "a", "b", "out.json");
    saveJson(file, {});
    assert.ok(fs.existsSync(file));
  });
});

// --- normalizeKey ---

test("normalizeKey - resolves a real path (symlink → target)", () => {
  withTmpDir((dir) => {
    const target = path.join(dir, "real");
    const link = path.join(dir, "link");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link);
    assert.equal(normalizeKey(link), fs.realpathSync(target));
  });
});

test("normalizeKey - falls back to path.resolve for a nonexistent path without throwing", () => {
  const fake = "/totally/nonexistent/path/abc123";
  assert.equal(normalizeKey(fake), path.resolve(fake));
});

// --- readProject / writeProject ---

test("readProject / writeProject - round-trips a project name", () => {
  withTmpDir((dir) => {
    writeProject("/repo/a", "ProjectA", { cacheDir: dir });
    assert.equal(readProject("/repo/a", { cacheDir: dir }), "ProjectA");
  });
});

test("readProject - returns empty string for an unknown repo", () => {
  withTmpDir((dir) => {
    assert.equal(readProject("/unknown/repo", { cacheDir: dir }), "");
  });
});

test("writeProject - overwriting one entry preserves siblings", () => {
  withTmpDir((dir) => {
    writeProject("/repo/a", "A", { cacheDir: dir });
    writeProject("/repo/b", "B", { cacheDir: dir });
    writeProject("/repo/a", "A2", { cacheDir: dir });
    assert.equal(readProject("/repo/b", { cacheDir: dir }), "B");
    assert.equal(readProject("/repo/a", { cacheDir: dir }), "A2");
  });
});

// --- readCommit / writeCommit ---

test("readCommit / writeCommit - round-trips a full SHA", () => {
  withTmpDir((dir) => {
    const sha = "a".repeat(40);
    writeCommit("/repo/x", sha, { cacheDir: dir });
    assert.equal(readCommit("/repo/x", { cacheDir: dir }), sha);
  });
});

test("readCommit - returns empty string for an unknown repo", () => {
  withTmpDir((dir) => {
    assert.equal(readCommit("/no/such/repo", { cacheDir: dir }), "");
  });
});

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
