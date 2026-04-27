import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getClipboardCandidates,
  copyToClipboard,
} from "../scripts/lib/clipboard.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dir, "..", "scripts");

// ─── pure-function unit tests ────────────────────────────────────────────────

test("getClipboardCandidates - darwin returns pbcopy", () => {
  const c = getClipboardCandidates({ platform: "darwin" });
  assert.deepEqual(c, [{ cmd: "pbcopy", args: [] }]);
});

test("getClipboardCandidates - win32 returns clip", () => {
  const c = getClipboardCandidates({ platform: "win32" });
  assert.deepEqual(c, [{ cmd: "clip", args: [] }]);
});

test("getClipboardCandidates - linux WSL_DISTRO_NAME puts clip.exe first", () => {
  const c = getClipboardCandidates({
    platform: "linux",
    release: "5.15.0-generic",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
  });
  assert.equal(c[0].cmd, "clip.exe");
  assert.ok(c.some((x) => x.cmd === "xclip"));
});

test("getClipboardCandidates - linux microsoft kernel puts clip.exe first", () => {
  const c = getClipboardCandidates({
    platform: "linux",
    release: "5.10-microsoft-standard-WSL2",
    env: {},
  });
  assert.equal(c[0].cmd, "clip.exe");
});

test("getClipboardCandidates - linux Wayland includes wl-copy before xclip", () => {
  const c = getClipboardCandidates({
    platform: "linux",
    release: "6.1.0",
    env: { WAYLAND_DISPLAY: "wayland-0" },
  });
  const wlIdx = c.findIndex((x) => x.cmd === "wl-copy");
  const xclipIdx = c.findIndex((x) => x.cmd === "xclip");
  assert.ok(wlIdx !== -1, "wl-copy not found");
  assert.ok(xclipIdx !== -1, "xclip not found");
  assert.ok(wlIdx < xclipIdx, "wl-copy should come before xclip");
});

test("getClipboardCandidates - linux plain returns only xclip and xsel", () => {
  const c = getClipboardCandidates({ platform: "linux", release: "6.1.0", env: {} });
  assert.equal(c.length, 2);
  assert.equal(c[0].cmd, "xclip");
  assert.equal(c[1].cmd, "xsel");
});

test("copyToClipboard - empty string returns empty-input, no spawn called", () => {
  let spawnCalled = false;
  const mockSpawn = () => { spawnCalled = true; return { status: 0 }; };
  const result = copyToClipboard("", { spawn: mockSpawn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-input");
  assert.deepEqual(result.tried, []);
  assert.equal(spawnCalled, false);
});

test("copyToClipboard - whitespace-only string returns empty-input", () => {
  let spawnCalled = false;
  const mockSpawn = () => { spawnCalled = true; return { status: 0 }; };
  const result = copyToClipboard("   \n", { spawn: mockSpawn });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-input");
  assert.equal(spawnCalled, false);
});

test("copyToClipboard - first candidate ENOENT, second succeeds", () => {
  const calls = [];
  const mockSpawn = (cmd, _args, _opts) => {
    calls.push(cmd);
    if (cmd === "xclip") return { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
    return { status: 0 };
  };
  const result = copyToClipboard("hello", {
    spawn: mockSpawn,
    platform: "linux",
    release: "6.1.0",
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.tool, "xsel");
  assert.ok(result.tried.some((t) => t.includes("xclip") && t.includes("missing")));
});

test("copyToClipboard - all candidates ENOENT returns no-tool-found", () => {
  const mockSpawn = () => ({
    error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  });
  const result = copyToClipboard("hello", {
    spawn: mockSpawn,
    platform: "linux",
    release: "6.1.0",
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-tool-found");
});

test("copyToClipboard - spawn called with correct options", () => {
  const spawnArgs = [];
  const mockSpawn = (_cmd, _args, opts) => {
    spawnArgs.push(opts);
    return { status: 0 };
  };
  copyToClipboard("test input", {
    spawn: mockSpawn,
    platform: "darwin",
  });
  assert.equal(spawnArgs.length, 1);
  assert.equal(spawnArgs[0].encoding, "utf8");
  assert.equal(spawnArgs[0].timeout, 2000);
  assert.equal(spawnArgs[0].input, "test input");
});

// ─── integration tests (CLI shim) ────────────────────────────────────────────

function runClipboard(args = [], { input, env = {} } = {}) {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPTS, "clipboard.mjs"), ...args],
    { input, encoding: "utf8", env: { ...process.env, ...env } }
  );
}

test("clipboard.mjs - DAILY_REPORT_NO_CLIPBOARD=1 skips copy", () => {
  const r = runClipboard([], {
    input: "- Proj-工作；\n",
    env: { DAILY_REPORT_NO_CLIPBOARD: "1" },
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("跳过"), `stdout: ${r.stdout}`);
});

test("clipboard.mjs - empty stdin exits 0 with empty-input in stderr", () => {
  const r = runClipboard([], { input: "" });
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("empty-input"), `stderr: ${r.stderr}`);
});

test("clipboard.mjs - no clipboard tool on PATH exits 0 with failure message", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dr-clipboard-empty-"));
  try {
    const r = runClipboard([], {
      input: "- Proj-完成功能；\n",
      env: { PATH: emptyDir },
    });
    assert.equal(r.status, 0);
    assert.ok(r.stderr.includes("复制到剪贴板失败"), `stderr: ${r.stderr}`);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("clipboard.mjs - fake xclip on PATH copies successfully with Chinese text", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dr-clipboard-"));
  const captureFile = path.join(tmpDir, "captured.txt");
  const fakeXclip = path.join(tmpDir, "xclip");
  try {
    fs.writeFileSync(
      fakeXclip,
      `#!/bin/sh\ncat > ${captureFile}\n`,
      { mode: 0o755 }
    );
    const input = "- TestProj-完成功能；\n";
    const r = runClipboard([], {
      input,
      env: {
        PATH: `${tmpDir}:${process.env.PATH}`,
        WAYLAND_DISPLAY: "",
        WSL_DISTRO_NAME: "",
      },
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("已复制到剪贴板"), `stdout: ${r.stdout}`);
    const captured = fs.readFileSync(captureFile, "utf8");
    assert.equal(captured, input);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
