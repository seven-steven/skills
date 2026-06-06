#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { validateMessage, formatErrorReport } from "./lib/commit-message.mjs";
import { readMessageInput } from "./lib/input.mjs";

function printUsage() {
  process.stderr.write("usage: commit.mjs [--cwd <repo-path>] <message>  # or pipe via stdin\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args[0] !== "--cwd") {
    return { cwd: undefined, messageArg: args[0] };
  }

  const cwd = args[1];
  if (!cwd) {
    return { error: true };
  }

  return { cwd, messageArg: args[2] };
}

async function main() {
  const { cwd, messageArg, error } = parseArgs(process.argv);
  if (error) {
    printUsage();
    process.exit(2);
  }

  const message = await readMessageInput({
    argv: [process.argv[0], process.argv[1], messageArg].filter(Boolean),
    stdin: process.stdin,
  });

  if (message === undefined || !message.trim()) {
    printUsage();
    process.exit(2);
  }

  const result = validateMessage(message);
  if (!result.ok) {
    process.stderr.write(formatErrorReport(result.errors));
    process.exit(1);
  }

  const tmpFile = join(tmpdir(), `claude-commit-${randomBytes(6).toString("hex")}.txt`);
  let exitCode = 1;
  try {
    writeFileSync(tmpFile, message, "utf8");
    const gitArgs = cwd ? ["-C", cwd, "commit", "-F", tmpFile] : ["commit", "-F", tmpFile];
    const r = spawnSync("git", gitArgs, { stdio: "inherit" });
    exitCode = r.status ?? 1;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* already gone */ }
  }
  process.exit(exitCode);
}

main();
