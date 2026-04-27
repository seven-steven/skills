# 项目规范

## 目录结构

```
/data/coding/projects/seven/skills/
├── .claude-plugin/
│   └── marketplace.json      # 插件注册表（所有 plugin + skill 路径）
├── CLAUDE.md                  # 项目级 Claude 指令
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md           # Skill 定义（frontmatter + body，英文）
│       └── scripts/           # Node.js 辅助脚本
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/plugin.json
│       ├── commands/          # Slash 命令（*.md）
│       ├── agents/            # Subagent（*.md）
│       ├── skills/            # 内部 skill（*.md）
│       ├── scripts/           # Node.js 脚本 + lib/
│       └── tests/             # 测试套件（*.test.mjs）
└── doc/
    └── knowledge-base/        # 项目知识库文档（本目录）
```

## 核心规范

### 脚本语言

- **必须使用 Node.js（`.mjs`）**，不用 Python，不用 bash
- 优先使用 Node.js 内置模块（`node:fs`、`node:http`、`node:net` 等）
- 零第三方依赖原则——确有必要时才引入 npm 包

### 测试

- **每个 Node.js 脚本都必须有测试套件**，覆盖 happy path、边界条件、错误路径
- 使用内置 `node:test` + `node:assert/strict`，不引入 Jest/Mocha
- `package.json` 配置：`"test": "node --test tests/*.test.mjs"`
- 所有测试通过后才能提交

### Skill 创建与修改

- **必须通过 `/skill-creator` 命令**创建或修改 skill，不手写 skill 文件
- 修改 skill 结构时，只在已生成的文件上做内容变更

### 注册表维护

- 新增或删除 skill/plugin 时，**同步更新 `.claude-plugin/marketplace.json`**

## 开发流程

遵循 TDD：

1. 写失败测试
2. 实现代码使测试通过
3. 重构（`/code-review` → `/simplify`）
4. 提交

提交信息使用 Angular 格式：`<type>(<scope>): <subject>`，语言跟随用户偏好。
