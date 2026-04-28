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

This skill bundles a Node.js validator under its installation directory. Before
running anything, resolve the absolute path of the `scripts/` directory and
store it as `$SKILL_SCRIPTS_DIR`:

1. Try relative path `scripts/` first (works for project-level installs).
2. If that fails, search for the anchor file `validate.mjs` under:
   - `~/.claude/plugins/cache/**/git-commit/scripts/validate.mjs` (global plugin install)
   - `<plugin-source>/skills/git-commit/scripts/validate.mjs` (project-level install via marketplace)
3. Use the resolved path in every command below.

## Steps

1. Resolve `$SKILL_SCRIPTS_DIR` per **Path Resolution**.
2. Stage files that are relevant to the current session's work. Ask when scope is unclear.
3. Compose an Angular-format commit message: `<type>(<scope>): <subject>`.
   - If user provided `<append message>`, append it to the subject.
   - Add a blank-line-separated body if the change needs explanation.
4. Validate the message:
   ```
   printf '%s' "<message>" | node "$SKILL_SCRIPTS_DIR/validate.mjs"
   ```
   If it exits non-zero, read the stderr errors, revise the message, and retry.
   Repeat up to 3 times; if still failing, ask the user for guidance.
5. Commit via stdin:
   ```
   printf '%s' "<message>" | node "$SKILL_SCRIPTS_DIR/commit.mjs"
   ```

## Constitution

- Write the commit message body in the user's preferred language; keep the `<type>(<scope>): <subject>` header in English.
- Never include `Co-Authored-By` trailers.
- Stage only files related to the current session's work; ask when in doubt rather than assuming scope.
- For large change sets, split into atomic commits grouped by coherent purpose. Each commit should represent a single logical unit, not a bundle of unrelated work.
