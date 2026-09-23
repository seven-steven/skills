import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { cleanupSandbox, makeSandbox, readJsonFile, runCompanion, writeJsonFile } from "./helpers.mjs";

test("task - multi-byte UTF-8 text split across pipe chunks is reassembled", () => {
  const sandbox = makeSandbox();
  try {
    // Covers CJK (3-byte), emoji (4-byte) and accented (2-byte) chars so the
    // split point lands mid-character no matter the offset chosen below.
    const tricky = "修复完成 🎉 ça va — settings.json 更新完毕 ✅";
    sandbox.env.CODEFREE_FAKE_SCENARIO = writeJsonFile(path.join(sandbox.tempDir, "scenario.json"), {
      splitText: { text: tricky, splitAt: 7 },
      exitCode: 0
    });

    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      ...sandbox,
      input: "go"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(tricky), `expected reassembled text, got: ${result.stdout}`);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - non-ASCII prompt reaches the fake binary verbatim", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = writeJsonFile(path.join(sandbox.tempDir, "scenario.json"), {
      events: [{ type: "text", sessionID: "s", part: { type: "text", text: "好的 ✅" } }],
      exitCode: 0
    });
    const prompt = "请修复 src/登录.ts 的表单校验 — 目标:100% 覆盖 🚀";
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      ...sandbox,
      input: prompt
    });
    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    const sep = record.argv.indexOf("--");
    assert.equal(record.argv[sep + 1], prompt);
  } finally {
    cleanupSandbox(sandbox);
  }
});
