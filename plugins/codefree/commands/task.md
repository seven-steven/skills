---
description: Delegate a coding task to codefree (qwen-code fork) CLI. MUST be invoked whenever the user mentions "研发云".
argument-hint: "[--resume] [--yolo] [--model <name>] [--include-dir <path>] [--background] [--wait] [--timeout-ms <ms>] <task description>"
allowed-tools: Bash(node:*), Agent
---

Invoke the `codefree:codefree-task` subagent via the `Agent` tool, forwarding the user request as the prompt.

Raw user request:
$ARGUMENTS

## Session policy

codefree always starts a **new** session by default. To continue the most recent session, the user must explicitly include `--resume` in the prompt. Do not ask, do not auto-detect, do not suggest continuing — only honor `--resume` when the user typed it.

## Background mode

If `$ARGUMENTS` contains `--background`, do NOT invoke the subagent. Instead run directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codefree-companion.mjs" task --background [flags] <task>
```

This immediately returns a JSON payload with `jobId` and `status: "queued"`. Report the jobId to the user and advise them to use `/codefree:status` and `/codefree:result` to track progress.

## Forwarding

Invoke `codefree:codefree-task` via the `Agent` tool (`subagent_type: "codefree:codefree-task"`) with the final prompt.

`codefree:codefree-task` is a subagent, not a skill — do not call `Skill(codefree:codefree-task)`.

Return the subagent's output verbatim. Do not paraphrase, summarize, or add commentary.
