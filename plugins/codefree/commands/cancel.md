---
description: Cancel an active background codefree job in this repository
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codefree-companion.mjs" cancel "$ARGUMENTS"`
