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

test("SKILL.md infers user language preference from context before composing the message", () => {
  assert.match(SKILL, /current conversation/i);
  assert.match(SKILL, /user messages/i);
  assert.match(SKILL, /explicit language instructions/i);
  assert.match(SKILL, /repository\/system context/i);
  assert.match(SKILL, /explicit user language[\s\S]*current conversation dominant language[\s\S]*recent commit request language[\s\S]*default English/i);
});

test("SKILL.md keeps conventional commit tokens in English while localizing natural language parts", () => {
  assert.match(SKILL, /subject\/body use the inferred user language/i);
  assert.match(SKILL, /type\/scope remain Conventional Commit English tokens/i);
  assert.match(SKILL, /Never include `Co-Authored-By` trailers\./);
});
