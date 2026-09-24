#!/usr/bin/env node
import {
  readProject,
  writeProject,
  readReportedCommitIds,
  writeReportedCommitIds,
} from "./lib/cache.mjs";
import { resolveScriptsDir } from "./lib/resolve-scripts-dir.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];

if (!action) {
  process.stderr.write("Usage: cache.mjs <action> [args...]\n");
  process.exit(1);
}

// resolve: no repo-path needed
if (action === "resolve") {
  const dir = resolveScriptsDir({
    searchRoots: [
      path.join(os.homedir(), ".claude", "plugins", "cache"),
      process.cwd(),
    ],
  });
  process.stdout.write((dir || path.dirname(fileURLToPath(import.meta.url))) + "\n");
  process.exit(0);
}

// remaining actions require repo-path
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
  case "read-reported": {
    const ids = readReportedCommitIds(repoPath);
    process.stdout.write(JSON.stringify(ids) + "\n");
    break;
  }
  case "write-reported": {
    const json = process.argv[4];
    if (!json) { process.stderr.write("Missing argument: commit_ids_json\n"); process.exit(1); }
    let ids;
    try { ids = JSON.parse(json); } catch (err) {
      process.stderr.write(`Invalid reported commit IDs: ${err.message}\n`);
      process.exit(1);
    }
    try {
      writeReportedCommitIds(repoPath, ids);
    } catch (err) {
      process.stderr.write(`Failed to persist reported commit IDs: ${err.message}\n`);
      process.exit(1);
    }
    process.stdout.write("已缓存已汇报 commit IDs\n");
    break;
  }
  default:
    process.stderr.write(`Unknown action: ${action}\n`);
    process.exit(1);
}
