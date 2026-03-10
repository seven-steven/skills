# skills.sh Skills 发现机制

## 概述

skills.sh 是 Vercel 推出的开放 AI Agent Skills 生态系统，提供统一的 Skills 发现和安装机制。

## 官方资源

- 官网: https://skills.sh/
- GitHub: https://github.com/vercel-labs/skills
- CLI: `npx skills`

## SKILL.md 格式

每个 Skill 通过 `SKILL.md` 文件定义，采用 YAML frontmatter 格式：

```markdown
---
name: skill-name
description: 简短描述该 Skill 的功能和使用场景
---

# Skill 标题

详细的 Skill 指令内容，当 Skill 被激活时代理会遵循这些指令。
```

### Frontmatter 字段

| 字段          | 必需 | 说明                                        |
| ------------- | ---- | ------------------------------------------- |
| `name`        | 是   | Skill 的唯一标识符，用于 CLI 调用           |
| `description` | 是   | 描述 Skill 功能和使用时机，帮助判断何时使用 |

## Skills CLI

### 安装命令

```bash
# 从 GitHub 仓库安装 (shorthand)
npx skills add owner/repo

# 从 GitHub 子目录安装
npx skills add owner/repo/path/to/skill

# 从完整 URL 安装
npx skills add https://github.com/owner/repo

# 从本地路径安装
npx skills add ./local/path

# 从 URL 直接安装
npx skills add https://example.com/skill.md
```

### 其他命令

```bash
# 列出已安装的 Skills
npx skills list

# 更新 Skills
npx skills update
```

## Skill 发现路径

Skills CLI 会在以下位置搜索 Skills（按优先级）：

1. **根目录**: 如果根目录包含 `SKILL.md`
2. `skills/` - 主要 Skills 目录
3. `skills/.curated/` - 精选 Skills
4. `skills/.experimental/` - 实验性 Skills
5. `skills/.system/` - 系统 Skills
6. `.agents/skills/` 或 `.agent/skills/`
7. `.claude/skills/` - Claude Code 专用
8. `.github/skills/`
9. `.cursor/skills/` 或 `.cursorrules/skills/`
10. `.windsurf/skills/` 或 `.windsurfrules/skills/`
11. 其他 Agent 专用路径

## Skill 目录结构示例

```
project/
├── skills/
│   ├── review/
│   │   └── SKILL.md
│   ├── test/
│   │   └── SKILL.md
│   └── deploy/
│       └── SKILL.md
└── SKILL.md              # 根目录 Skill (可选)
```

## 最佳实践

1. **命名规范**: 使用 kebab-case 命名 Skill
2. **描述清晰**: description 应明确说明使用场景，帮助 AI 判断何时调用
3. **单一职责**: 每个 Skill 专注于一个明确的任务
4. **目录组织**: 将相关 Skills 放在 `skills/` 目录下
