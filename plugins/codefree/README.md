# codefree-plugin-cc

一个 Claude Code 插件，封装 [codefree-o](https://www.srdcloud.cn/helpcenter/content?id=1496170897327239168)（研发云 CLI，OpenCode 派生），允许在 Claude Code 会话中直接将编码任务委派给 codefree-o。

本插件前身封装的是 qwen-code 系 `codefree-cli`（相关入口已下线），现已迁移到 codefree-o 的无头模式：默认经 **serve 传输**（spawn `codefree-o serve` 并通过其本地 HTTP API 驱动）执行任务，旧的 `--approval-mode`、`--include-directories`、自建后台 job 队列及其配套命令（`status`/`result`/`cancel`）均已移除，后台运行改由 Claude Code 原生后台任务承载。

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

## 传输层（serve 默认 / run 逃生）

companion 有两个传输通道，由环境变量 `CODEFREE_TRANSPORT` 选择（默认 `serve`）：

- **`serve`（默认）**：每次任务 spawn 一个 `codefree-o serve --port <随机高位端口> --hostname 127.0.0.1 --print-logs`（companion 自选 32768–60999 的随机端口并带 EADDRINUSE 换端口重试——`--port 0` 在 codefree-o 语义里是「默认端口 4096」而非随机，4096 是 opencode 系工具的知名端口，撞车时请求会打到别人的服务上形成静默故障），从 stdout banner 解析监听地址，然后通过本地 HTTP API 驱动：`POST /session` 建会话（`--resume` 定位最近会话、`--fork` 以 `parentID` 分叉）→ `POST /session/{id}/prompt_async` 发送任务（任务文本只进 HTTP body，永不进 argv/shell）→ 每秒轮询消息与状态直到完成（存在已完成 assistant 消息且会话不处于 busy/retry——实测完成后 `/session/status` 会直接移除该会话条目而非置 idle）→ 结束后按进程组 SIGTERM → 5s 宽限 → SIGKILL 兜底清理整棵 serve 进程树。权限请求自动以 `reply:"once"` 放行（`--auto` 等价）；question 类交互无法在无头环境作答，逐个 reject 以免永久阻塞。
- **`run`（逃生通道）**：保留旧的 `codefree-o run --format json --auto` 路径，仅在排查 serve 通道自身问题时使用。

**为什么默认 serve**：codefree-o v1.7.0 的 `run --format json --auto` 在非 TTY stdio 管道（即 companion 的 spawn 方式）下，首个 NDJSON 事件输出前的初始化路径会永久阻塞——表现为零输出直到超时。同窗口并行对照实测：serve HTTP API（同样无 TTY、同代理、同凭证）8/8 成功，run 通道 0/4 全挂，且代理短请求 20/20 通、限流与 token 因素均被排除，阻塞点与 stdio 形态强相关（真 TTY 终端下 run 可用）。

**超时预算须知**：serve 进程冷启动后**首个 prompt 有约 111 秒的一次性停摆**（SRD auth-bridge/MCP 慢速初始化，仅每个 serve 进程的第一次 chat 请求发生，之后每条 5~10s）。该停摆在 `timeoutMs` 预算内——默认 540s 足够；若调小超时（如 60s）会被冷启动吃满而误判超时。

**上游「受理即丢弃」窗口（2026-09-24 实测）**：当代理/链路对 `srdcloud.cn` 不可达时（auth refresh 报 `socket connection closed`），serve 会进入 waiting-auth → 无可用 provider 的状态，此时 `prompt_async` 仍返回 204 但**静默丢弃任务**（user 消息不落库，serve 日志报 `ProviderNoProvidersError`）。companion 的应对：默认开启 `--print-logs` 把 serve 日志收进失败输出；发出 prompt 后 60s 内无任何新消息即以 `serve-prompt-dropped` 快速失败（不再傻等总超时），失败输出中带完整诊断链。遇到该错误时先检查代理连通性（`curl -x <代理> https://www.srdcloud.cn`），恢复后重试即可。

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

| 变量                   | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEFREE_BIN`         | 覆盖 codefree-o 的二进制名称或绝对路径（默认：`codefree-o`，不依赖任何 shell alias）。Windows 必须指向原生可执行文件（如 `.exe`）；不支持 npm 提供的 `.cmd`/`.bat` 包装脚本，因为它们需要经 `cmd.exe` 转发任意任务文本。                                                                                                                                                                                                                                                                                   |
| `CODEFREE_TRANSPORT`   | 传输通道：`serve`（默认，spawn `codefree-o serve` + 本地 HTTP API）或 `run`（旧的 `codefree-o run --format json --auto` 逃生通道；codefree-o v1.7.0 在非 TTY stdio 管道下会永久挂起，见“传输层”）。其他值使该次调用直接失败（exit 2）。                                                                                                                                                                                                                                                                    |
| `CODEFREE_SERVE_DEBUG` | 置任意非空值时，serve 传输在 stderr 输出每轮轮询调试日志（消息数、完成状态、会话状态、`POST /session` 响应等），用于排查 serve 通道问题。                                                                                                                                                                                                                                                                                                                                                                  |
| `CODEFREE_PROXY`       | 仅作用于 codefree-o 子进程的代理配置。值为单个 `http(s)://` 代理 URL（三个 `*_PROXY` 同值），或空格分隔的 `KEY=VALUE` 串分别指定各变量；设置任一代理后 `NO_PROXY` 强制含 `localhost,127.0.0.1`，原有条目保留；不设置则原样继承会话代理环境；非法值使该次调用直接失败（exit 2）。仅在需要代理的项目或会话局部配置（如项目 `.claude/settings.local.json` 的 `env`）。serve 传输下它只作用于 serve 子进程（访问 srdcloud 需要）；companion 对 `127.0.0.1` 的 API 调用使用 Node 内建 fetch，不读代理环境变量。 |

`KEY=VALUE` 形式示例（`ALL_PROXY` 额外接受 `socks5(h)://`）：

```jsonc
{
  "env": {
    "CODEFREE_PROXY": "HTTP_PROXY=http://user:pass@proxy.example.com:1080 HTTPS_PROXY=http://user:pass@proxy.example.com:1080 ALL_PROXY=socks5h://user:pass@proxy.example.com NO_PROXY=127.0.0.1,other_internal_ips",
  },
}
```

## Windows 注意事项

二进制解析器会在 Windows 上查找 PATH/PATHEXT 中的原生 `.exe`。**解析结果若为 `.cmd` 或 `.bat`，插件会直接拒绝执行**，即使任务文本不含特殊字符也不会通过 `cmd.exe` 运行：shell 转发可能拆分参数、折叠空格或解释元字符，无法保证任务原文完整且安全。npm 安装若只提供 `.cmd` 包装脚本，请另行取得原生 codefree-o 可执行文件，并将 `CODEFREE_BIN` 指向其绝对路径；无法取得时，本插件在 Windows 上不可用。

无论宿主机代码页如何，codefree-o 的输出均以 UTF-8 捕获，多字节字符（汉字、emoji）即使跨 pipe chunk 分割也能正确还原。

## 版本说明

- **v1.3.1（2026-06-25 PoC）**：真实运行确认 `codefree-o run --format json` 输出 NDJSON 事件流，包含 `text`、`tool_use`、`step_start`、`step_finish` 等事件类型。本插件的事件解析以此为基准契约。
- **v1.7.0（本机当前版本）**：源码静态审阅确认 `run -- <任务>` 的参数会合并为消息，NDJSON 发射器包含 `text`、`tool_use`、`step_start`、`step_finish`、`reasoning` 与 `error` 事件。**2026-09-24 实测补充**：该版本 `run --format json --auto` 经非 TTY stdio 管道调用时在首事件输出前永久阻塞（同窗口 serve HTTP API 正常，代理/限流/token 均排除），因此插件默认改走 serve 传输（见“传输层”）；serve API 契约（`/session`、`/session/{id}/prompt_async`、`/session/{id}/message`、`/session/status`、`/permission/{id}/reply`、`/question/{id}/reject`、`/session/{id}/abort`，全部支持 `?directory=` 隔离）均对本机二进制实测锚定。插件对未知事件保持兼容并保留原文，不凭工具成功事件捏造完成状态或 diff；遇到错误事件、畸形输出或非零退出时呈现失败。

## License

MIT
