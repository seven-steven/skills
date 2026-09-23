# codefree-plugin-cc

一个 Claude Code 插件，封装 [codefree-o](https://www.srdcloud.cn/helpcenter/content?id=1496170897327239168)（研发云 CLI，OpenCode 派生），允许在 Claude Code 会话中直接将编码任务委派给 codefree-o。

本插件前身封装的是 qwen-code 系 `codefree-cli`（相关入口已下线），现已迁移到 `codefree-o run --format json --auto` 非交互模式：旧的 `--approval-mode`、`--include-directories`、自建后台 job 队列及其配套命令（`status`/`result`/`cancel`）均已移除，后台运行改由 Claude Code 原生后台任务承载。

灵感来源并参照 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) 的结构设计。

## 依赖

- 已安装 [Claude Code](https://claude.ai/code)
- 已安装并完成认证的 `codefree-o` CLI（默认从 PATH 解析；本机参考版本 v1.7.0，见下方“版本说明”）

## 命令

### `/codefree:task <任务描述>`

将编码任务委派给 codefree-o。每次调用运行一次 codefree-o，默认开启新会话；仅当用户明确要求续接时才使用会话标志。

```
/codefree:task Add input validation to the createUser function
/codefree:task --model provider/model Refactor the auth middleware
/codefree:task --agent build Fix all TypeScript errors in src/
/codefree:task --resume Run the test suite and fix any failures
/codefree:task --session <id> Apply the reviewed feedback to the auth module
```

> 注意：使用 `--resume` / `--session` 时，其后的任务描述会作为**新指令追加**进被续接的会话，而不是“原样继续”。若只想恢复上下文不追加新指令，可省略任务描述只传会话标志；需要继续推进时，建议写明具体指令（如上例），避免“Continue the previous session”这类含糊文本被当作指令执行。

**参数标志：**

| 标志                       | 说明                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `--model <provider/model>` | 覆盖 codefree-o 使用的模型，格式为 `provider/model`        |
| `--agent <name>`           | 指定 codefree-o 代理                                       |
| `--resume`                 | 继续最近一次的 codefree-o 会话（不加此标志则每次新开会话） |
| `--session <id>`           | 继续指定 ID 的 codefree-o 会话                             |
| `--fork`                   | 与 `--resume` 或 `--session` 合用，从已有会话分叉          |

所有任务均以 `--auto` 模式运行（含义与风险见下方“安全边界”）。`--resume` 是插件标志，由 subagent 转换为 codefree-o 的 `--continue`；请勿在 `/codefree:task` 中直接使用 `--continue`/`-c`、`-m`、`-s`。旧版的 `--yolo`、`--approval-mode`、`--include-dir`、`--background`、`--wait` 等标志不再支持；`--timeout-ms` 仅供 runner 调试和超时控制，非公开用户层标志（不再映射旧的 `--wait` 轮询语义）。

前台运行有默认超时（540 000 ms，即 9 分钟，不超过 Claude Code Bash 的 600 000 ms 上限），超时会终止 codefree-o 进程并如实标记本次委派失败；后台任务同样适用超时清理，不再有无限期挂起的 job。

## 后台运行

耗时较长的任务交给 Claude Code 原生后台能力：让后台 Agent 执行 `/codefree:task` 委派后，可在当前会话中用 `/tasks` 查看进度、用 `TaskStop` 停止。插件不再提供自建后台任务队列、job ID 或跨会话状态持久化；也不承诺 Claude 会话结束后原生后台任务仍继续运行。

已完成的 codefree-o 会话仍可用其原生命令查看与导出：

```bash
codefree-o session list --format json
codefree-o export <sessionID>
```

## 已移除的能力与迁移对照

| 旧能力                                                     | 现状                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/codefree:status`、`/codefree:result`、`/codefree:cancel` | 已删除；后台进度与停止使用 `/tasks` 与 `TaskStop`                                         |
| `--background` 自建 job 队列与持久化状态                   | 已删除；改用 Claude Code 原生后台 Agent                                                   |
| `--yolo` / `--approval-mode`                               | 已删除；统一使用 `--auto`（见“安全边界”）                                                 |
| `--include-dir <path>` 额外工作目录                        | 已删除；额外代码上下文改用 codefree-o 项目级 `reference` 配置（本地目录引用是**只读**的） |

## SubAgent

本插件暴露了一个 `codefree:codefree-task` subagent，供其他 agent、skill 或主 Claude 线程直接调用：

```typescript
Agent({
  subagent_type: "codefree:codefree-task",
  prompt: "Add type annotations to all Python files",
});
```

subagent 是薄转发层：转发前做任务保真整理（`codefree-prompting`），返回后忠实呈现原始结果（`codefree-result-handling`）；它不自行实现、不重试、不额外执行命令。

### 由谁决定何时使用 codefree

subagent 本身不内置任何关于“哪类任务适合交给 codefree-o”的策略，该决策由调用方负责：

- **用户级**：在 `~/.claude/CLAUDE.md` 中添加规则
- **项目级**：在项目的 `CLAUDE.md` 中添加规则
- **Skill 级**：编排型 skill 可以显式调用 `Agent("codefree:codefree-task", ...)`

例如希望用户提到“研发云”时自动路由，请在上述位置配置该编排策略。

## 安全边界（`--auto`）

- 所有任务以 `--auto` 运行。**该模式带 dangerous 标识：会自动批准所有未被显式 deny 的权限请求，也可能放行 `external_directory: ask` 的额外目录访问。**
- `--auto` **不继承** Claude Code 的审批体系，也**不构成沙箱**。
- codefree-o 自带 srdGuard（智能体运行防护，内置安全扫描）；`--auto` 对 srdGuard 行为的影响没有实证，不应假设它会被绕过，也不应假设它能保证无人值守安全。
- 建议：
  - 仅在可信仓库中使用本插件；
  - 在 `.codefree-o/codefree.json` 中按需显式 deny 敏感操作；
  - 对敏感项目使用隔离工作区（如 git worktree 或容器）；
  - 每次运行后自行核对 `git diff`，确认改动符合预期。
- 工作区为单目录：不要把 `reference` 引用当成额外可写目录的授权，本地目录引用仅用于只读读取外部代码上下文。

## 环境变量

| 变量             | 说明                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEFREE_BIN`   | 覆盖 codefree-o 的二进制名称或绝对路径（默认：`codefree-o`，不依赖任何 shell alias）。Windows 必须指向原生可执行文件（如 `.exe`）；不支持 npm 提供的 `.cmd`/`.bat` 包装脚本，因为它们需要经 `cmd.exe` 转发任意任务文本。                                                                                                                                            |
| `CODEFREE_PROXY` | 仅作用于 codefree-o 子进程的代理地址（`http(s)://…`）。设置后覆盖子进程继承的 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`，并确保 `NO_PROXY` 含 `localhost,127.0.0.1`；不设置则原样继承会话代理环境，非法值使该次调用直接失败（exit 2）。适合"个别环境需要专属代理"的场景：默认不设，仅在需要代理的项目或会话局部配置（如项目 `.claude/settings.local.json` 的 `env`）。 |

## Windows 注意事项

二进制解析器会在 Windows 上查找 PATH/PATHEXT 中的原生 `.exe`。**解析结果若为 `.cmd` 或 `.bat`，插件会直接拒绝执行**，即使任务文本不含特殊字符也不会通过 `cmd.exe` 运行：shell 转发可能拆分参数、折叠空格或解释元字符，无法保证任务原文完整且安全。npm 安装若只提供 `.cmd` 包装脚本，请另行取得原生 codefree-o 可执行文件，并将 `CODEFREE_BIN` 指向其绝对路径；无法取得时，本插件在 Windows 上不可用。

无论宿主机代码页如何，codefree-o 的输出均以 UTF-8 捕获，多字节字符（汉字、emoji）即使跨 pipe chunk 分割也能正确还原。

## 版本说明

- **v1.3.1（2026-06-25 PoC）**：真实运行确认 `codefree-o run --format json` 输出 NDJSON 事件流，包含 `text`、`tool_use`、`step_start`、`step_finish` 等事件类型。本插件的事件解析以此为基准契约。
- **v1.7.0（本机当前版本）**：对本机二进制进行的源码静态审阅确认，`run -- <任务>` 的参数会合并为消息，NDJSON 发射器包含 `text`、`tool_use`、`step_start`、`step_finish`、`reasoning` 与 `error` 事件；**未运行真实推理做端到端验证**。插件对未知事件保持兼容并保留原文，不凭工具成功事件捏造完成状态或 diff；遇到错误事件、畸形输出或非零退出时呈现失败。

## License

MIT
