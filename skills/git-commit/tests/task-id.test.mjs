import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { normalizeTaskId, extractTaskIdFromMessage, resolveTaskId } from "../scripts/lib/task-id.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_ID = join(__dirname, "../scripts/task-id.mjs");

function git(args, cwd) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "task-id-test-"));
  git(["init", "--quiet"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  return dir;
}

function commit(dir, name, message, authorEmail = "test@example.com") {
  writeFileSync(join(dir, name), name);
  git(["add", "."], dir);
  const result = spawnSync("git", ["-C", dir, "commit", "-m", message], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: authorEmail,
    },
  });
  assert.equal(result.status, 0, result.stderr);
}

test("task-id - normalizes valid values to exactly one percent", () => {
  assert.equal(normalizeTaskId("project-101"), "%project-101");
  assert.equal(normalizeTaskId(" %101 "), "%101");
  assert.equal(normalizeTaskId("ABC12"), "%ABC12");
});

test("task-id - rejects malformed values", () => {
  for (const value of ["", "%", "project-", "1-2", "task_1", "%project-101%"])
    assert.equal(normalizeTaskId(value), undefined, value);
});

test("task-id - extracts a valid exact footer only from the final non-empty line", () => {
  assert.equal(
    extractTaskIdFromMessage("feat: add feature\n\nBody text\n- srdcloud task id: %project-101\n"),
    "%project-101"
  );
  assert.equal(extractTaskIdFromMessage("feat: add\n\n- srdcloud task id: invalid"), undefined);
  assert.equal(extractTaskIdFromMessage("feat: add\n\nsrdcloud task id: %project-101"), undefined);
  assert.equal(extractTaskIdFromMessage("feat: add\n\n- srdcloud task id:  %project-101"), undefined);
  assert.equal(extractTaskIdFromMessage("feat: add\n\n- srdcloud task id: %project-101 "), undefined);
  assert.equal(
    extractTaskIdFromMessage("feat: add\n\n- srdcloud task id: %project-101\nMore text"),
    undefined
  );
});

test("task-id - explicit resolver result succeeds or fails", () => {
  assert.deepEqual(resolveTaskId({ taskId: "project-101" }), { ok: true, taskId: "%project-101" });
  assert.deepEqual(resolveTaskId({ taskId: "bad-id" }), { ok: false, taskId: undefined });
});

test("task-id CLI - explicit task ID works before and after cwd", () => {
  const dir = initRepo();
  try {
    for (const args of [["project-101", "--cwd", dir], ["--cwd", dir, "%project-101"]]) {
      const result = spawnSync(process.execPath, [TASK_ID, ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "%project-101\n");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task-id CLI - invalid task ID and malformed arguments exit 2", () => {
  for (const args of [["bad-id"], ["--cwd"], ["--cwd", "--unknown"], ["--unknown"], ["101", "102"]]) {
    const result = spawnSync(process.execPath, [TASK_ID, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, args.join(" "));
  }
});

test("task-id CLI - automatically finds newest valid footer in current author history", () => {
  const dir = initRepo();
  try {
    commit(dir, "one", "feat: first\n\n- srdcloud task id: %older-1");
    commit(dir, "two", "fix: second\n\n- srdcloud task id: invalid");
    commit(dir, "three", "feat: third\n\n- srdcloud task id: %newer-2");
    const result = spawnSync(process.execPath, [TASK_ID, "--cwd", dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "%newer-2\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task-id CLI - author matching is exact even with regex metacharacters", () => {
  const dir = initRepo();
  try {
    git(["config", "user.email", "dev+one@example.com"], dir);
    commit(dir, "other", "feat: other author\n\n- srdcloud task id: %wrong-1", "devXone@example.com");
    commit(dir, "mine", "feat: current author\n\n- srdcloud task id: %right-2", "dev+one@example.com");
    const result = spawnSync(process.execPath, [TASK_ID, "--cwd", dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "%right-2\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task-id CLI - automatic Git failures and no matching history return empty success", () => {
  const missing = spawnSync(process.execPath, [TASK_ID, "--cwd", join(tmpdir(), "missing-task-id-repo")], { encoding: "utf8" });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, "");

  const dir = initRepo();
  try {
    commit(dir, "one", "feat: no task footer");
    const noMatch = spawnSync(process.execPath, [TASK_ID, "--cwd", dir], { encoding: "utf8" });
    assert.equal(noMatch.status, 0, noMatch.stderr);
    assert.equal(noMatch.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
