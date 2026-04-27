---
description: Delegate a coding task to codefree (qwen-code fork) CLI
argument-hint: "[--resume|--fresh] [--yolo] [--model <name>] [--include-dir <path>] <task description>"
allowed-tools: Bash(bash:*), AskUserQuestion, Agent
---

Invoke the `codefree:codefree-task` subagent via the `Agent` tool, forwarding the user request as the prompt.

Raw user request:
$ARGUMENTS

## Resume routing

If `$ARGUMENTS` already contains `--resume` or `--fresh`, skip this section and go directly to **Forwarding**.

Otherwise, check for a resumable codefree session:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/codefree-companion.sh" task-resume-candidate --json
```

If the result is `{"available":true}`, use `AskUserQuestion` exactly once:

- Put `Continue current codefree session (Recommended)` first if the request sounds like a follow-up ("继续", "continue", "resume", "keep going", "apply", "dig deeper"). Otherwise put `Start a new codefree session (Recommended)` first.
- The two choices must be `Continue current codefree session` and `Start a new codefree session`.
- If the user picks **Continue**: prepend `--resume` to the prompt forwarded to the subagent.
- If the user picks **New**: prepend `--fresh` to the prompt forwarded to the subagent.

If the result is `{"available":false}`, forward the request as-is.

## Forwarding

Invoke `codefree:codefree-task` via the `Agent` tool (`subagent_type: "codefree:codefree-task"`) with the final prompt.

`codefree:codefree-task` is a subagent, not a skill — do not call `Skill(codefree:codefree-task)`.

Return the subagent's output verbatim. Do not paraphrase, summarize, or add commentary.
