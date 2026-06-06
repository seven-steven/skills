---
name: git-commit
disable-model-invocation: true
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git commit:*), Bash(git submodule:*), Bash(git -C:*), Bash(node:*)
description: >-
  提交 git 代码变更。当用户提到"提交代码"、"git commit"、"commit changes"、"提交变更"或需要根据当前 git 状态生成 commit message 时触发。
argument-hint: <append message> (optional, appended to the generated subject)
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status`
- Git status with submodule details: !`git status --short --branch --ignore-submodules=none`
- Submodule status: !`git submodule status --recursive`
- Submodule working tree status: !`git submodule foreach --recursive git status --short`
- Staged and unstaged diff: !`git diff HEAD`
- Recent commits: !`git log --oneline -10`
- Current session work content
- Current conversation
- User messages
- Explicit language instructions
- Repository/system context

## Path Resolution

Claude Code shows `Base directory for this skill: <skill-dir>` above these
instructions when the skill is loaded. Resolve bundled scripts from that loaded
skill directory:

1. Set `<scripts-dir>` to `<skill-dir>/scripts`.
2. Use `<scripts-dir>/validate.mjs` and `<scripts-dir>/commit.mjs` from the same directory.
3. Do not search `~/.claude/plugins/cache` by `validate.mjs` alone; stale cache copies can contain the validator but not the commit helper.
4. Use absolute script paths directly in `node` commands. Do not attach shell variable assignments before git or node commands, because that bypasses the allowed-tool patterns and causes extra permission prompts.

## Steps

1. Resolve `<scripts-dir>` per **Path Resolution**.
2. Inspect Context to determine whether the repository contains affected submodules.
   - If there are no submodule changes, continue with the normal repository flow.
   - If submodule changes are present, commit changes inside affected submodules before committing the parent repository.
3. For each affected submodule, inspect the submodule state before staging.
   - Use standalone commands such as `git -C <submodule-path> status`, `git -C <submodule-path> diff HEAD`, and `git -C <submodule-path> log --oneline -10`.
   - If nested submodules are involved, process nested submodules in deepest-first order.
   - Stage only files related to the current session's work with `git -C <submodule-path> add ...`. Ask when scope is unclear.
4. Infer the user's language preference from Context before composing each commit message.
   - Prefer explicit user language.
   - Otherwise prefer the current conversation dominant language.
   - Otherwise prefer the recent commit request language.
   - If the language is still unclear, default English.
   - Do not ask only to confirm language unless the instructions conflict.
5. Compose an Angular-format commit message: `<type>(<scope>): <subject>`.
   - If user provided `<append message>`, append it to the subject.
   - Subject/body use the inferred user language.
   - type/scope remain Conventional Commit English tokens.
   - Add a blank-line-separated body if the change needs explanation.
6. Validate each message before committing:
   ```
   node "<scripts-dir>/validate.mjs" "<message>"
   ```
   If it exits non-zero, read the stderr errors, revise the message, and retry.
   Repeat up to 3 times; if still failing, ask the user for guidance.
7. Commit submodule changes first when submodule changes are present:
   ```
   node "<scripts-dir>/commit.mjs" --cwd "<submodule-path>" "<submodule-message>"
   ```
8. After each submodule commit, return to the parent repository and stage the updated submodule path with `git add <submodule-path>` so the gitlink pointer update is included in the parent commit.
9. Stage parent-repository files that are relevant to the current session's work using standalone `git add ...` commands. Ask when scope is unclear.
10. Commit the parent repository with the same validated message:

```
node "<scripts-dir>/commit.mjs" "<message>"
```

If the parent repository change is primarily a submodule pointer update, describe that pointer/update clearly in the commit message.

## Constitution

- Infer the user's language preference from Context before composing the commit message.
- Let explicit user language override other signals. Otherwise prefer the current conversation dominant language, then the recent commit request language, and default English when still unclear.
- Subject/body use the inferred user language.
- type/scope remain Conventional Commit English tokens.
- Never include `Co-Authored-By` trailers.
- Stage only files related to the current session's work; ask when in doubt rather than assuming scope.
- For large change sets, split into atomic commits grouped by coherent purpose. Each commit should represent a single logical unit, not a bundle of unrelated work.
- When submodule changes are present, commit changes inside affected submodules before committing the parent repository.
- After submodule commits, stage the updated submodule path in the parent repository so the gitlink pointer is included in the parent commit.
- Do not commit unrelated submodule changes; ask the user when submodule scope is unclear.
