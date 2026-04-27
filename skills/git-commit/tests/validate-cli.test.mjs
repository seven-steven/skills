import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

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

// ---------------------------------------------------------------------------
// no input
// ---------------------------------------------------------------------------

test("validate-cli - no argv and empty stdin → exit 2, stderr contains usage", () => {
  const r = run([], "");
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("usage:"));
});
