import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const COMPANION_SCRIPT = path.resolve(TESTS_DIR, "..", "scripts", "codefree-companion.mjs");
export const FAKE_FIXTURE_SCRIPT = path.join(TESTS_DIR, "fake-codefree-fixture.mjs");

export function makeTempDir(prefix = "codefree-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

/**
 * Create a fake `codefree-o` executable in `binDir`. Behaviour comes from
 * the CODEFREE_FAKE_SCENARIO file the test points CODEFREE_FAKE_SCENARIO at;
 * every invocation records its argv/cwd to CODEFREE_FAKE_RECORD.
 */
export function writeFakeBin(binDir, { name = "codefree-o" } = {}) {
  const fixtureUrl = pathToFileURL(FAKE_FIXTURE_SCRIPT).href;
  const body = [
    "#!/usr/bin/env node",
    `import { runFakeBin } from ${JSON.stringify(fixtureUrl)};`,
    "runFakeBin();",
    ""
  ].join("\n");
  return writeExecutable(path.join(binDir, name), body);
}

export function makeSandbox({ binName } = {}) {
  const tempDir = makeTempDir();
  const cwd = path.join(tempDir, "workspace");
  fs.mkdirSync(cwd, { recursive: true });
  const fakeBinDir = path.join(tempDir, "bin");
  fs.mkdirSync(fakeBinDir, { recursive: true });
  if (binName !== null) {
    writeFakeBin(fakeBinDir, { name: binName });
  }
  const recordFile = path.join(tempDir, "fake-record.json");
  const env = {
    ...process.env,
    CODEFREE_BIN: "codefree-o",
    // Existing companion tests pin the run transport's argv/event contract;
    // serve-transport tests override this explicitly per test.
    CODEFREE_TRANSPORT: "run",
    CODEFREE_FAKE_RECORD: recordFile,
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    ...(process.platform === "win32" && !process.env.PATHEXT
      ? { PATHEXT: ".COM;.EXE;.BAT;.CMD" }
      : {})
  };
  return { tempDir, cwd, fakeBinDir, env, recordFile };
}

export function cleanupSandbox(sandbox) {
  if (sandbox?.tempDir && fs.existsSync(sandbox.tempDir)) {
    fs.rmSync(sandbox.tempDir, { recursive: true, force: true });
  }
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? 60_000,
    windowsHide: true
  });
}

export function runNode(args, options = {}) {
  return run(process.execPath, args, options);
}

export function runCompanion(args, options = {}) {
  return runNode([COMPANION_SCRIPT, ...args], options);
}

export async function waitFor(predicate, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
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

/**
 * POSIX-only: assert that a process id is no longer alive. Treats zombies
 * as dead: a killed child that has not been reaped yet (PID 1 in minimal
 * containers can lag) must not fail the assertion.
 */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // ESRCH — gone
  }
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
      if (state === "Z") return false;
    } catch {
      return false; // /proc entry vanished — gone
    }
  }
  return true;
}
