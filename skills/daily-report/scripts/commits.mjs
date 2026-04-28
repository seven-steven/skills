#!/usr/bin/env node
import { readCommit } from "./lib/cache.mjs";
import { spawnSync } from "node:child_process";

const [,, repoRoot, userEmail] = process.argv;

if (!repoRoot || !userEmail) {
  process.stderr.write("Usage: commits.mjs <repo_root> <user_email>\n");
  process.exit(1);
}

const cachedSha = readCommit(repoRoot);

const gitArgs = ["-C", repoRoot, "log", `--author=${userEmail}`, "--pretty=format:%h %s", "--all"];
if (cachedSha) {
  gitArgs.push(`${cachedSha}..HEAD`);
} else {
  gitArgs.push("--since=midnight");
}

const r = spawnSync("git", gitArgs, { encoding: "utf8" });
if (r.error) {
  process.stderr.write(`git error: ${r.error.message}\n`);
  process.exit(1);
}
if (r.status !== 0) {
  process.stderr.write(r.stderr || "git log failed\n");
  process.exit(r.status ?? 1);
}

process.stdout.write(r.stdout);
