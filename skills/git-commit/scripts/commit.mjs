#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { validateMessage, formatErrorReport, addTaskIdFooter } from "./lib/commit-message.mjs";
import { readMessageInput } from "./lib/input.mjs";
import { normalizeTaskId } from "./lib/task-id.mjs";

function printUsage() {
  process.stderr.write(
    "usage: commit.mjs [--cwd <repo-path>] [--task-id <task-id>] <message>  # or pipe via stdin\n"
  );
}

function parseArgs(argv) {
  let cwd;
  let taskId;
  let messageArg;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd" || arg === "--task-id") {
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
    } else if (arg.startsWith("--") || messageArg !== undefined) {
      return { error: true };
    } else {
      messageArg = arg;
    }
  }
  return { cwd, taskId, messageArg };
}

async function main() {
  const parsed = parseArgs(process.argv);
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

  const tmpFile = join(tmpdir(), `claude-commit-${randomBytes(6).toString("hex")}.txt`);
  let exitCode = 1;
  try {
    writeFileSync(tmpFile, finalMessage, "utf8");
    const gitArgs = parsed.cwd
      ? ["-C", parsed.cwd, "commit", "-F", tmpFile]
      : ["commit", "-F", tmpFile];
    const commit = spawnSync("git", gitArgs, { stdio: "inherit" });
    exitCode = commit.status ?? 1;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* already gone */ }
  }
  process.exit(exitCode);
}

main();
