# codefree-result-handling

## 用途

规范 `codefree:codefree-task` subagent 在任务完成后的输出呈现方式与失败处理边界。

codefree 的输出可能包含文件差异、行号、错误日志、假设标注等多种格式。本 skill 确保这些信息被如实呈现（不被裁剪或重新解释），并在失败或部分成功时给出明确的停止信号，防止 subagent 越权"修复"本应汇报的问题。

## 使用方式

本 skill 的 `user-invocable: false`，**不能由用户直接触发**。

仅由 `codefree:codefree-task` subagent 在处理 codefree 输出阶段调用。subagent 执行完 codefree CLI 后，依据本 skill 的指令决定如何呈现结果、何时停止、如何汇报错误。

## 配置

无环境变量。本 skill 仅是 prompt 指令，不包含脚本，无任何运行时配置项。

## 示例

**正常完成**（codefree 成功修改文件）：

subagent 按本 skill 规则，列出 codefree 修改过的文件列表，原样输出 diff 或报告内容，然后**停止**，不做额外修改或跟进操作。

**失败**（codefree CLI 报错退出）：

subagent 从 stderr 中提取最具可操作性的若干行，向用户汇报失败原因，**不自行实现该任务作为 fallback**。示例输出：

```
codefree 任务失败：
  - Error: codefree binary not found. Please install codefree or set CODEFREE_BIN.
请安装 codefree 或通过 CODEFREE_BIN 环境变量指定二进制路径。
```

**部分成功**（codefree 完成了部分工作后退出）：

subagent 说明已完成的内容与未完成的内容，让调用方决定下一步，不擅自追加操作。

## 实现架构

本 skill 不包含任何 Node.js 脚本，是纯 prompt 形式的 skill。

`codefree:codefree-task` subagent 在呈现 codefree 输出时加载本 skill（`codefree-result-handling`）的 SKILL.md 指令作为上下文。subagent 遵循 SKILL.md 中的输出规则：保留原始结构、按严重程度排序发现项、保留不确定性标注、在最终输出后显式停止。这些规则共同构成 subagent 的"输出阶段协议"。

## 限制

- **仅在 codefree-task subagent 内有效**：在其他上下文中加载此 skill 不会产生预期效果。
- **不自动重试**：失败时本 skill 指示 subagent 停止并汇报，不触发自动重试逻辑；重试由调用方决定。
- **不解析 codefree 内部格式**：本 skill 依赖 codefree 以标准 stdout/stderr 方式输出，对 codefree 内部协议的变更不具备鲁棒性。
