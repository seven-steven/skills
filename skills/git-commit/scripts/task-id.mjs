#!/usr/bin/env node
import { resolveTaskId } from "./lib/task-id.mjs";

function usage() {
  process.stderr.write("usage: task-id.mjs [--cwd <repo-path>] [taskId]\n");
}

function parseArgs(argv) {
  let cwd;
  let taskId;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") {
      const value = argv[index + 1];
      if (cwd !== undefined || value === undefined || value.startsWith("--")) {
        return { error: true };
      }
      cwd = value;
      index += 1;
    } else if (arg.startsWith("--") || taskId !== undefined) {
      return { error: true };
    } else {
      taskId = arg;
    }
  }
  return { cwd, taskId };
}

const parsed = parseArgs(process.argv);
if (parsed.error) {
  usage();
  process.exit(2);
}

const result = resolveTaskId(parsed);
if (!result.ok) {
  process.stderr.write("invalid task ID\n");
  process.exit(2);
}
if (result.taskId) process.stdout.write(`${result.taskId}\n`);
