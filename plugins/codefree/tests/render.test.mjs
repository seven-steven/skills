import test from "node:test";
import assert from "node:assert/strict";

import {
  renderCancelReport,
  renderJobStatusReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "../scripts/lib/render.mjs";

test("renderTaskResult - returns rawOutput with trailing newline", () => {
  const text = renderTaskResult({ rawOutput: "line one\nline two" });
  assert.equal(text, "line one\nline two\n");
});

test("renderTaskResult - falls back to failureMessage when rawOutput empty", () => {
  const text = renderTaskResult({ rawOutput: "", failureMessage: "boom" });
  assert.equal(text, "boom\n");
});

test("renderTaskResult - default failure message", () => {
  const text = renderTaskResult({});
  assert.equal(text, "codefree did not return a final message.\n");
});

test("renderStatusReport - empty state shows placeholder", () => {
  const text = renderStatusReport({ running: [], latestFinished: null, recent: [] });
  assert.match(text, /^# codefree Status/);
  assert.match(text, /No jobs recorded yet\./);
});

test("renderStatusReport - active job table includes columns", () => {
  const text = renderStatusReport({
    running: [
      {
        id: "task-abc",
        status: "running",
        phase: "running",
        elapsed: "5s",
        summary: "do thing"
      }
    ],
    latestFinished: null,
    recent: []
  });
  assert.match(text, /Active jobs:/);
  assert.match(text, /\| Job \| Status \| Phase \| Elapsed \| Summary \| Actions \|/);
  assert.match(text, /task-abc/);
  assert.match(text, /\/codefree:cancel task-abc/);
});

test("renderStatusReport - latest finished section includes result hint", () => {
  const text = renderStatusReport({
    running: [],
    latestFinished: {
      id: "task-done",
      status: "completed",
      duration: "12s",
      summary: "did the thing"
    },
    recent: []
  });
  assert.match(text, /Latest finished:/);
  assert.match(text, /task-done/);
  assert.match(text, /Result:/);
});

test("renderJobStatusReport - shows cancel hint for running job", () => {
  const text = renderJobStatusReport({
    id: "task-r",
    status: "running",
    phase: "running",
    elapsed: "1s"
  });
  assert.match(text, /Cancel:/);
});

test("renderStoredJobResult - prefers rawOutput over rendered", () => {
  const text = renderStoredJobResult(
    { id: "task-x", status: "completed" },
    { result: { rawOutput: "the raw thing\n" }, rendered: "fallback" }
  );
  assert.equal(text, "the raw thing\n");
});

test("renderStoredJobResult - falls back to rendered when rawOutput missing", () => {
  const text = renderStoredJobResult(
    { id: "task-x", status: "completed" },
    { result: {}, rendered: "rendered output" }
  );
  assert.equal(text, "rendered output\n");
});

test("renderStoredJobResult - synthesizes minimal block when no payload", () => {
  const text = renderStoredJobResult(
    { id: "task-x", status: "failed", title: "do thing", errorMessage: "exploded" },
    null
  );
  assert.match(text, /# do thing/);
  assert.match(text, /Status: failed/);
  assert.match(text, /exploded/);
});

test("renderCancelReport - includes job id and follow-up hint", () => {
  const text = renderCancelReport({ id: "task-c", title: "stop me", summary: "noop" });
  assert.match(text, /^# codefree Cancel/);
  assert.match(text, /Cancelled task-c/);
  assert.match(text, /\/codefree:status/);
});
