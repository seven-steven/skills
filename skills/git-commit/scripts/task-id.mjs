#!/usr/bin/env node
import { resolveTaskId } from "./lib/task-id.mjs";
import { parseCommitArgs } from "./lib/args.mjs";

function usage() {
  process.stderr.write("usage: task-id.mjs [--cwd <repo-path>] [taskId]\n");
}

const parsed = parseCommitArgs(process.argv);
if (parsed.error) {
  usage();
  process.exit(2);
}

// The positional arg is the task ID; also accept --task-id (equivalent).
const taskIdArg = parsed.taskId ?? parsed.messageArg;

const result = resolveTaskId({ cwd: parsed.cwd, taskId: taskIdArg });
if (!result.ok) {
  process.stderr.write("invalid task ID\n");
  process.exit(2);
}
if (result.taskId) process.stdout.write(`${result.taskId}\n`);