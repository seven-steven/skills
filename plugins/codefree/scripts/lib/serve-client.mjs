/**
 * serve-client.mjs
 *
 * serve 传输层：spawn `codefree-o serve` 并通过其本地 HTTP API 驱动一次任务。
 *
 * 为什么存在：codefree-o v1.7.0 的 `run --format json --auto` 在非 TTY stdio
 * 管道下，首个 NDJSON 事件输出前的初始化路径会永久阻塞（与 SRD auth-bridge/
 * MCP 慢速重试初始化耦合；同窗口内 serve HTTP API 与代理链路均健康，见插件
 * README 的排查记录）。serve 头端模式是实测唯一可靠的程序化通道（8/8 vs
 * run 0/4），因此它成为 companion 的默认传输；`CODEFREE_TRANSPORT=run`
 * 保留为逃生通道。
 *
 * API 契约（对 codefree-o v1.7.0 实测锚定，字段名勿改）：
 *   - 所有请求带 ?directory=<绝对 cwd> 做会话目录隔离；
 *   - POST /session                     body {title, parentID?} → Session
 *   - GET  /session                     → 会话列表（新到旧）
 *   - POST /session/{id}/prompt_async   body {parts:[{type:"text",text}],
 *                                        model?, agent?} → 204 fire-and-forget
 *   - GET  /session/{id}/message        → [{info:{role,time{created,completed}},
 *                                        parts:[...]}]
 *   - GET  /session/status              → {[sessionID]: {type:"busy"|"idle"|...}}
 *   - GET  /permission                  → 待批权限；POST /permission/{id}/reply
 *                                        body {reply:"once"|"always"|"reject"}
 *   - GET  /question                    → 待答问题；POST /question/{id}/reject
 *   - POST /session/{id}/abort          → 中止当前运行
 *
 * 关键行为：
 *   - prompt 只进 HTTP body，永不进 argv/shell —— 延续 companion 的红线设计；
 *   - serve 进程 POSIX detached 独立进程组，结束（成功/失败/超时/信号）统一
 *     terminateProcessTree → KILL_GRACE_MS → SIGKILL 兜底（对齐 run 路径的
 *     F3 语义：SIGTERM 免疫的孙进程靠 grace timer 清理）。按 PID kill，绝不
 *     pkill -f（会误杀 wrapper shell）；
 *   - 轮询完成判定双条件：存在 assistant 且 info.time.completed 非空的消息，
 *     且 /session/status 报 idle；
 *   - 权限自动放行（--auto 等价）：build agent 基线规则下常规工具无事件直接
 *     执行；ask 类规则产生 permission 请求，逐一 reply "once"；
 *   - question 工具在 serve 下不会被 deny（实测），不处理会永久卡 busy——
 *     逐个 reject，失败则记入事件流由总超时兜底；
 *   - serve 冷启动后首个 prompt 有 ~111s auth-bridge/MCP 停摆（一次性），属
 *     于 timeoutMs 预算的一部分。
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import { needsShellForBinary, resolveBinaryPath, terminateProcessTree } from "./process.mjs";
import { buildRunPayload } from "./run-events.mjs";

// Banner 出现的启动窗口；banner 后立即可 POST /session（实测 ~1.4s）。
export const SERVE_STARTUP_TIMEOUT_MS = 30_000;
// 优雅 SIGTERM 后的 SIGKILL 宽限，对齐 companion run 路径的 SIGKILL_GRACE_MS
// 与 F3 语义（孙进程泄漏防线）。仅作为模块内常量，不跨文件导入私有值。
export const SERVE_KILL_GRACE_MS = 5_000;
export const SERVE_POLL_INTERVAL_MS = 1_000;
// 单个 HTTP 请求的硬超时：serve 半死（TCP 挂起不响应）时轮询请求必须及时
// 失败，否则 deadline 检查永远走不到，总超时不触发，detached 的 serve 树
// 会泄漏到 companion 进程之外。
export const SERVE_HTTP_TIMEOUT_MS = 10_000;
// 「受理即丢弃」检测窗口：user 消息在 prompt 受理后立即落库（实测 ~15s 内，
// 与 ~111s 冷启动无关——冷启动只延迟 assistant 完成）。发出 prompt 超过这
// 个窗口仍无任何新消息 = serve 静默丢弃（上游认证不可达 → No providers，
// prompt_async 仍返回 204 的 codefree-o 缺陷），立即以明确 reason 失败，
// 不傻等总超时。
export const SERVE_PROMPT_DROP_DETECT_MS = 60_000;
const STDERR_CAP_BYTES = 256 * 1024;

const BANNER_PATTERN = /codefree-o server listening on (https?:\/\/\S+)/;

// --port 0 在 codefree-o 语义里是「默认端口 4096」而非随机（实测），4096 是
// opencode 系工具的知名端口，与任何残留实例/用户自己开的服务冲突时，请求会
// 打到别人的服务上（POST 204 受理但消息不落在预期会话里，形成 msgs=0 的
// 静默超时）。因此 companion 必须自己挑随机高位端口显式传给 serve。
const EPHEMERAL_PORT_MIN = 32_768;
const EPHEMERAL_PORT_MAX = 60_999;
// EADDRINUSE 时 serve 崩溃退出（exit 1、无 banner）——换端口重试。
const SERVE_START_ATTEMPTS = 3;

export function pickEphemeralPort(random = Math.random) {
  const span = EPHEMERAL_PORT_MAX - EPHEMERAL_PORT_MIN + 1;
  return EPHEMERAL_PORT_MIN + Math.floor(random() * span);
}

export function buildServeArgv(port) {
  // --print-logs：serve 的 stderr 是「静默丢弃」类故障（上游认证不可达 →
  // ProviderNoProvidersError）的唯一证据源，默认开启并收进 payload.stderr。
  return ["serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"];
}

// serve 消息 part.type → run NDJSON 事件 type（run-events.mjs 的提取字段
// part.text / part.tool / part.callID / part.state.{status,title} 与 serve 的
// part 快照结构一致，无需转换 part 本体）。
const PART_TYPE_TO_EVENT = {
  "step-start": "step_start",
  text: "text",
  tool: "tool_use",
  "step-finish": "step_finish"
};

// ---------------------------------------------------------------------------
// 纯函数原语（单测友好）
// ---------------------------------------------------------------------------

/** 从 serve stdout 一行中提取监听地址；不匹配返回 null。 */
export function parseServeBanner(line) {
  const match = BANNER_PATTERN.exec(String(line ?? ""));
  return match ? match[1] : null;
}

/** "provider/model" → {providerID, modelID}；无法拆分返回 null。 */
export function splitModelID(model) {
  const value = String(model ?? "");
  const sep = value.indexOf("/");
  if (sep <= 0 || sep === value.length - 1) return null;
  return { providerID: value.slice(0, sep), modelID: value.slice(sep + 1) };
}

/** 构造 prompt_async 请求体：prompt 只进 body；model/agent 缺省不加。 */
export function buildServePromptBody({ prompt, model, agent } = {}) {
  const body = { parts: [{ type: "text", text: String(prompt ?? "") }] };
  if (model) {
    const split = splitModelID(model);
    if (split) body.model = split;
  }
  if (agent) body.agent = agent;
  return body;
}

/** 是否存在已完成（info.time.completed 非空）的 assistant 消息。 */
export function hasCompletedAssistant(messages) {
  return (messages ?? []).some(
    (message) => message?.info?.role === "assistant" && message.info?.time?.completed != null
  );
}

/**
 * 把 serve 消息列表重建为 run NDJSON 兼容事件数组（直接喂 buildRunPayload，
 * 不经 parseEventLine）。全量幂等重建，不维护增量游标。timestamp 取消息的
 * completed（未完成回退 created）。未映射的 part.type 原样跳过。
 */
export function mapMessagesToEvents(messages, sessionID) {
  const events = [];
  for (const message of messages ?? []) {
    if (!message || typeof message !== "object") continue;
    const timestamp = message.info?.time?.completed ?? message.info?.time?.created ?? 0;
    for (const part of message.parts ?? []) {
      const type = PART_TYPE_TO_EVENT[part?.type];
      if (!type) continue;
      events.push({ type, timestamp, sessionID, part });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// HTTP 原语
// ---------------------------------------------------------------------------

function apiUrl(baseUrl, pathname, directory) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set("directory", directory);
  return url;
}

async function apiFetch(fetchImpl, baseUrl, pathname, { directory, method = "GET", body } = {}) {
  const hasBody = body !== undefined;
  const response = await fetchImpl(apiUrl(baseUrl, pathname, directory), {
    method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(SERVE_HTTP_TIMEOUT_MS)
  });
  if (!(response.status >= 200 && response.status < 300)) {
    throw new Error(`HTTP ${response.status} on ${method} ${pathname}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// serve 进程管理
// ---------------------------------------------------------------------------

class CappedLog {
  constructor(capBytes = STDERR_CAP_BYTES) {
    this.capBytes = capBytes;
    this.parts = [];
    this.size = 0;
    this.truncated = false;
  }

  append(text) {
    if (this.size >= this.capBytes) {
      this.truncated = true;
      return;
    }
    this.parts.push(text);
    this.size += text.length;
    if (this.size >= this.capBytes) {
      this.truncated = true;
    }
  }

  toString() {
    return this.parts.join("") + (this.truncated ? "\n[serve output truncated]\n" : "");
  }
}

/**
 * spawn codefree-o serve 并等待 stdout banner。解析成功返回
 * { ok, child, baseUrl, stdoutLog, stderrLog }；失败返回 { ok:false, payload }
 * （payload 字段全集与 companion run 路径的失败分支对齐）。
 */
export function startServe({
  binary,
  cwd,
  env,
  argv,
  startupTimeoutMs = SERVE_STARTUP_TIMEOUT_MS,
  spawnImpl = spawn,
  now = Date.now
}) {
  return new Promise((resolve) => {
    const resolved = resolveBinaryPath(binary);
    if (resolved === null) {
      const rendered =
        `Failed to start codefree-o: binary not found on PATH ` +
        `(CODEFREE_BIN=${binary}). Install codefree-o or point ` +
        "CODEFREE_BIN at the binary.";
      resolve({
        ok: false,
        payload: {
          status: "failed",
          reason: "binary-not-found",
          stderr: `codefree-o binary not found on PATH (CODEFREE_BIN=${binary})`,
          text: "", sessionID: null, toolUses: [], errorEvents: [], events: [],
          malformedLines: [], degraded: false, exitCode: 127, signal: null,
          timedOut: false, durationMs: 0, eventCount: 0, rendered
        }
      });
      return;
    }
    // 与 run 路径一致的 fail-closed shell 策略：.cmd/.bat shim 一律拒绝。
    if (needsShellForBinary(resolved)) {
      const rendered =
        "Refusing to run: codefree-o resolved to a .cmd/.bat shim, which " +
        "requires a shell-mediated spawn (word splitting, space loss, and " +
        "cmd.exe metacharacter risks). Install codefree-o as a native " +
        "executable and point CODEFREE_BIN at it.";
      resolve({
        ok: false,
        payload: {
          status: "failed",
          reason: "shell-mediated-spawn-refused",
          stderr: rendered,
          text: "", sessionID: null, toolUses: [], errorEvents: [], events: [],
          malformedLines: [], degraded: false, exitCode: 2, signal: null,
          timedOut: false, durationMs: 0, eventCount: 0, rendered
        }
      });
      return;
    }

    const serveArgv = argv ?? buildServeArgv(pickEphemeralPort());
    const child = spawnImpl(resolved, serveArgv, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32"
    });

    const stdoutLog = new CappedLog();
    const stderrLog = new CappedLog();
    const startedAt = now();
    let settled = false;

    const fail = (reason, rendered) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      offSignalHandlers();
      terminateProcessTree(child.pid);
      resolve({
        ok: false,
        payload: {
          status: "failed",
          reason,
          stderr: stderrLog.toString(),
          text: "", sessionID: null, toolUses: [], errorEvents: [], events: [],
          malformedLines: [], degraded: false, exitCode: 1, signal: null,
          timedOut: false, durationMs: now() - startedAt, eventCount: 0, rendered
        }
      });
    };

    const watchdog = setTimeout(() => {
      fail(
        "serve-start-timeout",
        `[codefree-o] FAILED: serve-start-timeout (no listening banner within ` +
          `${startupTimeoutMs}ms on stdout)`
      );
    }, startupTimeoutMs);

    // serve 进程意外退出（banner 未出现）同样是启动失败。
    child.on("close", () => {
      fail(
        "serve-exited",
        "[codefree-o] FAILED: serve-exited (serve process exited before " +
          "announcing a listening address)"
      );
    });
    child.on("error", (err) => {
      fail("serve-exited", `Failed to start codefree-o serve: ${err.message}`);
    });

    // runServeTask 结束时会接管信号处理；启动窗口内先把 serve 树带走。
    const signalHandler = (signalName) => () => {
      terminateProcessTree(child.pid);
      process.kill(process.pid, signalName);
    };
    const onSigterm = signalHandler("SIGTERM");
    const onSigint = signalHandler("SIGINT");
    const offSignalHandlers = () => {
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
    };
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);

    child.stdout.setEncoding("utf8");
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const baseUrl = parseServeBanner(line);
      if (baseUrl === null) {
        stdoutLog.append(`${line}\n`);
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      // banner 已出现：立即摘除启动窗口的信号 handler——runServeTask 会注册
      // 自己的生命周期 handler（含 abort），两个 handler 各自 re-raise 会形成
      // 信号递归链。此处的 offSignalHandlers 仍随返回值传出，任务结束时再
      // 调用一次是无害的 no-op。
      offSignalHandlers();
      rl.close();
      resolve({ ok: true, child, baseUrl, argv: serveArgv, stdoutLog, stderrLog, offSignalHandlers });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrLog.append(chunk));
  });
}

// ---------------------------------------------------------------------------
// 任务编排
// ---------------------------------------------------------------------------

function killServeTree(child, { sleep }) {
  // 优雅组 SIGTERM → 宽限 → SIGKILL 兜底（F3：孙进程可能免疫 SIGTERM）。
  terminateProcessTree(child.pid);
  return sleep(SERVE_KILL_GRACE_MS).then(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });
}

function buildServeStderr(stdoutLog, stderrLog, transientErrors) {
  const sections = [];
  const stdout = stdoutLog?.toString().trim();
  if (stdout) sections.push(`--- serve stdout ---\n${stdout}`);
  const stderr = stderrLog?.toString().trim();
  if (stderr) sections.push(`--- serve stderr ---\n${stderr}`);
  if (transientErrors.length > 0) {
    sections.push(`--- serve transport errors ---\n${transientErrors.slice(-20).join("\n")}`);
  }
  return sections.join("\n\n");
}

function failedPayload(reason, { stderr = "", events = [], durationMs = 0, rendered }) {
  // 失败文案融合进 stderr 首行而非设置 payload.rendered：emitResult 优先
  // 使用 rendered 时会完全跳过 renderRunResult，导致 stderr 段（serve 日志、
  // 传输错误等关键证据）被整体吞掉。
  const finalStderr = rendered ? `${rendered}\n${stderr}` : stderr;
  return {
    status: "failed",
    reason,
    stderr: finalStderr,
    text: "",
    sessionID: null,
    toolUses: [],
    errorEvents: [],
    events,
    malformedLines: [],
    degraded: false,
    exitCode: 1,
    signal: null,
    timedOut: false,
    durationMs,
    eventCount: events.length
  };
}

/**
 * 驱动一次 serve 任务：启动 serve → 定位/创建会话 → prompt_async → 轮询到
 * 完成/超时 → 杀树 → 返回与 run 路径兼容的 { payload, exitCode }。
 *
 * 所有 IO 原语可注入（fetchImpl/spawnImpl/now/sleep）以便零网络单测。
 */
export async function runServeTask({
  binName = "codefree-o",
  prompt,
  options = {},
  cwd,
  env,
  timeoutMs = 540_000,
  fetchImpl,
  spawnImpl = spawn,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  const fetcher = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetcher !== "function") {
    return {
      payload: failedPayload("no-fetch-runtime", {
        rendered: "This Node runtime has no global fetch; cannot drive the serve transport."
      }),
      exitCode: 1
    };
  }

  const startedAt = now();
  // EADDRINUSE（随机端口撞车）时 serve 崩溃退出（reason=serve-exited），
  // 换一个随机端口重试；其余启动失败（binary-not-found 等）不重试。
  let serve = null;
  for (let attempt = 1; attempt <= SERVE_START_ATTEMPTS; attempt++) {
    const candidate = await startServe({ binary: binName, cwd, env, spawnImpl, now });
    if (candidate.ok) {
      serve = candidate;
      break;
    }
    if (candidate.payload.reason !== "serve-exited" || attempt === SERVE_START_ATTEMPTS) {
      const { payload } = candidate;
      return { payload: { ...payload, durationMs: now() - startedAt }, exitCode: payload.exitCode };
    }
  }
  if (!serve) {
    return {
      payload: failedPayload("serve-start-failed", {
        rendered: "[codefree-o] FAILED: serve-start-failed (unreachable)"
      }),
      exitCode: 1
    };
  }

  const { child, baseUrl, argv: serveArgv, stdoutLog, stderrLog, offSignalHandlers } = serve;
  const transientErrors = [];
  const questionEvents = new Map(); // id → audit 事件（reject 失败时仍留痕）
  const directory = cwd;
  let sessionID = null;

  // runServeTask 生命周期内的信号处理：abort（若已有会话）+ 杀树 + re-raise。
  let aborting = false;
  const signalHandler = (signalName) => () => {
    if (aborting) return;
    aborting = true;
    if (sessionID !== null) {
      apiFetch(fetcher, baseUrl, `/session/${encodeURIComponent(sessionID)}/abort`, {
        directory,
        method: "POST"
      }).catch(() => {});
    }
    killServeTree(child, { sleep }).finally(() => {
      offSignalHandlers();
      process.kill(process.pid, signalName);
    });
  };
  const onSigterm = signalHandler("SIGTERM");
  const onSigint = signalHandler("SIGINT");
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  try {
    // --- 定位/创建会话 -----------------------------------------------------
    if (options.session) {
      sessionID = options.session;
    } else if (options.continue) {
      const sessions = await apiFetch(fetcher, baseUrl, "/session", { directory });
      const latest = Array.isArray(sessions) ? sessions[0] : null;
      if (!latest?.id) {
        return {
          payload: failedPayload("session-not-found", {
            stderr: buildServeStderr(stdoutLog, stderrLog, transientErrors),
            durationMs: now() - startedAt,
            rendered:
              "[codefree-o] FAILED: session-not-found (--continue: no existing " +
              `session in directory ${cwd})`
          }),
          exitCode: 1
        };
      }
      sessionID = options.fork ? null : latest.id;
      if (options.fork) {
        const forked = await apiFetch(fetcher, baseUrl, "/session", {
          directory,
          method: "POST",
          body: { title: "companion", parentID: latest.id }
        });
        sessionID = forked.id;
      }
    } else {
      const created = await apiFetch(fetcher, baseUrl, "/session", {
        directory,
        method: "POST",
        body: { title: "companion" }
      });
      if (process.env.CODEFREE_SERVE_DEBUG) {
        process.stderr.write(
          `[serve-debug] POST /session => ${JSON.stringify(created)?.slice(0, 200)}\n`
        );
      }
      sessionID = created.id;
    }
    if (process.env.CODEFREE_SERVE_DEBUG) {
      process.stderr.write(`[serve-debug] sessionID=${JSON.stringify(sessionID)} baseUrl=${baseUrl}\n`);
      const dbgList = await apiFetch(fetcher, baseUrl, "/session", { directory });
      const dbgRaw = await fetcher(apiUrl(baseUrl, `/session/${encodeURIComponent(sessionID)}/message`, directory), { signal: AbortSignal.timeout(SERVE_HTTP_TIMEOUT_MS) });
      process.stderr.write(
        `[serve-debug] list=${JSON.stringify(dbgList)?.slice(0, 300)}\n` +
          `[serve-debug] message GET status=${dbgRaw.status} body=${(await dbgRaw.text()).slice(0, 200)}\n`
      );
    }

    // --- 发送 prompt（只进 HTTP body）---------------------------------------
    // baseline：--continue/--session 时会话已有历史消息，受理检测只看新增。
    let baselineCount = 0;
    try {
      const pre = await apiFetch(fetcher, baseUrl, `/session/${encodeURIComponent(sessionID)}/message`, { directory });
      baselineCount = Array.isArray(pre) ? pre.length : 0;
    } catch {
      // 首查失败不致命，按 0 处理（新会话本就是 0）
    }
    const promptSentAt = now();
    await apiFetch(fetcher, baseUrl, `/session/${encodeURIComponent(sessionID)}/prompt_async`, {
      directory,
      method: "POST",
      body: buildServePromptBody({ prompt, model: options.model, agent: options.agent })
    });

    // --- 轮询到完成/超时 -----------------------------------------------------
    const deadline = startedAt + timeoutMs;
    let lastMessages = [];
    let timedOut = false;
    let completed = false;

    while (true) {
      let messages = null;
      let statusMap = null;
      try {
        messages = await apiFetch(fetcher, baseUrl, `/session/${encodeURIComponent(sessionID)}/message`, { directory });
        statusMap = await apiFetch(fetcher, baseUrl, "/session/status", { directory });
        lastMessages = Array.isArray(messages) ? messages : [];
      } catch (err) {
        transientErrors.push(`poll: ${err.message}`);
      }

      // 权限自动放行（--auto 等价）。瞬时失败只记录，下一轮重试。
      try {
        const pending = await apiFetch(fetcher, baseUrl, "/permission", { directory });
        for (const request of pending ?? []) {
          if (!request?.id) continue;
          try {
            await apiFetch(fetcher, baseUrl, `/permission/${encodeURIComponent(request.id)}/reply`, {
              directory,
              method: "POST",
              body: { reply: "once" }
            });
          } catch (err) {
            transientErrors.push(`permission reply ${request.id}: ${err.message}`);
          }
        }
      } catch (err) {
        transientErrors.push(`permission list: ${err.message}`);
      }

      // question 拒答：headless 无法替用户做选择，快速失败让模型继续；
      // reject 端点异常时留痕并靠总超时兜底（不处理会永久卡 busy）。
      try {
        const pendingQuestions = await apiFetch(fetcher, baseUrl, "/question", { directory });
        for (const question of pendingQuestions ?? []) {
          if (!question?.id) continue;
          if (!questionEvents.has(question.id)) {
            questionEvents.set(question.id, {
              type: "question.asked",
              timestamp: now(),
              sessionID,
              part: { type: "question", question }
            });
          }
          try {
            await apiFetch(fetcher, baseUrl, `/question/${encodeURIComponent(question.id)}/reject`, {
              directory,
              method: "POST"
            });
          } catch (err) {
            transientErrors.push(`question reject ${question.id}: ${err.message}`);
          }
        }
      } catch (err) {
        transientErrors.push(`question list: ${err.message}`);
      }

      // 完成判定：存在已完成（time.completed 非空）的 assistant 消息，且
      // 会话不处于 busy/retry。实测（v1.7.0）完成后 /session/status 会直接
      // 移除该会话的条目（返回空对象）而非置 "idle"，故键消失也算完成。
      if (process.env.CODEFREE_SERVE_DEBUG) {
        const lastAssistant = [...lastMessages].reverse().find((m) => m?.info?.role === "assistant");
        process.stderr.write(
          `[serve-debug] t+${now() - startedAt}ms msgs=${lastMessages.length} ` +
            `lastCompleted=${lastAssistant?.info?.time?.completed ?? "none"} ` +
            `status=${JSON.stringify(statusMap?.[sessionID]?.type ?? "<absent>")} ` +
            `errors=${transientErrors.length}\n`
        );
      }
      if (hasCompletedAssistant(lastMessages)) {
        const st = statusMap?.[sessionID]?.type;
        if (st !== "busy" && st !== "retry") {
          completed = true;
          break;
        }
      }
      if (now() >= deadline) {
        timedOut = true;
        break;
      }
      // serve 进程死亡：在完成判定与超时判定之后检查——消息已完成的成功
      // 结果不会因 serve 随即退出而丢失；未完成则立即以 serve-died 失败，
      // 不白等总超时（fetch 失败只进 transientErrors，等 deadline 要数分钟）。
      // 置于丢弃检测之前：serve 死了消息同样不会来，先归因到 serve-died。
      if (child.exitCode !== null || child.signalCode !== null) {
        const diedPayload = failedPayload("serve-died", {
          stderr: buildServeStderr(stdoutLog, stderrLog, [
            ...transientErrors,
            `serve process exited (code=${child.exitCode} signal=${child.signalCode})`
          ]),
          events: [...mapMessagesToEvents(lastMessages, sessionID), ...questionEvents.values()],
          durationMs: now() - startedAt,
          rendered:
            `[codefree-o] FAILED: serve-died (serve process exited mid-task: ` +
            `code=${child.exitCode} signal=${child.signalCode})`
        });
        await killServeTree(child, { sleep });
        offSignalHandlers();
        return { payload: diedPayload, exitCode: 1 };
      }
      // 「受理即丢弃」检测：user 消息受理即落库，超过窗口仍无任何新消息 =
      // serve 静默丢弃（prompt_async 204 但 ProviderNoProvidersError）。
      // 常见于上游认证不可达（代理/网络窗口），stderr 里的 serve 日志有据可查。
      if (lastMessages.length <= baselineCount && now() - promptSentAt > SERVE_PROMPT_DROP_DETECT_MS) {
        const droppedPayload = failedPayload("serve-prompt-dropped", {
          stderr: buildServeStderr(stdoutLog, stderrLog, [
            ...transientErrors,
            `no new message within ${SERVE_PROMPT_DROP_DETECT_MS / 1000}s of prompt_async — ` +
              "serve accepted the prompt (HTTP 204) but silently dropped it. " +
              "Typical cause: upstream auth unreachable (check proxy/network to srdcloud.cn); " +
              "see serve output above and README."
          ]),
          events: [...mapMessagesToEvents(lastMessages, sessionID), ...questionEvents.values()],
          durationMs: now() - startedAt,
          rendered:
            "[codefree-o] FAILED: serve-prompt-dropped (prompt accepted but silently " +
            "dropped — upstream auth/providers unavailable; check proxy to srdcloud.cn)"
        });
        await killServeTree(child, { sleep });
        offSignalHandlers();
        return { payload: droppedPayload, exitCode: 1 };
      }
      await sleep(SERVE_POLL_INTERVAL_MS);
    }

    // --- 超时中止（尽力而为）与统一杀树 --------------------------------------
    if (timedOut) {
      try {
        await apiFetch(fetcher, baseUrl, `/session/${encodeURIComponent(sessionID)}/abort`, {
          directory,
          method: "POST"
        });
      } catch {
        // serve 可能已不可达；杀树才是可靠清理。
      }
    }
    await killServeTree(child, { sleep });
    offSignalHandlers();

    const events = [
      ...mapMessagesToEvents(lastMessages, sessionID),
      ...questionEvents.values()
    ];
    const payload = buildRunPayload({
      events,
      malformedLines: [],
      stderr: buildServeStderr(stdoutLog, stderrLog, transientErrors),
      exitCode: completed ? 0 : 124,
      signal: null,
      timedOut,
      durationMs: now() - startedAt,
      command: [binName, ...serveArgv]
    });
    return { payload, exitCode: payload.status === "completed" ? 0 : payload.exitCode };
  } catch (err) {
    // prompt 提交/会话创建等前置步骤失败：仍要清理 serve 树。
    await killServeTree(child, { sleep });
    offSignalHandlers();
    return {
      payload: failedPayload("serve-http-error", {
        stderr: buildServeStderr(stdoutLog, stderrLog, [...transientErrors, String(err.message)]),
        events: [...questionEvents.values()],
        durationMs: now() - startedAt,
        rendered: `[codefree-o] FAILED: serve-http-error (${err.message})`
      }),
      exitCode: 1
    };
  }
}
