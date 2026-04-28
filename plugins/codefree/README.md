# codefree-plugin-cc

A Claude Code plugin that wraps the [codefree-cli](https://www.srdcloud.cn/helpcenter/content?id=1443287380026744832&versionType=1) CLI (a qwen-code-based AI coding tool), enabling task delegation from inside a Claude Code session.

Inspired by and structured after [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

## Requirements

- [Claude Code](https://claude.ai/code) installed
- [codefree-cli](https://www.srdcloud.cn/helpcenter/content?id=1443287380026744832&versionType=1) CLI installed and authenticated

## Commands

### `/codefree:task <task description>`

Delegates a coding task to codefree. codefree runs in `auto-edit` mode by default — it applies file edits without prompting, but still asks for approval on shell commands.

```
/codefree:task Add input validation to the createUser function
/codefree:task --yolo Fix all TypeScript errors in src/
/codefree:task --model qwen3-coder-plus Refactor the auth middleware
/codefree:task --background Migrate all API calls to the new client
/codefree:task --resume Continue the previous codefree session
```

**Flags:**

| Flag                    | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `--resume`              | Continue the most recent codefree session (omit to always start a fresh session)     |
| `--yolo` / `-y`         | Skip all approval prompts (`--approval-mode yolo`)                                   |
| `--model <name>` / `-m` | Override the codefree model                                                          |
| `--include-dir <path>`  | Add an extra directory to codefree's workspace (repeatable)                          |
| `--background`          | Run the task in the background and return a job ID immediately                       |
| `--wait`                | Block until the job finishes (can be combined with `--background` or used in status) |
| `--timeout-ms <ms>`     | Timeout for `--wait` polling (default 120 000 ms)                                    |

### `/codefree:status [job-id]`

Show active and recent codefree jobs for the current repository.

```
/codefree:status                          # list all jobs this session
/codefree:status task-l3xq8z-9k2m1f      # detailed view of one job
/codefree:status task-l3xq8z-9k2m1f --wait --timeout-ms 60000
/codefree:status --all                    # include jobs from other sessions
```

### `/codefree:result [job-id]`

Show the stored final output for a finished codefree job.

```
/codefree:result                          # latest finished job
/codefree:result task-l3xq8z-9k2m1f
```

### `/codefree:cancel [job-id]`

Cancel an active background codefree job.

```
/codefree:cancel                          # cancel the only active job this session
/codefree:cancel task-l3xq8z-9k2m1f
```

## Background mode

For long-running tasks, use `--background` to avoid blocking the main Claude thread:

```
/codefree:task --background --yolo Add type annotations to all Python files
# → Queued: task-l3xq8z-9k2m1f

/codefree:status
# → table showing queued/running jobs

/codefree:status task-l3xq8z-9k2m1f --wait
# → blocks until done

/codefree:result task-l3xq8z-9k2m1f
# → full output of the completed task
```

Jobs are persisted to `${CLAUDE_PLUGIN_DATA}/state/<repo-slug>/` so results survive session restarts.

## SubAgent

The plugin exposes a `codefree:codefree-task` subagent that other agents, skills, or the main Claude thread can invoke directly:

```typescript
Agent({
  subagent_type: "codefree:codefree-task",
  prompt: "--background --yolo Add type annotations to all Python files",
});
```

### Who decides when to use codefree

The subagent is neutral — it does not hard-code any policy about what tasks are appropriate for codefree. That decision lives with the caller:

- **User-level**: add a rule in `~/.claude/CLAUDE.md`
- **Project-level**: add a rule in the project's `CLAUDE.md`
- **Skill-level**: an orchestrating skill can explicitly call `Agent("codefree:codefree-task", ...)`

## Environment

| Variable       | Description                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEFREE_BIN` | Override the codefree binary name or absolute path (default: `codefree`). On Windows, prefer an absolute path including extension, e.g. `C:\Users\you\AppData\Roaming\npm\codefree.cmd`. |

## Windows notes

The plugin uses an explicit binary resolver that probes PATHEXT (`.COM;.EXE;.BAT;.CMD;.PS1`) so npm-installed `.cmd` shims are found automatically. You do not need to set `CODEFREE_BIN` unless codefree lives outside your PATH.

When codefree resolves to a `.cmd` or `.bat` file, Node invokes it through `cmd.exe` (`shell: true`). In that case, `&`, `|`, `>`, `<`, `^`, `(`, `)`, `%`, and `!` in the task prompt may be interpreted as cmd.exe metacharacters. Node's spawn quoting (post-CVE-2024-27980) handles the common cases, but prompts mixing these characters with unbalanced quotes may behave unexpectedly. Workaround: rephrase the prompt, or install codefree as an `.exe` so it is spawned directly without a shell.

Output from codefree is captured as UTF-8 regardless of the host code page. The plugin sets `child.stdout`/`child.stderr` encoding to `utf8` after spawn, so multi-byte (CJK, emoji) output is reconstructed correctly even when split across pipe chunks.

## License

MIT
