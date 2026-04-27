# Skill 设计指南

## 脚本优先原则

Skill 的行为逻辑应放在 Node.js 脚本中，而非依赖 LLM 直接操作文件。

- **好的做法**：`SKILL.md` 通过 `node scripts/foo.mjs "$ARGUMENTS"` 调用脚本，脚本完成所有 I/O 和处理
- **避免的做法**：在 SKILL.md 的 body 里让 Claude 直接读写文件，或用 bash 做复杂逻辑

理由：脚本行为确定、可测、可复现；LLM 直接操作文件可靠性低。

## 数据流设计

优先通过参数和上下文传递数据，避免不必要的磁盘持久化。

- LLM 可以在 skill 之间通过参数传递中间结果
- 只在真正需要跨会话状态（如 job broker）时才持久化到磁盘

## 命令组织

相关命令放在同一 plugin 目录下，用多个 `commands/*.md` 文件组织，而不是分散到多个 skill 目录。

例如 codefree plugin：`task.md`、`status.md`、`result.md`、`cancel.md` 同属一个 plugin。

## 依赖注入替代 Mock

测试复杂的 I/O 操作时，用依赖注入（DI）而非 Mock 库。

```js
// 生产代码：接受可选的实现参数
export function terminateProcessTree(pid, options = {}) {
  const kill = options.killImpl ?? process.kill;
  const runCmd = options.runCommandImpl ?? runCommand;
  // ...
}

// 测试代码：注入 fake 实现
terminateProcessTree(pid, {
  killImpl: (pid, sig) => killed.push({ pid, sig }),
  runCommandImpl: async () => ({ exitStatus: 0 }),
});
```

理由：零依赖、行为透明、与 `node:test` 内置框架无缝配合。

## Subagent 设计原则

Subagent 只做转发，不做判断。

- 由调用方（用户 / CLAUDE.md / 上层 skill）决定何时调用
- Subagent 不判断任务是否适合，不自行决策是否执行
- 使用最轻量的模型（如 `haiku`）降低延迟和成本

## Plugin 元数据

- `commands/` 和 `agents/` 下的 `.md` 文件会被自动扫描，无需在 `plugin.json` 中手动列出
- `description` 字段要准确描述触发场景，尤其是有固定触发词时（如 "研发云"）
