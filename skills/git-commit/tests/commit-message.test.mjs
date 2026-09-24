import test from "node:test";
import assert from "node:assert/strict";

import {
  ANGULAR_TYPES,
  MAX_SUBJECT_LENGTH,
  validateMessage,
  addTaskIdFooter,
} from "../scripts/lib/commit-message.mjs";
import { TASK_ID_FOOTER_PREFIX } from "../scripts/lib/task-id.mjs";

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
// task ID footer
// ---------------------------------------------------------------------------

test("addTaskIdFooter - appends the canonical footer as an independent final section", () => {
  const result = addTaskIdFooter("feat: add task support\n\nBody text.", "%project-101");
  assert.equal(result, "feat: add task support\n\nBody text.\n\n- srdcloud task id: %project-101");
  assert.equal(result.split("\n").at(-1), `${TASK_ID_FOOTER_PREFIX} %project-101`);
});

test("addTaskIdFooter - replaces the trailing footer, normalizes line endings, and is idempotent", () => {
  const source = [
    "feat: add task support\r\n",
    "\r\n",
    "Body text.\r\n",
    "\r\n",
    "- srdcloud task id: 42\r\n",
    "\r\n",
  ].join("");
  const once = addTaskIdFooter(source, "%project-101");
  const twice = addTaskIdFooter(once, "%project-101");
  assert.equal(twice, once);
  assert.equal(once, "feat: add task support\n\nBody text.\n\n- srdcloud task id: %project-101");
});

test("addTaskIdFooter - preserves task-like lines that are not the trailing footer", () => {
  const source = "feat: add task support\n\n- srdcloud task id: %old-1\nExplanation";
  const result = addTaskIdFooter(source, "%project-102");
  assert.ok(result.includes("- srdcloud task id: %old-1\nExplanation"));
  assert.ok(result.endsWith("- srdcloud task id: %project-102"));
});

test("addTaskIdFooter - preserves similar body lines that are not valid task footers", () => {
  const source = [
    "feat: add task support",
    "",
    "- srdcloud task id: explanation",
    "- srdcloud task id: %bad trailing text",
    "- srdcloud task id:  %project-101",
  ].join("\n");
  const result = addTaskIdFooter(source, "%project-102");
  assert.ok(result.includes("- srdcloud task id: explanation"));
  assert.ok(result.includes("- srdcloud task id: %bad trailing text"));
  assert.ok(result.includes("- srdcloud task id:  %project-101"));
  assert.ok(result.endsWith("- srdcloud task id: %project-102"));
});
