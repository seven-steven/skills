import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  COMPANION_SCRIPT,
  cleanupSandbox,
  findStateDir,
  readJsonFile,
  runNode,
  waitFor,
  withSandbox
} from "./helpers.mjs";
import {
  installFakeCodefree,
  makeFakeBinEnv,
  writeFixtureConfig
} from "./fake-codefree-fixture.mjs";

function runCompanionInSandbox(sandbox, subcommand, args = [], envOverrides = {}) {
  return runNode([COMPANION_SCRIPT, subcommand, ...args], {
    cwd: sandbox.cwd,
    env: { ...sandbox.env, ...envOverrides },
    timeout: 60_000
  });
}

test("task-resume-candidate - returns unavailable when no jobs exist", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  try {
    const result = runCompanionInSandbox(sandbox, "task-resume-candidate", ["--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"available":false/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task (foreground) - happy path writes state and prints output", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["hello from fake codefree", "second line"]
  });
  const env = makeFakeBinEnv(sandbox.env, fixturePath);
  try {
    const result = runCompanionInSandbox(sandbox, "task", ["do thing"], {
      CODEFREE_FIXTURE_FILE: fixturePath,
      ...env
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /hello from fake codefree/);
    assert.match(result.stdout, /second line/);

    const stateDir = findStateDir(sandbox.pluginData);
    assert.ok(stateDir, "state dir should be created");
    const state = readJsonFile(path.join(stateDir, "state.json"));
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].status, "completed");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task (foreground) - failure exit code propagates", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "fail",
    exitCode: 7,
    stderr: "fake codefree blew up"
  });
  try {
    const result = runCompanionInSandbox(sandbox, "task", ["do thing"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(result.status, 7);
    const stateDir = findStateDir(sandbox.pluginData);
    const state = readJsonFile(path.join(stateDir, "state.json"));
    assert.equal(state.jobs[0].status, "failed");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task --background - returns jobId immediately without blocking", async () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["bg output"]
  });
  try {
    const result = runCompanionInSandbox(sandbox, "task", ["--background", "long task"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.jobId, /^task-/);
    assert.equal(payload.status, "queued");

    const stateDir = findStateDir(sandbox.pluginData);
    assert.ok(stateDir);

    // Wait for the worker to actually finish
    await waitFor(
      () => {
        const state = readJsonFile(path.join(stateDir, "state.json"));
        const job = state.jobs.find((j) => j.id === payload.jobId);
        return job && (job.status === "completed" || job.status === "failed");
      },
      { timeoutMs: 15_000 }
    );

    const finalState = readJsonFile(path.join(stateDir, "state.json"));
    const finalJob = finalState.jobs.find((j) => j.id === payload.jobId);
    assert.equal(finalJob.status, "completed");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("status - lists running and finished jobs", async () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["ok"]
  });
  try {
    // Run one task in foreground first
    const fg = runCompanionInSandbox(sandbox, "task", ["finished task"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(fg.status, 0, fg.stderr);

    // Now check status (no args)
    const status = runCompanionInSandbox(sandbox, "status", ["--json"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(status.status, 0, status.stderr);
    const report = JSON.parse(status.stdout);
    assert.ok(report.latestFinished, "latestFinished should be set");
    assert.equal(report.latestFinished.status, "completed");
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("status - filters by session id by default, --all bypasses", async () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["ok"]
  });
  try {
    // Run with session A
    runCompanionInSandbox(sandbox, "task", ["job from A"], {
      CODEFREE_FIXTURE_FILE: fixturePath,
      CODEFREE_COMPANION_SESSION_ID: "session-A"
    });

    // Run with session B
    runCompanionInSandbox(sandbox, "task", ["job from B"], {
      CODEFREE_FIXTURE_FILE: fixturePath,
      CODEFREE_COMPANION_SESSION_ID: "session-B"
    });

    // Status from session A: only sees A
    const aStatus = runCompanionInSandbox(sandbox, "status", ["--json"], {
      CODEFREE_FIXTURE_FILE: fixturePath,
      CODEFREE_COMPANION_SESSION_ID: "session-A"
    });
    const aReport = JSON.parse(aStatus.stdout);
    const aJobs = [aReport.latestFinished, ...aReport.recent].filter(Boolean);
    assert.equal(
      aJobs.every((j) => !j.sessionId || j.sessionId === "session-A"),
      true
    );

    // Status with --all from session A: should see B too
    const allStatus = runCompanionInSandbox(sandbox, "status", ["--all", "--json"], {
      CODEFREE_FIXTURE_FILE: fixturePath,
      CODEFREE_COMPANION_SESSION_ID: "session-A"
    });
    const allReport = JSON.parse(allStatus.stdout);
    const allJobs = [allReport.latestFinished, ...allReport.recent].filter(Boolean);
    const sessionsSeen = new Set(allJobs.map((j) => j.sessionId).filter(Boolean));
    assert.ok(sessionsSeen.has("session-A"));
    assert.ok(sessionsSeen.has("session-B"));
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("result - shows finished job output", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["the answer is 42"]
  });
  try {
    runCompanionInSandbox(sandbox, "task", ["compute it"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    const result = runCompanionInSandbox(sandbox, "result", [], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /the answer is 42/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("result - throws when no finished jobs exist", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  try {
    const result = runCompanionInSandbox(sandbox, "result", [], {});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No finished codefree jobs/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("cancel - terminates running background job and updates status", async () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const sentinelPath = path.join(sandbox.tempDir, "slow-pid");
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "slow",
    sleepMs: 30_000,
    sentinelFile: sentinelPath
  });
  try {
    const enqueue = runCompanionInSandbox(sandbox, "task", ["--background", "slow task"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(enqueue.status, 0, enqueue.stderr);
    const payload = JSON.parse(enqueue.stdout);
    const jobId = payload.jobId;

    const stateDir = findStateDir(sandbox.pluginData);

    // Wait for the worker to actually start codefree
    await waitFor(
      () => fs.existsSync(sentinelPath),
      { timeoutMs: 10_000 }
    );

    // Cancel
    const cancel = runCompanionInSandbox(sandbox, "cancel", [jobId], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.match(cancel.stdout, /Cancelled task-/);

    // Verify state reflects cancellation
    const state = readJsonFile(path.join(stateDir, "state.json"));
    const job = state.jobs.find((j) => j.id === jobId);
    assert.equal(job.status, "cancelled");

    // Verify the codefree child process is no longer alive
    const slowPid = Number(fs.readFileSync(sentinelPath, "utf8"));
    await waitFor(
      () => {
        try {
          process.kill(slowPid, 0);
          return false;
        } catch (err) {
          return err.code === "ESRCH";
        }
      },
      { timeoutMs: 10_000 }
    );
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task-resume-candidate - returns available after a completed job", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["done"]
  });
  try {
    runCompanionInSandbox(sandbox, "task", ["initial task"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    const result = runCompanionInSandbox(sandbox, "task-resume-candidate", ["--json"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"available":true/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("task - empty prompt returns error", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  try {
    const result = runCompanionInSandbox(sandbox, "task", []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /empty task/);
  } finally {
    cleanupSandbox(sandbox);
  }
});

test("status job-id - resolves by prefix", () => {
  const sandbox = withSandbox();
  installFakeCodefree(sandbox.fakeBinDir);
  const fixturePath = writeFixtureConfig(sandbox.tempDir, {
    mode: "happy",
    stdoutLines: ["ok"]
  });
  try {
    const enqueue = runCompanionInSandbox(sandbox, "task", ["test"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(enqueue.status, 0);

    const stateDir = findStateDir(sandbox.pluginData);
    const state = readJsonFile(path.join(stateDir, "state.json"));
    const fullId = state.jobs[0].id;
    const prefix = fullId.slice(0, 10);

    const status = runCompanionInSandbox(sandbox, "status", [prefix, "--json"], {
      CODEFREE_FIXTURE_FILE: fixturePath
    });
    assert.equal(status.status, 0, status.stderr);
    const job = JSON.parse(status.stdout);
    assert.equal(job.id, fullId);
  } finally {
    cleanupSandbox(sandbox);
  }
});
