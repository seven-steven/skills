# git-commit

将当前 session 的 git 变更转换为规范的 Angular 格式 commit。

## 用途

Claude 读取当前 git 状态与 diff，生成 Angular Conventional Commits 格式的 commit message，通过 Node.js 验证脚本校验后执行 `git commit`。适用于：

- 日常开发提交（feat、fix、refactor 等）
- 需要按逻辑拆分成多个原子 commit 的大型变更
- 多行 commit message（subject + body）

## 用法

Claude 自动触发，无需手动输入命令。也可以直接调用脚本验证或提交 commit message：

```bash
# 验证消息
node scripts/validate.mjs "feat(api): add login endpoint"

# 提交消息
node scripts/commit.mjs "fix(auth): resolve token expiry"
```

退出码：`0` 合法/提交成功，`1` 格式错误或 git commit 失败，`2` 未提供输入。

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
refactor(db): extract connection pool helper
```

**非法**：

```
feat add something         # 缺少冒号
Bug: fix crash             # 未知 type（大小写敏感）
feat: Add new feature.     # 首字母大写 + 结尾有句点
feat: <73 chars here...>   # subject 超过 72 字符
```

## 配置

无环境变量。`allowed-tools` 限定了脚本运行时所需的 git 和 node 权限：

```
Bash(git add:*), Bash(git status:*), Bash(git diff:*),
Bash(git log:*), Bash(git branch:*), Bash(git commit:*),
Bash(node:*)
```

## 实现架构

```
SKILL.md
├── Path Resolution: 使用 skill 加载时显示的 Base directory 定位 scripts/
├── Step 4: node <scripts-dir>/validate.mjs "<msg>"
│   └── scripts/validate.mjs              # CLI 入口（argv / stdin）
│       ├── scripts/lib/input.mjs          # argv / stdin 读取
│       └── scripts/lib/commit-message.mjs
│           ├── normalize(text)           # BOM / CRLF / trailing-newline 清洗
│           ├── parseMessage(text)        # → { subject, body, trailers }
│           ├── validateMessage(text)     # → { ok, errors[], parsed? }
│           └── formatErrorReport(errs)  # 格式化错误列表给 stderr
└── Step 5: node <scripts-dir>/commit.mjs "<msg>"
    └── scripts/commit.mjs               # 从 argv 或 stdin 读 message，验证后 git commit -F <tmpfile>
        ├── scripts/lib/input.mjs         # argv / stdin 读取
        └── scripts/lib/commit-message.mjs  # 复用同一校验函数，不重复实现
```

验证流程：

1. SKILL.md 从加载结果里的 `Base directory for this skill` 定位同一份 `scripts/`
2. `validate.mjs` 读取消息（argv 或 stdin）
3. 调用 `validateMessage`，返回 `{ ok, errors }`
4. 合法 → exit 0；非法 → 输出错误到 stderr，exit 1
5. SKILL.md 读取 stderr 修订消息后重试，最多 3 次
6. 消息通过校验后，`commit.mjs` 从 argv 或 stdin 读取同一消息，写入临时文件，执行 `git commit -F <tmpfile>`，完成后删除临时文件

## 测试

```bash
cd skills/git-commit && npm test
```

覆盖 43 个用例：`commit-message` 解析与校验（28）、`validate-cli` 退出码（6）、`commit-cli`（7）、`SKILL.md` 路径解析与命令形态（2）。

## 限制

- 只校验 commit message 的格式，不做语义判断（subject 是否准确描述变更）
- subject 大小写规则仅检测首字符是否为 ASCII 大写，不处理 Unicode 特殊字符
- 不接管 staging 决策：由 SKILL 指令和 Claude 判断哪些文件应该 stage
- TLS-over-tunnel 等场景不适用（本 skill 不涉及网络）
