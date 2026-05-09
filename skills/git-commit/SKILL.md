---
name: git-commit
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git commit:*), Bash(node:*)
description: >-
  提交 git 代码变更。当用户提到"提交代码"、"git commit"、"commit changes"、"提交变更"或需要根据当前 git 状态生成 commit message 时触发。
argument-hint: <append message> (optional, appended to the generated subject)
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status`
- Staged and unstaged diff: !`git diff HEAD`
- Recent commits: !`git log --oneline -10`
- Current session work content

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
2. Stage files that are relevant to the current session's work using standalone `git add ...` commands. Ask when scope is unclear.
3. Compose an Angular-format commit message: `<type>(<scope>): <subject>`.
   - If user provided `<append message>`, append it to the subject.
   - Add a blank-line-separated body if the change needs explanation.
4. Validate the message:
   ```
   node "<scripts-dir>/validate.mjs" "<message>"
   ```
   If it exits non-zero, read the stderr errors, revise the message, and retry.
   Repeat up to 3 times; if still failing, ask the user for guidance.
5. Commit with the same validated message:
   ```
   node "<scripts-dir>/commit.mjs" "<message>"
   ```

## Constitution

- Write the commit message body in the user's preferred language; keep the `<type>(<scope>): <subject>` header in English.
- Never include `Co-Authored-By` trailers.
- Stage only files related to the current session's work; ask when in doubt rather than assuming scope.
- For large change sets, split into atomic commits grouped by coherent purpose. Each commit should represent a single logical unit, not a bundle of unrelated work.
