# seven-skills

A collection of AI agent skills for software development.

## Skills Library

### Git

**git-commit** — Create git commits with Angular-style commit messages from staged changes

### Reporting

**daily-report** — Generate daily work report from today's git commit history (supports project name caching and business module grouping)

## Installation

### Claude Code (via Plugin Marketplace)

Register the marketplace first:

```
/plugin marketplace add seven-steven/skills
```

Then install plugins from this marketplace:

```
/plugin install git-commit@seven-skills
/plugin install daily-report@seven-skills
```

**Updating**

Skills update automatically when you update the plugin:

```
/plugin update git-commit
/plugin update daily-report
```

### npx skills

```bash
# List skills in this repository
npx skills add seven-steven/skills --list

# Install specific skills
npx skills add seven-steven/skills --skill git-commit --skill daily-report

# Install to specific agents
npx skills add seven-steven/skills -a claude-code -a opencode

# Non-interactive installation (CI/CD friendly)
npx skills add seven-steven/skills --skill git-commit -g -a claude-code -y

# Install all skills from this repo to all agents
npx skills add seven-steven/skills --all

# Install all skills to specific agents
npx skills add seven-steven/skills --skill '*' -a claude-code

# Install specific skills to all agents
npx skills add seven-steven/skills --agent '*' --skill git-commit
```
