/**
 * task-runner.mjs
 *
 * Legacy `run` transport execution and shared argv/env construction for the
 * codefree companion.
 *
 * Exports:
 *   CODEFREE_BIN
 *   buildCodefreeArgv({ prompt, options, resolvedCwd }) → string[]
 *   buildChildEnv(sourceEnv) → child env object
 *   resolveTransport() → "serve" | "run"
 *   runCodefree({ argv, cwd, timeoutMs }) → Promise<{ payload, exitCode }>
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import { UsageError } from "./errors.mjs";
import { needsShellForBinary, resolveBinaryPath, terminateProcessTree } from "./process.mjs";
import { buildRunPayload, parseEventLine } from "./run-events.mjs";

export const CODEFREE_BIN = process.env.CODEFREE_BIN ?? "codefree-o";
const SIGKILL_GRACE_MS = 5_000;
const STDERR_CAP_BYTES = 256 * 1024;

// 传输层选择：serve（spawn codefree-o serve + 本地 HTTP API）是默认通道；
// run（spawn codefree-o run --format json --auto）保留为逃生通道——codefree-o
// v1.7.0 的 run 在非 TTY stdio 管道下首个事件输出前会永久阻塞（详见
// scripts/lib/serve-client.mjs 头注与 README），仅在排查 serve 通道自身问题时
// 才值得切换 CODEFREE_TRANSPORT=run。
const VALID_TRANSPORTS = new Set(["serve", "run"]);

export function resolveTransport() {
  const value = process.env.CODEFREE_TRANSPORT ?? "serve";
  if (!VALID_TRANSPORTS.has(value)) {
    throw new UsageError(
      `Invalid CODEFREE_TRANSPORT value: ${value} (expected "serve" or "run").`
    );
  }
  return value;
}

export function buildCodefreeArgv({ prompt, options, resolvedCwd }) {
  const argv = ["run"];
  // Flags first; the prompt goes after a bare `--` so a task text that
  // itself starts with "--foo" can never be parsed as an option by
  // codefree-o's yargs parser. NOTE: yargs' `--` (everything after is
  // positional) semantics are unverified against the real codefree-o
  // v1.7.0 binary — the PoC anchored the event schema, not this flag
  // layout. Verify with a real run before relying on it in production.
  argv.push("--format", "json", "--auto");
  if (options.model) argv.push("--model", options.model);
  if (options.agent) argv.push("--agent", options.agent);
  if (options.session) argv.push("--session", options.session);
  if (options.continue) argv.push("--continue");
  if (options.fork) argv.push("--fork");
  argv.push("--dir", resolvedCwd);
  if (prompt) {
    argv.push("--", prompt);
  }
  return argv;
}

function killTreeHard(pid) {
  // Last-resort SIGKILL after the graceful group TERM.
  try {
    process.kill(-pid, "SIGKILL");
    return;
  } catch {
    // fall through to single-process kill
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

const PROXY_URL_PATTERN = /^https?:\/\/\S+$/;
const ALL_PROXY_URL_PATTERN = /^(?:https?|socks5h?):\/\/\S+$/;
const LOCAL_NO_PROXY_ENTRIES = ["localhost", "127.0.0.1"];
const PROXY_ASSIGNMENT_PATTERN = /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)=(\S+)$/;

/**
 * Build the environment for the codefree-o child process.
 *
 * `CODEFREE_PROXY` routes ONLY codefree-o traffic through a proxy without
 * touching the rest of the session. Two value formats are accepted:
 *
 *   1. A single http(s) proxy URL — shortcut: HTTP_PROXY, HTTPS_PROXY and
 *      ALL_PROXY all get that URL.
 *   2. Space-separated KEY=VALUE assignments naming any of HTTP_PROXY,
 *      HTTPS_PROXY, ALL_PROXY, NO_PROXY — each key overrides exactly the
 *      matching child env var (ALL_PROXY also accepts socks5(h):// URLs).
 *      Example:
 *        "HTTP_PROXY=http://u:p@h:1080 HTTPS_PROXY=http://u:p@h:1080
 *         ALL_PROXY=socks5h://u:p@h NO_PROXY=127.0.0.1,10.0.0.0/8"
 *
 * Whenever at least one proxy variable is set, NO_PROXY is preserved and
 * always gains localhost/127.0.0.1 (required by upstream docs — the TUI
 * talks to a local HTTP server and must not loop through the proxy).
 * Invalid values fail fast instead of silently producing a broken config.
 */
export function buildChildEnv(sourceEnv = process.env) {
  const childEnv = { ...sourceEnv, LANG: sourceEnv.LANG ?? "C.UTF-8" };
  const raw = sourceEnv.CODEFREE_PROXY;
  if (raw === undefined || raw === "") {
    return childEnv;
  }

  let overrides;
  if (typeof raw === "string" && PROXY_URL_PATTERN.test(raw)) {
    overrides = { HTTP_PROXY: raw, HTTPS_PROXY: raw, ALL_PROXY: raw };
  } else {
    overrides = {};
    for (const token of String(raw).trim().split(/\s+/)) {
      const match = token.match(PROXY_ASSIGNMENT_PATTERN);
      if (!match) {
        throw new UsageError(
          `CODEFREE_PROXY has an invalid segment (expected KEY=VALUE with KEY in ` +
            `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY, got: ${token.slice(0, 60)})`
        );
      }
      overrides[match[1]] = match[2];
    }
    if (overrides.HTTP_PROXY !== undefined && !PROXY_URL_PATTERN.test(overrides.HTTP_PROXY)) {
      throw new UsageError(`CODEFREE_PROXY HTTP_PROXY must be an http(s) URL`);
    }
    if (overrides.HTTPS_PROXY !== undefined && !PROXY_URL_PATTERN.test(overrides.HTTPS_PROXY)) {
      throw new UsageError(`CODEFREE_PROXY HTTPS_PROXY must be an http(s) URL`);
    }
    if (overrides.ALL_PROXY !== undefined && !ALL_PROXY_URL_PATTERN.test(overrides.ALL_PROXY)) {
      throw new UsageError(`CODEFREE_PROXY ALL_PROXY must be an http(s) or socks5(h) URL`);
    }
  }

  let proxySet = false;
  for (const [key, value] of Object.entries(overrides)) {
    childEnv[key] = value;
    if (key !== "NO_PROXY") {
      proxySet = true;
    }
  }
  if (proxySet) {
    const noProxy = (childEnv.NO_PROXY ?? "").split(",").map((entry) => entry.trim());
    for (const entry of LOCAL_NO_PROXY_ENTRIES) {
      if (!noProxy.includes(entry)) {
        noProxy.unshift(entry);
      }
    }
    childEnv.NO_PROXY = noProxy.join(",");
  }
  return childEnv;
}

export function runCodefree({ argv, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const resolved = resolveBinaryPath(CODEFREE_BIN);
    if (resolved === null) {
      const rendered =
        `Failed to start codefree-o: binary not found on PATH ` +
        `(CODEFREE_BIN=${CODEFREE_BIN}). Install codefree-o or point ` +
        "CODEFREE_BIN at the binary.";
      resolve({
        rendered,
        exitCode: 127,
        payload: {
          status: "failed",
          reason: "binary-not-found",
          stderr: `codefree-o binary not found on PATH (CODEFREE_BIN=${CODEFREE_BIN})`,
          text: "",
          sessionID: null,
          toolUses: [],
          errorEvents: [],
          events: [],
          malformedLines: [],
          degraded: false,
          exitCode: 127,
          signal: null,
          timedOut: false,
          durationMs: 0,
          eventCount: 0
        }
      });
      return;
    }

    // Fail-closed shell policy: a .cmd/.bat resolution forces a shell-mediated
    // spawn (cmd.exe), which can split whitespace-containing values, collapse
    // consecutive spaces in the prompt, and interpret cmd metacharacters —
    // even inside Node's quoting. That entire class of risk is refused:
    // only a native codefree-o executable is supported. CODEFREE_BIN is an
    // untrusted env value, so this refusal is unconditional, not value-based.
    if (needsShellForBinary(resolved)) {
      const rendered =
        "Refusing to run: codefree-o resolved to a .cmd/.bat shim, which " +
        "requires a shell-mediated spawn (word splitting, space loss, and " +
        "cmd.exe metacharacter risks). Install codefree-o as a native " +
        "executable and point CODEFREE_BIN at it.";
      resolve({
        rendered,
        exitCode: 2,
        payload: {
          status: "failed",
          reason: "shell-mediated-spawn-refused",
          stderr:
            "Refusing a shell-mediated spawn via .cmd/.bat shim. " +
            "Install codefree-o as a native executable (e.g. .exe) and " +
            "point CODEFREE_BIN at it.",
          text: "",
          sessionID: null,
          toolUses: [],
          errorEvents: [],
          events: [],
          malformedLines: [],
          degraded: false,
          exitCode: 2,
          signal: null,
          timedOut: false,
          durationMs: 0,
          eventCount: 0
        }
      });
      return;
    }

    const startedAt = Date.now();
    // The prompt (if any) is the element after the trailing `--` separator;
    // redact it from the audit command line so `--json` payloads do not
    // silently copy sensitive task text into logs or reports.
    const promptIndex = argv[argv.length - 2] === "--" ? argv.length - 1 : -1;
    const auditCommand = [
      CODEFREE_BIN,
      ...argv.map((element, index) =>
        index === promptIndex ? `<prompt: ${element.length} chars, redacted>` : element
      )
    ];
    // detached on POSIX => own process group => kill(-pid) reaches the whole
    // tree. On win32, taskkill /T in terminateProcessTree walks the tree.
    const child = spawn(resolved, argv, {
      cwd,
      env: buildChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: needsShellForBinary(resolved)
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const events = [];
    const malformedLines = [];
    let stderr = "";
    let stderrTruncated = false;
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let timeoutTimer = null;
    let killTimer = null;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const parsed = parseEventLine(line);
      if (parsed.ok) {
        events.push(parsed.event);
      } else if (parsed.raw !== null) {
        malformedLines.push(parsed.raw);
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length < STDERR_CAP_BYTES) {
        stderr += chunk;
        if (stderr.length >= STDERR_CAP_BYTES) {
          stderr = stderr.slice(0, STDERR_CAP_BYTES);
          stderrTruncated = true;
        }
      }
    });

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = null;
      // F3: once the graceful timeout kill has started, the SIGKILL grace
      // timer must NOT be cancelled by an early child 'close' — a grandchild
      // that ignores SIGTERM may still be alive and would otherwise leak.
      // It is only cancelled while never armed (killTimer stays armed once
      // timedOut is set, keeping the event loop alive until it fires).
      if (killTimer && !timedOut) clearTimeout(killTimer);
      if (!timedOut) killTimer = null;
    };

    const offSignalHandlers = () => {
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
    };

    const settle = ({ forcedExitCode = null, signal = null } = {}) => {
      if (settled) return;
      settled = true;
      clearTimers();
      offSignalHandlers();
      rl.close();

      const payload =
        spawnError !== null
          ? {
              status: "failed",
              reason: "spawn-error",
              stderr: spawnError.message,
              text: "",
              sessionID: null,
              toolUses: [],
              errorEvents: [],
              events: [],
              malformedLines: [],
              degraded: false,
              exitCode: 127,
              signal: null,
              timedOut: false,
              durationMs: Date.now() - startedAt,
              command: auditCommand,
              eventCount: 0,
              // F1: full field set + rendered so downstream printing never
              // has to fall back to renderRunResult on a partial payload.
              rendered: `Failed to start codefree-o: ${spawnError.message}`
            }
          : buildRunPayload({
              events,
              malformedLines,
              stderr: stderrTruncated ? `${stderr}\n[stderr truncated]` : stderr,
              exitCode: forcedExitCode ?? 1,
              signal,
              timedOut,
              durationMs: Date.now() - startedAt,
              command: auditCommand
            });

      resolve({ payload, exitCode: spawnError !== null ? 127 : (forcedExitCode ?? 1) });
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid);
      // Not unref'd on purpose: the companion must stay alive until the
      // SIGKILL grace fires, even if the direct child closes early (F3).
      killTimer = setTimeout(() => killTreeHard(child.pid), SIGKILL_GRACE_MS);
    }, timeoutMs);
    if (timeoutTimer.unref) timeoutTimer.unref();

    // If the companion itself receives SIGTERM/SIGINT (e.g. TaskStop killing
    // the wrapping tool call), take the codefree-o tree with us instead of
    // leaving an unattended agent running, then re-raise the signal.
    const signalHandler = (signalName, exitSignal) => () => {
      terminateProcessTree(child.pid);
      settle({ forcedExitCode: 128 + exitSignal, signal: signalName });
      process.kill(process.pid, signalName);
    };
    const onSigterm = signalHandler("SIGTERM", 15);
    const onSigint = signalHandler("SIGINT", 2);
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);

    child.on("error", (err) => {
      spawnError = err;
      // 'error' is not always followed by 'close' (e.g. EINVAL);
      // settle now — later 'close' events are ignored via `settled`.
      settle({});
    });

    child.on("close", (code, signal) => {
      if (spawnError !== null) return;
      const forcedExitCode = code ?? (timedOut ? 124 : 1);
      settle({ forcedExitCode, signal });
    });
  });
}