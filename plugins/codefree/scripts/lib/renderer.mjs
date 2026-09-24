/**
 * renderer.mjs
 *
 * Render the run result for human or JSON output.
 *
 * Exports:
 *   renderRunResult(payload) → string
 *   emitResult(payload, exitCode, asJson) → void (writes stdout/stderr)
 */

import process from "node:process";

export function renderRunResult(payload) {
  if (payload.status === "completed") {
    const lines = [];
    if (payload.textParts.length > 0) {
      // Display-only separation between original text parts; the parts
      // themselves are never re-joined with invented characters.
      lines.push(payload.textParts.join("\n\n"));
    }
    const meta = [];
    if (payload.sessionID) meta.push(`session=${payload.sessionID}`);
    meta.push(`tool_calls=${payload.toolUses.length}`);
    meta.push(`duration=${(payload.durationMs / 1000).toFixed(1)}s`);
    lines.push(`[codefree-o] ${meta.join(" ")}`);
    for (const use of payload.toolUses) {
      lines.push(`  - ${use.tool ?? "unknown tool"}${use.title ? `: ${use.title}` : ""}`);
    }
    return lines.join("\n");
  }

  const lines = [`[codefree-o] FAILED: ${payload.reason ?? "unknown"} (exit ${payload.exitCode})`];
  if (payload.sessionID) lines.push(`session=${payload.sessionID}`);
  if (payload.text) {
    lines.push("--- partial output (run did not complete cleanly) ---", payload.text);
  }
  if (payload.errorEvents.length > 0) {
    lines.push("--- error events ---", ...payload.errorEvents.map((e) => JSON.stringify(e)));
  }
  if (payload.stderr.trim()) {
    lines.push("--- stderr ---", payload.stderr.trimEnd());
  }
  if (payload.degraded) {
    lines.push("--- non-JSON stdout lines ---", ...payload.malformedLines);
  }
  return lines.join("\n");
}

export function emitResult(payload, exitCode, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${payload.rendered ?? renderRunResult(payload)}\n`);
  }
  if (payload.status !== "completed") {
    process.exitCode = exitCode !== 0 ? exitCode : 1;
  }
}