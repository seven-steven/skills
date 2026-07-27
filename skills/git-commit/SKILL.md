---
name: git-commit
model: haiku
disable-model-invocation: true
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git commit:*), Bash(git submodule:*), Bash(git -C:*), Bash(node:*)
description: >-
  提交当前任务相关的 Git 变更并生成规范 Angular Conventional Commit。用户要求提交代码、提交变更、git commit、commit changes，或显式调用 /git-commit 时使用；会按需检查 diff、提交历史与 submodule，并只暂存当前任务相关文件。
argument-hint: <append message> (optional, appended to the generated subject)
---

## Workflow

The initial context is intentionally small:

- Current branch: !`git branch --show-current`
- Git status: !`git status --short --branch`
- Current session work, conversation, user messages, explicit language instructions, and repository/system context

Use the following workflow. Read additional Git data only when it is needed to decide scope, compose an accurate message, or process submodules; this keeps `/git-commit` fast and avoids loading unrelated repository history.

1. Resolve the bundled helpers from the `Base directory for this skill: <skill-dir>` line shown when this skill loads.
   - Set `<scripts-dir>` to `<skill-dir>/scripts`.
   - Use the absolute paths `<scripts-dir>/validate.mjs` and `<scripts-dir>/commit.mjs` directly in `node` commands.
   - Do not search `~/.claude/plugins/cache` for a helper by filename: cache copies can be stale or incomplete.
   - Do not prefix Git or Node commands with shell variable assignments; that bypasses the allowed-tool patterns and creates needless permission prompts.
2. Use the initial status and the current task to identify candidate changes.
   - Read `git diff HEAD` only when the status and task context do not establish the relevant changes or a message cannot be composed accurately.
   - Read `git log --oneline -10` only when language preference or local commit conventions remain unclear.
   - Read `git status --short --branch --ignore-submodules=none`, `git submodule status --recursive`, or `git submodule foreach --recursive git status --short` only when status indicates a submodule change or the task mentions submodules.
3. Stage only files related to the current session's work using standalone `git add ...` commands. Ask the user instead of guessing when the relevant scope is unclear. For a large, coherent change set, make atomic commits by purpose rather than one unrelated bundle.
4. If affected submodules need commits, inspect each affected submodule on demand with standalone commands such as `git -C <submodule-path> status`, `git -C <submodule-path> diff HEAD`, and `git -C <submodule-path> log --oneline -10`.
   - Process nested submodules deepest-first.
   - Stage only current-task files in each submodule and ask if its scope is unclear.
   - Commit each affected submodule before its parent repository:

     ```
     node "<scripts-dir>/commit.mjs" --cwd "<submodule-path>" "<submodule-message>"
     ```

   - After each successful submodule commit, run `git add <submodule-path>` in its parent to include the updated gitlink. Do not commit unrelated submodule changes.

5. Infer the language for each message in this priority order: explicit user language, the dominant language of the current conversation, the language of the recent commit request, then English. Do not ask merely to confirm language unless instructions conflict. Keep Conventional Commit `type` and `scope` in English; write the natural-language subject and body in the inferred language.
6. Compose an Angular Conventional Commit message, `<type>(<scope>): <subject>`, adding a blank-line-separated body only when useful. If `<append message>` was supplied, append it to the subject. Never include a `Co-Authored-By` trailer.
7. Validate every proposed message before committing:

   ```
   node "<scripts-dir>/validate.mjs" "<message>"
   ```

   On a non-zero exit, read stderr, revise the message, and validate again. Make no more than three validation attempts; after a third failure, ask the user for guidance.

8. Commit the staged changes with the validated message:

   ```
   node "<scripts-dir>/commit.mjs" "<message>"
   ```

   If the parent change is primarily a submodule gitlink update, say so clearly in its message.

9. Report the final commit hash (or hashes when submodules were committed) and any relevant changes left uncommitted or unstaged. Do not claim that all changes were included when unrelated or ambiguous changes remain.
