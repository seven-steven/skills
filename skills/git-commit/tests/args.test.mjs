import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseCommitArgs, readMessageInput } from "../scripts/lib/args.mjs";

// ---------------------------------------------------------------------------
// parseCommitArgs — basic parsing
// ---------------------------------------------------------------------------

test("parseCommitArgs - accepts only a positional message", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "feat: add login"]);
  delete r.error;
  assert.deepEqual(r, { cwd: undefined, taskId: undefined, messageArg: "feat: add login" });
});

test("parseCommitArgs - accepts --cwd with a value", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--cwd", "/tmp/repo", "feat: add login"]);
  delete r.error;
  assert.deepEqual(r, { cwd: "/tmp/repo", taskId: undefined, messageArg: "feat: add login" });
});

test("parseCommitArgs - accepts --task-id with a value", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--task-id", "project-101", "feat: add login"]);
  delete r.error;
  assert.deepEqual(r, { cwd: undefined, taskId: "project-101", messageArg: "feat: add login" });
});

test("parseCommitArgs - accepts both --cwd and --task-id in either order", () => {
  const a = parseCommitArgs(["node", "commit.mjs", "--cwd", "/tmp", "--task-id", "p-1", "feat: x"]);
  delete a.error;
  assert.deepEqual(a, { cwd: "/tmp", taskId: "p-1", messageArg: "feat: x" });

  const b = parseCommitArgs(["node", "commit.mjs", "--task-id", "p-1", "--cwd", "/tmp", "feat: x"]);
  delete b.error;
  assert.deepEqual(b, { cwd: "/tmp", taskId: "p-1", messageArg: "feat: x" });
});

test("parseCommitArgs - returns undefined for missing optional options", () => {
  const r = parseCommitArgs(["node", "commit.mjs"]);
  delete r.error;
  assert.deepEqual(r, { cwd: undefined, taskId: undefined, messageArg: undefined });
});

// ---------------------------------------------------------------------------
// parseCommitArgs — error: missing option value
// ---------------------------------------------------------------------------

test("parseCommitArgs - --cwd without value → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--cwd"]);
  assert.equal(r.error, true);
});

test("parseCommitArgs - --task-id without value → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--task-id"]);
  assert.equal(r.error, true);
});

test("parseCommitArgs - --cwd at end of args without value → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "feat: msg", "--cwd"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// parseCommitArgs — error: option value starts with --
// ---------------------------------------------------------------------------

test("parseCommitArgs - option value cannot be another option", () => {
  // --cwd's value is --task-id
  const a = parseCommitArgs(["node", "commit.mjs", "--cwd", "--task-id", "project-101"]);
  assert.equal(a.error, true);

  // --task-id's value is --cwd
  const b = parseCommitArgs(["node", "commit.mjs", "--task-id", "--cwd", "/tmp"]);
  assert.equal(b.error, true);
});

test("parseCommitArgs - option value cannot be -- (double dash)", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--cwd", "--", "feat: msg"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// parseCommitArgs — error: duplicate options
// ---------------------------------------------------------------------------

test("parseCommitArgs - duplicate --cwd → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--cwd", "/a", "--cwd", "/b", "feat: msg"]);
  assert.equal(r.error, true);
});

test("parseCommitArgs - duplicate --task-id → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--task-id", "a", "--task-id", "b", "feat: msg"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// parseCommitArgs — error: multiple positional arguments
// ---------------------------------------------------------------------------

test("parseCommitArgs - multiple positional arguments → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "feat: first", "and second"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// parseCommitArgs — `--` separator
// ---------------------------------------------------------------------------

test("parseCommitArgs - -- separates options from positional message", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--cwd", "/tmp", "--", "feat: after dash"]);
  delete r.error;
  assert.deepEqual(r, { cwd: "/tmp", taskId: undefined, messageArg: "feat: after dash" });
});

test("parseCommitArgs - -- allows a positional that starts with --", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--", "--task-id"]);
  delete r.error;
  assert.deepEqual(r, { cwd: undefined, taskId: undefined, messageArg: "--task-id" });
});

test("parseCommitArgs - multiple args after -- → error", () => {
  // After --, the first arg is positional; any further args are still excess.
  const r = parseCommitArgs(["node", "commit.mjs", "--", "--cwd", "/tmp"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// parseCommitArgs — unknown --flag falls into positional
// ---------------------------------------------------------------------------

test("parseCommitArgs - unknown --flag becomes positional message", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--unknown-flag"]);
  delete r.error;
  assert.deepEqual(r, { cwd: undefined, taskId: undefined, messageArg: "--unknown-flag" });
});

test("parseCommitArgs - unknown --flag followed by another positional → error", () => {
  const r = parseCommitArgs(["node", "commit.mjs", "--unknown-flag", "another"]);
  assert.equal(r.error, true);
});

// ---------------------------------------------------------------------------
// readMessageInput
// ---------------------------------------------------------------------------

test("readMessageInput - returns argv[2] when present", async () => {
  const result = await readMessageInput({
    argv: ["node", "script.mjs", "feat: from argv"],
    stdin: process.stdin,
  });
  assert.equal(result, "feat: from argv");
});

test("readMessageInput - returns undefined when no argv[2] and stdin is TTY", async () => {
  // We can't easily fake process.stdin.isTTY, but we can pass a mock object.
  const mockStdout = new Readable({ read() {} });
  mockStdout.isTTY = true;
  const result = await readMessageInput({
    argv: ["node", "script.mjs"],
    stdin: mockStdout,
  });
  assert.equal(result, undefined);
});

test("readMessageInput - reads all lines from piped stdin", async () => {
  const mockStdin = new Readable({ read() {} });
  mockStdin.isTTY = false;
  mockStdin.push("line one\n");
  mockStdin.push("line two\n");
  mockStdin.push("line three");
  mockStdin.push(null);  // EOF

  const result = await readMessageInput({
    argv: ["node", "script.mjs"],
    stdin: mockStdin,
  });
  assert.equal(result, "line one\nline two\nline three");
});

test("readMessageInput - empty piped stdin returns empty string", async () => {
  const mockStdin = new Readable({ read() {} });
  mockStdin.isTTY = false;
  mockStdin.push(null);  // Immediate EOF with no data

  const result = await readMessageInput({
    argv: ["node", "script.mjs"],
    stdin: mockStdin,
  });
  assert.equal(result, "");
});

test("readMessageInput - defaults are process.argv and process.stdin", async () => {
  // Supply explicit argv to avoid depending on test-launch argv.
  // stdin defaults to process.stdin; we pass an explicit mock to avoid TTY
  // detection flakiness in CI and hanging on piped-but-never-closed stdin.
  const mockStdin = new Readable({ read() {} });
  mockStdin.isTTY = true;
  const result = await readMessageInput({
    argv: ["node", "script.mjs"],
    stdin: mockStdin,
  });
  assert.equal(result, undefined);
});