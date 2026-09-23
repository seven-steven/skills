# codefree Plugin 架构

## 概述

codefree plugin 将 [codefree-o](https://www.srdcloud.cn/helpcenter/content?id=1496170897327239168)（研发云 CLI，OpenCode 派生）封装为 Claude Code 插件，通过 `codefree-o run --format json --auto` 非交互模式做单次任务委派。提及“研发云”时可由调用方的编排策略路由至 `codefree:codefree-task` subagent；插件本身不强制该路由。

本插件前身封装 qwen-code 系 `codefree-cli`（相关入口已下线）。迁移后移除了自建 job broker、持久化状态、`task-worker` detach 进程与 `/codefree:{status,result,cancel}` 命令；后台运行改由 Claude Code 原生后台 Agent 承载（`/tasks` 查看、`TaskStop` 停止），已完成的 codefree-o 会话用其原生命令查看与续接。

参考实现：[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)，按最小裁剪移植，不引入 JSON-RPC 栈。

---

## 目录结构

```
plugins/codefree/
├── .claude-plugin/plugin.json
├── commands/
│   └── task.md                    # 唯一入口命令
├── agents/
│   └── codefree-task.md           # 薄转发 subagent
├── skills/
│   ├── codefree-prompting/SKILL.md
│   └── codefree-result-handling/SKILL.md
├── scripts/
│   ├── codefree-companion.mjs     # 单次运行入口
│   └── lib/
│       ├── run-events.mjs         # NDJSON 事件解析
│       ├── process.mjs            # 二进制解析（PATH/PATHEXT）与进程树终止（沿用）
│       └── args.mjs               # 参数解析（保留，按实际引用裁剪）
└── tests/                         # node:test 契约测试（见下）
```

> 注：随 job broker 移除的模块（`state.mjs`、`tracked-jobs.mjs`、`job-control.mjs`、`render.mjs`、`fs.mjs`、`workspace.mjs`）及对应测试一并删除；`args.mjs` 是否保留以实现为准。

---

## 运行模型

### 前台

`/codefree:task` 或 `codefree:codefree-task` subagent → companion 单次 spawn `codefree-o run [flags] [prompt]`（`--format json` 与 `--auto` 由 runner 固定注入；参数顺序与传递方式以 runner 实际 args 为准）：

- 默认新会话；仅用户明确要求才追加 `--continue` / `--session <id>`，可显式指定 `--model provider/model` 与 `--agent`。
- 任务在当前仓库工作目录中运行；额外只读目录由 codefree-o 项目级 `reference` 配置提供（本地目录引用是只读的），不再有 `--include-directories` 转发。
- 前台与后台运行均适用默认超时（540 000 ms，不超过 Claude Code Bash 的 600 000 ms 上限），超时终止进程树并如实标记失败。

### 后台

由 Claude Code 原生后台 Agent 承载：委派在后台运行，`/tasks` 查看进度，`TaskStop` 停止。插件侧不重建持久队列；不承诺 Claude 会话结束后原生后台任务仍继续运行。

---

## NDJSON 事件解析

- **基准契约**：2026-06-25 v1.3.1 真实 PoC 固化记录——`--format json` 输出 NDJSON，含 `text`、`tool_use`、`step_start`、`step_finish` 等事件。
- **解析原则**：保留事件原始顺序、原始 stderr、错误及 `sessionID`，向调用者提供可靠的原文结果；不凭工具成功事件捏造完成状态或 diff。
- **失败保护**：对未知事件兼容但保留原文；错误事件、畸形输出或非零退出均呈现失败，保留已有的部分结果供诊断；工具调用事件本身不代表代码变更已落地，实际 diff 需由调用方检查。
- **版本证据**：对本机 v1.7.0 二进制的源码静态审阅确认了 `run -- <任务>` 参数合并和 NDJSON 发射器的已知事件类型（另含 `reasoning`、`error`）；真实推理端到端仍未执行，解析器保留未知事件并对格式错误失败关闭。

---

## 安全边界

- `--auto` 带 dangerous 标识：自动批准所有未被显式 deny 的权限请求，也可能放行 `external_directory: ask` 的额外目录访问。**不是沙箱，也不继承 Claude Code 的审批。**Windows 上 `.cmd`/`.bat` 包装脚本一律拒绝运行，因为经 `cmd.exe` 无法可靠保全任意任务参数；需使用原生 `.exe`。
- codefree-o 自带 srdGuard（智能体运行防护）；`--auto` 对其行为的影响无实证——不声称 `--auto` 会绕过它，也不声称它能保证无人值守安全。
- 建议：可信仓库、`.codefree-o/codefree.json` 按需显式 deny、敏感项目用隔离工作区、运行后自行核对 `git diff`。
- 工作区为单目录：`reference` 引用仅提供只读外部代码上下文，不是额外可写目录授权。

---

## 内部 Skill 协议

`codefree:codefree-task` 仅在向 codefree-o 转发任务之前使用 `codefree-prompting`：具体任务最小透传；可串行复合任务完整保留；范围冲突或未知时将澄清请求交还调用方。它不读取仓库来猜测路径、验收项或约束。

codefree-o 返回后，subagent 使用 `codefree-result-handling`：先保留原始结果的顺序、路径、行号、diff 与不确定性，再可选添加可追溯的 summary/index；severity 只能附加。最后以正向终止协议将控制权返回调用方，不 fallback、不重试、不自行修改。

---

## 测试结构

用 `node:test` 配合假 `codefree-o` 二进制做零网络、零模型费用的契约测试，覆盖：argv/cwd、`--auto`、新会话与显式续接、NDJSON 事件排序与 Unicode 分块、错误/畸形/未知事件、stderr 与退出码、二进制缺失、超时终止、Windows PATH/PATHEXT 与 shell 元字符；另校验 agent/command 元数据及被删除命令的引用清理。运行方式以 `plugins/codefree/package.json` 为准。
