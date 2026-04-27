import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ensureStateDir,
  generateJobId,
  listJobs,
  loadState,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  upsertJob,
  writeJobFile
} from "../scripts/lib/state.mjs";
import { makeTempDir, withSandbox, cleanupSandbox } from "./helpers.mjs";

test("resolveStateDir - honors CLAUDE_PLUGIN_DATA env", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      const dir = resolveStateDir(sandbox.cwd);
      assert.ok(dir.startsWith(path.join(sandbox.pluginData, "state")), `got ${dir}`);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("resolveStateDir - same workspace yields stable hash", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      const a = resolveStateDir(sandbox.cwd);
      const b = resolveStateDir(sandbox.cwd);
      assert.equal(a, b);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("loadState - returns default when file missing", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      const state = loadState(sandbox.cwd);
      assert.equal(state.version, 1);
      assert.deepEqual(state.jobs, []);
      assert.deepEqual(state.config, {});
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("saveState + loadState roundtrip", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      saveState(sandbox.cwd, {
        config: { foo: "bar" },
        jobs: [{ id: "task-1", status: "completed", updatedAt: "2026-01-01T00:00:00Z" }]
      });
      const reloaded = loadState(sandbox.cwd);
      assert.equal(reloaded.config.foo, "bar");
      assert.equal(reloaded.jobs.length, 1);
      assert.equal(reloaded.jobs[0].id, "task-1");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("loadState - corrupt JSON returns default state", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      ensureStateDir(sandbox.cwd);
      fs.writeFileSync(resolveStateFile(sandbox.cwd), "{not-json", "utf8");
      const state = loadState(sandbox.cwd);
      assert.deepEqual(state.jobs, []);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("upsertJob - inserts new and updates existing", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      upsertJob(sandbox.cwd, { id: "task-1", status: "queued", title: "first" });
      let jobs = listJobs(sandbox.cwd);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "queued");

      upsertJob(sandbox.cwd, { id: "task-1", status: "running" });
      jobs = listJobs(sandbox.cwd);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "running");
      assert.equal(jobs[0].title, "first");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("saveState - prunes oldest beyond MAX_JOBS=50", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      const jobs = [];
      for (let i = 0; i < 60; i += 1) {
        jobs.push({
          id: `task-${i}`,
          status: "completed",
          updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString()
        });
      }
      saveState(sandbox.cwd, { jobs });
      const stored = listJobs(sandbox.cwd);
      assert.equal(stored.length, 50);
      assert.equal(stored[0].id, "task-59");
      assert.equal(stored[49].id, "task-10");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("writeJobFile + readJobFile roundtrip", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      const jobFile = writeJobFile(sandbox.cwd, "task-x", { id: "task-x", status: "queued" });
      assert.ok(fs.existsSync(jobFile));
      const stored = readJobFile(jobFile);
      assert.equal(stored.id, "task-x");
      assert.equal(stored.status, "queued");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("saveState - removes job files for evicted jobs", () => {
  const sandbox = withSandbox();
  try {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = sandbox.pluginData;
    try {
      writeJobFile(sandbox.cwd, "task-old", { id: "task-old", status: "completed" });
      const logFile = resolveJobLogFile(sandbox.cwd, "task-old");
      fs.writeFileSync(logFile, "old log", "utf8");

      saveState(sandbox.cwd, {
        jobs: [
          { id: "task-old", status: "completed", updatedAt: "2026-01-01T00:00:00Z", logFile }
        ]
      });

      // Now save a new state without task-old → it should be evicted along with files
      saveState(sandbox.cwd, {
        jobs: [{ id: "task-new", status: "completed", updatedAt: "2026-01-02T00:00:00Z" }]
      });

      const oldJobFile = resolveJobFile(sandbox.cwd, "task-old");
      assert.equal(fs.existsSync(oldJobFile), false, "evicted job file should be removed");
      assert.equal(fs.existsSync(logFile), false, "evicted log file should be removed");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("generateJobId - includes prefix and is unique", () => {
  const a = generateJobId("task");
  const b = generateJobId("task");
  assert.match(a, /^task-/);
  assert.notEqual(a, b);
});

test("resolveStateDir - falls back to tmpdir when CLAUDE_PLUGIN_DATA unset", () => {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const tmp = makeTempDir();
    try {
      const dir = resolveStateDir(tmp);
      assert.ok(
        dir.includes("codefree-companion"),
        `expected fallback root containing 'codefree-companion', got ${dir}`
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    if (previous !== undefined) {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  }
});
