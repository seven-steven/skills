# git-commit

将当前 session 的 git 变更转换为规范的 Angular 格式 commit。

## 用途

Claude 读取当前 git 状态、diff 与 submodule 信息，生成 Angular Conventional Commits 格式的 commit message，通过 Node.js 验证脚本校验后执行 `git commit`。适用于：

- 日常开发提交（feat、fix、refactor 等）
- 需要按逻辑拆分成多个原子 commit 的大型变更
- 多行 commit message（subject + body）
- 包含 git submodule 的仓库，且需要先提交 submodule 再提交父仓库

## 用法

Claude 自动触发，无需手动输入命令。也可以直接调用脚本验证或提交 commit message：

```bash
# 验证消息
node scripts/validate.mjs "feat(api): add login endpoint"

# 在当前仓库提交消息
node scripts/commit.mjs "fix(auth): resolve token expiry"

# 在指定仓库目录提交消息，例如 submodule 路径
node scripts/commit.mjs --cwd path/to/submodule "fix(core): update submodule logic"
```

退出码：`0` 合法/提交成功，`1` 格式错误或 git commit 失败，`2` 未提供输入或 `--cwd` 参数不完整。

## 语言策略

skill 会结合当前 Context 推断用户语言倾向，来源包括：

- 当前对话
- 用户消息
- 用户显式指定的语言
- 仓库或系统提供的上下文

推断优先级：

1. 用户显式指定的语言
2. 当前对话的主要语言
3. 最近一次提交请求使用的语言
4. 无法判断时默认英文

生成 commit message 时：

- `type` 和 `scope` 仍保持 Conventional Commits 规定的英文标识
- `subject` 和 `body` 使用推断出的用户语言倾向
- 仅当语言指令互相冲突时，才需要向用户进一步确认

## 校验规则

验证脚本执行严格 Angular Conventional Commits 校验：

| 规则               | 说明                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| **格式**           | 必须是 `<type>(<scope>): <subject>`，scope 可选                                    |
| **type 白名单**    | `feat` `fix` `docs` `style` `refactor` `test` `chore` `perf` `build` `ci` `revert` |
| **subject 长度**   | ≤ 72 字符（含 type、scope、冒号）                                                  |
| **subject 大小写** | 首字母必须小写                                                                     |
| **subject 结尾**   | 不能以 `.` 结尾                                                                    |
| **多行分隔**       | 第 2 行（body 开始前）必须为空行                                                   |
| **禁用 trailer**   | 任何位置禁止 `Co-Authored-By`（大小写不敏感）                                      |

## 示例

**合法**：

```
feat: add user login
fix(auth): resolve token expiry bug
fix(auth): 修复令牌过期处理
refactor(db): extract connection pool helper
```

**非法**：

```
feat add something         # 缺少冒号
Bug: fix crash             # 未知 type（大小写敏感）
feat: Add new feature.     # 首字母大写 + 结尾有句点
feat: <73 chars here...>   # subject 超过 72 字符
```

## Submodule 工作流

当仓库包含 submodule 且 submodule 中存在需要提交的变更时，skill 应遵循以下顺序：

1. 通过 Context 中的 submodule 信息识别受影响的 submodule。
2. 进入每个 submodule 检查局部状态、diff 和最近提交。
3. 只 stage 当前任务相关的 submodule 文件。
4. 先在 submodule 内生成、校验并提交独立的 commit message。
5. 回到父仓库后执行 `git add <submodule-path>`，纳入更新后的 gitlink 指针。
6. 最后提交父仓库变更。

如果存在嵌套 submodule，应按最深层优先处理；如果 submodule 变更与当前任务范围无关，应先询问用户。

## 配置

无环境变量。skill 在 `SKILL.md` frontmatter 中使用 `model: haiku`，以 Haiku 执行提交工作流。`allowed-tools` 限定了脚本运行时所需的 git 和 node 权限：

```
Bash(git add:*), Bash(git status:*), Bash(git diff:*),
Bash(git log:*), Bash(git branch:*), Bash(git commit:*),
Bash(git submodule:*), Bash(git -C:*), Bash(node:*)
```

## 实现架构

```
SKILL.md
├── Context: branch / status / diff / recent commits / submodule status
├── Path Resolution: 使用 skill 加载时显示的 Base directory 定位 scripts/
├── Step 6: node <scripts-dir>/validate.mjs "<msg>"
│   └── scripts/validate.mjs               # CLI 入口（argv / stdin）
│       ├── scripts/lib/input.mjs          # argv / stdin 读取
│       └── scripts/lib/commit-message.mjs
│           ├── normalize(text)            # BOM / CRLF / trailing-newline 清洗
│           ├── parseMessage(text)         # → { subject, body, trailers }
│           ├── validateMessage(text)      # → { ok, errors[], parsed? }
│           └── formatErrorReport(errs)    # 格式化错误列表给 stderr
├── Step 7: node <scripts-dir>/commit.mjs --cwd "<submodule-path>" "<submodule-message>"
└── Step 10: node <scripts-dir>/commit.mjs "<msg>"
    └── scripts/commit.mjs                 # 从 argv 或 stdin 读 message，验证后 git commit -F <tmpfile>
        ├── scripts/lib/input.mjs          # argv / stdin 读取
        └── scripts/lib/commit-message.mjs # 复用同一校验函数，不重复实现
```

验证流程：

1. SKILL.md 从加载结果里的 `Base directory for this skill` 定位同一份 `scripts/`
2. 读取普通仓库状态以及 submodule 状态
3. `validate.mjs` 读取消息（argv 或 stdin）
4. 调用 `validateMessage`，返回 `{ ok, errors }`
5. 合法 → exit 0；非法 → 输出错误到 stderr，exit 1
6. SKILL.md 读取 stderr 修订消息后重试，最多 3 次
7. 如果存在 submodule 变更，先调用 `commit.mjs --cwd <submodule-path>` 提交 submodule
8. 回到父仓库 stage submodule path，随后由 `commit.mjs` 在父仓库提交

## 测试

```bash
cd skills/git-commit && npm test
```

测试覆盖：`commit-message` 解析与校验、`validate-cli` 退出码、`commit-cli` 普通提交流程、`commit-cli --cwd` 指定仓库提交流程，以及 `SKILL.md` 的路径解析、语言策略与 submodule 工作流指令。

## 限制

- 语言倾向来自 Context 推断，显式语言指令优先；如果上下文不足，默认回退到英文
- 只校验 commit message 的格式，不做语义判断（subject 是否准确描述变更）
- subject 大小写规则仅检测首字符是否为 ASCII 大写，不处理 Unicode 特殊字符
- 不接管 staging 决策：由 SKILL 指令和 Claude 判断哪些文件应该 stage
- 不自动提交与当前任务无关的 submodule 变更；遇到范围不清晰或冲突时需要先询问用户
- 复杂嵌套 submodule 依赖指令按 deepest-first 执行，极端冲突场景仍需人工介入
- TLS-over-tunnel 等场景不适用（本 skill 不涉及网络）
