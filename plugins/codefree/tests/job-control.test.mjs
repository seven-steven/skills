import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  enrichJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "../scripts/lib/job-control.mjs";
import { upsertJob } from "../scripts/lib/state.mjs";
import { withSandbox, cleanupSandbox } from "./helpers.mjs";

const PREVIOUS_ENV = {};

function setEnv(name, value) {
  if (!(name in PREVIOUS_ENV)) {
    PREVIOUS_ENV[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function restoreEnv() {
  for (const [name, value] of Object.entries(PREVIOUS_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
    delete PREVIOUS_ENV[name];
  }
}

test("sortJobsNewestFirst - sorts by updatedAt descending", () => {
  const jobs = [
    { id: "a", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "b", updatedAt: "2026-01-03T00:00:00Z" },
    { id: "c", updatedAt: "2026-01-02T00:00:00Z" }
  ];
  const result = sortJobsNewestFirst(jobs);
  assert.deepEqual(
    result.map((job) => job.id),
    ["b", "c", "a"]
  );
});

test("enrichJob - adds kindLabel and phase fallback", () => {
  const job = {
    id: "task-x",
    status: "running",
    createdAt: "2026-01-01T00:00:00Z"
  };
  const enriched = enrichJob(job);
  assert.equal(enriched.kindLabel, "task");
  assert.equal(enriched.phase, "running");
});

test("enrichJob - completed job has duration not elapsed running", () => {
  const job = {
    id: "task-x",
    status: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:30Z"
  };
  const enriched = enrichJob(job);
  assert.equal(enriched.duration, "30s");
});

test("buildStatusSnapshot - groups by status", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, {
      id: "task-r",
      status: "running",
      title: "running one",
      createdAt: "2026-01-01T00:00:00Z"
    });
    upsertJob(sandbox.cwd, {
      id: "task-c",
      status: "completed",
      title: "completed one",
      createdAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:01:00Z"
    });
    upsertJob(sandbox.cwd, {
      id: "task-f",
      status: "failed",
      title: "failed one",
      createdAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:30Z"
    });

    const snapshot = buildStatusSnapshot(sandbox.cwd);
    assert.equal(snapshot.running.length, 1);
    assert.equal(snapshot.running[0].id, "task-r");
    assert.ok(snapshot.latestFinished);
    assert.equal(typeof snapshot.recent.length, "number");
    const idsInRecent = snapshot.recent.map((j) => j.id);
    assert.equal(idsInRecent.includes(snapshot.latestFinished.id), false);
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("buildStatusSnapshot - filters by session unless --all", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", "session-A");
  try {
    upsertJob(sandbox.cwd, { id: "task-mine", status: "completed", sessionId: "session-A" });
    upsertJob(sandbox.cwd, { id: "task-other", status: "completed", sessionId: "session-B" });

    const scoped = buildStatusSnapshot(sandbox.cwd);
    const recentIds = [scoped.latestFinished?.id, ...scoped.recent.map((j) => j.id)].filter(Boolean);
    assert.ok(recentIds.includes("task-mine"));
    assert.equal(recentIds.includes("task-other"), false);

    const all = buildStatusSnapshot(sandbox.cwd, { all: true });
    const allIds = [all.latestFinished?.id, ...all.recent.map((j) => j.id)].filter(Boolean);
    assert.ok(allIds.includes("task-mine"));
    assert.ok(allIds.includes("task-other"));
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("buildSingleJobSnapshot - resolves by exact id", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, { id: "task-abc123", status: "completed" });
    const { job } = buildSingleJobSnapshot(sandbox.cwd, "task-abc123");
    assert.equal(job.id, "task-abc123");
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("buildSingleJobSnapshot - resolves by unique prefix", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, { id: "task-aaa", status: "completed" });
    upsertJob(sandbox.cwd, { id: "task-bbb", status: "completed" });
    const { job } = buildSingleJobSnapshot(sandbox.cwd, "task-a");
    assert.equal(job.id, "task-aaa");
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("buildSingleJobSnapshot - ambiguous prefix throws", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, { id: "task-aaa", status: "completed" });
    upsertJob(sandbox.cwd, { id: "task-aab", status: "completed" });
    assert.throws(
      () => buildSingleJobSnapshot(sandbox.cwd, "task-aa"),
      /ambiguous/
    );
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("resolveResultJob - returns finished job and skips active", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, { id: "task-r", status: "running" });
    upsertJob(sandbox.cwd, { id: "task-c", status: "completed" });
    const { job } = resolveResultJob(sandbox.cwd, null);
    assert.equal(job.id, "task-c");
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("resolveResultJob - explicit reference to active job throws", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    upsertJob(sandbox.cwd, { id: "task-r", status: "running" });
    assert.throws(
      () => resolveResultJob(sandbox.cwd, "task-r"),
      /still running/
    );
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("resolveResultJob - throws when nothing is finished", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", undefined);
  try {
    assert.throws(
      () => resolveResultJob(sandbox.cwd, null),
      /No finished codefree jobs/
    );
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("resolveCancelableJob - returns sole active job when no reference", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", "session-A");
  try {
    upsertJob(sandbox.cwd, { id: "task-r", status: "running", sessionId: "session-A" });
    const { job } = resolveCancelableJob(sandbox.cwd, null);
    assert.equal(job.id, "task-r");
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});

test("resolveCancelableJob - throws on multiple active without reference", () => {
  const sandbox = withSandbox();
  setEnv("CLAUDE_PLUGIN_DATA", sandbox.pluginData);
  setEnv("CODEFREE_COMPANION_SESSION_ID", "session-A");
  try {
    upsertJob(sandbox.cwd, { id: "task-1", status: "running", sessionId: "session-A" });
    upsertJob(sandbox.cwd, { id: "task-2", status: "queued", sessionId: "session-A" });
    assert.throws(
      () => resolveCancelableJob(sandbox.cwd, null),
      /Multiple codefree jobs/
    );
  } finally {
    restoreEnv();
    cleanupSandbox(sandbox);
  }
});
