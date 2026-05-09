#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { validateMessage, formatErrorReport } from "./lib/commit-message.mjs";
import { readMessageInput } from "./lib/input.mjs";

async function main() {
  const message = await readMessageInput();

  if (message === undefined || !message.trim()) {
    process.stderr.write("usage: commit.mjs <message>  # or pipe via stdin\n");
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
    const r = spawnSync("git", ["commit", "-F", tmpFile], { stdio: "inherit" });
    exitCode = r.status ?? 1;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* already gone */ }
  }
  process.exit(exitCode);
}

main();
