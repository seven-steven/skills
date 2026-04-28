# seven-skills

AI 智能体技能集合，用于软件开发辅助。

## 技能库

### Git

**git-commit** — 根据暂存的变更生成 Angular 风格的 git commit 消息并提交

### 报告

**daily-report** — 从今日 git 提交历史生成工作日报（支持项目名称缓存与业务模块分组）

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
```

**更新**

技能会随插件更新自动升级：

```
/plugin update git-commit
/plugin update daily-report
```

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
