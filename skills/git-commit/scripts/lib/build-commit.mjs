import { parseCommitArgs, readMessageInput } from "./args.mjs";
import { normalizeTaskId } from "./task-id.mjs";
import { validateMessage, addTaskIdFooter } from "./commit-message.mjs";

/**
 * Run the full commit-message build pipeline: parse args →
 * normalize task ID → read message → add footer → validate.
 *
 * Returns:
 *   { ok: true, message, taskId, cwd }
 *   { ok: false, errors, exitCode: 1 | 2, cwd }
 *
 * The caller decides what to do with the built message (commit or discard).
 */
export async function buildCommit(argv, stdin) {
  const parsed = parseCommitArgs(argv);
  if (parsed.error) {
    return { ok: false, errors: null, exitCode: 2, cwd: undefined };
  }

  const taskId = parsed.taskId === undefined
    ? undefined
    : normalizeTaskId(parsed.taskId);
  if (parsed.taskId !== undefined && taskId === undefined) {
    return { ok: false, errors: ["invalid task ID"], exitCode: 2, cwd: parsed.cwd };
  }

  const message = await readMessageInput({
    argv: [argv[0], argv[1], parsed.messageArg].filter(Boolean),
    stdin,
  });
  if (message === undefined || !message.trim()) {
    return { ok: false, errors: null, exitCode: 2, cwd: parsed.cwd };
  }

  const finalMessage = taskId ? addTaskIdFooter(message, taskId) : message;
  const validation = validateMessage(finalMessage);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, exitCode: 1, cwd: parsed.cwd };
  }

  return { ok: true, message: finalMessage, taskId, cwd: parsed.cwd };
}