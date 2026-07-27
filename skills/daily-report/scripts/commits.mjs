#!/usr/bin/env node
import { readReportedCommitIds } from "./lib/cache.mjs";
import { spawnSync } from "node:child_process";

const [,, repoRoot, userEmail] = process.argv;

if (!repoRoot || !userEmail) {
  process.stderr.write("Usage: commits.mjs <repo_root> <user_email>\n");
  process.exit(1);
}

const reportedIds = new Set(readReportedCommitIds(repoRoot));
const gitArgs = [
  "-C", repoRoot, "log", `--author=${userEmail}`, "--since=midnight",
  "--all", "--pretty=format:%H%x09%s",
];
const r = spawnSync("git", gitArgs, { encoding: "utf8" });
if (r.error) {
  process.stderr.write(`git error: ${r.error.message}\n`);
  process.exit(1);
}
if (r.status !== 0) {
  process.stderr.write(r.stderr || "git log failed\n");
  process.exit(r.status ?? 1);
}

const commits = r.stdout.split("\n")
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t");
    return { id: line.slice(0, tab), subject: line.slice(tab + 1) };
  })
  .filter((commit) => commit.id && !reportedIds.has(commit.id));

process.stdout.write(commits.map(({ id, subject }) => `${id}\t${subject}`).join("\n"));
