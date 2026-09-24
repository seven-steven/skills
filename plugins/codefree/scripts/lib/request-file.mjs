/**
 * request-file.mjs
 *
 * Request-file loading and guarded cleanup for the codefree companion.
 *
 * Exports:
 *   loadRequestFile(requestPath) → CLI options object with __prompt
 *   safeDeleteTempFile(filePath) → boolean
 *   VALUE_PATTERNS, REQUEST_ALLOWED_KEYS, AGENT_TEMP_FILE, AGENT_TEMP_DIR
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UsageError } from "./errors.mjs";

// Value patterns for request-file fields. These are advisory hard limits so
// that untrusted strings cannot smuggle codefree-o flags or control
// characters; the values reach codefree-o via spawn argv (no shell), so the
// risk being contained here is flag injection, not shell injection. Values
// must start and end with an alphanumeric character, so no leading "-" or
// "." trickery.
export const VALUE_PATTERNS = {
  model: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,198}[A-Za-z0-9]$/,
  agent: /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}[A-Za-z0-9]$/,
  session: /^[A-Za-z0-9][A-Za-z0-9._-]{0,198}[A-Za-z0-9]$/
};

export const REQUEST_ALLOWED_KEYS = new Set([
  "prompt",
  "promptFile",
  "cwd",
  "model",
  "agent",
  "session",
  "continue",
  "fork",
  "timeoutMs"
]);

// Cleanup guard (constrained best effort, NOT ownership proof): a request/
// prompt file is deleted only when ALL of these hold — it lives under the
// OS temp dir, its basename matches the naming convention the agent was
// told to use with a random suffix of >= 8 chars, and it is a regular file
// (symlinks are never followed or deleted). A same-machine attacker who can
// pre-place a matching file under /tmp could still get it deleted; the guard
// bounds mistakes and abuse of arbitrary paths, it does not prove creation.
export const AGENT_TEMP_FILE = /^codefree-(task|request)-[A-Za-z0-9_-]{8,}(\.txt|\.json)$/;
// Private parent directories the agent creates via fs.mkdtempSync default to
// mode 0700; an emptied one is removed so no prompt-bearing tree lingers.
export const AGENT_TEMP_DIR = /^codefree-req-/;

export function safeDeleteTempFile(filePath) {
  const resolved = path.resolve(filePath);
  const tmpDir = path.resolve(os.tmpdir());
  const insideTmp = resolved === tmpDir || resolved.startsWith(tmpDir + path.sep);
  if (!insideTmp || !AGENT_TEMP_FILE.test(path.basename(resolved))) {
    process.stderr.write(
      "[codefree-companion] note: the request/prompt file was left in place " +
        "(only agent-created codefree-*-<random> files under the OS temp dir " +
        "are auto-deleted). Delete it yourself if it holds sensitive text.\n"
    );
    return false;
  }
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return false;
    }
    fs.unlinkSync(resolved);
  } catch {
    return false;
  }
  // Best-effort removal of the private parent dir once it is empty.
  const parent = path.dirname(resolved);
  const parentInsideTmp = parent.startsWith(tmpDir + path.sep);
  if (parentInsideTmp && AGENT_TEMP_DIR.test(path.basename(parent))) {
    try {
      fs.rmdirSync(parent); // fails (ENOENT-ish ENOTEMPTY) when not empty
    } catch {
      // non-empty or vanished — fine
    }
  }
  return true;
}

/**
 * Load and validate a request JSON file: { prompt, cwd, model, agent,
 * session, continue, fork, timeoutMs }. Unknown keys are rejected; string
 * values must match strict patterns so nothing that reaches codefree-o's
 * argv can smuggle extra flags. Returns the equivalent CLI options object
 * (with `__prompt` holding the prompt text).
 */
export function loadRequestFile(requestPath) {
  const filePath = path.resolve(requestPath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new UsageError(`Cannot read request file ${filePath}: ${err.message}`);
  }

  let options = {};
  try {
    let request;
    try {
      request = JSON.parse(raw);
    } catch (err) {
      throw new UsageError(`Request file ${filePath} is not valid JSON`);
    }
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new UsageError(`Request file ${filePath} must contain a JSON object.`);
    }

    const unknown = Object.keys(request).filter((key) => !REQUEST_ALLOWED_KEYS.has(key));
    if (unknown.length > 0) {
      throw new UsageError(`Request file has unknown key(s): ${unknown.join(", ")}`);
    }

    for (const key of Object.keys(request)) {
      const value = request[key];
      switch (key) {
        case "prompt":
          if (typeof value !== "string") throw new UsageError("request.prompt must be a string");
          options.__prompt = value;
          break;
        case "promptFile": {
          if (typeof value !== "string" || !value.trim()) {
            throw new UsageError("request.promptFile must be a non-empty string");
          }
          // The prompt file must be an agent temp file inside the SAME
          // private directory as the request file itself. This keeps the
          // two-file workflow (raw text + flags-only JSON) inside the guarded
          // cleanup boundary and stops the request from pointing at arbitrary
          // or pre-existing temp files elsewhere.
          const resolvedPromptFile = path.resolve(value);
          const tmpDir = path.resolve(os.tmpdir());
          const insideTmp =
            resolvedPromptFile === tmpDir || resolvedPromptFile.startsWith(tmpDir + path.sep);
          const sameDir = path.dirname(resolvedPromptFile) === path.dirname(filePath);
          if (!insideTmp || !sameDir || !AGENT_TEMP_FILE.test(path.basename(resolvedPromptFile))) {
            throw new UsageError(
              "request.promptFile must point at an agent temp file " +
                "(codefree-task-*.txt) inside the same private temp directory " +
                "as the request file."
            );
          }
          options.__promptFile = resolvedPromptFile;
          break;
        }
        case "cwd":
          if (typeof value !== "string") throw new UsageError("request.cwd must be a string");
          options.cwd = value;
          break;
        case "model":
        case "agent":
        case "session":
          if (typeof value !== "string" || !VALUE_PATTERNS[key].test(value)) {
            throw new UsageError(`request.${key} failed its validation pattern`);
          }
          options[key] = value;
          break;
        case "continue":
        case "fork":
          if (typeof value !== "boolean") throw new UsageError(`request.${key} must be a boolean`);
          options[key] = value;
          break;
        case "timeoutMs":
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            throw new UsageError("request.timeoutMs must be a positive number");
          }
          options["timeout-ms"] = String(Math.floor(value));
          break;
        default:
          break;
      }
    }

    if (options.__prompt !== undefined && options.__promptFile !== undefined) {
      throw new UsageError('Use either "prompt" or "promptFile" in the request file, not both.');
    }

    // Two-file workflow: the prompt lives in its own raw text file so no
    // JSON escaping of task text is ever needed. Read it verbatim.
    if (options.__promptFile !== undefined) {
      // Refuse symlinks / special files before reading.
      const stat = fs.lstatSync(options.__promptFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new UsageError("request.promptFile must be a regular file");
      }
      let content;
      try {
        content = fs.readFileSync(options.__promptFile, "utf8");
      } catch (err) {
        throw new UsageError(`Cannot read request.promptFile: ${err.message}`);
      }
      options.__prompt = content;
      safeDeleteTempFile(options.__promptFile);
      delete options.__promptFile;
    }

    return options;
  } finally {
    // Guarded cleanup runs even when validation fails, so sensitive files
    // are never left behind. Only files in the OS temp dir following the
    // agent naming convention are removed; anything else is left untouched.
    if (options.__promptFile !== undefined) {
      safeDeleteTempFile(options.__promptFile);
    }
    safeDeleteTempFile(filePath);
  }
}