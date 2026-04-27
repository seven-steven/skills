# Skills

## Constitution

- [CRITICAL] Write SKILLs in English
- [CRITICAL] Add sufficient metadata to SKILLs to ensure a good user experience
- [CRITICAL] Synchronously update the @.claude-plugin/marketplace.json file when creating or deleting a skill
- [CRITICAL] Use `/skill-creator` to create or modify skills — never hand-write skill files
- [CRITICAL] Every skill must have its own README.md covering: purpose, usage, configuration (env vars / options), examples, implementation architecture, and limitations
- [CRITICAL] Every Node.js script in a skill must have a test suite covering happy path, edge cases, and errors; all tests must pass before the skill ships
- [CRITICAL] When implementing or modifying a skill, synchronously update its documentation (README, inline comments, metadata description) to reflect the changes before marking the task complete
- [SHOULD] Use Node.js scripts whenever possible to make SKILL behavior deterministic

## References

- Agent Skills Specification: @https://agentskills.io/specification
- ClaudeCodeMarketPlaces: @https://code.claude.com/docs/zh-CN/plugin-marketplaces
