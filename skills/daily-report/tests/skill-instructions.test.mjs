import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(__dirname, "../SKILL.md"), "utf8");

test("SKILL.md has required frontmatter fields", () => {
  assert.match(SKILL, /^name: daily-report$/m);
  assert.match(SKILL, /^disable-model-invocation: true$/m);
  assert.match(SKILL, /^description:[\s\S]*?工作日报/m);
});

test("SKILL.md references all four scripts with correct paths", () => {
  assert.match(SKILL, /node\s+["']<Base directory>\/scripts\/commits\.mjs["']/);
  assert.match(SKILL, /node\s+["']<Base directory>\/scripts\/cache\.mjs["']/);
  assert.match(SKILL, /node\s+["']<Base directory>\/scripts\/validate\.mjs["']/);
  assert.match(SKILL, /node\s+["']<Base directory>\/scripts\/clipboard\.mjs["']/);
});

test("SKILL.md references cache write and read actions by name", () => {
  assert.match(SKILL, /cache\.mjs["']\s+write\s+/);
  assert.match(SKILL, /cache\.mjs["']\s+read\s+/);
});

test("SKILL.md validates in the CN bullet format with semifull-width semicolons", () => {
  assert.match(SKILL, /-\s*ProjectName-WorkContent；/);
  assert.match(SKILL, /-\s*ProjectName-BusinessModule-WorkContent；/);
  assert.match(SKILL, /validate/);
});

test("SKILL.md stops on no-new-commits without advancing cache", () => {
  assert.match(SKILL, /暂无新提交，无需生成日报。/);
  assert.match(SKILL, /Do not validate, copy, or change either cache/);
});

test("SKILL.md requires the commit-ID reported cache to advance only after validation passes", () => {
  assert.match(SKILL, /Never advance the commit cache before validation succeeds/);
  assert.match(SKILL, /write-reported[\s\S]*JSON array of every full SHA/);
});

test("SKILL.md describes incremental frontier using commit IDs, not SHA ranges", () => {
  assert.match(SKILL, /always runs `git log --since=midnight --all`/);
  assert.match(SKILL, /removes IDs already recorded for today/);
  assert.match(SKILL, /full-sha<TAB>subject/);
  assert.doesNotMatch(SKILL, /cached-sha\.\.HEAD/);
});

test("SKILL.md describes three mutually exclusive completion states", () => {
  assert.match(SKILL, /No-new-commits/);
  assert.match(SKILL, /Validation-failed/);
  assert.match(SKILL, /Reported/);
});

test("SKILL.md documents environment configuration knobs", () => {
  assert.match(SKILL, /DAILY_REPORT_CACHE_DIR/);
  assert.match(SKILL, /DAILY_REPORT_NO_CLIPBOARD/);
});