# daily-report

根据当天的 git 提交历史生成中文工作日报，每条记录格式为 `- 项目名称-业务模块-工作内容；`。

## 用途

在当前 git 仓库中，按当前用户的 author email 过滤提交记录，自动压缩生成工作日报。适用于：

- 每日下班前总结当天的 git 提交工作
- 只需说"工作日报"、"日报"、"daily report"、"工作总结"即可触发
- 支持多次调用：首次调用生成全天报告，当天再次调用只汇报新增提交（增量模式）

优点：

- **增量缓存**：记录上次报告的 commit hash，下次只处理新增提交，避免重复
- **单用户过滤**：仅汇总 `git config user.email` 匹配的提交，忽略协作者
- **格式校验**：输出经过内置 validator 验证，确保格式合规后才展示

限制：必须在 git 仓库目录内使用。

## 用法

Claude Code 自动触发，无需手动输入命令。也可通过 slash command 直接调用：

```
/daily-report [项目展示名]
```

项目名称可选；未提供时按优先级自动解析：已缓存名称 → git remote URL slug → 当前目录名。

**输出示例**（stdout）：

```
- MyProject-用户模块-完成登录、注册功能；
- MyProject-API模块-修复接口鉴权BUG；
- MyProject-重构认证流程并补充测试；
```

**开发者模式**——直接调用脚本：

```bash
# 解析脚本安装路径
node scripts/cache.mjs resolve

# 查询/写入项目名缓存
node scripts/cache.mjs read /path/to/repo
node scripts/cache.mjs write /path/to/repo "项目名称"

# 查询/写入 commit 缓存
node scripts/cache.mjs read-commit /path/to/repo
node scripts/cache.mjs write-commit /path/to/repo <sha>

# 手动验证报告格式
echo "- MyProject-完成功能；" | node scripts/validate.mjs

# 手动测试剪贴板复制
echo "- MyProject-完成功能；" | node scripts/clipboard.mjs
```

## 自动复制到剪贴板

报告通过格式校验后，自动复制到系统剪贴板，并在输出末尾追加一行状态提示：

```
- MyProject-用户模块-完成登录、注册功能；
- MyProject-API模块-修复接口鉴权BUG；
（已复制到剪贴板）
```

如果剪贴板工具不可用，会显示失败原因并提示手动复制，**报告仍正常输出**：

```
- MyProject-用户模块-完成登录、注册功能；
（剪贴板复制失败：no-tool-found，请手动复制）
```

**平台支持**：

| 平台          | 所需命令                           | 安装方式          |
| ------------- | ---------------------------------- | ----------------- |
| macOS         | `pbcopy`                           | 系统自带          |
| Windows 10+   | `clip`                             | 系统自带          |
| WSL           | `clip.exe`（首选）→ Linux 工具兜底 | 系统自带          |
| Linux Wayland | `wl-copy`                          | `wl-clipboard` 包 |
| Linux X11     | `xclip` 或 `xsel`                  | 同名包            |

**退出码**：

- `validate.mjs` 退出 0 = 格式通过；退出 1 = 格式不合规
- `cache.mjs` 退出 1 = 参数缺失或 action 不存在

## 配置

缓存文件存放于 `~/.claude/skills/daily-report/`（可通过 `DAILY_REPORT_CACHE_DIR` 环境变量覆盖）：

| 文件                      | 键类型                 | 值类型          | 作用             |
| ------------------------- | ---------------------- | --------------- | ---------------- |
| `project-name-cache.json` | `realpath(仓库根目录)` | 项目展示名      | 省去每次手动传参 |
| `commit-cache.json`       | `realpath(仓库根目录)` | 上次 commit SHA | 实现增量报告     |

**环境变量**：

- `DAILY_REPORT_CACHE_DIR` — 覆盖缓存目录路径（用于测试或自定义）
- `DAILY_REPORT_NO_CLIPBOARD=1` — 禁用自动剪贴板复制（适用于 CI、无图形界面的 SSH 会话、管道场景）

**常见操作**：

```bash
# 强制重新汇总全天（清除 commit 缓存中的当前仓库条目）
# 手动编辑 ~/.claude/skills/daily-report/commit-cache.json，删除对应 key

# 修正错误的项目名称（二选一）
node scripts/cache.mjs write $(git rev-parse --show-toplevel) "正确的项目名"
# 或直接编辑 project-name-cache.json
```

设置 `DAILY_REPORT_CACHE_DIR`（用于测试或自定义路径）：

```json
{
  "env": {
    "DAILY_REPORT_CACHE_DIR": "/path/to/custom/cache"
  }
}
```

## 示例

**场景一：全新仓库，首次调用（无缓存）**

```
/daily-report MyApp
```

- 从 midnight 开始抓取今天所有提交
- 将 `MyApp` 写入 `project-name-cache.json`
- 生成并校验报告后，将最新 commit hash 写入 `commit-cache.json`

**场景二：当天第二次调用（增量模式）**

```
/daily-report
```

- 从上次报告的 commit hash 开始，只处理新增提交
- 若无新提交，提示"暂无新提交"并退出

**场景三：包含跨分支提交（`--all`）**

feature 分支上有提交，切回 main 分支后调用：

```
/daily-report
```

- `--all` 参数使 git log 遍历所有本地分支，feature 分支的提交也会被纳入报告

## 实现架构

```
daily-report/
├── SKILL.md                 (skill 元数据 + Claude 操作步骤)
├── scripts/
│   ├── cache.mjs            (CLI shim：5 个 action 的命令行入口)
│   ├── validate.mjs         (CLI shim：从 stdin 读取并验证格式)
│   ├── clipboard.mjs        (CLI shim：跨平台剪贴板复制)
│   └── lib/
│       ├── cache.mjs        (纯函数：JSON 读写、路径标准化、脚本路径解析)
│       ├── validator.mjs    (纯函数：正则校验 + 逐行错误定位)
│       └── clipboard.mjs    (纯函数：平台候选项检测 + 复制逻辑)
└── tests/
    ├── cache.test.mjs       (16 用例：loadJson / saveJson / normalizeKey / read-write / resolveScriptsDir)
    ├── validator.test.mjs   (10 用例：happy / edge / error)
    ├── cli.test.mjs         (6 用例：shim 的 stdin 和 argv 接线)
    └── clipboard.test.mjs   (15 用例：平台检测 / 复制逻辑 / CLI shim 集成)
```

**关键设计决策**：

- **realpath 标准化键**：`normalizeKey` 用 `fs.realpathSync` 解析软链接，再 fallback 到 `path.resolve`，避免同一仓库因路径形式不同产生多条缓存记录
- **`_` 前缀键保留**：JSON 中以 `_` 开头的键被 `loadJson` 过滤，保留给未来元数据扩展使用
- **两层路径解析**：SKILL.md 中 `cache.mjs resolve` 优先在当前目录查找，再在 `~/.claude/plugins/cache` 中递归搜索，适配项目级和插件级两种安装方式
- **validator 纯函数化**：`validate(text)` 返回 `string[]`，无 IO 依赖，shim 处理 stdin 和退出码；方便单元测试和 Claude 内联调用

**运行测试**：

```bash
cd skills/daily-report && npm test
```

覆盖 47 个用例：缓存 I/O（16）、格式校验（10）、CLI 接线（6）、剪贴板（15）。

## 限制

- **git-only**：不支持非 git 目录
- **单 author 过滤**：通过 `git config user.email` 识别作者；配置了多个邮箱时可能漏报；bot/co-author 提交不会纳入
- **输出语言固定为 zh-CN**：这是业务要求，非配置项
- **压缩比无强制约束**：40–50% 目标由 Claude 的语言理解能力保证，非代码层面的硬限制
- **`last-report.txt`**：部分安装路径下可能残留该文件（早期调试遗留），可安全手动删除，不影响功能
