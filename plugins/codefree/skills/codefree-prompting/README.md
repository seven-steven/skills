# codefree-prompting

## 用途

将传给 `codefree:codefree-task` 的用户任务忠实整理为可转发给 codefree 的 prompt。完成标准是**不丢失用户目标**：本 skill 只澄清已知信息，绝不把猜测当作任务要求。

## 使用方式

本 skill 的 `user-invocable: false`，**不能由用户直接触发**。

仅由 `codefree:codefree-task` subagent 在转发任务前使用。它在移除命令标志后按如下规则处理任务：

- 具体且边界明确的任务最小透传，不额外套 XML、补路径或添加验收步骤。
- 可以在一次有序执行中完成的复合任务，保留全部目标及其顺序；不会只挑“主要目标”。
- 任务有冲突，或安全执行所需的范围未知时，向调用方说明具体歧义并请求澄清；不会猜测文件、排除项或偏好的实现方案。
- `<scope>`、`<output_contract>`、`<constraints>` 只转述调用方明确给出的内容；没有依据的块会省略。

## 配置

无环境变量。本 skill 仅包含 prompt 指令，没有脚本或运行时配置。

## 示例

**最小透传**（任务已具体且有边界）：

> 用户：`/codefree:task Fix all TypeScript errors in src/components/Button.tsx`

subagent 移除命令标志后，原样转发 `Fix all TypeScript errors in src/components/Button.tsx`。

**保留串行复合目标**：

> 用户：先迁移 `src/api/` 到新客户端，再更新对应测试，最后运行 `npm test`。

subagent 可用 `<task>` 按原顺序列出这三个目标，但不会删去测试或验证步骤，也不会自行增加限制。

**请求澄清**（范围不足）：

> 用户：帮我优化一下代码。

subagent 不会捏造 `src/api/user.ts`、函数名或测试命令，而是请求调用方指定要优化的目录/文件和期望结果。收到澄清前不会调用 codefree。

**忠实转述约束**：

> 用户：只修改 `src/api/user.ts`，不要安装依赖；修改后运行 `npm test`。

subagent 可将这三项分别放入 `<scope>`、`<constraints>` 和 `<output_contract>`，不附加其他未说明的约束。

## 实现架构

本 skill 是纯 prompt skill，不含 Node.js 脚本。`codefree:codefree-task` 在执行其唯一一次 companion-script 调用前加载本 skill。它仅进行任务保真检查、必要时请求调用方澄清，或用中性的 XML 结构重述已有信息；不会读取仓库或制定解决方案。

对应的 instruction/contract tests 位于 `plugins/codefree/tests/subagent-skills.test.mjs`，验证元数据、最小透传、复合目标、澄清边界和约束保真要求。

## 限制

- **仅在 codefree-task subagent 内有效**：其他上下文加载不会形成该 subagent 的转发边界。
- **不解决范围歧义**：它会把歧义返还给调用方，而不是分析仓库来猜测范围。
- **不保证 codefree 执行成功**：任务保真只避免 Claude 侧丢失或捏造要求，不改变 codefree 的能力、认证或环境状态。
