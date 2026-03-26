---
name: git-commit
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: 提交代码
argument-hint: <append message> (optional, if provided, it will be appended to the generated commit message)
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes and chat history, create a single git commit for current work content.

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.

You should always user Angular Style Commit Message format, which is: `<type>(<scope>): <subject>`

If user provided <append message>, append it to the subject part of the generated commit message.

## Constitution

- Edit commit message in zh-CN。
- Don't add `Co-Authored-By` content in commit message。
