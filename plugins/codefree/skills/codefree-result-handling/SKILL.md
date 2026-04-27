---
name: codefree-result-handling
description: codefree subagent 内部使用，规范 codefree 输出的呈现方式与失败处理边界
user-invocable: false
---

# codefree Result Handling

When presenting codefree's output:

- Preserve the output structure — file paths, line numbers, diffs, and messages exactly as reported.
- If codefree made edits, list the touched files as reported.
- If codefree reported findings, present them ordered by severity.
- Preserve uncertainty markers — if codefree flagged something as a hypothesis or open question, keep that label.

On failure:

- Surface the most actionable stderr lines and stop.
- **Do not implement the task yourself as a fallback.** Report the failure and stop.
- If codefree is missing or unauthenticated, tell the user to install codefree or set `CODEFREE_BIN`.

On partial success:

- State what was done and what was not. Let the caller decide what to do next.

**Critical**: after presenting output, STOP. Do not apply additional fixes, refactors, or follow-up changes unless explicitly asked.
