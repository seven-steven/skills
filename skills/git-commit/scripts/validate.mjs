#!/usr/bin/env node
import { validateMessage, formatErrorReport, addTaskIdFooter } from "./lib/commit-message.mjs";
import { parseCommitArgs, readMessageInput } from "./lib/args.mjs";
import { normalizeTaskId } from "./lib/task-id.mjs";

function printUsage() {
  process.stderr.write(
    "usage: validate.mjs [--cwd <repo-path>] [--task-id <task-id>] <message>  # or pipe via stdin\n"
  );
}

async function main() {
  const parsed = parseCommitArgs(process.argv);
  if (parsed.error) {
    printUsage();
    process.exit(2);
  }

  const taskId = parsed.taskId === undefined ? undefined : normalizeTaskId(parsed.taskId);
  if (parsed.taskId !== undefined && taskId === undefined) {
    process.stderr.write("invalid task ID\n");
    process.exit(2);
  }

  const message = await readMessageInput({
    argv: [process.argv[0], process.argv[1], parsed.messageArg].filter(Boolean),
    stdin: process.stdin,
  });
  if (message === undefined || !message.trim()) {
    printUsage();
    process.exit(2);
  }

  const finalMessage = taskId ? addTaskIdFooter(message, taskId) : message;
  const result = validateMessage(finalMessage);
  if (!result.ok) {
    process.stderr.write(formatErrorReport(result.errors));
    process.exit(1);
  }
}

main();
