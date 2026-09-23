# seven-skills

AI 智能体技能集合，用于软件开发辅助。

## 可用技能

<!-- BEGIN_SKILLS_TABLE -->

| 名称           | 描述                                                                                                    | 文档                                       |
| -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `git-commit`   | 通过 `/git-commit` 根据当前相关变更生成 Angular/Conventional Commit 并提交，支持 submodule 先子后父流程 | [README.md](skills/git-commit/README.md)   |
| `daily-report` | 通过 `/daily-report` 从当前用户今日 git 提交生成增量工作日报，支持项目名称缓存与业务模块分组            | [README.md](skills/daily-report/README.md) |
| `web-fetch`    | 需要可审计原始 Markdown、网络回退或代理时，通过 r.jina.ai → markdown.new → defuddle.md 获取 URL 内容    | [README.md](skills/web-fetch/README.md)    |
| `codefree`     | 通过 `/codefree:task` 命令与专用 subagent 将编码任务委派给 codefree-o CLI，以 `--auto` 模式自动批准     | [README.md](plugins/codefree/README.md)    |

<!-- END_SKILLS_TABLE -->

## 安装

### Claude Code（通过插件市场）

首先注册插件市场：

```
/plugin marketplace add seven-steven/skills
```

然后从该市场安装插件：

```
/plugin install git-commit@seven-skills
/plugin install daily-report@seven-skills
/plugin install web-fetch@seven-skills
/plugin install codefree@seven-skills
```

**更新**

技能会随插件更新自动升级：

```
/plugin update git-commit
/plugin update daily-report
/plugin update web-fetch
/plugin update codefree
```

`git-commit` 与 `daily-report` 采用用户显式调用，避免模型在未确认时自动执行提交或日报流程。`web-fetch` 可由模型在需要原始 Markdown、回退链或代理时选择。`codefree` 提供 `/codefree:task` 命令与专用 subagent，将编码任务委派给 codefree-o CLI（以 `--auto` 自动批准模式运行，存在风险，详见[插件 README](plugins/codefree/README.md)的安全边界一节）；若希望用户提到“研发云”时自动路由，请在用户级或项目级 `CLAUDE.md` 中配置该编排策略。

### npx skills

```bash
# 列出仓库中的技能
npx skills add seven-steven/skills --list

# 安装指定技能
npx skills add seven-steven/skills --skill git-commit --skill daily-report

# 安装到指定智能体
npx skills add seven-steven/skills -a claude-code -a opencode

# 非交互式安装（适用于 CI/CD）
npx skills add seven-steven/skills --skill git-commit -g -a claude-code -y

# 安装该仓库的所有技能到所有智能体
npx skills add seven-steven/skills --all

# 安装所有技能到指定智能体
npx skills add seven-steven/skills --skill '*' -a claude-code

# 安装指定技能到所有智能体
npx skills add seven-steven/skills --agent '*' --skill git-commit
```
