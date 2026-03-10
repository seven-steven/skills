# Claude Code Plugin Marketplace 安装机制

## 概述

Claude Code Plugin Marketplace 是 Anthropic 提供的插件生态系统，允许用户发现和安装 Skills、Agents、Hooks 和 MCP Servers。

## 官方资源

- Claude Code 文档: https://docs.anthropic.com/en/docs/claude-code
- Marketplace 命令: `/plugin marketplace`

## Plugin Manifest 格式

### marketplace.json

位置: `.claude-plugin/marketplace.json`

```json
{
  "metadata": {
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "plugin-name",
      "source": "plugin-source",
      "skills": ["./skills/skill-1", "./skills/skill-2"],
      "agents": ["./agents/agent-1"],
      "hooks": {
        "PreToolUse": "./hooks/pre-tool-use.js"
      },
      "mcpServers": {
        "server-name": {
          "command": "node",
          "args": ["./mcp/server.js"]
        }
      }
    }
  ]
}
```

### plugin.json (单插件)

位置: `.claude-plugin/plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "skills": ["./skills/review", "./skills/test"]
}
```

## Plugin 组件

| 组件            | 说明                              |
| --------------- | --------------------------------- |
| **Skills**      | 定义 AI 行为的指令文件 (SKILL.md) |
| **Agents**      | 自定义代理配置                    |
| **Hooks**       | 事件钩子脚本                      |
| **MCP Servers** | Model Context Protocol 服务器     |

## 安装方式

### 通过 Marketplace 安装

```bash
# 在 Claude Code 中
/plugin marketplace add owner/repo
/plugin marketplace list
/plugin marketplace update
/plugin marketplace remove plugin-name
```

### 自动更新

Claude Code 在启动时会自动检查已安装插件的更新。

## Skill 安装路径

| 作用域 | 路径                |
| ------ | ------------------- |
| 项目级 | `.claude/skills/`   |
| 全局级 | `~/.claude/skills/` |

## 目录结构示例

```
project/
├── .claude-plugin/
│   ├── marketplace.json      # Marketplace 配置
│   └── plugin.json           # 单插件配置 (可选)
├── .claude/
│   └── skills/               # 项目级 Skills
│       └── my-skill/
│           └── SKILL.md
├── skills/                   # skills.sh 兼容目录
│   └── my-skill/
│       └── SKILL.md
└── plugins/                  # 插件根目录
    └── my-plugin/
        ├── skills/
        └── agents/
```

## 与 skills.sh 兼容

要同时支持 skills.sh 和 Claude Code Plugin Marketplace：

1. **使用 `skills/` 目录**: 存放所有 SKILL.md 文件
2. **创建 `.claude-plugin/marketplace.json`**: 指向 skills 目录
3. **使用标准 SKILL.md 格式**: 确保两种系统都能识别

## 发布要求

1. 公开 GitHub 仓库
2. 包含 `.claude-plugin/marketplace.json` 或 `plugin.json`
3. Skills 遵循 SKILL.md 格式规范
