/**
 * run-events.mjs
 *
 * Parser and outcome aggregator for `codefree-o run --format json` output.
 *
 * Schema anchor: codefree-o v1.3.1 PoC (2026-06-25, SAFE research doc
 * `technical-implementation-guidance-research-2026-06-25.md`, appendix B).
 * Each NDJSON line is a JSON object with top-level
 * `{ type, timestamp, sessionID, part }`. Known event types:
 *
 *   - text:        part.text holds an assistant text chunk
 *   - tool_use:    part.tool / part.callID / part.state.{status,title,output,...}
 *   - step_start / step_finish: step lifecycle (step_finish carries cost/tokens)
 *   - error:       run-level or part-level error
 *
 * The current local binary reports v1.7.0; future versions may add event
 * types. Unknown types are therefore NEVER rejected: they are kept verbatim
 * in the audit payload. However, unknown events cannot mark a run complete
 * on their own — completion requires at least one `text` or `tool_use`
 * event, a clean exit code, and no error event.
 */

/**
 * Parse a single NDJSON line.
 * Returns `{ ok: true, event }` for a JSON object line, or
 * `{ ok: false, raw, blank? }` for blank / malformed lines.
 */
export function parseEventLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    // Blank lines carry no information; treat as skippable, not malformed.
    return { ok: false, raw: null, blank: true };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, raw: line };
    }
    return { ok: true, event: parsed };
  } catch {
    return { ok: false, raw: line };
  }
}

function isErrorEvent(event) {
  if (event?.type === "error") return true;
  if (event?.part?.type === "error") return true;
  if (event?.part?.state?.status === "error") return true;
  return false;
}

/**
 * Aggregate parsed events into a run outcome.
 *
 * Completion semantics (intentional, documented in the plugin README):
 *   - any error event            -> failed ("error-event"), even when exit code is 0
 *   - exit code !== 0            -> failed ("non-zero-exit")
 *   - timedOut                   -> failed ("timeout")
 *   - any malformed stdout line  -> failed ("malformed-output"), fail-closed
 *   - >=1 text or tool_use event -> completed (empty text with tool_use is valid)
 *   - otherwise                  -> failed ("no-result")
 *
 * Fail-closed on malformed output per the approved migration plan: a
 * non-JSON stdout line means the event stream cannot be trusted to be
 * complete, so the run is marked failed even when a plausible result is
 * present. Partial text is still surfaced for debugging. Note that a
 * future codefree-o version printing benign non-JSON notices to stdout
 * would therefore fail runs — that tradeoff was chosen deliberately over
 * silently accepting an incomplete stream.
 */
export function aggregateRunEvents(events, { exitCode = 0, timedOut = false, malformedLines = [] } = {}) {
  const textParts = [];
  const toolUses = [];
  const errorEvents = [];
  let sessionID = null;

  for (const event of events) {
    if (typeof event.sessionID === "string" && event.sessionID && sessionID === null) {
      sessionID = event.sessionID;
    }
    if (isErrorEvent(event)) {
      errorEvents.push(event);
      continue;
    }
    if (event?.type === "text" && typeof event.part?.text === "string") {
      textParts.push(event.part.text);
      continue;
    }
    if (event?.type === "tool_use") {
      toolUses.push({
        tool: typeof event.part?.tool === "string" ? event.part.tool : null,
        callID: event.part?.callID ?? null,
        status: event.part?.state?.status ?? null,
        title: typeof event.part?.state?.title === "string" ? event.part.state.title : null
      });
    }
  }

  let status = "completed";
  let reason = null;
  if (errorEvents.length > 0) {
    status = "failed";
    reason = "error-event";
  } else if (timedOut) {
    status = "failed";
    reason = "timeout";
  } else if (exitCode !== 0) {
    status = "failed";
    reason = "non-zero-exit";
  } else if (malformedLines.length > 0) {
    status = "failed";
    reason = "malformed-output";
  } else if (!textParts.some((t) => t.length > 0) && toolUses.length === 0) {
    status = "failed";
    reason = "no-result";
  }

  return {
    status,
    reason,
    sessionID,
    // textParts is the authoritative record: one entry per text event, in
    // original order. The convenience `text` concatenation deliberately adds
    // NO separator characters (never invent content); renderers that need
    // visual separation should use textParts instead.
    textParts,
    text: textParts.join(""),
    toolUses,
    errorEvents,
    hasValidResult: textParts.length > 0 || toolUses.length > 0
  };
}

/**
 * Build the full audit payload for one companion run.
 *
 * `events` holds every parsed event in original order (verbatim, for audit);
 * `malformedLines` holds raw non-JSON stdout lines; `stderr` is the captured
 * stderr text. Callers decide how much of this to echo — the default
 * human-readable rendering shows only the result text plus metadata, never
 * the full tool/token stream.
 */
export function buildRunPayload({
  events,
  malformedLines = [],
  stderr = "",
  exitCode = 0,
  signal = null,
  timedOut = false,
  durationMs = 0,
  command = []
}) {
  const outcome = aggregateRunEvents(events, { exitCode, timedOut, malformedLines });
  return {
    ...outcome,
    degraded: malformedLines.length > 0,
    malformedLines,
    stderr,
    exitCode,
    signal,
    timedOut,
    durationMs,
    command,
    eventCount: events.length,
    events
  };
}
