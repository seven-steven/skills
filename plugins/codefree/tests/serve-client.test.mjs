import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import {
  SERVE_POLL_INTERVAL_MS,
  buildServePromptBody,
  hasCompletedAssistant,
  mapMessagesToEvents,
  parseServeBanner,
  runServeTask,
  splitModelID,
  startServe
} from "../scripts/lib/serve-client.mjs";
import {
  cleanupSandbox,
  makeSandbox,
  readJsonFile,
  runCompanion,
  writeJsonFile
} from "./helpers.mjs";

// ---------------------------------------------------------------------------
// 纯函数原语
// ---------------------------------------------------------------------------

test("parseServeBanner - extracts baseUrl, ignores other lines", () => {
  assert.equal(
    parseServeBanner("codefree-o server listening on http://127.0.0.1:47652"),
    "http://127.0.0.1:47652"
  );
  assert.equal(parseServeBanner("Warning: PASSWORD is not set"), null);
  assert.equal(parseServeBanner(""), null);
  assert.equal(parseServeBanner(null), null);
});

test("splitModelID - splits provider/model, rejects malformed values", () => {
  assert.deepEqual(splitModelID("codefree/GLM-5.2"), { providerID: "codefree", modelID: "GLM-5.2" });
  assert.equal(splitModelID("nomodel"), null);
  assert.equal(splitModelID("/leading"), null);
  assert.equal(splitModelID("trailing/"), null);
});

test("buildServePromptBody - minimal body plus optional model/agent", () => {
  assert.deepEqual(buildServePromptBody({ prompt: "do it" }), {
    parts: [{ type: "text", text: "do it" }]
  });
  assert.deepEqual(
    buildServePromptBody({ prompt: "hi", model: "p/m", agent: "build" }),
    { parts: [{ type: "text", text: "hi" }], model: { providerID: "p", modelID: "m" }, agent: "build" }
  );
  // malformed model is dropped, not mangled into the body
  assert.ok(!("model" in buildServePromptBody({ prompt: "hi", model: "broken" })));
});

test("hasCompletedAssistant - requires assistant role with completed time", () => {
  const done = [{ info: { role: "assistant", time: { completed: 1 } } }];
  const pending = [{ info: { role: "assistant", time: { completed: null } } }];
  const userOnly = [{ info: { role: "user", time: { completed: 1 } } }];
  assert.equal(hasCompletedAssistant(done), true);
  assert.equal(hasCompletedAssistant(pending), false);
  assert.equal(hasCompletedAssistant(userOnly), false);
  assert.equal(hasCompletedAssistant([]), false);
});

test("mapMessagesToEvents - maps known part types, skips the rest", () => {
  const messages = [
    {
      info: { role: "assistant", time: { created: 10, completed: 20 } },
      parts: [
        { type: "step-start", id: "p1" },
        { type: "text", text: "hello" },
        { type: "tool", tool: "bash", callID: "c1", state: { status: "completed", title: "ls" } },
        { type: "step-finish", reason: "stop" },
        { type: "reasoning", text: "..." },
        null
      ]
    }
  ];
  const events = mapMessagesToEvents(messages, "ses_x");
  assert.deepEqual(
    events.map((e) => e.type),
    ["step_start", "text", "tool_use", "step_finish"]
  );
  assert.equal(events.every((e) => e.timestamp === 20 && e.sessionID === "ses_x"), true);
  assert.equal(events[1].part.text, "hello");
  assert.deepEqual(events[2].part.state, { status: "completed", title: "ls" });
  assert.deepEqual(mapMessagesToEvents(null, "s"), []);
});

// ---------------------------------------------------------------------------
// runServeTask with injected fetch/spawn/clock
// ---------------------------------------------------------------------------

/** Minimal Response-alike for the apiFetch contract ({status, text()}). */
const jsonResponse = (value, status = 200) => ({
  status,
  text: async () => JSON.stringify(value)
});
const noContent = () => ({ status: 204, text: async () => "" });

function makeFakeChild() {
  const child = new EventEmitter();
  child.pid = 4242; // nothing owns this pid; tree kills are harmless no-ops
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  return child;
}

function makeFakeSpawn({ child, spawnedArgv }) {
  return (resolvedBinary, argv, spawnOptions) => {
    spawnedArgv.binary = resolvedBinary;
    spawnedArgv.argv = argv;
    spawnedArgv.options = spawnOptions;
    child.stdout.push("codefree-o server listening on http://127.0.0.1:9999\n");
    return child;
  };
}

/** Injected clock: sleep advances the virtual time instead of waiting. */
function makeFakeClock(startAt = 1_000_000) {
  const state = { t: startAt };
  return {
    now: () => state.t,
    sleep: async (ms) => {
      state.t += ms;
    },
    state
  };
}

function makeApiHarness(overrides = {}) {
  const calls = [];
  const state = {
    createdSession: { id: "ses_new" },
    sessions: overrides.sessions ?? [{ id: "ses_existing" }],
    messages: overrides.messages ?? [],
    status: overrides.status, // undefined = 完成后键消失（对齐真实 v1.7.0 行为）
    permissions: overrides.permissions ?? [],
    questions: overrides.questions ?? [],
    aborts: [],
    ...overrides
  };
  const handler = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: parsed.pathname, directory: parsed.searchParams.get("directory"), body });
    const route = `${method} ${parsed.pathname}`;
    if (route === "POST /session") return jsonResponse(state.createdSession);
    if (route === "GET /session") return jsonResponse(state.sessions);
    if (parsed.pathname.endsWith("/prompt_async")) {
      state.promptBody = body;
      return noContent();
    }
    if (parsed.pathname.endsWith("/message")) return jsonResponse(state.messages);
    if (route === "GET /session/status") {
      // status === undefined：完成后键消失（真实行为）；显式 "busy"/"idle"
      // 用例返回对应条目。
      if (state.status === undefined) return jsonResponse({});
      return jsonResponse({ [state.currentSession ?? "ses_new"]: { type: state.status } });
    }
    if (route === "GET /permission") return jsonResponse(state.permissions);
    if (parsed.pathname.startsWith("/permission/")) {
      state.permissionReplies = state.permissionReplies ?? [];
      state.permissionReplies.push({ id: parsed.pathname.split("/")[2], body });
      state.permissions = [];
      return jsonResponse(true);
    }
    if (route === "GET /question") return jsonResponse(state.questions);
    if (parsed.pathname.startsWith("/question/")) {
      if (state.rejectQuestionFails) return jsonResponse({ error: "boom" }, 500);
      state.questionRejects = state.questionRejects ?? [];
      state.questionRejects.push(parsed.pathname.split("/")[2]);
      state.questions = [];
      return jsonResponse(true);
    }
    if (parsed.pathname.endsWith("/abort")) {
      state.aborts.push(parsed.pathname.split("/")[2]);
      return jsonResponse(true);
    }
    throw new Error(`unmatched ${route}`);
  };
  return { handler, calls, state };
}

const completedMessages = [
  {
    info: { role: "assistant", time: { created: 10, completed: 20 } },
    parts: [{ type: "text", text: "all done" }]
  }
];

test("runServeTask - happy path: creates session, prompt in body only, completes", async () => {
  const child = makeFakeChild();
  const spawned = {};
  const clock = makeFakeClock();
  const api = makeApiHarness({ messages: completedMessages });
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    binName: process.execPath, // exists on every platform; spawnImpl is faked anyway
    prompt: "echo your model id to hello.txt",
    options: {},
    cwd: "/workspace",
    env: { X: "1" },
    timeoutMs: 540_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: spawned }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "completed", JSON.stringify(payload, null, 2));
  assert.equal(exitCode, 0);
  assert.equal(payload.sessionID, "ses_new");
  assert.equal(payload.text, "all done");
  // argv carries only the hardcoded serve flags — the prompt never appears.
  assert.deepEqual(
    spawned.argv.slice(0, 2).concat(["<port>"]).concat(spawned.argv.slice(3)),
    ["serve", "--port", "<port>", "--hostname", "127.0.0.1", "--print-logs"]
  );
  assert.match(spawned.argv[2], /^[0-9]+$/); // 随机高位端口，而非固定 "0"（默认 4096）
  assert.equal(payload.command.includes("echo your model id"), false);
  // prompt travels exclusively inside the prompt_async body
  const promptCall = api.calls.find((c) => c.path.endsWith("/prompt_async"));
  assert.equal(promptCall.body.parts[0].text, "echo your model id to hello.txt");
  // every API call is directory-scoped
  assert.ok(api.calls.every((c) => c.directory === "/workspace"));
});

test("runServeTask - completes when status entry is explicitly idle (post-completion shape tolerance)", async () => {
  // 真实 v1.7.0 完成后从 /session/status 移除会话条目（默认用例覆盖该形态）；
  // 若未来版本改为显式 "idle"，同样必须判定完成。
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({ messages: completedMessages, status: "idle" });
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    binName: process.execPath,
    prompt: "say ok",
    options: {},
    cwd: "/workspace",
    env: {},
    timeoutMs: 540_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "completed", JSON.stringify(payload, null, 2));
  assert.equal(exitCode, 0);
});

test("runServeTask - retries with a new port when serve dies at startup (EADDRINUSE shape)", async () => {
  // 第一次 spawn 的 serve 立即崩溃（端口撞车形态：close 且无 banner）；
  // runServeTask 必须换随机端口重试并最终成功。
  const crashedChild = makeFakeChild();
  const okChild = makeFakeChild();
  const clock = makeFakeClock();
  const spawnCalls = [];
  const spawnImpl = (_resolvedBinary, argv, _spawnOptions) => {
    spawnCalls.push(argv);
    if (spawnCalls.length === 1) {
      // EADDRINUSE：serve 崩溃退出，未打 banner。
      setImmediate(() => {
        crashedChild.exitCode = 1;
        crashedChild.emit("close", 1, null);
      });
      return crashedChild;
    }
    okChild.stdout.push("codefree-o server listening on http://127.0.0.1:9999\n");
    return okChild;
  };
  const api = makeApiHarness({ messages: completedMessages });
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    binName: process.execPath,
    prompt: "say ok",
    options: {},
    cwd: "/workspace",
    env: {},
    timeoutMs: 540_000,
    fetchImpl: api.handler,
    spawnImpl,
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(spawnCalls.length, 2);
  assert.notEqual(spawnCalls[0][2], spawnCalls[1][2]); // 两次尝试端口不同
  assert.equal(payload.status, "completed", JSON.stringify(payload, null, 2));
  assert.equal(exitCode, 0);
});

test("runServeTask - silently dropped prompt (no new messages) fails fast as serve-prompt-dropped", async () => {
  // 复刻真实故障：prompt_async 204 受理但上游认证不可达（No providers），
  // user 消息永不落库。超过 SERVE_PROMPT_DROP_DETECT_MS 后必须快速失败，
  // 而不是傻等总超时；提示信息指向代理/网络。
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({ messages: [] }); // 永远没有新消息
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    prompt: "doomed",
    options: {},
    cwd: "/w",
    env: {},
    timeoutMs: 540_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.reason, "serve-prompt-dropped");
  assert.equal(payload.status, "failed");
  assert.equal(exitCode, 1);
  assert.match(payload.stderr, /silently dropped/);
  // rendered is never set — renderRunResult is the sole format owner.
  assert.equal(payload.rendered, undefined);
});

test("runServeTask - model/agent forwarded into prompt body; --continue reuses latest session", async () => {
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({ messages: completedMessages });
  api.state.currentSession = "ses_existing";

  const { payload } = await runServeTask({
    prompt: "hi",
    options: { model: "codefree/GLM-5.2", agent: "build", continue: true },
    cwd: "/w",
    env: {},
    timeoutMs: 5_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "completed");
  assert.equal(payload.sessionID, "ses_existing");
  const promptCall = api.calls.find((c) => c.path.endsWith("/prompt_async"));
  assert.deepEqual(promptCall.body.model, { providerID: "codefree", modelID: "GLM-5.2" });
  assert.equal(promptCall.body.agent, "build");
  assert.equal(api.calls.some((c) => c.method === "POST /session"), false, "continue must not create a session");
});

test("runServeTask - --continue without sessions fails as session-not-found", async () => {
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({ sessions: [] });

  const { payload, exitCode } = await runServeTask({
    prompt: "hi",
    options: { continue: true },
    cwd: "/w",
    env: {},
    timeoutMs: 5_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "failed");
  assert.equal(payload.reason, "session-not-found");
  assert.equal(exitCode, 1);
});

test("runServeTask - pending permissions are auto-approved once", async () => {
  const child = makeFakeChild();
  const clock = makeFakeClock();
  // The permission is visible on the first poll; replying clears it before the
  // completion check runs, so the run still finishes on the same iteration.
  const api = makeApiHarness({
    permissions: [{ id: "per_1", permission: "read", patterns: ["secret.env"] }],
    messages: completedMessages
  });
  api.state.currentSession = "ses_new";

  const { payload } = await runServeTask({
    prompt: "read the env file",
    options: {},
    cwd: "/w",
    env: {},
    timeoutMs: 5_000,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "completed");
  assert.deepEqual(api.state.permissionReplies, [
    { id: "per_1", body: { reply: "once" } }
  ]);
});

test("runServeTask - question reject failure is tolerated and audited, timeout still fires", async () => {
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({
    questions: [{ id: "que_1", questions: [{ question: "color?" }] }],
    messages: completedMessages,
    status: "busy", // never completes → timeout path
    rejectQuestionFails: true
  });
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    prompt: "pick a color",
    options: {},
    cwd: "/w",
    env: {},
    timeoutMs: 3 * SERVE_POLL_INTERVAL_MS,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.status, "failed");
  assert.equal(payload.reason, "timeout");
  assert.equal(exitCode, 124);
  assert.equal(api.state.aborts.length, 1, "abort was requested on timeout");
  // the unanswered question stays in the audit trail
  assert.ok(payload.events.some((e) => e.type === "question.asked"));
  assert.match(payload.stderr, /question reject que_1/);
});

test("runServeTask - timeout aborts and reports exit 124 even without events", async () => {
  const child = makeFakeChild();
  const clock = makeFakeClock();
  const api = makeApiHarness({ status: "busy" });
  api.state.currentSession = "ses_new";

  const { payload, exitCode } = await runServeTask({
    prompt: "stuck",
    options: {},
    cwd: "/w",
    env: {},
    timeoutMs: 2 * SERVE_POLL_INTERVAL_MS,
    fetchImpl: api.handler,
    spawnImpl: makeFakeSpawn({ child, spawnedArgv: {} }),
    now: clock.now,
    sleep: clock.sleep
  });

  assert.equal(payload.reason, "timeout");
  assert.equal(payload.timedOut, true);
  assert.equal(exitCode, 124);
  assert.deepEqual(api.state.aborts, ["ses_new"]);
});

test("startServe - no banner within the startup window fails as serve-start-timeout", async () => {
  const child = makeFakeChild(); // stdout stays empty
  const result = await startServe({
    binary: process.execPath, // exists on every platform, so resolution succeeds
    cwd: process.cwd(),
    env: {},
    startupTimeoutMs: 50,
    spawnImpl: () => child
  });

  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "serve-start-timeout");
});

test("startServe - binary not on PATH fails as binary-not-found", async () => {
  const result = await startServe({
    binary: "definitely-not-on-path-xyz",
    cwd: process.cwd(),
    env: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.payload.reason, "binary-not-found");
  assert.match(result.payload.stderr, /binary not found/);
});

// ---------------------------------------------------------------------------
// companion end-to-end over the fake serve fixture (real processes, loopback only)
// ---------------------------------------------------------------------------

function serveScenario(sandbox, serve) {
  return writeJsonFile(path.join(sandbox.tempDir, "scenario.json"), { serve });
}

test("companion e2e - default transport is serve: argv contract and verbatim prompt", () => {
  const sandbox = makeSandbox();
  try {
    const promptFile = path.join(sandbox.tempDir, "serve-prompt.jsonl");
    sandbox.env.CODEFREE_FAKE_SCENARIO = serveScenario(sandbox, {
      messages: [
        {
          info: { role: "assistant", time: { created: 1, completed: 2 } },
          parts: [{ type: "text", text: "served result" }]
        }
      ],
      promptFile
    });
    delete sandbox.env.CODEFREE_TRANSPORT; // default must be serve

    const result = runCompanion(
      ["task", "--prompt-stdin", "--cwd", sandbox.cwd, "--timeout-ms", "15000"],
      { cwd: sandbox.cwd, env: sandbox.env, input: "echo your model id to hello.txt" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /served result/);
    assert.match(result.stdout, /session=ses_fake_serve/);

    const record = readJsonFile(sandbox.recordFile);
    assert.match(record.argv[2], /^[0-9]+$/); // 随机高位端口，而非固定 "0"（默认 4096）
    assert.equal(record.argv.some((a) => String(a).includes("model id")), false);

    const promptLines = fs.readFileSync(promptFile, "utf8").trim().split("\n");
    const body = JSON.parse(promptLines[promptLines.length - 1]);
    assert.equal(body.parts[0].text, "echo your model id to hello.txt");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("companion e2e - serve timeout aborts the session and exits 124", () => {
  const sandbox = makeSandbox();
  try {
    const abortFile = path.join(sandbox.tempDir, "aborts.txt");
    sandbox.env.CODEFREE_FAKE_SCENARIO = serveScenario(sandbox, {
      neverReady: true,
      abortFile
    });
    sandbox.env.CODEFREE_TRANSPORT = "serve";

    const result = runCompanion(
      ["task", "--prompt-stdin", "--cwd", sandbox.cwd, "--timeout-ms", "2000"],
      { cwd: sandbox.cwd, env: sandbox.env, input: "stuck task" }
    );

    assert.equal(result.status, 124, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stdout, /FAILED: timeout/);
    assert.match(fs.readFileSync(abortFile, "utf8"), /ses_fake_serve/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("companion e2e - invalid CODEFREE_TRANSPORT is a usage error", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_TRANSPORT = "carrier-pigeon";
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "hi"
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid CODEFREE_TRANSPORT/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("companion e2e - CODEFREE_TRANSPORT=run keeps the legacy path", () => {
  const sandbox = makeSandbox();
  try {
    sandbox.env.CODEFREE_FAKE_SCENARIO = writeJsonFile(path.join(sandbox.tempDir, "scenario.json"), {
      events: [{ type: "text", timestamp: 1, sessionID: "ses-fake", part: { type: "text", text: "run path" } }]
    });
    sandbox.env.CODEFREE_TRANSPORT = "run";
    const result = runCompanion(["task", "--prompt-stdin", "--cwd", sandbox.cwd], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: "legacy"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run path/);
    const record = readJsonFile(sandbox.recordFile);
    assert.equal(record.argv[0], "run");
  } finally {
    cleanupSandbox(sandbox);
  }
});
