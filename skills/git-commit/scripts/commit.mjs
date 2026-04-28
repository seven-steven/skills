#!/usr/bin/env node
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { validateMessage, formatErrorReport } from "./lib/commit-message.mjs";

async function readStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    const lines = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

async function main() {
  if (process.stdin.isTTY) {
    process.stderr.write("usage: printf '%s' '<message>' | node commit.mjs\n");
    process.exit(2);
  }

  const message = await readStdin();

  if (!message.trim()) {
    process.stderr.write("usage: printf '%s' '<message>' | node commit.mjs\n");
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
