# git-commit

`/git-commit` 将当前任务相关的 Git 变更提交为规范的 Angular Conventional Commit。它先用轻量 Git 状态判断范围，只在需要时读取 diff、历史或 submodule 细节，然后通过 Node.js helper 解析任务 ID、校验并执行提交。

## 用途

适用于以下场景：

- 显式调用 `/git-commit`
- 要求“提交代码”“提交变更”“git commit”或“commit changes”
- 需要从当前任务的变更生成 Conventional Commit message
- 需要将 submodule 的变更先提交，再提交父仓库 gitlink 更新

Skill 只会暂存与当前任务相关的文件；范围无法判断时会先询问，不会把无关改动一并提交。

## 使用方式

在 Claude Code 中直接输入：

```text
/git-commit
```

可选参数是显式任务 ID，会替换（而非追加到 subject）最终消息的任务 ID footer：

```text
/git-commit project-101
```

`project-101`、`%project-101` 和 `101` 分别会规范化为 `%project-101`、`%project-101` 和 `%101`。显式 ID 无效时流程会停止并要求更正，不会回退到自动发现。

也可独立调用 helper：

```bash
# 解析显式或自动发现的任务 ID
node scripts/task-id.mjs project-101
node scripts/task-id.mjs

# 使用任务 ID 校验消息
node scripts/validate.mjs --task-id "%project-101" "feat(api): add login endpoint"

# 在当前仓库提交
node scripts/commit.mjs --task-id "%project-101" "fix(auth): resolve token expiry"

# 在指定仓库目录提交，例如 submodule
node scripts/commit.mjs --cwd path/to/submodule --task-id "%project-101" "fix(core): update submodule logic"
```

显式任务 ID 必须合法；无效或参数格式错误会以退出码 `2` 失败。未提供 ID 时，`task-id.mjs` 在目标仓库读取 `user.email`，并仅扫描当前 `HEAD` 可达、该作者最近十条提交。没有可用 ID 或自动查询失败均视为 optional 流程：输出空值并以退出码 `0` 继续，不添加任务 ID footer。

只要解析出 ID，`validate.mjs` 和 `commit.mjs` 都接收同一个 `--task-id`；选项可以和 `--cwd` 以任意顺序组合。helper 只补充或替换独立的 `<footer>`，不修改 subject 或 body。若消息含 `Refs:`、`Fixes:` 等 Git trailers，它们位于 `<footer>` 之前：

```text
- srdcloud task id: %project-101
```

已有任务 ID footer 会被替换为这一条，避免重复。

## 工作流

### 初始上下文与按需读取

`/git-commit` 初始只读取当前分支和简短状态：

```text
git branch --show-current
git status --short --branch
```

随后结合当前 session 和用户任务识别候选改动。仅在必要时才读取额外信息：

- 无法确认范围或无法准确生成消息时，读取 `git diff HEAD`
- 无法确定语言偏好或需要参考本地提交惯例时，读取 `git log --oneline -10`
- 状态显示 submodule 改动或任务涉及 submodule 时，读取 submodule 状态和工作树详情

这可避免为普通提交预先加载无关 diff、日志与递归 submodule 信息。

### 任务 ID 解析与 footer

在暂存和生成消息前，skill 只解析一次任务 ID，并将该结果复用于所有受影响的 submodule 及父仓库。

1. `/git-commit <task-id>` 的可选参数优先级最高，作为显式任务 ID。
2. 未提供参数时，`task-id.mjs` 从当前主仓库的 `user.email` 获取作者邮箱，并扫描当前 `HEAD` 可达的该作者最近十条提交。
3. 解析结果统一为恰好一个前导 `%`。例如 `project-101` 与 `%project-101` 均为 `%project-101`，`101` 为 `%101`。
4. 自动查询没有结果或发生失败时不阻断提交，直接跳过 footer；显式无效 ID 则停止并要求用户提供有效值，绝不自动回退。
5. 有效 ID 只写入/替换独立的 `<footer>`，不追加到 subject，也不改写正文。`Refs:`、`Fixes:` 等 trailers 保持在它之前，task ID 是整个消息的最后一个非空行：

   ```text
   - srdcloud task id: %project-101
   ```

### 暂存与提交

1. 只用 `git add ...` 暂存当前任务相关文件；范围不清时询问用户。
2. 大型变更按单一、连贯目的拆分为原子 commit。
3. 根据语言策略生成 `<type>(<scope>): <subject>` 消息；必要时增加空行分隔的 body 和 Git trailers。任务 ID 仅写入独立 `<footer>`。
4. 每条消息均以同一个已解析值调用 `validate.mjs --task-id` 校验。失败时读取 stderr、修改后重试，最多三次；第三次失败后询问用户。
5. 用同一个 `--task-id` 调用 `commit.mjs` 提交已暂存的改动；无 ID 时两个 helper 都省略该选项。
6. 最终报告提交 hash（含 submodule hash）以及未暂存或未纳入的相关改动。

### 语言策略

消息自然语言部分的优先级如下：

1. 用户显式指定的语言
2. 当前对话的主要语言
3. 最近一次提交请求使用的语言
4. 无法判断时使用英文

`type` 与 `scope` 始终保持 Conventional Commits 的英文 token；`subject` 和 `body` 使用推断语言。除非语言指令冲突，否则不会只为确认语言而打断流程。

### Submodule 工作流

仅当状态或任务表明 submodule 受影响时才检查其详细信息。对需要提交的 submodule：

1. 按需检查局部状态、diff 和提交历史。
2. 仅暂存当前任务相关文件；嵌套 submodule 按 deepest-first 顺序处理。
3. 先在 submodule 内通过同一个已解析的 `commit.mjs --cwd ... --task-id ...` 提交；未解析到 ID 时省略 `--task-id`。
4. 回到其父仓库后执行 `git add <submodule-path>`，将 gitlink 更新纳入父级提交。
5. 最后以相同的已解析 ID（或不带该选项）提交父仓库。

不提交与当前任务无关的 submodule 改动；范围不明确时会询问用户。

## 校验规则

`validate.mjs` 与 `commit.mjs` 都执行严格校验：

| 规则           | 说明                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| 格式           | `<type>(<scope>): <subject>`，scope 可选                                                     |
| type 白名单    | `feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`perf`、`build`、`ci`、`revert` |
| subject 长度   | 含 type、scope、冒号在内不超过 72 字符                                                       |
| subject 大小写 | 首字符不能是 ASCII 大写字母                                                                  |
| subject 结尾   | 不能以 `.` 结尾                                                                              |
| 多行分隔       | body 前第二行必须为空行                                                                      |
| trailer        | 禁止任何位置出现 `Co-Authored-By`，不区分大小写                                              |

合法示例：

```text
feat: add user login
fix(auth): resolve token expiry bug
fix(auth): 修复令牌过期处理
```

## 配置

不需要环境变量。SKILL frontmatter 保留以下行为：

- `model: haiku`：使用 Haiku 执行提交工作流
- `disable-model-invocation: true`：避免模型自动调用；用户应显式使用 `/git-commit`
- `allowed-tools`：限制为所需 Git 与 Node.js 命令

## 实现架构

```text
SKILL.md
├── 轻量初始上下文：branch + short status
├── 按需读取：diff / log / submodule details
├── 从 Base directory for this skill 定位 scripts/
├── scripts/task-id.mjs
│   ├── 显式任务 ID 校验与 `%` 规范化
│   └── 通过主仓库 user.email 扫描 HEAD 可达的最近十条作者提交
├── scripts/validate.mjs
│   ├── 接收可选 --task-id 并生成独立末尾 <footer>
│   ├── scripts/lib/input.mjs
│   └── scripts/lib/commit-message.mjs 解析 subject / body / trailers / footer
└── scripts/commit.mjs
    ├── 复用同一校验与 footer 规则
    ├── 支持 --cwd <submodule-path> 和可选 --task-id
    └── 以临时文件传给 git commit -F
```

脚本路径始终从 Skill 加载时提供的 `Base directory for this skill` 解析，不会按文件名搜索插件缓存，以避免使用过期或不完整的 helper。

## 测试

```bash
cd skills/git-commit
npm test
```

测试覆盖任务 ID 规范化与历史解析、footer 的替换和幂等性、message 解析和校验、validate CLI、commit helper 的当前仓库及 `--cwd` / `--task-id` 流程，以及 `SKILL.md` 的 metadata、按需读取、路径解析、语言优先级、submodule deepest-first、三次校验限制和最终报告指令。

## 限制

- 消息校验只检查格式，不判断 subject 是否准确概括改动。
- subject 大小写规则仅检查 ASCII 大写首字符，不处理 Unicode 特殊大小写。
- Skill 不会猜测不明确的暂存范围，也不会自动纳入无关变更。
- 复杂嵌套 submodule 或冲突仍可能需要人工决策。
