import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  getBinaryCandidates,
  needsShellForBinary,
  resolveBinaryPath,
} from "../scripts/lib/process.mjs";

// ---------------------------------------------------------------------------
// getBinaryCandidates — win32
// ---------------------------------------------------------------------------

test("getBinaryCandidates win32: bare name expands across PATHEXT × PATH dirs in order", () => {
  const dir = path.join(os.tmpdir(), "cf-test-bin");
  const candidates = getBinaryCandidates("codefree", {
    platform: "win32",
    env: { PATH: dir, PATHEXT: ".EXE;.CMD" },
  });

  assert.ok(candidates.some((c) => c.dir === dir && c.filename === "codefree.EXE"));
  assert.ok(candidates.some((c) => c.dir === dir && c.filename === "codefree.CMD"));

  // PATHEXT order: .EXE before .CMD
  const exeIdx = candidates.findIndex((c) => c.filename === "codefree.EXE");
  const cmdIdx = candidates.findIndex((c) => c.filename === "codefree.CMD");
  assert.ok(exeIdx < cmdIdx, ".EXE candidate must precede .CMD candidate");
});

test("getBinaryCandidates win32: PS1 appended when absent from PATHEXT", () => {
  const dir = path.join(os.tmpdir(), "cf-test-bin");
  const candidates = getBinaryCandidates("codefree", {
    platform: "win32",
    env: { PATH: dir, PATHEXT: ".EXE;.CMD" },
  });
  assert.ok(candidates.some((c) => c.filename === "codefree.PS1"));
});

test("getBinaryCandidates win32: PS1 not duplicated when already in PATHEXT", () => {
  const dir = path.join(os.tmpdir(), "cf-test-bin");
  const candidates = getBinaryCandidates("codefree", {
    platform: "win32",
    env: { PATH: dir, PATHEXT: ".EXE;.PS1;.CMD" },
  });
  assert.equal(candidates.filter((c) => c.filename.toUpperCase() === "CODEFREE.PS1").length, 1);
});

test("getBinaryCandidates win32: bare name across multiple PATH dirs", () => {
  const dir1 = path.join(os.tmpdir(), "cf-bin1");
  const dir2 = path.join(os.tmpdir(), "cf-bin2");
  const candidates = getBinaryCandidates("codefree", {
    platform: "win32",
    env: { PATH: `${dir1};${dir2}`, PATHEXT: ".EXE" },
  });
  assert.equal(candidates.filter((c) => c.dir === dir1 && c.filename === "codefree.EXE").length, 1);
  assert.equal(candidates.filter((c) => c.dir === dir2 && c.filename === "codefree.EXE").length, 1);
});

test("getBinaryCandidates win32: name with known extension walks PATH without re-expansion", () => {
  const dir1 = path.join(os.tmpdir(), "cf-bin1");
  const dir2 = path.join(os.tmpdir(), "cf-bin2");
  const candidates = getBinaryCandidates("codefree.cmd", {
    platform: "win32",
    env: { PATH: `${dir1};${dir2}`, PATHEXT: ".EXE;.CMD" },
  });
  assert.ok(candidates.every((c) => c.filename === "codefree.cmd"), "no extension re-expansion");
  assert.equal(candidates.length, 2);
});

test("getBinaryCandidates win32: absolute path returns single candidate ignoring PATH", () => {
  const absPath = path.join(os.tmpdir(), "npm", "codefree.cmd");
  const candidates = getBinaryCandidates(absPath, {
    platform: "win32",
    env: { PATH: path.join(os.tmpdir(), "other"), PATHEXT: ".EXE;.CMD" },
  });
  assert.equal(candidates.length, 1);
  assert.equal(path.join(candidates[0].dir, candidates[0].filename), path.normalize(absPath));
});

test("getBinaryCandidates win32: empty PATH returns no candidates", () => {
  const candidates = getBinaryCandidates("codefree", {
    platform: "win32",
    env: { PATH: "", PATHEXT: ".EXE;.CMD" },
  });
  assert.equal(candidates.length, 0);
});

// ---------------------------------------------------------------------------
// getBinaryCandidates — posix
// (Use paths without ":" to stay cross-platform friendly.)
// ---------------------------------------------------------------------------

test("getBinaryCandidates posix: bare name returns one candidate per PATH dir", () => {
  const candidates = getBinaryCandidates("codefree", {
    platform: "linux",
    env: { PATH: "usr/local/bin:home/user/bin" },
  });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.filename === "codefree"));
  assert.equal(candidates[0].dir, "usr/local/bin");
  assert.equal(candidates[1].dir, "home/user/bin");
});

test("getBinaryCandidates posix: empty PATH returns no candidates", () => {
  const candidates = getBinaryCandidates("codefree", {
    platform: "linux",
    env: { PATH: "" },
  });
  assert.equal(candidates.length, 0);
});

// ---------------------------------------------------------------------------
// resolveBinaryPath
// ---------------------------------------------------------------------------

test("resolveBinaryPath win32: returns first existing match (.exe before .cmd)", () => {
  const dir = path.join(os.tmpdir(), "cf-test-bin");
  const exePath = path.join(dir, "codefree.EXE");
  const fakeFs = { existsSync: (p) => p === exePath };

  const result = resolveBinaryPath("codefree", {
    platform: "win32",
    env: { PATH: dir, PATHEXT: ".EXE;.CMD" },
    fs: fakeFs,
  });
  assert.equal(result, exePath);
});

test("resolveBinaryPath win32: falls through to .cmd when .exe absent", () => {
  const dir = path.join(os.tmpdir(), "cf-test-bin");
  const cmdPath = path.join(dir, "codefree.CMD");
  const fakeFs = { existsSync: (p) => p === cmdPath };

  const result = resolveBinaryPath("codefree", {
    platform: "win32",
    env: { PATH: dir, PATHEXT: ".EXE;.CMD" },
    fs: fakeFs,
  });
  assert.equal(result, cmdPath);
});

test("resolveBinaryPath: returns null when nothing found", () => {
  const fakeFs = { existsSync: () => false };
  const result = resolveBinaryPath("definitely-missing", {
    platform: "win32",
    env: { PATH: path.join(os.tmpdir(), "cf-test-bin"), PATHEXT: ".EXE;.CMD" },
    fs: fakeFs,
  });
  assert.equal(result, null);
});

test("resolveBinaryPath: does not throw for unreadable PATH dirs", () => {
  const goodDir = path.join(os.tmpdir(), "cf-good");
  const fakeFs = {
    existsSync: (p) => {
      if (p.includes("bad")) throw new Error("EACCES: permission denied");
      return false;
    },
  };
  assert.doesNotThrow(() => {
    resolveBinaryPath("codefree", {
      platform: "win32",
      env: { PATH: `${path.join(os.tmpdir(), "cf-bad")};${goodDir}`, PATHEXT: ".EXE" },
      fs: fakeFs,
    });
  });
});

test("resolveBinaryPath posix: returns first existing match", () => {
  // Use relative-style paths (no drive letter) so `:` PATH delimiter is
  // unambiguous even when this test suite runs on Windows.
  const dir1 = "usr-bin";
  const dir2 = "usr-local-bin";
  const expected = path.join(dir2, "codefree");
  const fakeFs = { existsSync: (p) => p === expected };

  const result = resolveBinaryPath("codefree", {
    platform: "linux",
    env: { PATH: `${dir1}:${dir2}` },
    fs: fakeFs,
  });
  assert.equal(result, expected);
});

test("resolveBinaryPath win32: absolute path check works when file exists", () => {
  const absPath = path.join(os.tmpdir(), "npm", "codefree.cmd");
  const fakeFs = { existsSync: (p) => path.normalize(p) === path.normalize(absPath) };

  const result = resolveBinaryPath(absPath, {
    platform: "win32",
    env: { PATH: path.join(os.tmpdir(), "other"), PATHEXT: ".EXE;.CMD" },
    fs: fakeFs,
  });
  assert.equal(path.normalize(result), path.normalize(absPath));
});

test("resolveBinaryPath win32: absolute path returns null when file missing", () => {
  const absPath = path.join(os.tmpdir(), "npm", "codefree.cmd");
  const fakeFs = { existsSync: () => false };

  const result = resolveBinaryPath(absPath, {
    platform: "win32",
    env: { PATH: path.join(os.tmpdir(), "other"), PATHEXT: ".EXE;.CMD" },
    fs: fakeFs,
  });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// needsShellForBinary
// ---------------------------------------------------------------------------

test("needsShellForBinary win32 .cmd returns true", () => {
  assert.equal(needsShellForBinary(path.join(os.tmpdir(), "codefree.cmd"), "win32"), true);
});

test("needsShellForBinary win32 .CMD (uppercase) returns true", () => {
  assert.equal(needsShellForBinary(path.join(os.tmpdir(), "codefree.CMD"), "win32"), true);
});

test("needsShellForBinary win32 .bat returns true", () => {
  assert.equal(needsShellForBinary(path.join(os.tmpdir(), "codefree.bat"), "win32"), true);
});

test("needsShellForBinary win32 .exe returns false", () => {
  assert.equal(needsShellForBinary(path.join(os.tmpdir(), "codefree.exe"), "win32"), false);
});

test("needsShellForBinary win32 .ps1 returns false", () => {
  assert.equal(needsShellForBinary(path.join(os.tmpdir(), "codefree.ps1"), "win32"), false);
});

test("needsShellForBinary posix always returns false", () => {
  assert.equal(needsShellForBinary("/usr/bin/codefree", "linux"), false);
  assert.equal(needsShellForBinary("/usr/bin/codefree.bat", "linux"), false);
  assert.equal(needsShellForBinary("/usr/bin/codefree.cmd", "darwin"), false);
});
