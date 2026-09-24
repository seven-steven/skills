import test from "node:test";
import assert from "node:assert/strict";

import { aggregateRunEvents, buildRunPayload, failedPayload, parseEventLine } from "../scripts/lib/run-events.mjs";

const textEvent = (text, sessionID = "ses-1") => ({
  type: "text",
  timestamp: Date.now(),
  sessionID,
  part: { type: "text", text }
});

const toolUseEvent = (tool = "write", status = "completed") => ({
  type: "tool_use",
  timestamp: Date.now(),
  sessionID: "ses-1",
  part: {
    type: "tool",
    tool,
    callID: "call-1",
    state: { status, title: `did ${tool}` }
  }
});

// ---------------------------------------------------------------------------
// parseEventLine
// ---------------------------------------------------------------------------

test("parseEventLine - parses a valid event object", () => {
  const line = JSON.stringify(textEvent("hello"));
  const parsed = parseEventLine(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.event.part.text, "hello");
});

test("parseEventLine - blank line is skippable, not malformed", () => {
  const parsed = parseEventLine("   ");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.raw, null);
  assert.equal(parsed.blank, true);
});

test("parseEventLine - garbage text is malformed and preserved raw", () => {
  const parsed = parseEventLine("oh no, not json");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.raw, "oh no, not json");
});

test("parseEventLine - JSON array or scalar is malformed (must be an object)", () => {
  assert.equal(parseEventLine("[1,2]").ok, false);
  assert.equal(parseEventLine("42").ok, false);
  assert.equal(parseEventLine("null").ok, false);
});

// ---------------------------------------------------------------------------
// aggregateRunEvents — completion semantics
// ---------------------------------------------------------------------------

test("aggregateRunEvents - text + clean exit completes", () => {
  const outcome = aggregateRunEvents([textEvent("done")], { exitCode: 0 });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.text, "done");
  assert.equal(outcome.sessionID, "ses-1");
});

test("aggregateRunEvents - empty text with tool_use is a valid completion", () => {
  const outcome = aggregateRunEvents([toolUseEvent("write", "completed")], { exitCode: 0 });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.text, "");
  assert.equal(outcome.hasValidResult, true);
  assert.equal(outcome.toolUses[0].tool, "write");
});

test("aggregateRunEvents - error event fails the run even when exit code is 0", () => {
  const errorEvent = { type: "error", sessionID: "ses-1", part: { type: "error", message: "boom" } };
  const outcome = aggregateRunEvents([textEvent("partial"), errorEvent], { exitCode: 0 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "error-event");
  assert.equal(outcome.errorEvents.length, 1);
});

test("aggregateRunEvents - part-level error state is also an error", () => {
  const event = { type: "tool_use", part: { type: "tool", state: { status: "error" } } };
  const outcome = aggregateRunEvents([event], { exitCode: 0 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "error-event");
});

test("aggregateRunEvents - non-zero exit fails", () => {
  const outcome = aggregateRunEvents([textEvent("hi")], { exitCode: 3 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "non-zero-exit");
});

test("aggregateRunEvents - timeout fails", () => {
  const outcome = aggregateRunEvents([textEvent("hi")], { exitCode: 0, timedOut: true });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "timeout");
});

test("aggregateRunEvents - malformed output fails closed even with valid text", () => {
  const outcome = aggregateRunEvents([textEvent("looks fine")], {
    exitCode: 0,
    malformedLines: ["Oops: update available"]
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "malformed-output");
});

test("aggregateRunEvents - exit 0 with no text and no tool_use is no-result", () => {
  const stepStart = { type: "step_start", sessionID: "ses-1", part: { type: "step-start" } };
  const outcome = aggregateRunEvents([stepStart], { exitCode: 0 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "no-result");
});

test("aggregateRunEvents - error-event takes precedence over non-zero exit", () => {
  const errorEvent = { type: "error", part: null };
  const outcome = aggregateRunEvents([errorEvent], { exitCode: 3 });
  assert.equal(outcome.reason, "error-event");
});

// ---------------------------------------------------------------------------
// aggregateRunEvents — fidelity
// ---------------------------------------------------------------------------

test("aggregateRunEvents - preserves boundaries between distinct text parts without inventing characters", () => {
  const outcome = aggregateRunEvents([textEvent("para one"), textEvent("para two")], { exitCode: 0 });
  assert.deepEqual(outcome.textParts, ["para one", "para two"]);
  assert.equal(outcome.text, "para onepara two");
});

test("aggregateRunEvents - first sessionID wins and unknown events are ignored safely", () => {
  const unknown = { type: "brand-new-future-event", sessionID: null, payload: { huge: true } };
  const outcome = aggregateRunEvents([unknown, textEvent("x", "ses-real")], { exitCode: 0 });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.sessionID, "ses-real");
});

// ---------------------------------------------------------------------------
// buildRunPayload
// ---------------------------------------------------------------------------

test("buildRunPayload - keeps the full audit trail", () => {
  const events = [textEvent("ok"), { type: "step_finish", part: { tokens: {} } }];
  const payload = buildRunPayload({
    events,
    malformedLines: [],
    stderr: "noise",
    exitCode: 0,
    timedOut: false,
    durationMs: 1234,
    command: ["codefree-o", "run"]
  });
  assert.equal(payload.status, "completed");
  assert.equal(payload.degraded, false);
  assert.equal(payload.stderr, "noise");
  assert.equal(payload.eventCount, 2);
  assert.deepEqual(payload.events, events);
  assert.deepEqual(payload.command, ["codefree-o", "run"]);
});

test("buildRunPayload - degraded flag reflects malformed lines", () => {
  const payload = buildRunPayload({ events: [], malformedLines: ["junk"], exitCode: 0 });
  assert.equal(payload.degraded, true);
  assert.equal(payload.status, "failed");
});

// ---------------------------------------------------------------------------
// failedPayload
// ---------------------------------------------------------------------------

test("failedPayload - returns the canonical 16-field shape with defaults", () => {
  const payload = failedPayload("test-reason");
  assert.equal(payload.status, "failed");
  assert.equal(payload.reason, "test-reason");
  assert.equal(payload.stderr, "");
  assert.equal(payload.text, "");
  assert.equal(payload.sessionID, null);
  assert.deepEqual(payload.toolUses, []);
  assert.deepEqual(payload.errorEvents, []);
  assert.deepEqual(payload.events, []);
  assert.deepEqual(payload.malformedLines, []);
  assert.equal(payload.degraded, false);
  assert.equal(payload.exitCode, 1);
  assert.equal(payload.signal, null);
  assert.equal(payload.timedOut, false);
  assert.equal(payload.durationMs, 0);
  assert.equal(payload.eventCount, 0);
});

test("failedPayload - overrides merge caller-provided fields", () => {
  const events = [{ type: "text" }];
  const payload = failedPayload("boom", {
    stderr: "something broke",
    exitCode: 127,
    durationMs: 42,
    events,
    eventCount: events.length
  });
  assert.equal(payload.reason, "boom");
  assert.equal(payload.stderr, "something broke");
  assert.equal(payload.exitCode, 127);
  assert.equal(payload.durationMs, 42);
  assert.equal(payload.eventCount, 1);
  assert.deepEqual(payload.events, events);
  // defaults are still there for non-overridden fields
  assert.equal(payload.text, "");
  assert.equal(payload.signal, null);
});

test("failedPayload - does not expose a rendered field (renderer is sole owner)", () => {
  const payload = failedPayload("test", { stderr: "log" });
  assert.equal(payload.rendered, undefined);
});
