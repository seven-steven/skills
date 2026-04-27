import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "scripts",
  "codefree-companion.mjs"
);

export const COMPANION_SCRIPT = SCRIPT_PATH;

export function makeTempDir(prefix = "codefree-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? 30_000,
    windowsHide: true
  });
}

export function runNode(args, options = {}) {
  return run(process.execPath, args, options);
}

export function runCompanion(subcommand, args = [], options = {}) {
  return runNode([SCRIPT_PATH, subcommand, ...args], options);
}

export function initGitRepo(dir) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com"
  };
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: dir, env });
  fs.writeFileSync(path.join(dir, ".gitignore"), "", "utf8");
  spawnSync("git", ["add", ".gitignore"], { cwd: dir, env });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, env });
  return dir;
}

export function withSandbox(setup) {
  const tempDir = makeTempDir();
  const cwd = path.join(tempDir, "workspace");
  fs.mkdirSync(cwd, { recursive: true });
  initGitRepo(cwd);

  const pluginData = path.join(tempDir, "plugin-data");
  fs.mkdirSync(pluginData, { recursive: true });

  const fakeBinDir = path.join(tempDir, "bin");
  fs.mkdirSync(fakeBinDir, { recursive: true });

  const env = {
    ...process.env,
    CLAUDE_PLUGIN_DATA: pluginData,
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`
  };

  if (typeof setup === "function") {
    setup({ tempDir, cwd, pluginData, fakeBinDir, env });
  }

  return { tempDir, cwd, pluginData, fakeBinDir, env };
}

export function cleanupSandbox(sandbox) {
  if (sandbox?.tempDir && fs.existsSync(sandbox.tempDir)) {
    fs.rmSync(sandbox.tempDir, { recursive: true, force: true });
  }
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function listJobsDir(stateDir) {
  const jobsDir = path.join(stateDir, "jobs");
  if (!fs.existsSync(jobsDir)) {
    return [];
  }
  return fs.readdirSync(jobsDir);
}

export function findStateDir(pluginData, slug = "workspace-") {
  const stateRoot = path.join(pluginData, "state");
  if (!fs.existsSync(stateRoot)) {
    return null;
  }
  const entries = fs.readdirSync(stateRoot);
  const match = entries.find((entry) => entry.startsWith(slug));
  return match ? path.join(stateRoot, match) : null;
}

export async function waitFor(predicate, { timeoutMs = 10_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor: timed out");
}
