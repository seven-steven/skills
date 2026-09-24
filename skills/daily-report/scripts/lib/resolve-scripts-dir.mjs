import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ANCHOR_FILENAME = "cache.mjs";
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude"]);

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