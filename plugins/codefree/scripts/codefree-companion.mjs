#!/usr/bin/env node
/**
 * codefree-companion.mjs
 *
 * Subcommand dispatcher for codefree plugin job tracking.
 * Subcommands: task | task-worker | task-resume-candidate | status | result | cancel
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderStatusReport,
  renderStoredJobResult
} from "./lib/render.mjs";
import {
  generateJobId,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobRecord,
  nowIso,
  runTrackedJob
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CODEFREE_BIN = process.env.CODEFREE_BIN ?? "codefree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function outputResult(text, asJson = false) {
  if (asJson) {
    process.stdout.write(`${typeof text === "string" ? text : JSON.stringify(text, null, 2)}\n`);
  } else {
    process.stdout.write(typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`);
  }
}

function resolveCommandCwd(options) {
  return options.cwd ? path.resolve(options.cwd) : process.cwd();
}

function markerFile(repoRoot) {
  const hash = createHash("md5").update(repoRoot).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `codefree-ran-${hash}`);
}

function createCompanionJob({ prefix, title, workspaceRoot, summary }) {
  const id = generateJobId(prefix);
  return createJobRecord(
    { id, title, summary, workspaceRoot, kind: "task" },
    { env: process.env }
  );
}

function createTrackedProgress(job) {
  const logFile = createJobLogFile(job.workspaceRoot, job.id, job.title);
  return { logFile };
}

// ---------------------------------------------------------------------------
// executeCodefreeRun — spawn codefree and collect output
// ---------------------------------------------------------------------------

async function executeCodefreeRun({ cwd, prompt, approvalMode, model, includeDirs, useContinue, onProgress }) {
  const argv = [];

  if (prompt) {
    argv.push(prompt);
  }

  argv.push("--approval-mode", approvalMode ?? "auto-edit");

  if (model) {
    argv.push("--model", model);
  }

  if (includeDirs && includeDirs.length > 0) {
    argv.push("--include-directories", includeDirs.join(","));
  }

  if (useContinue) {
    argv.push("--continue");
  }

  return new Promise((resolve) => {
    const child = spawn(CODEFREE_BIN, argv, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutLines = [];
    const stderrLines = [];

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      stdoutLines.push(line);
      onProgress?.(line);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderrLines.push(text);
    });

    child.on("close", (code) => {
      const exitStatus = code ?? 1;
      const stdout = stdoutLines.join("\n");
      const stderr = stderrLines.join("");
      const rendered = exitStatus === 0 ? stdout : `codefree exited with code ${exitStatus}\n${stderr}`.trim();
      const summary = exitStatus === 0 ? "completed" : `failed (exit ${exitStatus})`;
      resolve({
        exitStatus,
        payload: { rawOutput: stdout, stderr },
        rendered,
        summary
      });
    });

    child.on("error", (err) => {
      const message = err.message;
      resolve({
        exitStatus: 127,
        payload: { rawOutput: "", stderr: message },
        rendered: `Failed to start codefree: ${message}`,
        summary: "failed (spawn error)"
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Background worker spawn
// ---------------------------------------------------------------------------

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "codefree-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd, job, request) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      logFile
    },
    logFile
  };
}

// ---------------------------------------------------------------------------
// Foreground run
// ---------------------------------------------------------------------------

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile } = createTrackedProgress(job);
  const progress = (line) => appendLogLine(logFile, line);
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? JSON.stringify(execution.payload) : execution.rendered);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

// ---------------------------------------------------------------------------
// task / task-worker — the main codefree delegation command
// ---------------------------------------------------------------------------

async function handleTaskCommand(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd", "model", "include-dir", "timeout-ms"],
    booleanOptions: ["background", "wait", "yolo", "y", "resume-last", "json"],
    aliasMap: { m: "model", y: "yolo" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  const prompt = positionals.join(" ").trim();
  const approvalMode = (options.yolo || options.y) ? "yolo" : "auto-edit";
  const model = options.model ?? null;
  const useContinue = Boolean(options["resume-last"]);
  const isBackground = Boolean(options.background);

  const includeRaw = options["include-dir"];
  const includeDirs = includeRaw
    ? (Array.isArray(includeRaw) ? includeRaw : [includeRaw]).map((d) => path.resolve(cwd, d))
    : [];

  if (!prompt && !useContinue) {
    process.stderr.write("ERROR: empty task. Usage: /codefree:task <task description>\n");
    process.exitCode = 2;
    return;
  }

  const title = prompt ? prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "") : "resume session";
  const job = createCompanionJob({ prefix: "task", title, workspaceRoot, summary: title });

  const request = { cwd, prompt, approvalMode, model, includeDirs, useContinue };

  if (isBackground) {
    const result = enqueueBackgroundTask(cwd, job, request);
    outputResult(JSON.stringify(result.payload, null, 2));
    return;
  }

  // Foreground
  await runForegroundCommand(
    job,
    (onProgress) => executeCodefreeRun({ ...request, onProgress }),
    { json: options.json }
  );

  // Touch legacy marker for resume detection
  try {
    fs.writeFileSync(markerFile(workspaceRoot), "", "utf8");
  } catch {
    // non-fatal
  }
}

async function handleTaskWorkerCommand(argv) {
  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "job-id"],
    booleanOptions: []
  });

  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const jobId = options["job-id"];

  if (!jobId) {
    process.stderr.write("task-worker: missing --job-id\n");
    process.exitCode = 1;
    return;
  }

  const jobFile = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(jobFile)) {
    process.stderr.write(`task-worker: job file not found: ${jobFile}\n`);
    process.exitCode = 1;
    return;
  }

  const stored = readJobFile(jobFile);
  const workspaceRoot = stored.workspaceRoot ?? resolveWorkspaceRoot(cwd);
  const request = stored.request ?? {};
  const logFile = stored.logFile ?? resolveJobLogFile(workspaceRoot, jobId);

  const job = { ...stored, workspaceRoot };

  try {
    await runTrackedJob(
      job,
      () => executeCodefreeRun({
        cwd: request.cwd ?? cwd,
        prompt: request.prompt,
        approvalMode: request.approvalMode ?? "auto-edit",
        model: request.model,
        includeDirs: request.includeDirs ?? [],
        useContinue: request.useContinue ?? false,
        onProgress: (line) => appendLogLine(logFile, line)
      }),
      { logFile }
    );

    // Touch legacy marker
    try {
      fs.writeFileSync(markerFile(workspaceRoot), "", "utf8");
    } catch {
      // non-fatal
    }
  } catch (err) {
    appendLogLine(logFile, `task-worker error: ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// task-resume-candidate
// ---------------------------------------------------------------------------

function handleTaskResumeCandidate(argv) {
  const { options } = parseArgs(argv, {
    booleanOptions: ["json"]
  });

  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  // Check state.json for any completed job (primary signal)
  let stateAvailable = false;
  try {
    const jobs = listJobs(workspaceRoot);
    stateAvailable = sortJobsNewestFirst(jobs).some((job) => job.status === "completed");
  } catch {
    // state not initialized yet
  }

  // Fall back to legacy marker (backward compat)
  const legacyMarker = markerFile(workspaceRoot);
  const available = stateAvailable || fs.existsSync(legacyMarker);

  if (options.json) {
    outputResult(JSON.stringify({ available }));
  } else {
    outputResult(available ? "available" : "unavailable");
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function handleStatusCommand(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd", "timeout-ms"],
    booleanOptions: ["all", "wait", "json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;

  if (options.wait && reference) {
    const timeoutMs = Number(options["timeout-ms"]) || 120_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { job } = buildSingleJobSnapshot(cwd, reference);
        if (job.status !== "queued" && job.status !== "running") {
          outputResult(options.json ? JSON.stringify(job) : renderJobStatusReport(job));
          return;
        }
      } catch {
        // job not found yet, keep waiting
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    process.stderr.write(`Timed out waiting for job ${reference}\n`);
    process.exitCode = 1;
    return;
  }

  if (reference) {
    const { job } = buildSingleJobSnapshot(cwd, reference);
    outputResult(options.json ? JSON.stringify(job) : renderJobStatusReport(job));
    return;
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? JSON.stringify(report) : renderStatusReport(report));
}

// ---------------------------------------------------------------------------
// result
// ---------------------------------------------------------------------------

function handleResultCommand(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;

  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const jobFile = resolveJobFile(workspaceRoot, job.id);
  const storedJob = fs.existsSync(jobFile) ? readJobFile(jobFile) : null;

  if (options.json) {
    outputResult(JSON.stringify({ job, stored: storedJob }));
    return;
  }

  outputResult(renderStoredJobResult(job, storedJob));
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

function handleCancelCommand(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;

  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);

  if (job.pid) {
    terminateProcessTree(job.pid);
  }

  const cancelledAt = nowIso();
  const patch = { id: job.id, status: "cancelled", phase: "cancelled", pid: null, completedAt: cancelledAt };
  upsertJob(workspaceRoot, patch);

  const jobFile = resolveJobFile(workspaceRoot, job.id);
  if (fs.existsSync(jobFile)) {
    const stored = readJobFile(jobFile);
    writeJobFile(workspaceRoot, job.id, { ...stored, ...patch });
  }

  const cancelled = { ...job, ...patch };

  if (options.json) {
    outputResult(JSON.stringify(cancelled));
    return;
  }

  outputResult(renderCancelReport(cancelled));
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  try {
    switch (subcommand) {
      case "task":
        await handleTaskCommand(rest);
        break;

      case "task-worker":
        await handleTaskWorkerCommand(rest);
        break;

      case "task-resume-candidate":
        handleTaskResumeCandidate(rest);
        break;

      case "status":
        await handleStatusCommand(rest);
        break;

      case "result":
        handleResultCommand(rest);
        break;

      case "cancel":
        handleCancelCommand(rest);
        break;

      default: {
        const usage = [
          "Usage: codefree-companion.mjs <subcommand> [options]",
          "",
          "Subcommands:",
          "  task [--background] [--wait] [--yolo] [--model <name>] [--include-dir <path>] [--resume-last] <task>",
          "  task-worker --cwd <path> --job-id <id>",
          "  task-resume-candidate [--json]",
          "  status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]",
          "  result [job-id] [--json]",
          "  cancel [job-id] [--json]"
        ];
        process.stderr.write(`${usage.join("\n")}\n`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

main();
