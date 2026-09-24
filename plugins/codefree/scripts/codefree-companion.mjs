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
 *   - Transport: by default the task runs over the serve transport
 *     (scripts/lib/serve-client.mjs): spawn `codefree-o serve` and drive it
 *     via its local HTTP API. The legacy run transport (spawn `codefree-o
 *     run --format json --auto`) stays reachable via CODEFREE_TRANSPORT=run,
 *     but codefree-o v1.7.0 hangs on that path under non-TTY stdio pipes —
 *     see the serve-client header and plugin README for the evidence.
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
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { UsageError } from "./lib/errors.mjs";
import { loadRequestFile } from "./lib/request-file.mjs";
import { resolvePrompt } from "./lib/prompt-resolver.mjs";
import {
  CODEFREE_BIN,
  buildChildEnv,
  buildCodefreeArgv,
  resolveTransport,
  runCodefree
} from "./lib/task-runner.mjs";
import { runServeTask } from "./lib/serve-client.mjs";
import { emitResult } from "./lib/renderer.mjs";

const DEFAULT_TIMEOUT_MS = 540_000;

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

  if (resolveTransport() === "serve") {
    const { payload, exitCode } = await runServeTask({
      binName: CODEFREE_BIN,
      prompt,
      options,
      cwd: resolvedCwd,
      env: buildChildEnv(),
      timeoutMs
    });
    emitResult(payload, exitCode, asJson);
    return;
  }

  const argvForCodefree = buildCodefreeArgv({ prompt, options, resolvedCwd });
  const { payload, exitCode } = await runCodefree({
    argv: argvForCodefree,
    cwd: resolvedCwd,
    timeoutMs
  });

  emitResult(payload, exitCode, asJson);
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