# codefree-plugin-cc

一个 Claude Code 插件，封装了 [codefree-cli](https://www.srdcloud.cn/helpcenter/content?id=1443287380026744832&versionType=1)（基于 qwen-code 的 AI 编码工具），允许在 Claude Code 会话中直接将编码任务委派给 codefree。

灵感来源并参照 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) 的结构设计。

## 依赖

- 已安装 [Claude Code](https://claude.ai/code)
- 已安装并完成认证的 [codefree-cli](https://www.srdcloud.cn/helpcenter/content?id=1443287380026744832&versionType=1)

## 命令

### `/codefree:task <任务描述>`

将编码任务委派给 codefree。codefree 默认以 `auto-edit` 模式运行——直接应用文件修改无需确认，但在执行 shell 命令前仍会请求审批。

```
/codefree:task Add input validation to the createUser function
/codefree:task --yolo Fix all TypeScript errors in src/
/codefree:task --model qwen3-coder-plus Refactor the auth middleware
/codefree:task --background Migrate all API calls to the new client
/codefree:task --resume Continue the previous codefree session
```

**参数标志：**

| 标志                    | 说明                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `--resume`              | 继续最近一次的 codefree 会话（不加此标志则每次新开会话）                     |
| `--yolo` / `-y`         | 跳过所有审批提示（`--approval-mode yolo`）                                   |
| `--model <name>` / `-m` | 覆盖 codefree 使用的模型                                                     |
| `--include-dir <path>`  | 为 codefree 的工作区额外添加目录（可重复使用）                               |
| `--background`          | 在后台运行任务，立即返回任务 ID                                              |
| `--wait`                | 阻塞直到任务完成（可与 `--background` 结合使用，或在 status 命令中单独使用） |
| `--timeout-ms <ms>`     | `--wait` 轮询的超时时间（默认 120 000 ms）                                   |

### `/codefree:status [job-id]`

显示当前仓库中活跃及最近的 codefree 任务。

```
/codefree:status                          # 列出本会话所有任务
/codefree:status task-l3xq8z-9k2m1f      # 查看单个任务详情
/codefree:status task-l3xq8z-9k2m1f --wait --timeout-ms 60000
/codefree:status --all                    # 包含其他会话的任务
```

### `/codefree:result [job-id]`

显示已完成的 codefree 任务的最终输出。

```
/codefree:result                          # 最近一个已完成的任务
/codefree:result task-l3xq8z-9k2m1f
```

### `/codefree:cancel [job-id]`

取消一个活跃的后台 codefree 任务。

```
/codefree:cancel                          # 取消本会话中唯一活跃的任务
/codefree:cancel task-l3xq8z-9k2m1f
```

## 后台模式

对于耗时较长的任务，使用 `--background` 可避免阻塞主 Claude 线程：

```
/codefree:task --background --yolo Add type annotations to all Python files
# → Queued: task-l3xq8z-9k2m1f

/codefree:status
# → 显示排队/运行中任务的列表

/codefree:status task-l3xq8z-9k2m1f --wait
# → 阻塞直到任务完成

/codefree:result task-l3xq8z-9k2m1f
# → 输出已完成任务的完整内容
```

任务状态持久化到 `${CLAUDE_PLUGIN_DATA}/state/<repo-slug>/`，会话重启后仍可查看结果。

## SubAgent

本插件暴露了一个 `codefree:codefree-task` subagent，供其他 agent、skill 或主 Claude 线程直接调用：

```typescript
Agent({
  subagent_type: "codefree:codefree-task",
  prompt: "--background --yolo Add type annotations to all Python files",
});
```

### 由谁决定何时使用 codefree

subagent 本身不内置任何关于"哪类任务适合交给 codefree"的策略，该决策由调用方负责：

- **用户级**：在 `~/.claude/CLAUDE.md` 中添加规则
- **项目级**：在项目的 `CLAUDE.md` 中添加规则
- **Skill 级**：编排型 skill 可以显式调用 `Agent("codefree:codefree-task", ...)`

## 环境变量

| 变量           | 说明                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEFREE_BIN` | 覆盖 codefree 的二进制名称或绝对路径（默认：`codefree`）。在 Windows 上建议使用包含扩展名的绝对路径，例如 `C:\Users\you\AppData\Roaming\npm\codefree.cmd`。 |

## Windows 注意事项

本插件使用显式的二进制解析器，会探测 PATHEXT（`.COM;.EXE;.BAT;.CMD;.PS1`），因此通过 npm 安装的 `.cmd` 包装脚本可被自动找到，无需设置 `CODEFREE_BIN`（除非 codefree 不在 PATH 中）。

当 codefree 解析为 `.cmd` 或 `.bat` 文件时，Node 会通过 `cmd.exe`（`shell: true`）调用它。此时，任务提示词中的 `&`、`|`、`>`、`<`、`^`、`(`、`)`、`%` 和 `!` 可能被 cmd.exe 解释为元字符。Node 的 spawn 引号处理（CVE-2024-27980 修复后）已覆盖常见情况，但包含上述字符与不匹配引号的提示词可能出现意外行为。解决方法：改写提示词措辞，或将 codefree 安装为 `.exe` 以直接 spawn 而不经过 shell。

无论宿主机代码页如何，codefree 的输出均以 UTF-8 捕获。插件在 spawn 后将 `child.stdout`/`child.stderr` 的编码设置为 `utf8`，因此多字节字符（汉字、emoji）即使跨 pipe chunk 分割也能正确还原。

## License

MIT
