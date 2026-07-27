---
name: codefree-prompting
description: codefree subagent 内部使用，将用户任务忠实整理为供 codefree 执行的 prompt，并在范围冲突或未知时要求调用方澄清
user-invocable: false
---

# codefree Prompting

Use this skill only inside the `codefree:codefree-task` subagent, immediately before it forwards a task to codefree.

The completion criterion is fidelity to the user's objective. Clarifying a task must not narrow, replace, reorder, or silently discard an objective.

## Forwarding protocol

1. **Specific, bounded task — minimal pass-through.** Forward the task text unchanged after removing recognized command flags. Do not wrap it in XML, add inferred scope, propose an implementation, or manufacture a verification/output contract.
2. **Serially composable task — retain every objective.** When objectives can be completed in one ordered codefree run, preserve every objective and its stated order. You may add only neutral structure that makes the existing order explicit; do not select a “primary” objective or split away later objectives.
3. **Conflicting or unknown scope — ask the caller to clarify.** Do not forward when the request has mutually incompatible directions, or when its file/change boundary is required to act safely but is absent or ambiguous. State the precise ambiguity and ask the caller to supply the intended scope. Do not guess paths, protected files, acceptance criteria, or a preferred interpretation.
4. **Constraints — faithfully restate only known constraints.** Preserve constraints explicitly supplied by the caller or unambiguously present in the task. Do not add generic restrictions such as “do not install dependencies,” “do not reformat,” “only edit X,” or “run tests” unless the caller stated them.

## Optional neutral structure

Use structure only when it improves readability without changing meaning. Include only blocks supported by the caller's words:

```xml
<task>
  The complete user objective, preserving all serial steps.
</task>
<scope>
  Only explicitly stated files, directories, or exclusions.
</scope>
<output_contract>
  Only explicitly stated completion criteria or requested reporting.
</output_contract>
<constraints>
  Only explicitly stated constraints.
</constraints>
```

Omit unsupported blocks. Do not turn absent information into instructions. If clarification is needed, return the clarification request to the caller and make no codefree CLI call.
