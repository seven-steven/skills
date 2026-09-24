import { createInterface } from "node:readline";

const KNOWN_OPTIONS = new Set(["--cwd", "--task-id"]);

/**
 * Parse CLI arguments for commit.mjs / validate.mjs.
 *
 * Returns `{ cwd, taskId, messageArg }` on success, or `{ error: true }` when
 * the arguments are malformed (missing option values, duplicate options, or
 * multiple positional arguments).
 *
 * Rules:
 * - `--cwd <path>`, `--task-id <value>` — value must not start with `--` and
 *   must not be `undefined` (missing).
 * - `--` separates options from the positional message.
 * - Unknown flags that start with `--` fall into the positional message.
 * - Only one positional message is allowed.
 */
export function parseCommitArgs(argv) {
  let cwd;
  let taskId;
  let messageArg;
  let pastDashDash = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (pastDashDash) {
      if (messageArg !== undefined) return { error: true };
      messageArg = arg;
      continue;
    }

    if (arg === "--") {
      pastDashDash = true;
      continue;
    }

    if (KNOWN_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { error: true };
      if (arg === "--cwd") {
        if (cwd !== undefined) return { error: true };
        cwd = value;
      } else {
        if (taskId !== undefined) return { error: true };
        taskId = value;
      }
      index += 1;
    } else if (messageArg !== undefined) {
      return { error: true };
    } else {
      // Positional — includes unknown --flags (falls into message).
      messageArg = arg;
    }
  }

  return { cwd, taskId, messageArg };
}

/**
 * Read a commit message from argv or stdin.
 *
 * When the first positional argument (`argv[2]`) is present, it is returned
 * immediately.  Otherwise, if stdin is a TTY (no pipe), returns undefined.
 * Otherwise reads all lines from stdin and returns them joined by newlines.
 */
export async function readMessageInput({ argv = process.argv, stdin = process.stdin } = {}) {
  if (argv[2] !== undefined) return argv[2];
  if (stdin.isTTY) return undefined;

  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin });
    const lines = [];
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}