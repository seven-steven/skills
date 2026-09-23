import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  COMPANION_SCRIPT,
  cleanupSandbox,
  isPidAlive,
  makeSandbox,
  readJsonFile,
  run,
  runCompanion,
  waitFor,
  writeJsonFile
} from "./helpers.mjs";

const textEvent = (text) => ({
  type: "text",
  timestamp: 1,
  sessionID: "ses-fake",
  part: { type: "text", text }
});

const toolUseEvent = () => ({
  type: "tool_use",
  timestamp: 2,
  sessionID: "ses-fake",
  part: { type: "tool", tool: "write", callID: "c1", state: { status: "completed", title: "wrote file" } }
});

function promptOf(record) {
  const sep = record.argv.indexOf("--");
  return sep === -1 ? null : record.argv[sep + 1];
}

function scenarioFile(sandbox, scenario) {
  return writeJsonFile(path.join(sandbox.tempDir, "scenario.json"), scenario);
}

// ---------------------------------------------------------------------------
// argv contract (the fake binary records what it was called with)
// ---------------------------------------------------------------------------

test("task - happy path forwards run/--format json/--auto/--dir and prompt verbatim", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [textEvent("all done")],
      exitCode: 0
    });

    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "Fix the login bug"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all done/);
    assert.match(result.stdout, /session=ses-fake/);

    const record = readJsonFile(sandbox.recordFile);
    assert.equal(record.argv[0], "run");
    assert.ok(record.argv.includes("--"), "prompt must follow a -- separator");
    assert.equal(promptOf(record), "Fix the login bug");
    assert.ok(record.argv.includes("--format"));
    assert.ok(record.argv.includes("json"));
    assert.ok(record.argv.includes("--auto"));
    assert.ok(!record.argv.includes("--approval-mode"));
    assert.ok(!record.argv.includes("--include-directories"));
    const dirIndex = record.argv.indexOf("--dir");
    assert.notEqual(dirIndex, -1);
    assert.equal(record.argv[dirIndex + 1], sandbox.cwd);
    assert.equal(record.cwd, sandbox.cwd);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - two-file workflow: promptFile read verbatim (multiline) and both files cleaned up", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codefree-req-test-"));
    const promptFile = path.join(privateDir, "codefree-task-twofile01.txt");
    const multiline = "Step 1: run the tests\nStep 2: \"quote\" things\nStep 3: résumé — done 🎉";
    fs.writeFileSync(promptFile, multiline, "utf8");
    const requestFile = path.join(privateDir, "codefree-request-twofile01.json");
    writeJsonFile(requestFile, {
      promptFile,
      cwd: sandbox.cwd,
      model: "provider/model-x"
    });

    const result = runCompanion(["task", "--request-file", requestFile], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });

    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(promptOf(record), multiline, "multiline task text must survive byte-for-byte");
    assert.equal(fs.existsSync(requestFile), false, "request file cleaned up");
    assert.equal(fs.existsSync(promptFile), false, "prompt file cleaned up");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - request file promptFile outside the agent convention is rejected", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const requestFile = path.join(sandbox.tempDir, "codefree-request-evilpath1.json");
    writeJsonFile(requestFile, { promptFile: "/etc/passwd", cwd: sandbox.cwd });

    const result = runCompanion(["task", "--request-file", requestFile], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /agent temp file/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - CODEFREE_PROXY overrides the child proxy env and forces local NO_PROXY", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    sandbox.env.CODEFREE_PROXY = "http://user:pass@proxy.example.com:1080";
    // Pre-existing session-wide proxy settings must be overridden for the child.
    sandbox.env.HTTP_PROXY = "http://old-proxy.example.com:2080";
    sandbox.env.HTTPS_PROXY = "http://old-proxy.example.com:2080";
    sandbox.env.ALL_PROXY = "http://old-proxy.example.com:2080";
    sandbox.env.NO_PROXY = "10.0.0.0/8";

    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });

    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(record.proxy.HTTP_PROXY, "http://user:pass@proxy.example.com:1080");
    assert.equal(record.proxy.HTTPS_PROXY, "http://user:pass@proxy.example.com:1080");
    assert.equal(record.proxy.ALL_PROXY, "http://user:pass@proxy.example.com:1080");
    const noProxy = record.proxy.NO_PROXY.split(",");
    assert.ok(noProxy.includes("localhost"), "NO_PROXY must include localhost");
    assert.ok(noProxy.includes("127.0.0.1"), "NO_PROXY must include 127.0.0.1");
    assert.ok(noProxy.includes("10.0.0.0/8"), "existing NO_PROXY entries are preserved");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - without CODEFREE_PROXY the inherited proxy env passes through unchanged", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    sandbox.env.HTTP_PROXY = "http://session-proxy.example.com:2080";
    delete sandbox.env.CODEFREE_PROXY;

    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });

    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(record.proxy.HTTP_PROXY, "http://session-proxy.example.com:2080");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - invalid CODEFREE_PROXY fails fast with a usage error", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_PROXY = "not a url";
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CODEFREE_PROXY/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - only allowlisted flags are forwarded; --auto is always present", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const result = runCompanion(
      [
        "task",
        "--prompt-stdin",
        "--cwd",
        sandbox.cwd,
        "--model",
        "provider/model-x",
        "--agent",
        "build",
        "--session",
        "ses-42",
        "--fork"
      ],
      { cwd: sandbox.cwd, env: sandbox.env, input: "go" }
    );

    assert.equal(result.status, 0, result.stderr);
    const argv = readJsonFile(sandbox.recordFile).argv;
    assert.ok(!argv.includes("--continue"), "--session and --continue must not both be set");
    for (const [flag, value] of [
      ["--model", "provider/model-x"],
      ["--agent", "build"],
      ["--session", "ses-42"],
      ["--fork", null]
    ]) {
      const index = argv.indexOf(flag);
      assert.notEqual(index, -1, `expected ${flag}`);
      if (value !== null) assert.equal(argv[index + 1], value);
    }
    for (const banned of ["--attach", "--share", "--command", "--file", "--title", "--port"]) {
      assert.ok(!argv.includes(banned), `${banned} must never be forwarded`);
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - unknown flags are rejected (strict allowlist blocks --attach etc.)", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [] });
    for (const bad of ["--attach", "--share", "--command", "--yolo", "--include-dir"]) {
      const result = runCompanion(["task", "--prompt-stdin", bad, "http://evil", "--cwd", sandbox.cwd], {
        cwd: sandbox.cwd,
        env: sandbox.env,
        input: "go"
      });
      assert.equal(result.status, 2, `expected usage failure for ${bad}`);
      assert.match(result.stderr, /Unrecognized argument/);
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - prompt text containing --flags is never stripped or parsed", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const tricky = "--resume-first then run tests with --model evilmodel and --attach http://x --fork";
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: tricky
    });
    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(promptOf(record), tricky);
    assert.ok(!record.argv.includes("evilmodel"));
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - malicious shell payload via stdin reaches codefree-o verbatim, unexecuted", function () {
  if (process.platform === "win32") {
    this.skip("POSIX shell injection probe");
  }
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const evil = "'; rm -rf /; echo '$(pwned) `id` && cat /etc/passwd";
    // Reproduce a hostile caller: single-quote escape and pipe through a
    // real shell into --prompt-stdin. The companion must pass the payload
    // through verbatim without executing any of it.
    const escaped = evil.replace(/'/g, `'\\''`);
    const shellLine = `printf '%s' '${escaped}' | node ${JSON.stringify(COMPANION_SCRIPT)} task --prompt-stdin --cwd ${JSON.stringify(sandbox.cwd)}`;
    const result = run("/bin/sh", ["-c", shellLine], { env: sandbox.env });
    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(promptOf(record), evil);
  } finally {
    cleanupSandbox(sandbox);
  }
});

// ---------------------------------------------------------------------------
// Request file mode (the agent-facing contract)
// ---------------------------------------------------------------------------

test("task - request file drives prompt and options; conforming temp file is cleaned up", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    // sandbox.tempDir lives under os.tmpdir(), and the name follows the
    // agent convention, so the companion deletes it after reading.
    const requestFile = path.join(sandbox.tempDir, "codefree-request-ab12cd34.json");
    writeJsonFile(requestFile, {
      prompt: "Refactor the auth module",
      cwd: sandbox.cwd,
      model: "provider/model-x",
      timeoutMs: 12345
    });

    const result = runCompanion(["task", "--request-file", requestFile], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });

    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(record.argv[0], "run");
    assert.equal(promptOf(record), "Refactor the auth module");
    assert.equal(record.argv[record.argv.indexOf("--model") + 1], "provider/model-x");
    assert.equal(record.cwd, sandbox.cwd);
    assert.equal(fs.existsSync(requestFile), false, "conforming request file must be deleted");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - request file without the agent naming convention is preserved", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const requestFile = path.join(sandbox.tempDir, "my-plain-request.json");
    writeJsonFile(requestFile, { prompt: "hello", cwd: sandbox.cwd });

    const result = runCompanion(["task", "--request-file", requestFile], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /left in place/);
    assert.equal(fs.existsSync(requestFile), true, "non-conforming file must NOT be deleted");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - request file rejects unknown keys, bad values, and conflicting flags", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });

    const badRequest = path.join(sandbox.tempDir, "codefree-request-badbad11.json");
    const cases = [
      { attach: "http://evil" },
      { prompt: "go", model: "-leading-dash" },
      { prompt: "go", session: "../traversal" },
      { prompt: "go", timeoutMs: -5 },
      { prompt: 42 }
    ];
    for (const [index, body] of cases.entries()) {
      fs.writeFileSync(badRequest, JSON.stringify(body), "utf8");
      const result = runCompanion(["task", "--request-file", badRequest], {
        cwd: sandbox.cwd,
        env: sandbox.env
      });
      assert.equal(result.status, 2, `case ${index} should be rejected: ${JSON.stringify(body)}`);
    }
    assert.equal(fs.existsSync(badRequest), false, "failed validation must still clean up");

    const conflict = path.join(sandbox.tempDir, "codefree-request-conflic1.json");
    writeJsonFile(conflict, { prompt: "go", cwd: sandbox.cwd });
    const result = runCompanion(["task", "--request-file", conflict, "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must be the only option/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - --json survives --request-file option replacement", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const requestFile = path.join(sandbox.tempDir, "codefree-request-jsonjson.json");
    writeJsonFile(requestFile, { prompt: "go", cwd: sandbox.cwd });

    const result = runCompanion(["task", "--request-file", requestFile, "--json"], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "completed");
    assert.ok(Array.isArray(payload.events));
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - audit command redacts the prompt text", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "super secret task text"
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const joined = payload.command.join(" ");
    assert.ok(!joined.includes("super secret task text"), "audit must not echo the prompt");
    assert.match(joined, /redacted/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

// ---------------------------------------------------------------------------
// Prompt source rules
// ---------------------------------------------------------------------------

test("task - prompt file content is passed verbatim including trailing newline", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const promptFile = path.join(sandbox.tempDir, "codefree-task-verbatim99.txt");
    fs.writeFileSync(promptFile, "keep my newline\n", "utf8");
    const result = runCompanion(["task", "--prompt-file", promptFile, "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });
    assert.equal(result.status, 0, result.stderr);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(promptOf(record), "keep my newline\n");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - prompt file with a non-conforming name is read but never deleted", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const promptFile = path.join(sandbox.cwd, "important-user-file.txt");
    fs.writeFileSync(promptFile, "do not delete me", "utf8");
    const result = runCompanion(["task", "--prompt-file", promptFile, "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /left in place/);
    assert.equal(fs.readFileSync(promptFile, "utf8"), "do not delete me");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - empty prompt without --continue/--session is a usage error", () => {
  const sandbox = makeSandbox();
  try {
    const result = runCompanion(["task", "--prompt-stdin"], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "   \n"
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Empty task/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - both prompt sources at once is a usage error", () => {
  const sandbox = makeSandbox();
  try {
    const promptFile = path.join(sandbox.tempDir, "codefree-task-bothsourc.txt");
    fs.writeFileSync(promptFile, "x", "utf8");
    const result = runCompanion(["task", "--prompt-file", promptFile, "--prompt-stdin"], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "y"
    });
    assert.equal(result.status, 2);
  } finally {
    cleanupSandbox(sandbox);
  }
});

// ---------------------------------------------------------------------------
// Outcome semantics
// ---------------------------------------------------------------------------

test("task - error event with exit 0 fails with a non-zero companion exit", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [{ type: "error", sessionID: "s", part: { type: "error", message: "kaput" } }],
      exitCode: 0
    });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "error-event");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - tool_use-only run completes with empty text", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [toolUseEvent()], exitCode: 0 });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "completed");
    assert.equal(payload.text, "");
    assert.equal(payload.toolUses.length, 1);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - non-zero exit propagates the exit code and marks failure", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [textEvent("partial")],
      exitCode: 3
    });
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 3);
    assert.match(result.stdout, /FAILED: non-zero-exit \(exit 3\)/);
    assert.match(result.stdout, /partial output/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - malformed stdout line fails closed but keeps partial text", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [textEvent("half result")],
      rawLines: ["% update notice %"],
      exitCode: 0
    });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "malformed-output");
    assert.deepEqual(payload.malformedLines, ["% update notice %"]);
    assert.equal(payload.text, "half result");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - unknown future event type is kept verbatim and does not break completion", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [{ type: "v9_quantum_step", sessionID: "ses-fake", extra: { deep: true } }, textEvent("ok")],
      exitCode: 0
    });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "completed");
    assert.deepEqual(payload.events[0].type, "v9_quantum_step");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - stderr is preserved in the json payload", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [textEvent("ok")],
      stderr: "warn: something",
      exitCode: 0
    });
    const result = runCompanion(["task", "--prompt-stdin", "--json", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.stderr, /warn: something/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

test("task - PATH precedence: the first PATH entry's binary wins over later shims", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    // A second, later PATH directory with a same-named binary must lose to
    // the earlier entry (this is how a native .exe shadows an old .cmd shim).
    const laterBinDir = path.join(sandbox.tempDir, "bin-later");
    fs.mkdirSync(laterBinDir, { recursive: true });
    const laterMarker = path.join(laterBinDir, "later-ran.txt");
    const laterBin = [
      "#!/usr/bin/env node",
      `require("node:fs").writeFileSync(${JSON.stringify(laterMarker)}, "x");`,
      ""
    ].join("\n");
    fs.writeFileSync(path.join(laterBinDir, "codefree-o"), laterBin, "utf8");
    fs.chmodSync(path.join(laterBinDir, "codefree-o"), 0o755);

    const env = {
      ...sandbox.env,
      PATH: `${sandbox.fakeBinDir}${path.delimiter}${laterBinDir}${path.delimiter}${process.env.PATH ?? ""}`
    };
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env,
      input: "go"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(laterMarker), false, "later PATH entry must not run");
    assert.equal(fs.existsSync(sandbox.recordFile), true, "first PATH entry must run");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - non-executable binary surfaces spawn-error without crashing (F1)", function () {
  if (process.platform === "win32") {
    this.skip("chmod-based non-executable simulation is POSIX-only");
  }
  const sandbox = makeSandbox({ binName: null });
  try {
    // Exists on disk (so the resolver finds it) but is not executable:
    // spawn fails with EACCES after resolution.
    const binPath = path.join(sandbox.fakeBinDir, "codefree-o");
    fs.writeFileSync(binPath, "not a program\n", "utf8");
    fs.chmodSync(binPath, 0o644);

    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });

    assert.equal(result.status, 127);
    assert.match(result.stdout, /Failed to start codefree-o/);
    // The failure payload must be printable without crashing (F1 regression:
    // renderRunResult used to hit a TypeError on the partial spawn-error
    // payload) and must not leak internals.
    assert.ok(!result.stdout.includes("TypeError"));
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - grandchild ignoring SIGTERM is reaped by the SIGKILL grace (F3)", async function () {
  if (process.platform === "win32") {
    this.skip("POSIX process-group regression test");
  }
  const sandbox = makeSandbox();
  let grandchildPid = null;
  try {
    // Grandchild: ignores SIGTERM, reports its pid, exits on its own after
    // 30s as a bounded-leak safety net.
    const grandchildScript = path.join(sandbox.tempDir, "stubborn-grandchild.mjs");
    const pidFile = path.join(sandbox.tempDir, "grandchild-pid");
    fs.writeFileSync(
      grandchildScript,
      [
        "import fs from 'node:fs';",
        "process.on('SIGTERM', () => {});",
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        "setInterval(() => {}, 50);",
        "setTimeout(() => process.exit(0), 30000);",
        ""
      ].join("\n"),
      "utf8"
    );

    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [],
      hangMs: 120_000,
      exitCode: 0,
      // The direct child hangs until the timeout group-SIGTERM kills it;
      // the grandchild survives that SIGTERM. The child's close must NOT
      // cancel the armed SIGKILL grace timer (F3) — only that grace reaps
      // the stubborn grandchild.
      grandchild: { scriptFile: grandchildScript }
    });

    // 200ms timeout; spawnSync blocks until the companion exits (~grace+eps).
    const result = runCompanion(
      ["task", "--prompt-stdin", "--timeout-ms", "200", "--cwd", sandbox.cwd],
      { cwd: sandbox.cwd, env: sandbox.env, input: "go" }
    );

    assert.equal(result.status, 124, `expected timeout exit, stderr: ${result.stderr}`);
    grandchildPid = Number(fs.readFileSync(pidFile, "utf8"));
    // Await the reap BEFORE the finally block runs, otherwise the cleanup
    // SIGKILL below would mask a regression by doing the killing itself.
    await waitFor(() => !isPidAlive(grandchildPid), { timeoutMs: 10_000 });
    assert.equal(isPidAlive(grandchildPid), false, "grandchild must be SIGKILLed");
  } finally {
    if (grandchildPid && isPidAlive(grandchildPid)) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    cleanupSandbox(sandbox);
  }
});

test("task - missing binary reports 127 with an actionable message", () => {  const sandbox = makeSandbox();
  try {
    const env = { ...sandbox.env, PATH: sandbox.fakeBinDir, CODEFREE_BIN: "definitely-not-codefree" };
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env,
      input: "go"
    });
    assert.equal(result.status, 127);
    assert.match(result.stdout, /binary not found on PATH/);
    assert.match(result.stdout, /definitely-not-codefree/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - timeout kills the fake binary tree and reports reason=timeout", async () => {
  const sandbox = makeSandbox();
  try {
    const pidFile = path.join(sandbox.tempDir, "hang-pid");
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
      events: [],
      hangMs: 120_000,
      hangPidFile: pidFile
    });
    const result = runCompanion(
      ["task", "--prompt-stdin", "--timeout-ms", "500", "--json", "--cwd", sandbox.cwd],
      { cwd: sandbox.cwd, env: sandbox.env, input: "go" }
    );
    assert.equal(result.status, 124);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "timeout");
    assert.equal(payload.timedOut, true);
    await waitFor(() => {
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      return !isPidAlive(pid);
    });
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - SIGTERM to the companion kills the codefree-o child tree", function () {
  if (process.platform === "win32") {
    this.skip("POSIX process-group cleanup test");
  }
  const sandbox = makeSandbox();
  const pidFile = path.join(sandbox.tempDir, "hang-pid");
  sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, {
    events: [],
    hangMs: 120_000,
    hangPidFile: pidFile
  });
  // Prompt travels via a conforming temp file so no stdin plumbing is needed.
  const promptFile = path.join(sandbox.tempDir, "codefree-task-sigterm01.txt");
  fs.writeFileSync(promptFile, "hang until killed", "utf8");

  const child = spawn(
    process.execPath,
    [COMPANION_SCRIPT, "task", "--prompt-file", promptFile, "--cwd", sandbox.cwd],
    { env: sandbox.env, stdio: "ignore" }
  );

  return waitFor(() => fs.existsSync(pidFile), { timeoutMs: 15_000 })
    .then(() => {
      const fakePid = Number(fs.readFileSync(pidFile, "utf8"));
      assert.ok(isPidAlive(fakePid));
      child.kill("SIGTERM");
      return waitFor(() => !isPidAlive(fakePid));
    })
    .then(() => {
      assert.equal(isPidAlive(child.pid), false, "companion should exit after re-raising SIGTERM");
    })
    .finally(() => {
      if (isPidAlive(child.pid)) child.kill("SIGKILL");
      cleanupSandbox(sandbox);
    });
});

// ---------------------------------------------------------------------------
// Usage / help
// ---------------------------------------------------------------------------

test("usage - --fork without --continue/--session is rejected", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = scenarioFile(sandbox, { events: [textEvent("ok")] });
    const result = runCompanion(["task", "--prompt-stdin", "--fork"], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--fork requires/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("usage - no subcommand prints usage with exit 2; help exits 0", () => {
  const sandbox = makeSandbox();
  try {
    const bare = runCompanion([], { env: sandbox.env });
    assert.equal(bare.status, 2);
    assert.match(bare.stdout, /Usage:/);
    const help = runCompanion(["help"], { env: sandbox.env });
    assert.equal(help.status, 0);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("usage - non-existent cwd is rejected", () => {
  const sandbox = makeSandbox();
  try {
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", path.join(os.tmpdir(), "nope-nope")], {
      env: sandbox.env,
      input: "go"
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not exist/);
  } finally {
    cleanupSandbox(sandbox);
  }
});
