import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32",
    windowsHide: true
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

// ---------------------------------------------------------------------------
// Binary resolution helpers (Windows-aware)
// ---------------------------------------------------------------------------

const WIN32_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Returns an ordered list of { dir, filename } candidates to probe for a binary.
 *
 * On win32: expands bare `name` across PATH × PATHEXT (+ .PS1). When `name`
 * already contains a path separator it is treated as a pre-resolved path and
 * a single candidate is returned. When `name` has a known extension but no
 * separator, it is looked up in each PATH dir without further expansion.
 *
 * On POSIX: returns one candidate per PATH dir with the bare filename.
 *
 * All args are injectable so callers can unit-test cross-platform behaviour.
 */
export function getBinaryCandidates(name, { platform = process.platform, env = process.env } = {}) {
  const hasPathSep = name.includes("/") || name.includes("\\");

  if (platform === "win32") {
    const pathDirs = (env.PATH || "").split(";").filter(Boolean);
    const pathextList = (env.PATHEXT || WIN32_DEFAULT_PATHEXT).split(";").filter(Boolean);

    if (hasPathSep) {
      return [{ dir: path.dirname(name), filename: path.basename(name) }];
    }

    const hasKnownExt = pathextList.some((ext) => name.toUpperCase().endsWith(ext.toUpperCase()));

    if (hasKnownExt) {
      return pathDirs.map((dir) => ({ dir, filename: name }));
    }

    const exts = [...pathextList];
    if (!exts.some((e) => e.toUpperCase() === ".PS1")) {
      exts.push(".PS1");
    }
    return pathDirs.flatMap((dir) => exts.map((ext) => ({ dir, filename: name + ext })));
  }

  // POSIX: bare name in each PATH dir, no extension guessing
  const pathDirs = (env.PATH || "").split(":").filter(Boolean);
  return pathDirs.map((dir) => ({ dir, filename: name }));
}

/**
 * Resolves a binary name or path to an absolute path that actually exists on
 * disk. Returns `null` when nothing is found. Never throws.
 */
export function resolveBinaryPath(name, { platform = process.platform, env = process.env, fs: fsImpl = fs } = {}) {
  const candidates = getBinaryCandidates(name, { platform, env });
  for (const { dir, filename } of candidates) {
    try {
      const fullPath = path.join(dir, filename);
      if (fsImpl.existsSync(fullPath)) {
        return fullPath;
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

/**
 * Returns true when the resolved binary must be invoked through a shell.
 *
 * Node ≥ 20.12.2 (post-CVE-2024-27980) requires `shell: true` to spawn
 * .cmd/.bat files on Windows; spawning them directly throws EINVAL.
 */
export function needsShellForBinary(resolvedPath, platform = process.platform) {
  if (platform !== "win32") return false;
  const ext = path.extname(resolvedPath).toUpperCase();
  return ext === ".CMD" || ext === ".BAT";
}

function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env
    });

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }

    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    if (result.error) {
      throw result.error;
    }

    throw new Error(formatCommandFailure(result));
  }

  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }

    return { attempted: true, delivered: false, method: "process-group" };
  }
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
