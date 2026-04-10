---
name: git-commit
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: 提交 git 代码变更。当用户提到"提交代码"、"git commit"、"commit changes"、"提交变更"或需要根据当前 git 状态生成 commit message 时触发。
argument-hint: <append message> （可选参数，会被追加到生成的 commit message 中）
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`
- current session work content

## Your task

Based on the above changes and chat history, create a single git commit for **current work content**.

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.

You should always use **Angular Style Commit Message format**, which is: `<type>(<scope>): <subject>`

If user provided <append message>, append it to the <subject> part of the generated commit message.

## Constitution

- Write commit message in user's preferred language.
- Don't add `Co-Authored-By` content in commit message。
- Only stage and commit files that are relevant to the current session's work. Ignore unrelated or stale changes unless the user **explicitly** requests them. When in doubt, ask which files to include rather than assuming scope.
