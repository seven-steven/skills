# codefree-plugin-cc

A Claude Code plugin that wraps the [codefree](https://github.com/QwenLM/qwen-code) CLI (a qwen-code-based AI coding tool), enabling task delegation from inside a Claude Code session.

Inspired by and structured after [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

## Requirements

- [Claude Code](https://claude.ai/code) installed
- [codefree](https://github.com/QwenLM/qwen-code) CLI installed and authenticated

## Installation

### Local install

```
/plugin marketplace add /path/to/codefree-plugin-cc
/plugin install codefree@codefree-plugin-cc
/reload-plugins
```

### From GitHub (after publishing)

```
/plugin marketplace add seven/codefree-plugin-cc
/plugin install codefree@codefree-plugin-cc
/reload-plugins
```

## Commands

### `/codefree:task <task description>`

Delegates a coding task to codefree. codefree runs in `auto-edit` mode by default — it applies file edits without prompting, but still asks for approval on shell commands and other higher-risk operations.

```
/codefree:task Add input validation to the createUser function
/codefree:task --yolo Fix all TypeScript errors in src/
/codefree:task --model qwen3-coder-plus Refactor the auth middleware
/codefree:task --include-dir ../shared-lib Add shared-lib types to the project
```

**Flags:**

| Flag                    | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `--yolo` / `-y`         | Skip all approval prompts (`--approval-mode yolo`)          |
| `--model <name>` / `-m` | Override the codefree model                                 |
| `--include-dir <path>`  | Add an extra directory to codefree's workspace (repeatable) |

**Environment variable:** set `CODEFREE_BIN` to override the codefree binary path.

## SubAgent

The plugin exposes a `codefree:codefree-task` subagent that other agents, skills, or the main Claude thread can invoke directly — without going through the `/codefree:task` slash command.

### Invocation

```typescript
// from another skill or the main thread
Agent({
  subagent_type: "codefree:codefree-task",
  prompt: "--yolo Add input validation to src/createUser.ts",
});
```

### Three invocation paths

| Path                                      | Trigger                           | Use case                                                    |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `/codefree:task ...`                      | User types the command            | One-off manual delegation                                   |
| `Agent("codefree:codefree-task", ...)`    | Main thread LLM decides           | Programmatic delegation based on project CLAUDE.md strategy |
| Another skill's body calling `Agent(...)` | A higher-level skill orchestrates | codefree as a step in a larger workflow                     |

### Who decides when to use codefree

The subagent is neutral — it does not hard-code any policy about "what tasks are appropriate for codefree". That decision lives with the caller:

- **User-level**: add a rule in `~/.claude/CLAUDE.md` (e.g. "for mechanical refactors, delegate to `codefree:codefree-task`")
- **Project-level**: add a rule in the project's `CLAUDE.md`
- **Skill-level**: an orchestrating skill can explicitly call `Agent("codefree:codefree-task", ...)` as one of its steps

## License

MIT
