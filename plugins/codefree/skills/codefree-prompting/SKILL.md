---
name: codefree-prompting
description: codefree subagent 内部使用，把用户的自然语言任务整理为 codefree 能稳定执行的 prompt（明确目标、输入文件、输出契约、不要碰的范围）
user-invocable: false
---

# codefree Prompt Engineering

Use this skill only inside the `codefree:codefree-task` subagent, before forwarding a task to codefree.

**When to apply**: if the task text is vague, composite, or missing file scope — rewrite it. If it is already specific and bounded, forward as-is.

## Prompt rules for codefree (qwen-code based)

- **Single responsibility**: one concrete job per run. If the task is composite, pick the primary goal.
- **Explicit file scope**: list target files or directories. Do not let codefree guess.
- **Output contract**: state what done looks like ("only edit X", "produce a unified diff", "run the command and report output").
- **Negative constraints**: state what codefree must not do (install dependencies, touch unrelated files, reformat).
- **Verification**: for fixes or changes, ask codefree to verify its result (e.g. "run tests after the change").

## Prompt structure

```xml
<task>
  Concrete job. Relevant repository context or failure description.
</task>
<scope>
  Files or directories to work in. Files to leave untouched.
</scope>
<output_contract>
  What done looks like. What to write to stdout.
</output_contract>
<constraints>
  Things to avoid. Safety guards.
</constraints>
```

Use only the blocks the task needs. Omit the rest.
