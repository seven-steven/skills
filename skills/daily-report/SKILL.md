---
name: daily-report
description: >-
  根据当天的 git 提交历史生成工作日报。支持可选参数指定项目名称，格式：/daily-report <项目名称>。当用户提到"工作日报"、"日报"、"daily report"、"工作总结"或需要根据 git 提交记录汇总当天工作时触发。
argument-hint: <项目名称> (可选参数，缺省时依据 SKILL 规则自动提取)
---

## Task

Analyze today's work based on git commit history and generate a daily report.

## Context

- Today's commits: !`git log --since="midnight" --pretty=format:"%s" --all`
- Git remote: !`git remote get-url origin 2>/dev/null || echo ""`
- Current directory name: !`basename $(pwd)`
- Repository root: !`git rev-parse --show-toplevel`

## Steps

1. If there are no commits today, inform the user and exit
2. Determine project name with the following priority:
   - If user provided project name as argument, use it and cache it:
     `python3 scripts/cache.py write <repo-root> <project-name>`
   - Run `python3 scripts/cache.py read <repo-root>` to check cache, use cached value if exists
   - Extract repository name from git remote URL (remove `.git` suffix and path prefix)
   - Use current directory name as fallback
3. Generate report following the output format

## Output Format

Each log entry on a separate line, strictly follow this format:

- ProjectName-WorkContent;

### Example

```
- ProjectName-WorkContent1;
- ProjectName-WorkContent2;
```

### Rules

- Each log entry on a separate line, use LF line endings
- Each line starts with `- `
- `ProjectName` and `WorkContent` are separated by `-`, both must be non-empty
- Each line ends with Chinese semicolon (；)

## Validation

After generating the report, run the format validation script:

```
echo '<output-content>' | python3 scripts/validate.py
```

If validation fails, fix the format based on error messages and re-validate until it passes.

## Guidelines

- Work content should be in zh-CN, concise and clear
