import { spawnSync } from "node:child_process";

const TASK_ID_RE = /^%?[A-Za-z\-_]*-*\d+$/;
export const TASK_ID_FOOTER_PREFIX = "- srdcloud task id:";
const TASK_ID_FOOTER_RE = /^- srdcloud task id: (%?[A-Za-z\-_]*-*\d+)$/;

export function normalizeTaskId(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!TASK_ID_RE.test(trimmed)) return undefined;
  return `%${trimmed.replace(/^%/, "")}`;
}

function escapeBasicRegex(value) {
  return value.replace(/[.\\[\]*^$]/g, "\\$&");
}

export function formatTaskIdFooter(taskId) {
  const normalized = normalizeTaskId(taskId);
  return normalized ? `${TASK_ID_FOOTER_PREFIX} ${normalized}` : undefined;
}

export function extractTaskIdFromFooter(line) {
  const match = String(line).match(TASK_ID_FOOTER_RE);
  return match ? normalizeTaskId(match[1]) : undefined;
}

export function extractTaskIdFromMessage(message) {
  const lines = String(message).replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return extractTaskIdFromFooter(lines.at(-1) ?? "");
}

function git(args, cwd) {
  return spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

export function resolveTaskId({ cwd = process.cwd(), taskId } = {}) {
  if (taskId !== undefined) {
    const normalized = normalizeTaskId(taskId);
    return normalized === undefined
      ? { ok: false, taskId: undefined }
      : { ok: true, taskId: normalized };
  }

  const emailResult = git(["config", "user.email"], cwd);
  if (emailResult.status !== 0) return { ok: true, taskId: undefined };
  const email = emailResult.stdout.trim();
  if (!email) return { ok: true, taskId: undefined };

  const logResult = git([
    "log",
    `--author=<${escapeBasicRegex(email)}>$`,
    "-n", "10",
    "--format=%ae%x00%B%x00",
  ], cwd);
  if (logResult.status !== 0) return { ok: true, taskId: undefined };

  const records = logResult.stdout.split("\0");
  for (let index = 0; index + 1 < records.length; index += 2) {
    if (records[index].trim() !== email) continue;
    const resolved = extractTaskIdFromMessage(records[index + 1]);
    if (resolved) return { ok: true, taskId: resolved };
  }
  return { ok: true, taskId: undefined };
}
