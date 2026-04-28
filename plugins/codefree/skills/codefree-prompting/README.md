# codefree-prompting

## 用途

将用户的自然语言任务描述整理为 codefree 能稳定执行的结构化 prompt。

codefree（基于 qwen-code）对模糊、复合或缺少文件范围的指令容易产生偏差。本 skill 通过强制 prompt 包含明确目标、输入文件、输出契约和负向约束，减少 codefree 的猜测空间，提高任务执行的可预期性。

## 使用方式

本 skill 的 `user-invocable: false`，**不能由用户直接触发**。

仅由 `codefree:codefree-task` subagent 在其工作流程内部调用：当检测到任务描述模糊、复合或缺少文件范围时，subagent 先执行本 skill 完成 prompt 改写，再将改写后的 prompt 传递给 codefree CLI。如果任务描述已经具体且有明确边界，subagent 可跳过本 skill 直接转发。

## 配置

无环境变量。本 skill 仅是 prompt 指令，不包含脚本，无任何运行时配置项。

## 示例

**触发改写**（任务模糊，缺少文件范围）：

> 用户：帮我优化一下代码

subagent 判断为模糊任务，调用本 skill 改写为：

```xml
<task>
  对 src/api/user.ts 中的 createUser 函数进行性能优化，减少数据库查询次数。
</task>
<scope>
  仅修改 src/api/user.ts。不触碰测试文件、迁移文件及其他模块。
</scope>
<output_contract>
  修改完成后运行 npm test，所有测试通过。将变更内容以文件差异形式输出到 stdout。
</output_contract>
<constraints>
  不安装新依赖。不修改接口签名。
</constraints>
```

**跳过改写**（任务已具体）：

> 用户：/codefree:task Fix all TypeScript errors in src/components/Button.tsx

任务已包含目标、文件范围和隐式输出契约，subagent 直接转发，不调用本 skill。

## 实现架构

本 skill 不包含任何 Node.js 脚本，是纯 prompt 形式的 skill。

`codefree:codefree-task` subagent 在执行任务前会加载本 skill（`codefree-prompting`）的 SKILL.md 指令作为其上下文的一部分。subagent 依据 SKILL.md 中的 prompt 规则，对输入任务进行判断：符合条件时原地改写，否则透传。改写后的 prompt 结构遵循 `<task>/<scope>/<output_contract>/<constraints>` 四块 XML 格式，保证 codefree 能稳定解析。

## 限制

- **仅在 codefree-task subagent 内有效**：在其他 skill 或主 Claude 线程中加载此 skill 不会产生预期效果。
- **不处理多任务拆分**：当任务包含多个独立目标时，本 skill 只保留主要目标，不自动拆分为多次调用。
- **不保证 codefree 一定执行成功**：改写 prompt 只降低失败概率，不消除 codefree 本身的限制（如不支持的操作、认证失败等）。
