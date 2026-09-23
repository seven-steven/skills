---
description: Delegate a coding task to the codefree-o CLI. When the caller's orchestration policy routes "研发云" coding work, this command is the entry point.
argument-hint: "[--resume | --session <id> | --fork] [--model <provider/model>] [--agent <name>] [--timeout-ms <ms>] <task description>"
allowed-tools: Bash(node:*), Agent
---

Invoke the `codefree:codefree-task` subagent via the `Agent` tool, forwarding the user request as the prompt. The raw user request below is plain prompt text for the Agent tool — never splice it into any shell command yourself.

Raw user request:
$ARGUMENTS

## Session policy

codefree-o always starts a **new** session by default. To continue the most recent session, the user must explicitly include `--resume` in the prompt (forwarded as `--continue`); `--session <id>` resumes a specific session. Do not ask, do not auto-detect, do not suggest continuing — only honor these flags when the user typed them.

## Timeout and long work

Foreground runs are capped at 540 000 ms by default (below the Bash tool's 600 000 ms hard limit). If the user's task will clearly take longer, tell them the work will be split or resumed via `--resume`/`--session` instead of raising the timeout far beyond the cap.

## Background runs

There is no `--background` flag anymore. For long-running delegations, invoke the `codefree:codefree-task` subagent as a background Agent run and follow its progress in the task list; stop it with TaskStop if needed. The companion kills the whole codefree-o process tree when the run times out or is stopped. Finished codefree-o sessions can be inspected and continued natively (e.g. `codefree-o session list`) — but do not promise that a background agent survives the end of this Claude session.

## Forwarding

Invoke `codefree:codefree-task` via the `Agent` tool (`subagent_type: "codefree:codefree-task"`) with the final prompt.

`codefree:codefree-task` is a subagent, not a skill — do not call `Skill(codefree:codefree-task)`.

Return the subagent's output verbatim. Do not paraphrase, summarize, or add commentary.
