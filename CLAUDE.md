# Skills

## CRITICAL

### constitution

- Write skills.md/commands.md in English, Other readme/design documents in Chinese.
- Add sufficient metadata to SKILLs to ensure a good user experience
- Use `/skill-creator` to create or modify skills — never hand-write skill files
- Synchronously update the @.claude-plugin/marketplace.json file when creating or deleting a skill

### Scripts

- Use Node.js scripts whenever possible to make SKILL behavior deterministic
- All Node.js scripts and SKILL.md instructions must be compatible with Linux, macOS, and Windows: use `os.homedir()` instead of `process.env.HOME`, avoid shell-only constructs (HEREDOC, `[ -z ]`, etc.) in cross-platform paths, and guard platform-specific test logic with `process.platform` checks
- Every Node.js script in a skill must have a test suite covering happy path, edge cases, and errors; all tests must pass before the skill ships

### Documents

- Every skill must have its own README.md covering: purpose, usage, configuration (env vars / options), examples, implementation architecture, and limitations
- When implementing or modifying a skill, synchronously update its documentation (README, inline comments, metadata description) to reflect the changes before marking the task complete

## References

- Agent Skills Specification: @<https://agentskills.io/specification>
- ClaudeCodeMarketPlaces: @<https://code.claude.com/docs/zh-CN/plugin-marketplaces>
