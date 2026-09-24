/**
 * prompt-resolver.mjs
 *
 * Resolves the task prompt from one of three sources:
 *   --prompt-file <path>   (file content, verbatim)
 *   --prompt-stdin           (process stdin)
 *   (none)                  (empty string — valid only with --continue/--session)
 *
 * Exports:
 *   resolvePrompt(options) → string
 */

import fs from "node:fs";
import path from "node:path";

import { UsageError } from "./errors.mjs";
import { safeDeleteTempFile } from "./request-file.mjs";

export function resolvePrompt(options, deps = {}) {
  const readStdin = deps.readStdin ?? (() => fs.readFileSync(0, "utf8"));
  const deleteFile = deps.deleteFile ?? safeDeleteTempFile;
  const fromFile = options["prompt-file"] !== undefined;
  const fromStdin = Boolean(options["prompt-stdin"]);
  if (fromFile && fromStdin) {
    throw new UsageError("Use either --prompt-file or --prompt-stdin, not both.");
  }

  let prompt = "";
  if (fromFile) {
    const filePath = path.resolve(options["prompt-file"]);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      throw new UsageError(`Cannot read prompt file ${filePath}: ${err.message}`);
    }
    // Preserve the file content verbatim — no trailing-newline trimming;
    // task fidelity beats cosmetic tidiness.
    prompt = content;
    // Cleanup is guarded (temp dir + naming convention only) so a hostile or
    // mistaken path can never delete a real user file.
    deleteFile(filePath);
  } else if (fromStdin) {
    prompt = readStdin();
  }

  const canRunWithoutPrompt = Boolean(options.continue || options.session);
  if (!prompt.trim() && !canRunWithoutPrompt) {
    throw new UsageError(
      "Empty task. Pass the task text via --prompt-stdin/--prompt-file, " +
        "or use --continue/--session to resume without a new prompt."
    );
  }
  return prompt;
}