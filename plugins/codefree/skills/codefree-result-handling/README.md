# codefree-result-handling

## 用途

规范 `codefree:codefree-task` subagent 在 codefree 返回后的结果呈现和终止边界。它将**原始结果**与可选的**派生摘要/索引**分层，避免摘要改写或取代 codefree 的证据记录。

## 使用方式

本 skill 的 `user-invocable: false`，**不能由用户直接触发**。

仅由 `codefree:codefree-task` subagent 在 codefree CLI 返回后使用。subagent 先返回原始输出，再按需要补充明确标记的导航性摘要或文件索引，随后执行正向终止协议并将控制权交回调用方。

## 配置

无环境变量。本 skill 仅是 prompt 指令，不包含脚本或运行时配置项。

## 示例

**原始结果优先**：

若 codefree 按顺序输出路径、行号、diff 和“可能仍有竞态条件”的提示，subagent 按原顺序原样呈现。可在原始内容之后增加“文件索引”或为该已有发现加上 severity 标签，但不会移动、改写或省略其路径、行号、diff 或不确定性标记。

**失败**：

若 CLI 返回错误，subagent 返回原始错误输出。缺少 codefree 或认证时，会说明需要安装 codefree 或配置 `CODEFREE_BIN`。随后明确说明本次委派已结束并将控制权交回调用方；不会自行实现、重试或执行额外命令。

**部分完成**：

subagent 保留 codefree 对已完成和未完成事项的原始说明，要求调用方选择下一步，然后结束该次委派。

## 实现架构

本 skill 是纯 prompt skill，不含 Node.js 脚本。`codefree:codefree-task` 将 raw result 作为权威记录；可选派生 summary/index 仅用于导航，并且每一项都必须能追溯到原始结果。severity 只能附加，不能改变原始内容。最后通过正向终止协议结束，而非尝试 fallback 或重试。

对应的 instruction/contract tests 位于 `plugins/codefree/tests/subagent-skills.test.mjs`，验证 raw/derived 分层、顺序与证据保留、severity 附加边界，以及不 fallback、不重试、不自行修改的终止约定。

## 限制

- **仅在 codefree-task subagent 内有效**：命令层直接执行的后台任务不会经过这个 subagent；其 job ID/状态输出由 companion script 提供。
- **不解析或修复 codefree 结果**：skill 不会验证 diff 的正确性、补全代码或解决原始结果中的问题。
- **不自动重试**：后续委派必须由调用方显式决定。
