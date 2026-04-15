---
name: daily-report
description: >-
  根据当天的 git 提交历史生成工作日报。支持可选参数指定项目名称，格式：/daily-report <项目名称>。当用户提到"工作日报"、"日报"、"daily report"、"工作总结"或需要根据 git 提交记录汇总当天工作时触发。
argument-hint: <项目名称> (可选参数，缺省时依据 SKILL 规则自动提取)
---

## Task

Analyze today's work based on git commit history and generate a daily report.

## Context

- Git remote: !`git remote get-url origin 2>/dev/null || echo ""`
- Current directory name: !`basename $(pwd)`
- Repository root: !`git rev-parse --show-toplevel`
- Cached last commit id: !`python3 $SKILL_SCRIPTS_DIR/cache.py read-commit $(git rev-parse --show-toplevel) 2>/dev/null || echo ""`
- Today's commits: !`cached_id=$(python3 $SKILL_SCRIPTS_DIR/cache.py read-commit $(git rev-parse --show-toplevel) 2>/dev/null); if [ -n "$cached_id" ]; then git log "${cached_id}..HEAD" --pretty=format:"%s" --all; else git log --since="midnight" --pretty=format:"%s" --all; fi`
- Latest commit hash: !`git log -1 --pretty=format:"%H" --all`

## Path Resolution

This skill bundles scripts under its installation directory. Before executing any script command, determine the absolute path of the `scripts/` directory:

1. Try relative path `scripts/` first (works for local / project-level installs)
2. If that fails, search for the anchor file `cache.py` under:
   - `~/.claude/plugins/cache/**/daily-report/scripts/cache.py` (global plugin install)
   - `<skill-source>/skills/daily-report/scripts/cache.py` (project-level install)
3. Store the resolved path as `$SKILL_SCRIPTS_DIR` and use it in all subsequent script calls

## Steps

1. Resolve `$SKILL_SCRIPTS_DIR` following the **Path Resolution** rules above
2. If there are no commits (based on cached range or today), inform the user and exit
3. Determine project name with the following priority:
   - If user provided project name as argument, use it and cache it:
     `python3 $SKILL_SCRIPTS_DIR/cache.py write <repo-root> <project-name>`
   - Run `python3 $SKILL_SCRIPTS_DIR/cache.py read <repo-root>` to check cache, use cached value if exists
   - Extract repository name from git remote URL (remove `.git` suffix and path prefix)
   - Use current directory name as fallback
4. Generate report following the output format
5. Cache the latest commit id:
   `python3 $SKILL_SCRIPTS_DIR/cache.py write-commit <repo-root> <latest-commit-hash>`

## Output Format

Each log entry on a separate line, strictly follow this format, no other additional message:

```
- ProjectName-WorkContent；
- ProjectName-BusinessModule-WorkContent；
```

### Example

```
- ProjectName-ModelA-WorkContent1；
- ProjectName-ModelA-WorkContent2；
- ProjectName-FunctionA-WorkContent3；
- ProjectName-FunctionA-WorkContent4；
- ProjectName-TaskA-WorkContent5；
```

After compression (merge by module):

```
- ProjectName-ModelA-WorkContent1、WorkContent2；
- ProjectName-FunctionA-WorkContent3、WorkContent4；
- ProjectName-TaskA-WorkContent5；
```

### Rules

- Each log entry on a separate line, use LF line endings
- Each line starts with `- `
- `ProjectName` and `WorkContent` are separated by `-`, both must be non-empty
- `BusinessModule` is optional, sits between `ProjectName` and `WorkContent`
- When `BusinessModule` is present, entries should be grouped by module
- Each line ends with Chinese semicolon (；)

### Compression Rules

- Merge multiple work items under the same `BusinessModule` into a single line, separated by Chinese enumeration comma (`、`)
- Closely related modules may be consolidated into a higher-level category (e.g. "error handling" + "logging" → "robustness")
- Strip redundant verbs and filler words, keep only the core action
- Target: reduce final entry count to ~40%-50% of the raw commit count

## Validation

After generating the report, run the format validation script:

```
echo '<output-content>' | python3 $SKILL_SCRIPTS_DIR/validate.py
```

If validation fails, fix the format based on error messages and re-validate until it passes.

## Guidelines

- Work content should be in zh-CN, concise and clear
