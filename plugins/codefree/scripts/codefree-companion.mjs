#!/usr/bin/env node
/**
 * codefree-companion.mjs
 *
 * Single-run companion for the codefree-o CLI (`codefree-o run`).
 *
 * Subcommands:
 *   task   Run one codefree-o delegation and print the result.
 *   help   Show usage.
 *
 * Design notes:
 *   - The task prompt travels through one of:
 *       --prompt-stdin   (preferred: agent single-quote-escapes the text
 *                         into the Bash tool call itself)
 *       --prompt-file <path>  (fallback: file in the OS temp dir)
 *     Either way the companion hands the prompt to codefree-o directly
 *     via the spawn argv array, so no shell ever re-interprets it here.
 *     The prompt is never parsed for flags and never accepted as a
 *     positional, so task text containing "--anything" is preserved.
 *   - `--auto` (auto-approve permissions that are not explicitly denied —
 *     flagged DANGEROUS by codefree-o itself) is always added, per the
 *     approved migration plan. This does NOT inherit Claude Code approval
 *     state and is not a sandbox. See the plugin README.
 *   - Only a strict allowlist of codefree-o flags is forwarded:
 *     --model / --agent / --continue / --session / --fork. Attach, share,
 *     command, file-attachment, title, and port flags are never forwarded;
 *     any unknown argument is a usage error (strict allowlist).
 *   - On POSIX the child runs detached in its own process group so that
 *     timeout, SIGTERM and SIGINT cleanup can kill the whole tree via
 *     terminateProcessTree(-pid). The companion also forwards its own
 *     SIGTERM/SIGINT to the child tree before exiting (TaskStop safety).
 *   - NDJSON stdout is parsed with scripts/lib/run-events.mjs. Error
 *     events fail the run even when codefree-o exits 0; malformed stdout
 *     lines fail the run (fail-closed); a run with tool_use events but no
 *     text is still a completion; exit 0 with no text and no tool_use is
 *     a failure ("no-result").
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { needsShellForBinary, resolveBinaryPath, terminateProcessTree } from "./lib/process.mjs";
import { buildRunPayload, parseEventLine } from "./lib/run-events.mjs";

const CODEFREE_BIN = process.env.CODEFREE_BIN ?? "codefree-o";
// Kept below the Claude Code Bash tool hard cap (600 000 ms) so a foreground
// delegation can always finish inside a single tool call. Longer work must be
// split, or resumed via --continue / --session.
const DEFAULT_TIMEOUT_MS = 540_000;
const SIGKILL_GRACE_MS = 5_000;
const STDERR_CAP_BYTES = 256 * 1024;

// Value patterns for request-file fields. These are advisory hard limits so
// that untrusted strings cannot smuggle codefree-o flags or control
// characters; the values reach codefree-o via spawn argv (no shell), so the
// risk being contained here is flag injection, not shell injection. Values
// must start and end with an alphanumeric character, so no leading "-" or
// "." trickery.
const VALUE_PATTERNS = {
  model: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,198}[A-Za-z0-9]$/,
  agent: /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}[A-Za-z0-9]$/,
  session: /^[A-Za-z0-9][A-Za-z0-9._-]{0,198}[A-Za-z0-9]$/
};

const REQUEST_ALLOWED_KEYS = new Set([
  "prompt",
  "promptFile",
  "cwd",
  "model",
  "agent",
  "session",
  "continue",
  "fork",
  "timeoutMs"
]);

// Cleanup guard (constrained best effort, NOT ownership proof): a request/
// prompt file is deleted only when ALL of these hold — it lives under the
// OS temp dir, its basename matches the naming convention the agent was
// told to use with a random suffix of >= 8 chars, and it is a regular file
// (symlinks are never followed or deleted). A same-machine attacker who can
// pre-place a matching file under /tmp could still get it deleted; the guard
// bounds mistakes and abuse of arbitrary paths, it does not prove creation.
const AGENT_TEMP_FILE = /^codefree-(task|request)-[A-Za-z0-9_-]{8,}(\.txt|\.json)$/;
// Private parent directories the agent creates via fs.mkdtempSync default to
// mode 0700; an emptied one is removed so no prompt-bearing tree lingers.
const AGENT_TEMP_DIR = /^codefree-req-/;

function safeDeleteTempFile(filePath) {
  const resolved = path.resolve(filePath);
  const tmpDir = path.resolve(os.tmpdir());
  const insideTmp = resolved === tmpDir || resolved.startsWith(tmpDir + path.sep);
  if (!insideTmp || !AGENT_TEMP_FILE.test(path.basename(resolved))) {
    process.stderr.write(
      "[codefree-companion] note: the request/prompt file was left in place " +
        "(only agent-created codefree-*-<random> files under the OS temp dir " +
        "are auto-deleted). Delete it yourself if it holds sensitive text.\n"
    );
    return false;
  }
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return false;
    }
    fs.unlinkSync(resolved);
  } catch {
    return false;
  }
  // Best-effort removal of the private parent dir once it is empty.
  const parent = path.dirname(resolved);
  const parentInsideTmp = parent.startsWith(tmpDir + path.sep);
  if (parentInsideTmp && AGENT_TEMP_DIR.test(path.basename(parent))) {
    try {
      fs.rmdirSync(parent); // fails (ENOENT-ish ENOTEMPTY) when not empty
    } catch {
      // non-empty or vanished — fine
    }
  }
  return true;
}

const USAGE = [
  "Usage: codefree-companion.mjs task --request-file <path> [options]",
  "       (or combine --prompt-stdin / --prompt-file with individual flags)",
  "",
  "Request file (recommended for agents; everything else is ignored with it):",
  "  A JSON object:",
  '    { "promptFile": "/tmp/codefree-req-x/codefree-task-ab12cd34.txt",',
  '      "cwd": "...", "model": "provider/model", "agent": "build",',
  '      "session": "ses-id", "continue": false, "fork": false,',
  '      "timeoutMs": 540000 }',
  "  promptFile points at a raw UTF-8 text file holding the task verbatim",
  "  (preferred: no JSON escaping of task text). Alternatively a short",
  '  "prompt" string may be given directly — never both. All keys are',
  "  optional except one of prompt/promptFile. Unknown keys and values that",
  "  fail strict patterns are rejected. Files are deleted after reading ONLY",
  "  if inside the OS temp dir and matching codefree-(task|request)-*.",
  "",
  "Options:",
  "  --request-file <path> Read task + options from a JSON request file.",
  "  --prompt-stdin        Read the task prompt from stdin instead.",
  "  --prompt-file <path>  Read the task prompt from this UTF-8 text file.",
  "  --cwd <dir>           Working directory (forwarded as codefree-o's --dir).",
  "  --model <provider/model>",
  "  --agent <name>",
  "  --continue            Continue the most recent codefree-o session.",
  "  --session <id>        Continue a specific codefree-o session.",
  "  --fork                Fork the session when continuing (requires --continue/--session).",
  "  --timeout-ms <ms>     Kill the codefree-o process tree after this long",
  `                        (default: ${DEFAULT_TIMEOUT_MS}, below the 600 000 ms`,
  "                        Bash tool cap — split longer work or resume via",
  "                        --continue/--session).",
  "  --json                Print the full audit payload as JSON.",
  "",
  "The prompt is required unless --continue or --session is given.",
  "",
  "Security notes:",
  "  - No user text is ever placed on a shell command line: prompts travel",
  "    through files/stdin, and codefree-o receives it via spawn argv.",
  "  - Cleanup guard: the companion only deletes request/prompt files inside",
  "    the OS temp dir matching codefree-(task|request)-*.{json,txt}; any",
  "    other --prompt-file/--request-file path is read-only.",
  "  - --auto (dangerous: auto-approves permissions not explicitly denied)",
  "    is always applied and cannot be disabled through this wrapper."
].join("\n");

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// CLI parsing (strict allowlist — anything unknown is a usage error)
// ---------------------------------------------------------------------------

function parseTaskArgs(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["prompt-file", "request-file", "cwd", "model", "agent", "session", "timeout-ms"],
    booleanOptions: ["prompt-stdin", "continue", "fork", "json"]
  });

  if (positionals.length > 0) {
    throw new UsageError(
      `Unrecognized argument(s): ${positionals.join(" ")}. ` +
        "Pass the task text via --prompt-stdin or --prompt-file, never positionally."
    );
  }
  return options;
}

function resolveTimeoutMs(options) {
  if (options["timeout-ms"] === undefined) return DEFAULT_TIMEOUT_MS;
  const value = Number(options["timeout-ms"]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`Invalid --timeout-ms value: ${options["timeout-ms"]}`);
  }
  return Math.floor(value);
}

function resolvePrompt(options) {
  const fromFile = options["prompt-file"] !== undefined;
  const fromStdin = Boolean(options["prompt-stdin"]);
  if (fromFile && fromStdin) {
    throw new UsageError("Use either --prompt-file or --prompt-stdin, not both.");
  }

  let prompt = "";
  if (fromFile) {
    const filePath = path.resolve(options["prompt-file"]);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      throw new UsageError(`Cannot read prompt file ${filePath}: ${err.message}`);
    }
    // Preserve the file content verbatim — no trailing-newline trimming;
    // task fidelity beats cosmetic tidiness.
    prompt = content;
    // Cleanup is guarded (temp dir + naming convention only) so a hostile or
    // mistaken path can never delete a real user file.
    safeDeleteTempFile(filePath);
  } else if (fromStdin) {
    prompt = fs.readFileSync(0, "utf8");
  }

  const canRunWithoutPrompt = Boolean(options.continue || options.session);
  if (!prompt.trim() && !canRunWithoutPrompt) {
    throw new UsageError(
      "Empty task. Pass the task text via --prompt-stdin/--prompt-file, " +
        "or use --continue/--session to resume without a new prompt."
    );
  }
  return prompt;
}

/**
 * Load and validate a request JSON file: { prompt, cwd, model, agent,
 * session, continue, fork, timeoutMs }. Unknown keys are rejected; string
 * values must match strict patterns so nothing that reaches codefree-o's
 * argv can smuggle extra flags. Returns the equivalent CLI options object
 * (with `__prompt` holding the prompt text).
 */
function loadRequestFile(requestPath) {
  const filePath = path.resolve(requestPath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new UsageError(`Cannot read request file ${filePath}: ${err.message}`);
  }

  let options = {};
  try {
    let request;
    try {
      request = JSON.parse(raw);
    } catch (err) {
      throw new UsageError(`Request file ${filePath} is not valid JSON`);
    }
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new UsageError(`Request file ${filePath} must contain a JSON object.`);
    }

    const unknown = Object.keys(request).filter((key) => !REQUEST_ALLOWED_KEYS.has(key));
    if (unknown.length > 0) {
      throw new UsageError(`Request file has unknown key(s): ${unknown.join(", ")}`);
    }

    for (const key of Object.keys(request)) {
      const value = request[key];
      switch (key) {
        case "prompt":
          if (typeof value !== "string") throw new UsageError("request.prompt must be a string");
          options.__prompt = value;
          break;
        case "promptFile": {
          if (typeof value !== "string" || !value.trim()) {
            throw new UsageError("request.promptFile must be a non-empty string");
          }
          // The prompt file must be an agent temp file inside the SAME
          // private directory as the request file itself. This keeps the
          // two-file workflow (raw text + flags-only JSON) inside the guarded
          // cleanup boundary and stops the request from pointing at arbitrary
          // or pre-existing temp files elsewhere.
          const resolvedPromptFile = path.resolve(value);
          const tmpDir = path.resolve(os.tmpdir());
          const insideTmp =
            resolvedPromptFile === tmpDir || resolvedPromptFile.startsWith(tmpDir + path.sep);
          const sameDir = path.dirname(resolvedPromptFile) === path.dirname(filePath);
          if (!insideTmp || !sameDir || !AGENT_TEMP_FILE.test(path.basename(resolvedPromptFile))) {
            throw new UsageError(
              "request.promptFile must point at an agent temp file " +
                "(codefree-task-*.txt) inside the same private temp directory " +
                "as the request file."
            );
          }
          options.__promptFile = resolvedPromptFile;
          break;
        }
        case "cwd":
          if (typeof value !== "string") throw new UsageError("request.cwd must be a string");
          options.cwd = value;
          break;
        case "model":
        case "agent":
        case "session":
          if (typeof value !== "string" || !VALUE_PATTERNS[key].test(value)) {
            throw new UsageError(`request.${key} failed its validation pattern`);
          }
          options[key] = value;
          break;
        case "continue":
        case "fork":
          if (typeof value !== "boolean") throw new UsageError(`request.${key} must be a boolean`);
          options[key] = value;
          break;
        case "timeoutMs":
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            throw new UsageError("request.timeoutMs must be a positive number");
          }
          options["timeout-ms"] = String(Math.floor(value));
          break;
        default:
          break;
      }
    }

    if (options.__prompt !== undefined && options.__promptFile !== undefined) {
      throw new UsageError('Use either "prompt" or "promptFile" in the request file, not both.');
    }

    // Two-file workflow: the prompt lives in its own raw text file so no
    // JSON escaping of task text is ever needed. Read it verbatim.
    if (options.__promptFile !== undefined) {
      // Refuse symlinks / special files before reading.
      const stat = fs.lstatSync(options.__promptFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new UsageError("request.promptFile must be a regular file");
      }
      let content;
      try {
        content = fs.readFileSync(options.__promptFile, "utf8");
      } catch (err) {
        throw new UsageError(`Cannot read request.promptFile: ${err.message}`);
      }
      options.__prompt = content;
      safeDeleteTempFile(options.__promptFile);
      delete options.__promptFile;
    }

    return options;
  } finally {
    // Guarded cleanup runs even when validation fails, so sensitive files
    // are never left behind. Only files in the OS temp dir following the
    // agent naming convention are removed; anything else is left untouched.
    if (options.__promptFile !== undefined) {
      safeDeleteTempFile(options.__promptFile);
    }
    safeDeleteTempFile(filePath);
  }
}

// ---------------------------------------------------------------------------
// codefree-o execution
// ---------------------------------------------------------------------------

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

function runCodefree({ argv, cwd, timeoutMs }) {
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderRunResult(payload) {
  if (payload.status === "completed") {
    const lines = [];
    if (payload.textParts.length > 0) {
      // Display-only separation between original text parts; the parts
      // themselves are never re-joined with invented characters.
      lines.push(payload.textParts.join("\n\n"));
    }
    const meta = [];
    if (payload.sessionID) meta.push(`session=${payload.sessionID}`);
    meta.push(`tool_calls=${payload.toolUses.length}`);
    meta.push(`duration=${(payload.durationMs / 1000).toFixed(1)}s`);
    lines.push(`[codefree-o] ${meta.join(" ")}`);
    for (const use of payload.toolUses) {
      lines.push(`  - ${use.tool ?? "unknown tool"}${use.title ? `: ${use.title}` : ""}`);
    }
    return lines.join("\n");
  }

  const lines = [`[codefree-o] FAILED: ${payload.reason ?? "unknown"} (exit ${payload.exitCode})`];
  if (payload.sessionID) lines.push(`session=${payload.sessionID}`);
  if (payload.text) {
    lines.push("--- partial output (run did not complete cleanly) ---", payload.text);
  }
  if (payload.errorEvents.length > 0) {
    lines.push("--- error events ---", ...payload.errorEvents.map((e) => JSON.stringify(e)));
  }
  if (payload.stderr.trim()) {
    lines.push("--- stderr ---", payload.stderr.trimEnd());
  }
  if (payload.degraded) {
    lines.push("--- non-JSON stdout lines ---", ...payload.malformedLines);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// task subcommand
// ---------------------------------------------------------------------------

async function handleTaskCommand(argv) {
  let options = parseTaskArgs(argv);
  const asJson = Boolean(options.json);

  if (options["request-file"] !== undefined) {
    const conflicts = Object.keys(options).filter((key) => key !== "request-file" && key !== "json");
    if (conflicts.length > 0) {
      throw new UsageError(
        `--request-file must be the only option besides --json (found: ${conflicts.join(", ")}).`
      );
    }
    // loadRequestFile replaces the option set; --json must survive the swap.
    options = { ...loadRequestFile(options["request-file"]), json: asJson };
  }

  const prompt =
    options.__prompt !== undefined ? options.__prompt : resolvePrompt(options);

  if (!prompt.trim() && !options.continue && !options.session) {
    throw new UsageError(
      "Empty task. Provide a prompt via the request file / --prompt-file / --prompt-stdin, " +
        "or use --continue/--session to resume without a new prompt."
    );
  }
  if (options.continue && options.session) {
    throw new UsageError("--continue and --session are mutually exclusive.");
  }
  if (options.fork && !options.continue && !options.session) {
    throw new UsageError("--fork requires --continue or --session.");
  }
  const timeoutMs = resolveTimeoutMs(options);
  const resolvedCwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  let cwdStat = null;
  try {
    cwdStat = fs.statSync(resolvedCwd);
  } catch {
    // handled below
  }
  if (!cwdStat || !cwdStat.isDirectory()) {
    throw new UsageError(`Working directory does not exist or is not a directory: ${resolvedCwd}`);
  }

  const argvForCodefree = buildCodefreeArgv({ prompt, options, resolvedCwd });
  const { payload, exitCode } = await runCodefree({
    argv: argvForCodefree,
    cwd: resolvedCwd,
    timeoutMs
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${payload.rendered ?? renderRunResult(payload)}\n`);
  }
  if (payload.status !== "completed") {
    process.exitCode = exitCode !== 0 ? exitCode : 1;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  try {
    switch (subcommand) {
      case "task":
        await handleTaskCommand(rest);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        process.stdout.write(`${USAGE}\n`);
        if (subcommand === undefined) process.exitCode = 2;
        break;
      default:
        process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}\n`);
        process.exitCode = 2;
    }
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  }
}

main();
