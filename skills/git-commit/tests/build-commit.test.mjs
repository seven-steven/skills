import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { buildCommit } from "../scripts/lib/build-commit.mjs";

function argv(args) {
  return ["node", "build-commit.mjs", ...args];
}

function ttyStdin() {
  const s = new Readable({ read() {} });
  s.isTTY = true;
  return s;
}

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

test("buildCommit - valid argv message → ok with message and cwd", async () => {
  const r = await buildCommit(argv(["feat: add login"]), ttyStdin());
  assert.equal(r.ok, true);
  assert.equal(r.message, "feat: add login");
  assert.equal(r.taskId, undefined);
  assert.equal(r.cwd, undefined);
});

test("buildCommit - valid message + task ID → footer appended", async () => {
  const r = await buildCommit(argv(["--task-id", "project-101", "feat: add task"]), ttyStdin());
  assert.equal(r.ok, true);
  assert.ok(r.message.endsWith("- srdcloud task id: %project-101"), r.message);
  assert.equal(r.taskId, "%project-101");
});

test("buildCommit - --cwd is captured for the caller", async () => {
  const r = await buildCommit(argv(["--cwd", "/tmp/repo", "feat: add x"]), ttyStdin());
  assert.equal(r.ok, true);
  assert.equal(r.cwd, "/tmp/repo");
});

// ---------------------------------------------------------------------------
// parse errors → exitCode 2
// ---------------------------------------------------------------------------

test("buildCommit - malformed args → not ok, exitCode 2, errors null", async () => {
  const r = await buildCommit(argv(["--cwd"]), ttyStdin());
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.equal(r.errors, null);
});

test("buildCommit - invalid task ID → not ok, exitCode 2", async () => {
  const r = await buildCommit(argv(["--task-id", "not-valid", "feat: add task"]), ttyStdin());
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.deepEqual(r.errors, ["invalid task ID"]);
});

test("buildCommit - empty message → not ok, exitCode 2", async () => {
  const r = await buildCommit(argv([]), ttyStdin());
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.equal(r.errors, null);
});

// ---------------------------------------------------------------------------
// validation failure → exitCode 1
// ---------------------------------------------------------------------------

test("buildCommit - invalid message format → not ok, exitCode 1, errors", async () => {
  const r = await buildCommit(argv(["This is not angular format."]), ttyStdin());
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.ok(r.errors.some((e) => e.includes("missing")));
});

// ---------------------------------------------------------------------------
// stdin message
// ---------------------------------------------------------------------------

test("buildCommit - reads message from piped stdin", async () => {
  const stdin = new Readable({ read() {} });
  stdin.isTTY = false;
  stdin.push("fix: read from stdin");
  stdin.push(null);
  const r = await buildCommit(argv([]), stdin);
  assert.equal(r.ok, true);
  assert.equal(r.message, "fix: read from stdin");
});
