import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(__dirname, "../scripts/validate.mjs");

function run(args = [], input = undefined) {
  return spawnSync(process.execPath, [VALIDATE, ...args], {
    input,
    encoding: "utf8",
  });
}

// ---------------------------------------------------------------------------
// argv mode
// ---------------------------------------------------------------------------

test("validate-cli - argv: valid message → exit 0, no stderr", () => {
  const r = run(["feat(api): add login endpoint"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), "");
});

test("validate-cli - argv: invalid message → exit 1, stderr contains error", () => {
  const r = run(["BAD MESSAGE"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.length > 0);
});

test("validate-cli - argv: unknown type → exit 1, stderr mentions unknown type", () => {
  const r = run(["bug: fix something"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("unknown type"));
});

// ---------------------------------------------------------------------------
// stdin mode
// ---------------------------------------------------------------------------

test("validate-cli - stdin: valid message → exit 0", () => {
  const r = run([], "fix(core): resolve crash on startup");
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), "");
});

test("validate-cli - stdin: invalid message → exit 1", () => {
  const r = run([], "This is not angular format.");
  assert.equal(r.status, 1);
  assert.ok(r.stderr.length > 0);
});

test("validate-cli - --task-id supports either option order and rejects invalid task IDs", () => {
  for (const args of [
    ["--cwd", tmpdir(), "--task-id", "project-101", "feat: add task"],
    ["--task-id", "%project-101", "--cwd", tmpdir(), "feat: add task"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
  }
  const invalid = run(["--task-id", "not-valid", "feat: add task"]);
  assert.equal(invalid.status, 2);
  assert.ok(invalid.stderr.includes("invalid task ID"));
  for (const args of [["--cwd", "--task-id", "project-101"], ["--task-id", "--cwd", tmpdir()]]) {
    const missingValue = run(args);
    assert.equal(missingValue.status, 2, args.join(" "));
    assert.ok(missingValue.stderr.includes("usage:"));
  }
});

// ---------------------------------------------------------------------------
// no input
// ---------------------------------------------------------------------------

test("validate-cli - no argv and empty stdin → exit 2, stderr contains usage", () => {
  const r = run([], "");
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("usage:"));
});
