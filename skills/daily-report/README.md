# daily-report

`daily-report` 用于在 Git 仓库中生成中文工作日报。需要生成日报时应**显式调用**：`/daily-report [项目展示名]`；也可以在任务中明确要求 Claude 调用 `/daily-report`，而不是只询问生成方法。

它会读取当天、当前 Git 身份的提交，输出格式化且已校验的中文条目；同一天的后续调用只汇总此前日报未包含的提交。技能保留 `disable-model-invocation: true`，因此需要用户或上层流程显式调用。

## 用途

适用于：

- 下班前从当天 Git 提交整理工作日报；
- 当天再次提交后，仅补充新增工作；
- 希望按照固定格式输出并尝试复制到系统剪贴板。

不适用于非 Git 目录、没有配置 `git config user.email` 的目录，或需要汇总其他作者提交的场景。

## 使用方法

在目标仓库内调用：

```text
/daily-report
/daily-report MyProject
```

项目展示名是可选参数。未传入时，按以下优先级确定：项目名缓存、`origin` 远程地址的仓库名、仓库根目录名称。传入参数会更新该仓库的项目名缓存。

技能加载时以 `SKILL.md` 所在目录作为 Base directory，并使用其中的 `scripts/` 绝对路径调用脚本；不依赖当前工作目录中的相对脚本路径。

## 输出与完成状态

通过校验的报告每行必须是以下之一：

```text
- 项目名称-工作内容；
- 项目名称-业务模块-工作内容；
```

示例：

```text
- MyProject-用户模块-完成登录和注册功能；
- MyProject-接口模块-修复鉴权问题并补充测试；
（已复制到剪贴板）
```

调用只会落入以下一种互斥状态：

1. **无新增提交**：输出 `暂无新提交，无需生成日报。`，不做校验、剪贴板复制或提交缓存推进。
2. **校验失败**：说明校验失败后停止；不会复制或推进提交缓存。
3. **已生成报告**：先完成格式校验，再尝试剪贴板复制，最后写入已汇报的 commit ID 缓存。复制失败不会阻止报告和缓存推进；但缓存写入失败会明确提示，不能声称增量状态已保存。

缓存推进在校验成功之后，且发生在剪贴板尝试之后。这个顺序避免无提交或不合规内容被错误标记为已汇报，同时确保已成功生成的报告不会因剪贴板不可用而重复出现。

## 增量与 `--all` 语义

`commits.mjs` 使用：

```text
git log --since=midnight --all --author=<user.email>
```

它输出完整 SHA 与提交标题，再排除当天已经记录的 SHA。不能使用简单的 `<cached-sha>..HEAD` 作为 `--all` 的增量范围：`HEAD` 不包含其他分支独有的提交，且一个 SHA 不能代表已处理的全部分支前沿，都会导致漏报或重复。为此，`commit-cache.json` 中每个仓库保存当天已汇报的完整 SHA 集合；次日会自动开始新的集合。

早期仅保存单个 SHA 的缓存仍可被读取为已汇报项，首次成功写入会迁移为日期加 ID 集合的结构。若要强制在当天重新汇总，删除对应仓库的 `commit-cache.json` 条目。

## 配置

| 配置                          | 说明                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `DAILY_REPORT_CACHE_DIR`      | 覆盖默认缓存目录。默认是 `~/.claude/skills/daily-report/`。 |
| `DAILY_REPORT_NO_CLIPBOARD=1` | 跳过剪贴板复制，适合 CI、SSH 或无图形界面环境。             |

缓存文件：

| 文件                      | 内容                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `project-name-cache.json` | `realpath(仓库根目录)` 到项目展示名的映射。                |
| `commit-cache.json`       | `realpath(仓库根目录)` 到当天已汇报 commit ID 集合的映射。 |

## 开发者脚本

从技能安装目录调用脚本。下面的 `<scripts-dir>` 是 `SKILL.md` 同级 `scripts` 目录的绝对路径。

```text
node <scripts-dir>/commits.mjs <repo-root> <user-email>
node <scripts-dir>/cache.mjs read <repo-root>
node <scripts-dir>/cache.mjs write <repo-root> <project-name>
node <scripts-dir>/cache.mjs read-reported <repo-root>
node <scripts-dir>/cache.mjs write-reported <repo-root> '["<full-sha>"]'
node <scripts-dir>/validate.mjs <report-file>
node <scripts-dir>/clipboard.mjs <report-file>
```

`commits.mjs` 每行输出 `完整SHA<TAB>提交标题`。`validate.mjs` 成功时退出码为 0，格式错误时退出码为 1。`clipboard.mjs` 无论复制工具失败与否都使用退出码 0，通过 stdout/stderr 表示结果，避免复制问题掩盖已生成的日报。

## 实现架构

```text
daily-report/
├── SKILL.md
├── README.md
├── scripts/
│   ├── commits.mjs          # 查询当天 --all 提交并按已汇报 ID 过滤
│   ├── cache.mjs            # 项目名与已汇报 ID 缓存的 CLI 入口
│   ├── validate.mjs         # 读取文件或 stdin，校验日报格式
│   ├── clipboard.mjs        # 跨平台复制入口
│   └── lib/
│       ├── cache.mjs        # JSON 缓存、路径规范化与日期范围的 ID 集合
│       ├── validator.mjs    # 纯格式校验函数
│       └── clipboard.mjs    # 平台剪贴板候选与复制函数
└── tests/
    ├── cache.test.mjs
    ├── commits.test.mjs
    ├── cli.test.mjs
    ├── validator.test.mjs
    └── clipboard.test.mjs
```

Node 脚本使用 `node:` 标准库并以 `os.homedir()` 获得默认目录，兼容 Linux、macOS 与 Windows。测试覆盖正常路径、边界条件与错误路径。

## 运行测试

```text
cd skills/daily-report
npm test
```

## 限制

- 只按 `git config user.email` 过滤作者。多邮箱、bot 或仅 co-author 的工作可能不被纳入。
- 只汇总本地可见的、从当天本地午夜起的提交；远端未拉取的分支不可见。
- 工作内容压缩和模块归类由模型生成，格式由脚本校验，但语义准确性仍应由调用者审阅。
- 剪贴板依赖系统工具：macOS 的 `pbcopy`、Windows 的 `clip`、Wayland 的 `wl-copy`、X11 的 `xclip`/`xsel`；不可用时日报仍会输出。
