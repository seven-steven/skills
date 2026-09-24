#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildCommit } from "./lib/build-commit.mjs";

async function main() {
  const result = await buildCommit(process.argv, process.stdin);
  if (!result.ok) {
    if (result.errors) {
      process.stderr.write(`  - ${result.errors.join("\n  - ")}\n`);
    } else {
      process.stderr.write(
        "usage: commit.mjs [--cwd <repo-path>] [--task-id <task-id>] <message>  # or pipe via stdin\n"
      );
    }
    process.exit(result.exitCode);
  }

  const tmpFile = join(tmpdir(), `claude-commit-${randomBytes(6).toString("hex")}.txt`);
  let exitCode = 1;
  try {
    writeFileSync(tmpFile, result.message, "utf8");
    const gitArgs = result.cwd
      ? ["-C", result.cwd, "commit", "-F", tmpFile]
      : ["commit", "-F", tmpFile];
    const commit = spawnSync("git", gitArgs, { stdio: "inherit" });
    exitCode = commit.status ?? 1;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* already gone */ }
  }
  process.exit(exitCode);
}

main();