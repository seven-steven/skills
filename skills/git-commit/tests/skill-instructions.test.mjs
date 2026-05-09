import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(__dirname, "../SKILL.md"), "utf8");

test("SKILL.md resolves both scripts from the loaded skill directory", () => {
  assert.match(SKILL, /Base directory for this skill/);
  assert.match(SKILL, /<skill-dir>\/scripts/);
  assert.match(SKILL, /<scripts-dir>\/validate\.mjs[\s\S]*<scripts-dir>\/commit\.mjs/);
  assert.doesNotMatch(SKILL, /~\/\.claude\/plugins\/cache[\s\S]*git-commit\/scripts\/validate\.mjs/);
});

test("SKILL.md uses direct node calls without shell-pipeline setup", () => {
  assert.doesNotMatch(SKILL, /SKILL_SCRIPTS_DIR|printf '%s'[\s\S]*\| node/);
  assert.match(SKILL, /node\s+["']<scripts-dir>\/validate\.mjs["']\s+["']<message>["']/);
  assert.match(SKILL, /node\s+["']<scripts-dir>\/commit\.mjs["']\s+["']<message>["']/);
});
