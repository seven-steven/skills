---
description: Delegate a coding task to codefree (qwen-code fork) CLI
argument-hint: "[--yolo] [--model <name>] [--include-dir <path>] <task description>"
allowed-tools: Bash(bash:*)
---

Parse `$ARGUMENTS` and call the companion script via the Bash tool.

**Recognized flags** (extract these; do NOT include them in the task text):

- `--yolo` or `-y` → pass as `--yolo`
- `--model <name>` or `-m <name>` → pass as `--model <name>`
- `--include-dir <path>` → pass as `--include-dir <path>`

**Task text** = everything in `$ARGUMENTS` after removing the flags above.

Build the Bash command as follows — flags go as individual shell words, and the task text is passed as **one single-quoted string** so that `?`, `*`, `[`, and any other shell metacharacters in the text are never expanded:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/codefree-companion.sh" [flags...] '<task text>'
```

Example: if `$ARGUMENTS` is `--yolo --model qwen3 what files exist here?` then run:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/codefree-companion.sh" --yolo --model qwen3 'what files exist here?'
```

Execute the command and return codefree's stdout **verbatim**:

- Do not paraphrase, summarize, or add commentary before or after it.
- Do not attempt to fix, re-apply, or critique anything codefree did.
- If the script exits non-zero, surface the error output directly.
