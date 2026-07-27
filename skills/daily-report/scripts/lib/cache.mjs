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

// Legacy single-SHA access is retained for existing callers. New report runs use
// the date-scoped ID frontier below, which is necessary for exact --all increments.
export function readCommit(repoPath, opts = {}) {
  const value = loadJson(cacheFile(COMMIT_CACHE_FILENAME, opts))[normalizeKey(repoPath)];
  return typeof value === "string" ? value : "";
}

export function writeCommit(repoPath, commitId, opts = {}) {
  const file = cacheFile(COMMIT_CACHE_FILENAME, opts);
  const cache = loadJson(file);
  cache[normalizeKey(repoPath)] = commitId;
  saveJson(file, cache);
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readReportedCommitIds(repoPath, opts = {}) {
  const value = loadJson(cacheFile(COMMIT_CACHE_FILENAME, opts))[normalizeKey(repoPath)];
  const date = opts.date ?? localDate();
  if (value && typeof value === "object" && value.date === date && Array.isArray(value.commitIds)) {
    return value.commitIds.filter((id) => typeof id === "string");
  }
  // A legacy SHA is safely recognized as reported, but cannot model an --all
  // frontier. The next successful report migrates the entry to the new schema.
  return typeof value === "string" ? [value] : [];
}

export function writeReportedCommitIds(repoPath, commitIds, opts = {}) {
  if (!Array.isArray(commitIds) || commitIds.some((id) => typeof id !== "string" || !id)) {
    throw new TypeError("commitIds must be an array of non-empty strings");
  }
  const file = cacheFile(COMMIT_CACHE_FILENAME, opts);
  const cache = loadJson(file);
  const key = normalizeKey(repoPath);
  const date = opts.date ?? localDate();
  const previous = cache[key];
  const priorIds = previous && typeof previous === "object" && previous.date === date && Array.isArray(previous.commitIds)
    ? previous.commitIds.filter((id) => typeof id === "string")
    : [];
  cache[key] = { date, commitIds: [...new Set([...priorIds, ...commitIds])] };
  saveJson(file, cache);
}

function findAnchor(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
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
