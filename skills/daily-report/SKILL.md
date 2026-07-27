---
name: daily-report
disable-model-invocation: true
description: >-
  Explicitly invoke /daily-report whenever the user asks for a Chinese work daily
  report (工作日报/日报/daily report/工作总结) from today's Git commits, including
  an incremental update since the prior report. It produces validated Chinese
  bullets, resolves and caches the project display name, and reports clipboard
  copy status. Call /daily-report [project-name] directly; do not merely explain
  how to create the report.
argument-hint: <project-name> (optional; falls back to cache → git remote slug → repository basename)
allowed-tools: Bash(git rev-parse:*), Bash(git config:*), Bash(git remote:*), Bash(git log:*), Bash(node *), Bash(pwd), Bash
---

## Task

Generate a Chinese daily work report from today's Git commits authored by the configured Git email. The report is incremental: each successful report remembers every included commit ID for the local calendar day.

## Base directory

At skill load time, the base directory is the directory containing this `SKILL.md`. Use that load-time Base directory to form an absolute scripts path:

`<Base directory>/scripts`

Use the resulting absolute path in every Node command below. Do not locate scripts by searching the working directory and do not use shell variables, command substitution, shell conditionals, pipes, `echo`, or platform-specific shell syntax.

## Collect Git context

Run these commands separately:

1. `git rev-parse --show-toplevel` to obtain `<repo_root>`. If it fails, state that the skill requires a Git repository and stop.
2. `git config user.email` to obtain `<user_email>`. If it is empty or fails, state that Git `user.email` must be configured and stop.
3. `git remote get-url origin` only if a project name must fall back to the remote slug.
4. `node "<Base directory>/scripts/commits.mjs" "<repo_root>" "<user_email>"`.

The commits script always runs `git log --since=midnight --all` and removes IDs already recorded for today. Its output is one `full-sha<TAB>subject` per unreported commit. This ID-set design is required because `<cached-sha>..HEAD` is not an exact incremental boundary under `--all`: commits reachable only from another branch could otherwise be missed, while a cached `HEAD` would not represent all previously reported branch tips.

If the command returns no lines, emit exactly one terminal state:

`暂无新提交，无需生成日报。`

Do not validate, copy, or change either cache in this state.

## Resolve project name

Apply this priority order:

1. If the optional skill argument is non-empty, use it and call `node "<Base directory>/scripts/cache.mjs" write "<repo_root>" "<project_name>"`.
2. Otherwise call `node "<Base directory>/scripts/cache.mjs" read "<repo_root>"`; use its non-empty stdout.
3. Otherwise derive the final path component of the `origin` remote URL after removing a trailing `.git`.
4. If there is no usable remote, use the final component of `<repo_root>`.

Cache write errors do not prevent generation; retain the error for the final status only if the report otherwise succeeds.

## Produce and validate the report

1. Turn each unreported commit subject into concise zh-CN work content.
2. Group related content by business module and compress toward 40–50% of the raw commit count where that improves clarity.
3. Produce one line per entry in exactly one format:

   ```text
   - ProjectName-WorkContent；
   - ProjectName-BusinessModule-WorkContent；
   ```

4. Write the complete draft to a temporary text file using the available file tool. Run `node "<Base directory>/scripts/validate.mjs" "<draft_file>"`.
5. If validation fails, revise the file and validate again. Never advance the commit cache before validation succeeds.

## Completion states and cache order

The following states are mutually exclusive; emit exactly one of them.

### No-new-commits

Defined above. No report, validation, clipboard action, project-cache write (unless a supplied name was explicitly written before detection), or commit-cache write occurs.

### Validation-failed

If a valid report cannot be produced, state the validation failure and stop. Do not copy to the clipboard. Do not write reported commit IDs. Project-name caching may already have occurred.

### Reported

Only after validation succeeds:

1. Copy the validated file with `node "<Base directory>/scripts/clipboard.mjs" "<draft_file>"`.
2. Regardless of clipboard success, call `node "<Base directory>/scripts/cache.mjs" write-reported "<repo_root>" '<JSON array of every full SHA returned by commits.mjs>'`.
3. If the reported-ID cache write fails, emit the validated bullets and state that cache persistence failed; do not claim a successful incremental update.
4. If it succeeds, emit the validated bullets followed by exactly one clipboard status line:
   - `（已复制到剪贴板）` when clipboard stdout reports success.
   - `（剪贴板复制失败：<reason>，请手动复制）` when clipboard stderr reports failure.
   - `（已跳过剪贴板复制）` when stdout reports the skip setting.

Clipboard failure is not a report failure: its cache advancement happens after the copy attempt so a successfully generated report is not repeated next time. Cache advancement is forbidden when there are no commits or validation failed.

## Configuration and limits

- Cache directory: `~/.claude/skills/daily-report/`, overridden by `DAILY_REPORT_CACHE_DIR`.
- Set `DAILY_REPORT_NO_CLIPBOARD=1` to skip copying.
- Commits are filtered by `git config user.email`; alternate identities and co-authored work can be omitted.
- The per-day ID set resets on the next local calendar day. Delete the repository entry in `commit-cache.json` to force a same-day rerun.
