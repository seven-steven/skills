import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".claude", "skills", "daily-report");
export const PROJECT_CACHE_FILENAME = "project-name-cache.json";
export const COMMIT_CACHE_FILENAME = "commit-cache.json";

const ANCHOR_FILENAME = "cache.mjs";
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude"]);

export function loadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("_")));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

export function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function normalizeKey(repoPath) {
  try {
    return fs.realpathSync(repoPath);
  } catch {
    return path.resolve(repoPath);
  }
}

function cacheFile(filename, opts = {}) {
  const dir = opts.cacheDir ?? (process.env.DAILY_REPORT_CACHE_DIR || DEFAULT_CACHE_DIR);
  return path.join(dir, filename);
}

export function readProject(repoPath, opts = {}) {
  return loadJson(cacheFile(PROJECT_CACHE_FILENAME, opts))[normalizeKey(repoPath)] ?? "";
}

export function writeProject(repoPath, name, opts = {}) {
  const file = cacheFile(PROJECT_CACHE_FILENAME, opts);
  const cache = loadJson(file);
  cache[normalizeKey(repoPath)] = name;
  saveJson(file, cache);
}

export function readCommit(repoPath, opts = {}) {
  return loadJson(cacheFile(COMMIT_CACHE_FILENAME, opts))[normalizeKey(repoPath)] ?? "";
}

export function writeCommit(repoPath, commitId, opts = {}) {
  const file = cacheFile(COMMIT_CACHE_FILENAME, opts);
  const cache = loadJson(file);
  cache[normalizeKey(repoPath)] = commitId;
  saveJson(file, cache);
}

function findAnchor(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  // Claude Code marks superseded plugin-cache versions with `.orphaned_at`.
  // Skip them so a stale duplicate doesn't shadow the active version.
  if (entries.some((e) => e.isFile() && e.name === ".orphaned_at")) return null;
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findAnchor(full);
      if (found) return found;
    } else if (entry.isFile() && entry.name === ANCHOR_FILENAME) {
      return path.dirname(full);
    }
  }
  return null;
}

export function resolveScriptsDir(opts = {}) {
  const searchRoots = opts.searchRoots ?? [
    path.join(os.homedir(), ".claude", "plugins", "cache"),
    process.cwd(),
  ];
  for (const root of searchRoots) {
    const found = findAnchor(root);
    if (found) return found;
  }
  return "";
}
