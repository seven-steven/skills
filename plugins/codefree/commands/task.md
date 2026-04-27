---
description: Delegate a coding task to codefree (qwen-code fork) CLI
argument-hint: "[--yolo] [--model <name>] [--include-dir <path>] <task description>"
allowed-tools: Agent
---

Invoke the `codefree:codefree-task` subagent via the `Agent` tool (`subagent_type: "codefree:codefree-task"`), forwarding the raw user request as the prompt.

`codefree:codefree-task` is a subagent, not a skill — do not call `Skill(codefree:codefree-task)`.

Raw user request:
$ARGUMENTS

Return the subagent's output verbatim. Do not paraphrase, summarize, or add commentary.
