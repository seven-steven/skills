import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(__dirname, "../SKILL.md"), "utf8");

test("SKILL.md preserves the required metadata and explicit slash-command trigger", () => {
  assert.match(SKILL, /^model: haiku$/m);
  assert.match(SKILL, /^disable-model-invocation: true$/m);
  assert.match(SKILL, /显式调用 \/git-commit 时使用/);
});

test("SKILL.md resolves both scripts from the loaded skill directory", () => {
  assert.match(SKILL, /Base directory for this skill/);
  assert.match(SKILL, /<skill-dir>\/scripts/);
  assert.match(SKILL, /<scripts-dir>\/task-id\.mjs[\s\S]*<scripts-dir>\/validate\.mjs[\s\S]*<scripts-dir>\/commit\.mjs/);
  assert.doesNotMatch(SKILL, /~\/\.claude\/plugins\/cache[\s\S]*git-commit\/scripts\/validate\.mjs/);
});

test("SKILL.md starts with lightweight branch and status context", () => {
  assert.match(SKILL, /Current branch: !`git branch --show-current`/);
  assert.match(SKILL, /Git status: !`git status --short --branch`/);
  assert.doesNotMatch(SKILL, /^- Staged and unstaged diff:/m);
  assert.doesNotMatch(SKILL, /^- Recent commits:/m);
  assert.doesNotMatch(SKILL, /^- Submodule status:/m);
  assert.match(SKILL, /Read additional Git data only when it is needed/i);
});

test("SKILL.md reads diff, log, and submodule details on demand", () => {
  assert.match(SKILL, /Read `git diff HEAD` only when/i);
  assert.match(SKILL, /Read `git log --oneline -10` only when/i);
  assert.match(SKILL, /git status --short --branch --ignore-submodules=none/);
  assert.match(SKILL, /git submodule status --recursive/);
  assert.match(SKILL, /git submodule foreach --recursive git status --short/);
});

test("SKILL.md passes the resolved task ID to both helpers", () => {
  assert.doesNotMatch(SKILL, /SKILL_SCRIPTS_DIR|printf '%s'[\s\S]*\| node/);
  assert.match(SKILL, /node\s+["']<scripts-dir>\/validate\.mjs["']\s+--task-id\s+["']<resolved-task-id>["']\s+["']<message>["']/);
  assert.match(SKILL, /node\s+["']<scripts-dir>\/commit\.mjs["']\s+--task-id\s+["']<resolved-task-id>["']\s+["']<message>["']/);
  assert.match(SKILL, /Omit `--task-id` when resolution returned no value\./);
});

test("SKILL.md resolves and reuses task IDs without changing message content", () => {
  assert.match(SKILL, /argument-hint: <task ID> \(optional; replaces the generated task-ID footer\)/);
  assert.match(SKILL, /Resolve the task ID once[\s\S]*Reuse this one resolved value for every affected submodule and the parent repository/);
  assert.match(SKILL, /optional slash-command argument as an explicit task ID, not text to append to the subject/i);
  assert.match(SKILL, /invalid explicit ID[\s\S]*stop[\s\S]*do not fall back to automatic discovery/i);
  assert.match(SKILL, /user\.email[\s\S]*up to ten commits reachable from `HEAD` by that author/i);
  assert.match(SKILL, /automatic resolution produces no usable value or fails, continue without a task-ID footer/i);
  assert.match(SKILL, /normalized to exactly one leading `%`/i);
  assert.match(SKILL, /independent canonical `<footer>`, `- srdcloud task id: %<task-id>`/);
  assert.match(SKILL, /after any Git trailers/i);
  assert.match(SKILL, /not part of the subject or body/i);
  assert.match(SKILL, /does not alter the message subject or body/i);
});

test("SKILL.md infers user language preference from context before composing the message", () => {
  assert.match(SKILL, /current conversation/i);
  assert.match(SKILL, /user messages/i);
  assert.match(SKILL, /explicit language instructions/i);
  assert.match(SKILL, /repository\/system context/i);
  assert.match(SKILL, /explicit user language[\s\S]*dominant language of the current conversation[\s\S]*language of the recent commit request[\s\S]*English/i);
});

test("SKILL.md keeps conventional commit tokens in English while localizing natural language parts", () => {
  assert.match(SKILL, /natural-language subject and body in the inferred language/i);
  assert.match(SKILL, /type` and `scope` in English/i);
  assert.match(SKILL, /Never include a `Co-Authored-By` trailer\./);
});

test("SKILL.md stages only relevant files and limits validation retries", () => {
  assert.match(SKILL, /Stage only files related to the current session's work/i);
  assert.match(SKILL, /Ask the user instead of guessing when the relevant scope is unclear/i);
  assert.match(SKILL, /no more than three validation attempts/i);
});

test("SKILL.md requires deepest-first submodule commits before parent commits", () => {
  assert.match(SKILL, /commit each affected submodule before its parent repository/i);
  assert.match(SKILL, /node\s+["']<scripts-dir>\/commit\.mjs["']\s+--cwd\s+["']<submodule-path>["']\s+--task-id\s+["']<resolved-task-id>["']\s+["']<submodule-message>["']/);
  assert.match(SKILL, /git add <submodule-path>/);
  assert.match(SKILL, /nested submodules deepest-first/i);
});

test("SKILL.md reports commit hashes and remaining changes", () => {
  assert.match(SKILL, /Report the final commit hash/i);
  assert.match(SKILL, /changes left uncommitted or unstaged/i);
});
