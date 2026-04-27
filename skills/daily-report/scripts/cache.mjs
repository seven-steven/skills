#!/usr/bin/env node
import { readProject, writeProject, readCommit, writeCommit, resolveScriptsDir } from "./lib/cache.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];

if (!action) {
  process.stderr.write("Usage: cache.mjs <action> [args...]\n");
  process.exit(1);
}

if (action === "resolve") {
  const scriptsDir = resolveScriptsDir({
    searchRoots: [
      path.join(process.env.HOME || "", ".claude", "plugins", "cache"),
      process.cwd(),
    ],
  });
  // anchor search exhausted — fall back to this script's own directory
  process.stdout.write((scriptsDir || path.dirname(fileURLToPath(import.meta.url))) + "\n");
  process.exit(0);
}

const repoPath = process.argv[3];
if (!repoPath) {
  process.stderr.write("Missing argument: <repo_path>\n");
  process.exit(1);
}

switch (action) {
  case "read": {
    const name = readProject(repoPath);
    if (name) process.stdout.write(name + "\n");
    break;
  }
  case "write": {
    const name = process.argv[4];
    if (!name) { process.stderr.write("Missing argument: name\n"); process.exit(1); }
    writeProject(repoPath, name);
    process.stdout.write(`已缓存项目名称: ${repoPath} → ${name}\n`);
    break;
  }
  case "read-commit": {
    const sha = readCommit(repoPath);
    if (sha) process.stdout.write(sha + "\n");
    break;
  }
  case "write-commit": {
    const sha = process.argv[4];
    if (!sha) { process.stderr.write("Missing argument: commit_id\n"); process.exit(1); }
    writeCommit(repoPath, sha);
    process.stdout.write(`已缓存 commit id: ${sha}\n`);
    break;
  }
  default:
    process.stderr.write(`Unknown action: ${action}\n`);
    process.exit(1);
}
