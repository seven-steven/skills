# Claude Code Plugin Marketplace

## 概述

插件市场是一个目录，用于向团队和社区分发 Claude Code 扩展。市场提供集中式发现、版本跟踪、自动更新以及对多种源类型的支持。

## 创建市场

### 目录结构

```
repository/
├── .claude-plugin/
│   └── marketplace.json      # 市场配置文件 (必需)
├── plugins/                  # 插件根目录
│   └── my-plugin/
│       ├── skills/
│       │   └── my-skill/
│       │       └── SKILL.md
│       ├── agents/
│       └── hooks/
└── skills/                   # 根级 skills 目录 (可选)
    └── skill-name/
        └── SKILL.md
```

### marketplace.json 架构

位置: `.claude-plugin/marketplace.json`

#### 必需字段

| 字段      | 类型   | 描述                    | 示例                      |
| --------- | ------ | ----------------------- | ------------------------- |
| `name`    | string | 市场标识符 (kebab-case) | `"acme-tools"`            |
| `owner`   | object | 市场维护者信息          | `{ "name": "Team Name" }` |
| `plugins` | array  | 可用插件列表            | 见下文                    |

#### 所有者字段

| 字段    | 类型   | 必需 | 描述                 |
| ------- | ------ | ---- | -------------------- |
| `name`  | string | 是   | 维护者或团队的名称   |
| `email` | string | 否   | 维护者的联系电子邮件 |

#### 可选元数据

| 字段                   | 类型   | 描述               |
| ---------------------- | ------ | ------------------ |
| `metadata.description` | string | 简短的市场描述     |
| `metadata.version`     | string | 市场版本           |
| `metadata.pluginRoot`  | string | 插件源路径的基目录 |

#### 完整示例

```json
{
  "name": "company-tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@example.com"
  },
  "metadata": {
    "description": "企业开发工具集合",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "保存时自动代码格式化",
      "version": "2.1.0",
      "strict": false,
      "skills": ["./skills/format"],
      "author": {
        "name": "DevTools Team"
      }
    }
  ]
}
```

## 插件条目

### 必需字段

| 字段     | 类型           | 描述                    |
| -------- | -------------- | ----------------------- |
| `name`   | string         | 插件标识符 (kebab-case) |
| `source` | string\|object | 从哪里获取插件          |

### 可选字段

#### 标准元数据

| 字段          | 类型    | 描述                                     |
| ------------- | ------- | ---------------------------------------- |
| `description` | string  | 简短的插件描述                           |
| `version`     | string  | 插件版本                                 |
| `author`      | object  | 插件作者信息                             |
| `homepage`    | string  | 插件主页 URL                             |
| `repository`  | string  | 源代码仓库 URL                           |
| `license`     | string  | SPDX 许可证标识符                        |
| `keywords`    | array   | 用于发现的标签                           |
| `category`    | string  | 插件类别                                 |
| `tags`        | array   | 可搜索标签                               |
| `strict`      | boolean | 控制 plugin.json 是否是权威 (默认: true) |

#### 组件配置字段

| 字段         | 类型           | 描述                  |
| ------------ | -------------- | --------------------- |
| `commands`   | string\|array  | 命令文件或目录路径    |
| `agents`     | string\|array  | agent 文件路径        |
| `hooks`      | string\|object | hooks 配置或路径      |
| `mcpServers` | string\|object | MCP server 配置或路径 |
| `lspServers` | string\|object | LSP server 配置或路径 |
| `skills`     | array          | skill 目录路径数组    |

### 严格模式 (strict)

| 值            | 行为                                     |
| ------------- | ---------------------------------------- |
| `true` (默认) | `plugin.json` 是权威，市场条目可补充     |
| `false`       | 市场条目是完整定义，不需要 `plugin.json` |

**使用场景:**

- `strict: true`: 插件有自己的 `plugin.json` 并管理自己的组件
- `strict: false`: 市场运营者想要完全控制，不需要插件有自己的 `plugin.json`

## 插件源类型

| 源       | 类型     | 示例                                            |
| -------- | -------- | ----------------------------------------------- |
| 相对路径 | `string` | `"./plugins/my-plugin"`                         |
| GitHub   | object   | `{ "source": "github", "repo": "owner/repo" }`  |
| Git URL  | object   | `{ "source": "url", "url": "https://..." }`     |
| npm      | object   | `{ "source": "npm", "package": "@org/plugin" }` |
| pip      | object   | `{ "source": "pip", "package": "plugin-name" }` |

### 相对路径

```json
{
  "name": "my-plugin",
  "source": "./plugins/my-plugin"
}
```

### GitHub 仓库

```json
{
  "name": "github-plugin",
  "source": {
    "source": "github",
    "repo": "owner/plugin-repo",
    "ref": "v2.0.0",
    "sha": "a1b2c3d4e5f6..."
  }
}
```

### Git URL

```json
{
  "name": "git-plugin",
  "source": {
    "source": "url",
    "url": "https://gitlab.com/team/plugin.git",
    "ref": "main"
  }
}
```

### npm 包

```json
{
  "name": "my-npm-plugin",
  "source": {
    "source": "npm",
    "package": "@acme/claude-plugin",
    "version": "2.1.0",
    "registry": "https://npm.example.com"
  }
}
```

## Skills 目录结构

Skill 必须放在 `skills/` 目录下，包含 `SKILL.md` 文件：

```
plugins/my-plugin/
└── skills/
    └── my-skill/
        └── SKILL.md
```

### SKILL.md 格式

```markdown
---
name: skill-name
description: Skill 描述
allowed-tools: Bash(git:*), Read
---

## Context

- 上下文信息

## Your task

- 任务描述

## Constitution

- 执行规则
```

## 高级插件条目示例

```json
{
  "name": "enterprise-tools",
  "source": {
    "source": "github",
    "repo": "company/enterprise-plugin"
  },
  "description": "企业工作流自动化工具",
  "version": "2.1.0",
  "author": {
    "name": "Enterprise Team",
    "email": "enterprise@example.com"
  },
  "homepage": "https://docs.example.com/plugins/enterprise-tools",
  "repository": "https://github.com/company/enterprise-plugin",
  "license": "MIT",
  "keywords": ["enterprise", "workflow", "automation"],
  "category": "productivity",
  "commands": ["./commands/core/", "./commands/enterprise/"],
  "agents": ["./agents/security-reviewer.md"],
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh"
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "enterprise-db": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"]
    }
  },
  "strict": false
}
```

**注意:**

- 使用 `${CLAUDE_PLUGIN_ROOT}` 变量引用插件安装目录
- `commands` 和 `agents` 可指定多个目录或单个文件
- 路径相对于插件根目录

## 托管和分发

### GitHub 托管 (推荐)

```bash
# 用户添加市场
/plugin marketplace add owner/repo

# 用户安装插件
/plugin install plugin-name@marketplace-name
```

### 其他 git 服务

```bash
/plugin marketplace add https://gitlab.com/company/plugins.git
```

### 本地测试

```bash
/plugin marketplace add ./my-local-marketplace
/plugin install test-plugin@my-local-marketplace
```

## 私有仓库认证

### 手动安装

使用现有的 git 凭证助手 (如 `gh auth login`)。

### 自动更新

设置环境变量：

| 提供商    | 环境变量                     |
| --------- | ---------------------------- |
| GitHub    | `GITHUB_TOKEN` 或 `GH_TOKEN` |
| GitLab    | `GITLAB_TOKEN` 或 `GL_TOKEN` |
| Bitbucket | `BITBUCKET_TOKEN`            |

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

## 团队配置

在 `.claude/settings.json` 中配置：

```json
{
  "extraKnownMarketplaces": {
    "company-tools": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-plugins"
      }
    }
  },
  "enabledPlugins": {
    "code-formatter@company-tools": true
  }
}
```

## 故障排除

### 常见错误

| 错误                                              | 原因            | 解决方案              |
| ------------------------------------------------- | --------------- | --------------------- |
| `File not found: .claude-plugin/marketplace.json` | 缺少清单        | 创建 marketplace.json |
| `Invalid JSON syntax`                             | JSON 语法错误   | 检查逗号和引号        |
| `Duplicate plugin name`                           | 插件名称重复    | 使用唯一名称          |
| `Path traversal not allowed`                      | 源路径包含 `..` | 使用相对路径不含 `..` |

### 验证命令

```bash
# 验证市场配置
/plugin validate .

# 或使用 CLI
claude plugin validate .
```

### Git 操作超时

```bash
# 增加超时时间 (毫秒)
export CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000  # 5 分钟
```

## 相关资源

- 官方文档: https://code.claude.com/docs/zh-CN/plugin-marketplaces
- Agent Skills 规范: https://agentskills.io/specification
- anthropics/skills 仓库: https://github.com/anthropics/skills
