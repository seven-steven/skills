import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AGENT_TEMP_DIR,
  AGENT_TEMP_FILE,
  loadRequestFile,
  safeDeleteTempFile
} from "../scripts/lib/request-file.mjs";
import { UsageError } from "../scripts/lib/errors.mjs";
import { makeTempDir } from "./helpers.mjs";

function writeRequest(dir, basename, body) {
  const filePath = path.join(dir, basename);
  fs.writeFileSync(filePath, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return filePath;
}

function privateDir() {
  // Same naming convention the agent uses (codefree-req-<random>).
  return fs.mkdtempSync(path.join(os.tmpdir(), "codefree-req-test-"));
}

// ---------------------------------------------------------------------------
// loadRequestFile — validation
// ---------------------------------------------------------------------------

test("loadRequestFile - rejects unknown keys", () => {
  const dir = privateDir();
  try {
    const requestFile = writeRequest(dir, "codefree-request-unkkey001.json", { attach: "http://evil" });
    assert.throws(() => loadRequestFile(requestFile), (err) => {
      assert.ok(err instanceof UsageError);
      assert.match(err.message, /unknown key\(s\): attach/);
      return true;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - rejects values failing the strict pattern", () => {
  const cases = [
    { model: "-leading-dash" },
    { session: "../traversal" },
    { model: "noSpace here" },
    { agent: "" }
  ];
  for (const body of cases) {
    const dir = privateDir();
    try {
      const requestFile = writeRequest(dir, "codefree-request-badval001.json", body);
      assert.throws(() => loadRequestFile(requestFile), (err) => {
        assert.ok(err instanceof UsageError, `expected UsageError for ${JSON.stringify(body)}`);
        assert.match(err.message, /failed its validation pattern/);
        return true;
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("loadRequestFile - prompt and promptFile are mutually exclusive", () => {
  const dir = privateDir();
  try {
    const promptFile = path.join(dir, "codefree-task-bothboth01.txt");
    fs.writeFileSync(promptFile, "task text", "utf8");
    const requestFile = writeRequest(dir, "codefree-request-bothboth01.json", {
      prompt: "also a prompt",
      promptFile,
      cwd: "."
    });
    assert.throws(() => loadRequestFile(requestFile), /not both/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - prompt type and timeoutMs type are validated", () => {
  const cases = [
    { prompt: 42 },
    { prompt: "go", timeoutMs: -5 },
    { prompt: "go", timeoutMs: "soon" },
    { prompt: "go", continue: "yes" }
  ];
  for (const body of cases) {
    const dir = privateDir();
    try {
      const requestFile = writeRequest(dir, "codefree-request-badtype01.json", body);
      assert.throws(() => loadRequestFile(requestFile), UsageError, JSON.stringify(body));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("loadRequestFile - maps camelCase timeoutMs to kebab --timeout-ms", () => {
  const dir = privateDir();
  try {
    const requestFile = writeRequest(dir, "codefree-request-tmo0001.json", {
      prompt: "go",
      timeoutMs: 12345
    });
    const options = loadRequestFile(requestFile);
    assert.equal(options["timeout-ms"], "12345");
    assert.equal(options.__prompt, "go");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadRequestFile — two-file workflow
// ---------------------------------------------------------------------------

test("loadRequestFile - two-file workflow reads prompt verbatim and cleans both files", () => {
  const dir = privateDir();
  try {
    const multiline = "Step 1: run\nStep 2: \"quote\" — done 🎉\n";
    const promptFile = path.join(dir, "codefree-task-twofile02.txt");
    fs.writeFileSync(promptFile, multiline, "utf8");
    const requestFile = writeRequest(dir, "codefree-request-twofile02.json", {
      promptFile,
      cwd: "."
    });

    const options = loadRequestFile(requestFile);
    assert.equal(options.__prompt, multiline, "multiline text must survive byte-for-byte");
    assert.equal(options.__promptFile, undefined, "internal __promptFile must be consumed");
    assert.equal(fs.existsSync(requestFile), false, "request file cleaned up");
    assert.equal(fs.existsSync(promptFile), false, "prompt file cleaned up");
    assert.equal(fs.existsSync(dir), false, "emptied private dir is removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - promptFile outside the agent temp convention is rejected", () => {
  const dir = privateDir();
  try {
    const requestFile = writeRequest(dir, "codefree-request-evilpath2.json", {
      promptFile: "/etc/passwd",
      cwd: "."
    });
    assert.throws(() => loadRequestFile(requestFile), /agent temp file/);
    // the request file itself is still cleaned up (conforming name)
    assert.equal(fs.existsSync(requestFile), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - promptFile in a different directory is rejected", () => {
  const dir = privateDir();
  const otherDir = privateDir();
  try {
    const promptFile = path.join(otherDir, "codefree-task-otherdir01.txt");
    fs.writeFileSync(promptFile, "x", "utf8");
    const requestFile = writeRequest(dir, "codefree-request-otherdir1.json", {
      promptFile,
      cwd: "."
    });
    assert.throws(() => loadRequestFile(requestFile), /same private temp directory/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(otherDir, { recursive: true, force: true });
  }
});

test("loadRequestFile - promptFile pointing at a symlink is refused before reading", () => {
  const dir = privateDir();
  try {
    const target = path.join(dir, "codefree-task-realreal01.txt");
    fs.writeFileSync(target, "real content", "utf8");
    const symlink = path.join(dir, "codefree-task-symlink01.txt");
    fs.symlinkSync(target, symlink);
    const requestFile = writeRequest(dir, "codefree-request-symlink01.json", {
      promptFile: symlink,
      cwd: "."
    });
    assert.throws(() => loadRequestFile(requestFile), /must be a regular file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - invalid JSON is rejected", () => {
  const dir = privateDir();
  try {
    const requestFile = writeRequest(dir, "codefree-request-notjson1.json", "{ not json");
    assert.throws(() => loadRequestFile(requestFile), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRequestFile - non-object JSON is rejected", () => {
  for (const raw of ["[1,2,3]", "null", "\"str\""]) {
    const dir = privateDir();
    try {
      const requestFile = writeRequest(dir, "codefree-request-nonobj01.json", raw);
      assert.throws(() => loadRequestFile(requestFile), /JSON object/, raw);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// safeDeleteTempFile — cleanup guard
// ---------------------------------------------------------------------------

test("safeDeleteTempFile - deletes a conforming temp file and empties the private dir", () => {
  const dir = privateDir();
  try {
    const file = path.join(dir, "codefree-task-guarded01.txt");
    fs.writeFileSync(file, "x", "utf8");
    assert.equal(safeDeleteTempFile(file), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(dir), false, "emptied codefree-req-* dir is removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("safeDeleteTempFile - leaves non-conforming names in place", () => {
  const dir = makeTempDir("codefree-test-guard-");
  try {
    const file = path.join(dir, "my-important-file.txt");
    fs.writeFileSync(file, "keep me", "utf8");
    assert.equal(safeDeleteTempFile(file), false);
    assert.equal(fs.readFileSync(file, "utf8"), "keep me");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("safeDeleteTempFile - leaves files outside the temp dir in place", () => {
  // A conforming basename, but located OUTSIDE os.tmpdir() — the guard must
  // refuse to delete it (hostile path protection).
  const dir = fs.mkdtempSync(path.join(os.homedir(), "codefree-guard-out-"));
  try {
    const outside = path.join(dir, "codefree-task-outside01.txt");
    fs.writeFileSync(outside, "do not delete", "utf8");
    assert.equal(safeDeleteTempFile(outside), false);
    assert.equal(fs.readFileSync(outside, "utf8"), "do not delete");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("safeDeleteTempFile - does not follow a symlink even with a conforming name", () => {
  const dir = privateDir();
  try {
    const target = path.join(dir, "real-target.txt");
    fs.writeFileSync(target, "real", "utf8");
    const symlink = path.join(dir, "codefree-task-symlnk01.txt");
    fs.symlinkSync(target, symlink);
    assert.equal(safeDeleteTempFile(symlink), false);
    assert.equal(fs.existsSync(target), true, "symlink target must survive");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("safeDeleteTempFile - leaves a non-empty private dir behind when sibling files remain", () => {
  const dir = privateDir();
  try {
    const file = path.join(dir, "codefree-task-keepdir01.txt");
    fs.writeFileSync(file, "x", "utf8");
    fs.writeFileSync(path.join(dir, "sibling.txt"), "y", "utf8");
    assert.equal(safeDeleteTempFile(file), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(dir), true, "dir with remaining files must not be removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// exported constants
// ---------------------------------------------------------------------------

test("constants - AGENT_TEMP_FILE matches the agent naming convention", () => {
  assert.equal(AGENT_TEMP_FILE.test("codefree-task-ab12cd34.txt"), true);
  assert.equal(AGENT_TEMP_FILE.test("codefree-request-ab12cd34.json"), true);
  assert.equal(AGENT_TEMP_FILE.test("codefree-task-abcd.txt"), false, "random suffix must be >= 8 chars");
  assert.equal(AGENT_TEMP_FILE.test("plain-request.json"), false);
  assert.equal(AGENT_TEMP_FILE.test("codefree-task-ab12cd34.exe"), false);
});

test("constants - AGENT_TEMP_DIR matches the private dir convention", () => {
  assert.equal(AGENT_TEMP_DIR.test("codefree-req-abc123"), true);
  assert.equal(AGENT_TEMP_DIR.test("codefree-test-abc123"), false);
});
