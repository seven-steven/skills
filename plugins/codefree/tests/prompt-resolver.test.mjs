import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolvePrompt } from "../scripts/lib/prompt-resolver.mjs";

function makePromptFile(prefix, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codefree-req-test-"));
  const filePath = path.join(dir, `codefree-task-${prefix}.txt`);
  fs.writeFileSync(filePath, content, "utf8");
  return { dir, filePath };
}

// ---------------------------------------------------------------------------
// three sources + mutual exclusion
// ---------------------------------------------------------------------------

test("resolvePrompt - reads --prompt-file verbatim including trailing newline", () => {
  const { dir, filePath } = makePromptFile("verbatim01", "do the thing\n");
  try {
    const prompt = resolvePrompt({ "prompt-file": filePath });
    assert.equal(prompt, "do the thing\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePrompt - reads --prompt-stdin via injected reader", () => {
  const prompt = resolvePrompt({ "prompt-stdin": true }, { readStdin: () => "from stdin" });
  assert.equal(prompt, "from stdin");
});

test("resolvePrompt - returns empty string when neither source is given but continue is set", () => {
  assert.equal(resolvePrompt({ continue: true }), "");
  assert.equal(resolvePrompt({ session: "ses-1" }), "");
});

test("resolvePrompt - --prompt-file and --prompt-stdin together is a usage error", () => {
  const { dir, filePath } = makePromptFile("bothsrc01", "x");
  try {
    assert.throws(
      () => resolvePrompt({ "prompt-file": filePath, "prompt-stdin": true }),
      /not both/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// empty prompt rules
// ---------------------------------------------------------------------------

test("resolvePrompt - empty prompt without continue/session is a usage error", () => {
  assert.throws(
    () => resolvePrompt({ "prompt-stdin": true }, { readStdin: () => "   \n" }),
    /Empty task/
  );
});

test("resolvePrompt - empty prompt with continue is allowed", () => {
  const prompt = resolvePrompt(
    { continue: true, "prompt-stdin": true },
    { readStdin: () => "" }
  );
  assert.equal(prompt, "");
});

test("resolvePrompt - empty prompt with session is allowed", () => {
  const prompt = resolvePrompt(
    { session: "ses-x", "prompt-stdin": true },
    { readStdin: () => "" }
  );
  assert.equal(prompt, "");
});

test("resolvePrompt - whitespace-only prompt file without continue fails", () => {
  const { dir, filePath } = makePromptFile("spaces01", "   \n  ");
  try {
    assert.throws(() => resolvePrompt({ "prompt-file": filePath }), /Empty task/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// file read errors + cleanup
// ---------------------------------------------------------------------------

test("resolvePrompt - unreadable prompt file is a usage error", () => {
  assert.throws(
    () => resolvePrompt({ "prompt-file": path.join(os.tmpdir(), "does-not-exist-codefree.txt") }),
    /Cannot read prompt file/
  );
});

test("resolvePrompt - conforming temp prompt file is deleted after reading", () => {
  const { dir, filePath } = makePromptFile("cleanup01", "content");
  try {
    resolvePrompt({ "prompt-file": filePath });
    assert.equal(fs.existsSync(filePath), false, "conforming prompt file must be cleaned up");
    assert.equal(fs.existsSync(dir), false, "emptied private dir is removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePrompt - non-conforming prompt file is read but not deleted", () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), "codefree-prompt-out-"));
  try {
    const filePath = path.join(dir, "important.txt");
    fs.writeFileSync(filePath, "keep", "utf8");
    const prompt = resolvePrompt({ "prompt-file": filePath });
    assert.equal(prompt, "keep");
    assert.equal(fs.existsSync(filePath), true, "non-conforming file must not be deleted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
