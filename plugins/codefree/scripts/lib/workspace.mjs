import { spawnSync } from "node:child_process";

export function resolveWorkspaceRoot(cwd) {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // fall through
  }
  return cwd;
}
