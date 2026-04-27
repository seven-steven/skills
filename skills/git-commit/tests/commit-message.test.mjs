import test from "node:test";
import assert from "node:assert/strict";

import {
  ANGULAR_TYPES,
  MAX_SUBJECT_LENGTH,
  parseMessage,
  validateMessage,
  formatErrorReport,
} from "../scripts/lib/commit-message.mjs";

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

test("parseMessage - single-line message", () => {
  const r = parseMessage("feat: add login");
  assert.equal(r.subject, "feat: add login");
  assert.equal(r.body, "");
  assert.deepEqual(r.trailers, []);
});

test("parseMessage - subject + body separated by blank line", () => {
  const r = parseMessage("feat: add x\n\nThis is the body.");
  assert.equal(r.subject, "feat: add x");
  assert.equal(r.body, "This is the body.");
});

test("parseMessage - subject + body + trailers", () => {
  const r = parseMessage("fix: broken\n\nBody text.\n\nRefs: #42\nFixes: #99");
  assert.equal(r.subject, "fix: broken");
  assert.deepEqual(r.trailers, ["Refs: #42", "Fixes: #99"]);
});

test("parseMessage - normalizes CRLF line endings", () => {
  const r = parseMessage("feat: add x\r\n\r\nbody line");
  assert.equal(r.subject, "feat: add x");
  assert.equal(r.body, "body line");
});

test("parseMessage - strips leading UTF-8 BOM", () => {
  const r = parseMessage("﻿feat: add x");
  assert.equal(r.subject, "feat: add x");
});

test("parseMessage - ignores trailing blank lines", () => {
  const r = parseMessage("feat: add x\n\nbody\n\n\n");
  assert.equal(r.subject, "feat: add x");
  assert.equal(r.body, "body");
});

// ---------------------------------------------------------------------------
// ANGULAR_TYPES / MAX_SUBJECT_LENGTH constants
// ---------------------------------------------------------------------------

test("ANGULAR_TYPES - contains all expected types", () => {
  const expected = [
    "feat", "fix", "docs", "style", "refactor",
    "test", "chore", "perf", "build", "ci", "revert",
  ];
  assert.deepEqual(ANGULAR_TYPES, expected);
});

test("MAX_SUBJECT_LENGTH - is 72", () => {
  assert.equal(MAX_SUBJECT_LENGTH, 72);
});

// ---------------------------------------------------------------------------
// validateMessage - happy path
// ---------------------------------------------------------------------------

test("validateMessage - simple feat without scope", () => {
  const r = validateMessage("feat: add user login");
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.parsed.type, "feat");
  assert.equal(r.parsed.scope, null);
  assert.equal(r.parsed.subject, "add user login");
});

test("validateMessage - fix with scope", () => {
  const r = validateMessage("fix(auth): resolve token expiry");
  assert.equal(r.ok, true);
  assert.equal(r.parsed.type, "fix");
  assert.equal(r.parsed.scope, "auth");
});

test("validateMessage - scope with dash", () => {
  const r = validateMessage("feat(scope-with-dash): some feature");
  assert.equal(r.ok, true);
  assert.equal(r.parsed.scope, "scope-with-dash");
});

test("validateMessage - subject at exactly 72 characters", () => {
  const subject = "a".repeat(62);
  const r = validateMessage(`feat: ${subject}`);
  assert.equal(r.ok, true);
});

test("validateMessage - multiline with blank separator", () => {
  const msg = "feat: add x\n\nThis is a detailed body.\n\nRefs: #123";
  const r = validateMessage(msg);
  assert.equal(r.ok, true);
});

test("validateMessage - all Angular types are accepted", () => {
  for (const type of ANGULAR_TYPES) {
    const r = validateMessage(`${type}: do something`);
    assert.equal(r.ok, true, `Expected ${type} to be valid`);
  }
});

// ---------------------------------------------------------------------------
// validateMessage - error cases
// ---------------------------------------------------------------------------

test("validateMessage - empty message", () => {
  const r = validateMessage("");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("subject is empty")));
});

test("validateMessage - whitespace-only message", () => {
  const r = validateMessage("   \n  \n");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("subject is empty")));
});

test("validateMessage - subject exceeds 72 characters", () => {
  // "feat: " is 6 chars; 67 more = 73 total > 72
  const subject = "a".repeat(67);
  const r = validateMessage(`feat: ${subject}`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("exceeds 72 characters")));
});

test("validateMessage - missing Angular header (no colon)", () => {
  const r = validateMessage("feat add something");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('missing "<type>(<scope>): <subject>"')));
});

test("validateMessage - unknown type", () => {
  const r = validateMessage("bug: fix something");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown type "bug"')));
});

test("validateMessage - unknown type is case-sensitive (Feature not allowed)", () => {
  const r = validateMessage("Feature: add something");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unknown type") || e.includes('missing "<type>')));
});

test("validateMessage - subject starts with uppercase", () => {
  const r = validateMessage("feat: Add something");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("must not start with uppercase")));
});

test("validateMessage - subject ends with period", () => {
  const r = validateMessage("feat: add something.");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("must not end with a period")));
});

test("validateMessage - second line is not blank", () => {
  const r = validateMessage("feat: add x\nnot a blank line");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("body must be separated")));
});

test("validateMessage - Co-authored-by trailer (case-insensitive)", () => {
  const r = validateMessage("feat: add x\n\nCo-authored-by: Bot <bot@example.com>");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("Co-Authored-By")));
});

test("validateMessage - Co-Authored-By uppercase variant", () => {
  const r = validateMessage("feat: add x\n\nCo-Authored-By: Bot <bot@example.com>");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("Co-Authored-By")));
});

test("validateMessage - empty subject after colon", () => {
  const r = validateMessage("feat: ");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("subject must not be empty after the colon")));
});

// ---------------------------------------------------------------------------
// formatErrorReport
// ---------------------------------------------------------------------------

test("formatErrorReport - joins multiple errors with newlines", () => {
  const report = formatErrorReport(["error one", "error two"]);
  assert.ok(report.includes("error one"));
  assert.ok(report.includes("error two"));
  const lines = report.split("\n").filter(Boolean);
  assert.ok(lines.length >= 2);
});

test("formatErrorReport - single error", () => {
  const report = formatErrorReport(["subject is empty"]);
  assert.ok(report.includes("subject is empty"));
});
