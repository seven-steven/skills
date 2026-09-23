import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(testsDir, "..");

function readPluginFile(relativePath) {
  return fs.readFileSync(path.join(pluginDir, relativePath), "utf8");
}

function frontmatterValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

const promptingSkill = readPluginFile("skills/codefree-prompting/SKILL.md");
const resultSkill = readPluginFile("skills/codefree-result-handling/SKILL.md");
const agent = readPluginFile("agents/codefree-task.md");

test("prompting contract - internal-only skill preserves specific tasks with minimal pass-through", () => {
  assert.equal(frontmatterValue(promptingSkill, "name"), "codefree-prompting");
  assert.equal(frontmatterValue(promptingSkill, "user-invocable"), "false");
  assert.match(promptingSkill, /Specific, bounded task — minimal pass-through/);
  assert.match(promptingSkill, /Forward the task text unchanged/);
  assert.match(promptingSkill, /Do not wrap it in XML, add inferred scope/);
});

test("prompting contract - retains serial objectives and asks caller about conflicts or unknown scope", () => {
  assert.match(promptingSkill, /Serially composable task — retain every objective/);
  assert.match(promptingSkill, /preserve every objective and its stated order/);
  assert.match(promptingSkill, /Conflicting or unknown scope — ask the caller to clarify/);
  assert.match(promptingSkill, /Do not guess paths, protected files, acceptance criteria, or a preferred interpretation/);
});

test("prompting contract - only faithfully restates supplied constraints", () => {
  assert.match(promptingSkill, /Constraints — faithfully restate only known constraints/);
  assert.match(promptingSkill, /Do not add generic restrictions/);
  assert.match(promptingSkill, /Omit unsupported blocks/);
});

test("result contract - internal-only skill preserves raw evidence before derived views", () => {
  assert.equal(frontmatterValue(resultSkill, "name"), "codefree-result-handling");
  assert.equal(frontmatterValue(resultSkill, "user-invocable"), "false");
  assert.match(resultSkill, /Raw result — authoritative record/);
  assert.match(resultSkill, /original order/);
  assert.match(resultSkill, /file paths[;,.\s]/);
  assert.match(resultSkill, /line numbers/);
  assert.match(resultSkill, /diffs/);
  assert.match(resultSkill, /uncertainty markers/);
  assert.match(resultSkill, /Derived summary or index — optional navigation aid/);
});

test("result contract - severity only augments raw findings", () => {
  assert.match(resultSkill, /severity label may be added/);
  assert.match(resultSkill, /must not alter the finding's wording, order, path, line number, diff, or uncertainty/);
  assert.match(resultSkill, /Do not claim a severity, completion state, or conclusion absent from the raw result/);
});

test("result contract - positive termination forbids fallback, retries, and modifications", () => {
  assert.match(resultSkill, /Positive termination protocol/);
  assert.match(resultSkill, /control is returning to the caller/);
  assert.match(resultSkill, /make no fallback implementation, retry, additional command, or repository modification/);
  assert.match(resultSkill, /Only the caller may request a new delegation or a further action/);
});

test("subagent contract - wires both skills and applies their forwarding and termination boundaries", () => {
  assert.match(agent, /skills:\n  - codefree-prompting\n  - codefree-result-handling/);
  assert.match(agent, /apply the `codefree-prompting` skill/);
  assert.match(agent, /Preserve every objective in an ordered composite task/);
  assert.match(agent, /ask the caller to clarify instead of invoking codefree/);
  assert.match(agent, /Never infer paths, verification steps, or constraints/);
  assert.match(agent, /exactly one Bash call/);
  assert.match(agent, /raw output is authoritative/);
  assert.match(agent, /Do not retry, fall back to implementing work, or make repository changes after codefree returns/);
});

test("subagent contract - passes the prompt via private temp files, never inline shell text", () => {
  assert.match(agent, /tools: Bash, Write/);
  assert.match(agent, /nothing user-supplied ever appears on a shell command line/);
  assert.match(agent, /--request-file/);
  assert.match(agent, /mkdtempSync/);
  assert.match(agent, /mode 0700/);
  assert.match(agent, /verbatim, unmodified/);
  assert.match(agent, /no JSON escaping/);
  assert.match(agent, /promptFile/);
  assert.match(agent, /Never write the task text itself into the JSON/);
  assert.match(agent, /Never write either file inside any repository/);
  assert.match(agent, /deletes both files — and the emptied private directory — afterwards/);
  assert.match(agent, /Never forward `--attach`, `--share`, `--command`, `--file`, `--title`, `--port`/);
  assert.match(agent, /--auto/);
  assert.match(agent, /`timeout` parameter to `600000`/);
  assert.match(agent, /defaults to 120 000 ms/);
});
