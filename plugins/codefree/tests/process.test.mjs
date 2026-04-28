import test from "node:test";
import assert from "node:assert/strict";

import {
  binaryAvailable,
  formatCommandFailure,
  runCommand,
  terminateProcessTree
} from "../scripts/lib/process.mjs";

test("runCommand - captures stdout from echo-ish command", () => {
  const result = runCommand("node", ["-e", "process.stdout.write('hi')"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "hi");
});

test("runCommand - non-zero exit reflected in status", () => {
  const result = runCommand("node", ["-e", "process.exit(3)"]);
  assert.equal(result.status, 3);
});

test("binaryAvailable - reports unavailable when binary missing", () => {
  const result = binaryAvailable("definitely-not-a-real-binary-xyzzy");
  assert.equal(result.available, false);
});

test("binaryAvailable - reports available for node", () => {
  const result = binaryAvailable("node", ["--version"]);
  assert.equal(result.available, true);
});

test("formatCommandFailure - includes exit code", () => {
  const text = formatCommandFailure({
    command: "fake",
    args: ["--flag"],
    status: 2,
    signal: null,
    stdout: "",
    stderr: "boom"
  });
  assert.match(text, /fake --flag/);
  assert.match(text, /exit=2/);
  assert.match(text, /boom/);
});

test("formatCommandFailure - includes signal when present", () => {
  const text = formatCommandFailure({
    command: "fake",
    args: [],
    status: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: ""
  });
  assert.match(text, /signal=SIGTERM/);
});

test("terminateProcessTree - returns no-op for non-finite pid", () => {
  const result = terminateProcessTree(NaN);
  assert.equal(result.attempted, false);
  assert.equal(result.delivered, false);
});

test("terminateProcessTree - posix path uses process group via killImpl", () => {
  const calls = [];
  const killImpl = (pid, signal) => {
    calls.push({ pid, signal });
  };
  const result = terminateProcessTree(1234, {
    platform: "linux",
    killImpl
  });
  assert.equal(result.attempted, true);
  assert.equal(result.delivered, true);
  assert.equal(result.method, "process-group");
  assert.deepEqual(calls, [{ pid: -1234, signal: "SIGTERM" }]);
});

test("terminateProcessTree - posix falls back to process when group fails", () => {
  const calls = [];
  const killImpl = (pid, signal) => {
    calls.push({ pid, signal });
    if (pid < 0) {
      const err = new Error("group not found");
      err.code = "EPERM";
      throw err;
    }
  };
  const result = terminateProcessTree(2222, {
    platform: "linux",
    killImpl
  });
  assert.equal(result.method, "process");
  assert.equal(result.delivered, true);
  assert.deepEqual(calls, [
    { pid: -2222, signal: "SIGTERM" },
    { pid: 2222, signal: "SIGTERM" }
  ]);
});

test("terminateProcessTree - posix ESRCH on group means process is gone", () => {
  const killImpl = () => {
    const err = new Error("no such process");
    err.code = "ESRCH";
    throw err;
  };
  const result = terminateProcessTree(3333, {
    platform: "linux",
    killImpl
  });
  assert.equal(result.delivered, false);
  assert.equal(result.method, "process-group");
});

test("terminateProcessTree - win32 uses taskkill via runCommandImpl", () => {
  const calls = [];
  const runCommandImpl = (command, args) => {
    calls.push({ command, args });
    return { command, args, status: 0, signal: null, stdout: "", stderr: "", error: null };
  };
  const result = terminateProcessTree(4444, {
    platform: "win32",
    runCommandImpl,
    killImpl: () => {
      throw new Error("kill should not be called when taskkill succeeds");
    }
  });
  assert.equal(result.method, "taskkill");
  assert.equal(result.delivered, true);
  assert.deepEqual(calls, [
    { command: "taskkill", args: ["/PID", "4444", "/T", "/F"] }
  ]);
});

test("terminateProcessTree - win32 'not found' message means process is gone", () => {
  const runCommandImpl = () => ({
    command: "taskkill",
    args: [],
    status: 128,
    signal: null,
    stdout: "",
    stderr: "ERROR: The process \"5555\" not found.",
    error: null
  });
  const result = terminateProcessTree(5555, {
    platform: "win32",
    runCommandImpl
  });
  assert.equal(result.method, "taskkill");
  assert.equal(result.delivered, false);
});
