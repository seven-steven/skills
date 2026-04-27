# codefree Plugin 架构

## 概述

codefree plugin 将 `codefree` CLI（qwen-code fork）封装为 Claude Code 插件，支持前台同步调用和后台异步任务追踪。触发词 "研发云" 必须路由到 `codefree:task` subagent。

参考实现：[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)，按最小裁剪移植，不引入 JSON-RPC 栈。

---

## 目录结构

```
plugins/codefree/
├── .claude-plugin/plugin.json
├── commands/
│   ├── task.md           # 主入口，支持 --background
│   ├── status.md         # 查看 job 状态
│   ├── result.md         # 拉取已完成 job 输出
│   └── cancel.md         # 终止运行中 job
├── agents/
│   └── codefree-task.md  # 薄转发 subagent（model: haiku）
├── skills/
│   ├── codefree-prompting/SKILL.md
│   └── codefree-result-handling/SKILL.md
├── scripts/
│   ├── codefree-companion.mjs   # 主调度器（~400L）
│   ├── codefree-companion.sh    # 旧版兼容（待删除）
│   └── lib/
│       ├── state.mjs            # JSON 持久化状态
│       ├── tracked-jobs.mjs     # Job CRUD + session 隔离
│       ├── process.mjs          # runCommand + terminateProcessTree
│       ├── fs.mjs               # atomicWriteJson
│       ├── workspace.mjs        # resolveWorkspaceRoot
│       ├── args.mjs             # parseArgs / splitRawArgumentString
│       ├── job-control.mjs      # 查询/快照辅助函数
│       └── render.mjs           # 所有子命令的 Markdown 渲染
└── tests/                       # 75 个测试，全部通过（node:test）
```

---

## Job Broker 设计

### 存储路径

```
${CLAUDE_PLUGIN_DATA}/state/<basename>-<sha256(realpath)[0:16]>/
  ├── state.json          # 所有 job 的索引
  └── jobs/
      ├── <jobId>.json    # 单个 job 的完整状态
      └── <jobId>.log     # 运行时日志（逐行追加）
```

回退路径：`${TMPDIR}/codefree-companion/<slug>/`

### 状态机

```
queued → running → completed
                 → failed
                 → cancelled
```

### 后台 detach 模式

```js
// 父进程：立即返回 {jobId, status:"queued"}
spawn(execPath, [scriptPath, "task-worker", "--job-id", id], {
  detached: true,
  stdio: "ignore",
});
child.unref();

// task-worker 子命令：在后台执行实际的 codefree 调用
```

### Session 隔离

- 每个 job 打上 `CODEFREE_COMPANION_SESSION_ID` 标签
- `status` 默认只显示当前 session 的 job
- `--all` 跨 session 查看历史

### Cancel 实现

- POSIX：`process.kill(-pid, "SIGTERM")` 杀进程组，5s 后 SIGKILL 兜底
- Win32：`taskkill /T /F /PID <pid>`
- 写入 `status: "cancelled"`

---

## 子命令一览（codefree-companion.mjs）

| 子命令                                     | 行为                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| `task <prompt>`                            | 前台同步：运行 codefree，写 state，打印输出              |
| `task --background <prompt>`               | 后台：detach worker，立即返回 `{jobId, status:"queued"}` |
| `task-worker --job-id <id>`                | 内部：detached 子进程，执行 `executeCodefreeRun`         |
| `task-resume-candidate --json`             | 返回 `{available: bool}`，基于 state.json 中已完成 job   |
| `status [jobId] [--all] [--json] [--wait]` | 列出/查看 job                                            |
| `result [jobId]`                           | 显示已完成 job 的完整输出                                |
| `cancel [jobId]`                           | 终止运行中 job                                           |

---

## executeCodefreeRun

```js
// 通过 spawn 调用 codefree CLI，不用 JSON-RPC
spawn("codefree", argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
// stdout 逐行 appendLogLine 写入 .log 文件
// 返回：{ exitStatus, payload: { stdout, stderr }, rendered, summary }
```

首版使用默认 text 输出，不用 `-o stream-json`（留给 Item 7）。

---

## Session 策略

新 session 是默认值。只有用户明确传 `--resume` 时才追加 `--resume-last`，不自动检测，不弹确认框。

---

## 已修复的关键 Bug

1. **`matchJobReference` 未命中时应返回 `null` 而非抛异常** — 调用方需要走 active-job 检测兜底路径，抛异常会让该路径永远不可达。

2. **`buildStatusSnapshot` 的 `--all` 应完全跳过 session 过滤** — 原实现只改了 `maxJobs`，没有绕过 `filterJobsForCurrentSession`，导致跨 session 查看失效。

---

## 测试结构

```
tests/
├── args.test.mjs          # 15 个用例：parseArgs / splitRawArgumentString
├── state.test.mjs          # 11 个用例：resolveStateDir / loadState / pruning
├── process.test.mjs        # 10 个用例：runCommand / terminateProcessTree（DI）
├── render.test.mjs         # 11 个用例：所有渲染函数
├── job-control.test.mjs    # 15 个用例：查询/快照/resolve 函数
├── companion.test.mjs      # 12 个 e2e 用例：四件套完整流程
├── helpers.mjs             # 测试基础设施（sandbox、fake bin、waitFor）
└── fake-codefree-fixture.mjs  # fake codefree（happy/fail/slow 模式）
```

运行：`cd plugins/codefree && npm test`
