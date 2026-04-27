---
name: daily-report
description: >-
  Generate a Chinese daily work report (工作日报) from today's git commit
  history, formatted as one bullet per line "- ProjectName-Module-Work；".
  Resolves the project display name from a CLI argument, a per-repo cache,
  the git remote URL slug, or the current directory basename — in that order.
  Caches the latest reported commit hash per repo so the next invocation only
  summarizes new commits since last report. Use this whenever the user says
  "工作日报", "日报", "daily report", "工作总结", or asks to summarize today's
  git work as a report. Output is validated by a bundled formatter before being
  shown to the user.
argument-hint: <project-name> (optional; falls back to cache → git remote slug → cwd basename)
allowed-tools: Bash(git remote:*), Bash(git rev-parse:*), Bash(git config:*), Bash(git log:*), Bash(node:*), Bash(basename:*), Bash(find:*), Bash(echo:*)
---

## Task

Analyze today's git commits for the current user and generate a Chinese daily work report (工作日报).

## Path Resolution

Determine the absolute path of the `scripts/` directory before any script call.
Store the result as `$SKILL_SCRIPTS_DIR`.

```bash
SKILL_SCRIPTS_DIR=$(node scripts/cache.mjs resolve 2>/dev/null)
if [ -z "$SKILL_SCRIPTS_DIR" ]; then
  SKILL_SCRIPTS_DIR=$(find ~/.claude/plugins/cache -path "*/daily-report/scripts/cache.mjs" -print -quit 2>/dev/null | xargs dirname 2>/dev/null)
fi
if [ -z "$SKILL_SCRIPTS_DIR" ]; then
  SKILL_SCRIPTS_DIR=scripts
fi
```

## Context

- Git context: !`root=$(git rev-parse --show-toplevel 2>/dev/null); email=$(git config user.email 2>/dev/null); remote=$(git remote get-url origin 2>/dev/null || echo ""); echo "repo_root=$root"; echo "user_email=$email"; echo "remote_url=$remote"`
- Latest commit: !`git log -1 --author="$(git config user.email)" --pretty=format:"%H" --all 2>/dev/null`

## Steps

1. Resolve `$SKILL_SCRIPTS_DIR` using the **Path Resolution** block above.

2. Read the cached last commit:

   ```bash
   cached=$(node "$SKILL_SCRIPTS_DIR/cache.mjs" read-commit <repo_root> 2>/dev/null)
   ```

   Fetch today's commits:

   ```bash
   # If cached commit exists, only show new commits since then; otherwise show since midnight
   if [ -n "$cached" ]; then
     git log "${cached}..HEAD" --author="<user_email>" --pretty=format:"%h %s" --all
   else
     git log --since="midnight" --author="<user_email>" --pretty=format:"%h %s" --all
   fi
   ```

   If there are no commits, tell the user there is nothing to report and exit.

3. Determine project name (priority order):
   - **CLI argument** (`$ARGUMENTS`): if provided, use it and persist:
     `node "$SKILL_SCRIPTS_DIR/cache.mjs" write <repo_root> <project-name>`
   - **Cache**: `node "$SKILL_SCRIPTS_DIR/cache.mjs" read <repo_root>`
   - **Git remote slug**: strip the `.git` suffix and last path component from the remote URL
   - **Fallback**: `basename <repo_root>`

4. Generate the report following the **Output Format** and **Compression Rules** below.

5. Validate the draft:

   ```bash
   echo '<draft>' | node "$SKILL_SCRIPTS_DIR/validate.mjs"
   ```

   If validation fails, fix the format based on the error messages and repeat until it passes.

6. Persist progress:

   ```bash
   node "$SKILL_SCRIPTS_DIR/cache.mjs" write-commit <repo_root> <latest_commit_hash>
   ```

7. Copy to clipboard:

   ```bash
   echo '<validated_report>' | node "$SKILL_SCRIPTS_DIR/clipboard.mjs"
   ```

   Capture the script output:
   - stdout `已复制到剪贴板（<tool>）` = success
   - stderr `复制到剪贴板失败：<reason>` = failure
   - stdout `跳过剪贴板复制` = skipped (`DAILY_REPORT_NO_CLIPBOARD=1`)

   Always proceed to step 8 regardless of outcome — do not abort.

8. Emit the validated bullet lines — no preamble, no explanation. Then append a single short status line based on clipboard.mjs output:
   - Success: `（已复制到剪贴板）`
   - Failure: `（剪贴板复制失败：<reason>，请手动复制）`
   - Skipped: `（已跳过剪贴板复制）`

## Output Format

Each entry on its own line, strictly:

```
- ProjectName-WorkContent；
- ProjectName-BusinessModule-WorkContent；
```

### Compression example

Raw commits:

```
- ProjectName-ModelA-完成功能A；
- ProjectName-ModelA-修复Bug；
- ProjectName-FunctionB-重构代码；
- ProjectName-FunctionB-补充测试；
- ProjectName-TaskC-文档更新；
```

After compression (target 40–50% of raw count):

```
- ProjectName-ModelA-完成功能A、修复Bug；
- ProjectName-FunctionB-重构并补充测试；
- ProjectName-TaskC-文档更新；
```

## Compression Rules

- Group entries by `BusinessModule`; merge work items with Chinese enumeration comma `、`
- Closely related modules may be consolidated into a higher-level category
- Strip redundant verbs and filler words; keep only the core action
- Target: reduce final entry count to ~40–50% of the raw commit count

## Failure Handling

- If `validate.mjs` exits non-zero: read the error output, fix the format, and re-pipe until clean
- If `cache.mjs` exits non-zero: still produce the report, skip cache persistence, tell the user
- If `clipboard.mjs` writes to stderr: surface the failure reason to the user but still emit the report

## Configuration

Cache files live in `~/.claude/skills/daily-report/` (overridable via `DAILY_REPORT_CACHE_DIR` env var):

- `project-name-cache.json` — maps `realpath(repo)` → display project name
- `commit-cache.json` — maps `realpath(repo)` → last reported commit SHA
- `DAILY_REPORT_NO_CLIPBOARD=1` — disables auto-copy (useful for CI, headless SSH, or pipeline use)

## Notes

- Commits are filtered by `git config user.email`; users with multiple git identities may miss some commits
- `--all` includes commits on all branches, not just the current one
- To force a full-day rerun (ignore the commit cache), delete the repo's entry from `commit-cache.json`
- Work content should be in zh-CN, concise and clear
