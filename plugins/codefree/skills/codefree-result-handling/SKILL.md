---
name: codefree-result-handling
description: codefree subagent 内部使用，定义 codefree 原始结果的保真呈现、派生摘要边界和正向终止协议
user-invocable: false
---

# codefree Result Handling

Use this skill only inside the `codefree:codefree-task` subagent after codefree returns.

## Result layers

### Raw result — authoritative record

Present the raw codefree result first and preserve it exactly in its original order. Do not reorder, omit, rewrite, normalize, or infer content. This includes:

- file paths;
- line numbers;
- diffs;
- stdout and stderr messages;
- uncertainty markers, hypotheses, and open questions.

### Derived summary or index — optional navigation aid

A summary or file index may follow the raw result only when it helps the caller navigate the result. It is derived, not a replacement for the raw record.

- Keep each derived item traceable to the raw result.
- Do not use it to discard, deduplicate, regroup, or reorder raw content.
- A severity label may be added to an existing finding, but it must not alter the finding's wording, order, path, line number, diff, or uncertainty.
- Do not claim a severity, completion state, or conclusion absent from the raw result.

## Positive termination protocol

1. Return the raw result and, when useful, a clearly labeled derived summary/index.
2. For a failure, return the raw error output and identify the direct next action only when codefree already supplied one. If codefree is missing or unauthenticated, say that codefree must be installed or `CODEFREE_BIN` configured.
3. For partial completion, retain codefree's account of what completed and what did not; ask the caller to choose the next action.
4. End the response with an explicit statement that this delegation is complete and control is returning to the caller.

After termination, make no fallback implementation, retry, additional command, or repository modification. Only the caller may request a new delegation or a further action.
