---
name: effort-estimation
description: >-
  IT 项目研发工时评估。读取需求文档（文本 / Markdown / Word / Excel），按业务模块拆分功能点，再按"需求/设计/前端/后端/测试/运维"六类工作项结合复杂度查表估算工时（单位：人日 pd），产出《工作详单》与《工时汇总》两张表并导出 xlsx。当用户提到"工时评估"、"工作量估算"、"排期"、"人日"、"研发工时"、"effort estimation"、"需要估算多少工作量"或提供需求文档要求拆解研发任务时触发。
argument-hint: <需求文件路径> [senior=N,middle=N,junior=N] [buffer=0.15]（均可选；buffer 缺省 0；团队缺省时 skill 主动询问）
---

## Task

Given a requirements document, decompose it into engineering work items, estimate effort (in person-days, pd) via a lookup-table method, and produce two tables: **工作详单** (detail) and **工时汇总** (summary).

## Context

- Current directory: !`pwd`
- Current time: !`date '+%Y-%m-%d %H:%M:%S'`
- Input file arg: `$1`
- Input file exists: !`[ -f "$1" ] && echo yes || echo no`
- Input file suffix: !`echo "$1" | awk -F. '{print tolower($NF)}'`

## Path Resolution

Before calling any script, resolve the skill's install directory:

1. Try relative `scripts/` and `references/` first (project-level install)
2. Otherwise search for anchor file `validate.py` under:
   - `~/.claude/plugins/cache/**/effort-estimation/scripts/validate.py` (global)
   - `<repo>/skills/effort-estimation/scripts/validate.py` (project-level)
3. Store as `$SKILL_SCRIPTS_DIR` / `$SKILL_REFERENCES_DIR`

## Python Environment

Scripts depend on Python 3 with `openpyxl` (xlsx) and `python-docx` (.docx). To keep the skill self-contained on every machine, a venv is provisioned **inside the skill's own install directory** (`<skill-root>/.venv/`) on first run. Subsequent runs reuse it instantly.

Before any script call:

```bash
SKILL_PY=$(bash "$SKILL_SCRIPTS_DIR/ensure_env.sh")
```

- If `ensure_env.sh` exits non-zero → Python 3 is missing on the user's machine. Relay the stderr (which contains platform-specific install instructions: brew / apt / pacman / python.org) to the user and stop. Do not fall back to the system `python3`.
- On success, `$SKILL_PY` is the absolute path to the venv's `python3` — use it in **every** subsequent script invocation in place of bare `python3`.

## Clarification Policy

Only two situations **require** calling `AskUserQuestion`; for everything else, make a reasonable assumption and **record it in the 备注 column** of the affected row so the user can spot and override it:

1. **Input file path missing, not found, or parses to empty content** — without input, estimation is meaningless
2. **Team composition not supplied via argument** — present 3 presets (偏资深 / 均衡 / 偏初级) plus 自定义

For module decomposition ambiguity, complexity boundaries, or ambiguous terms: **pick the most reasonable option, annotate in 备注** (e.g., `假设：风控=规则引擎`). This keeps flow smooth and still surfaces assumptions to the user.

## Steps

1. **Resolve paths** per the Path Resolution section, then **bootstrap the Python environment** per the Python Environment section to obtain `$SKILL_PY`. If bootstrapping fails, stop and relay the install hint to the user.

2. **Parse arguments**: if input missing → ask. If team composition missing → `AskUserQuestion` with 偏资深 / 均衡 / 偏初级 / 自定义. Buffer is **optional** (default 0) — parse `buffer=0.15` if provided; do not ask if absent.

3. **Read input**:
   - `.md` / `.txt`: read directly
   - `.docx` / `.xlsx`: `$SKILL_PY $SKILL_SCRIPTS_DIR/read_input.py <path>`

4. **Load baseline table** from `$SKILL_REFERENCES_DIR/effort-table.md`.

5. **Decompose** — 每条工作项的行粒度由类型决定：

   | 类型 | 行粒度                 | `工作内容` 列填法                                                               |
   | ---- | ---------------------- | ------------------------------------------------------------------------------- |
   | 需求 | 1 行/模块              | `-`                                                                             |
   | 设计 | 1 行/模块              | `-`                                                                             |
   | 前端 | **1 行/页面**          | 页面名（下单页 / 订单列表页 / 个人中心）                                        |
   | 后端 | **1 行/业务动作**      | 业务语言（新增订单 / 查询订单 / 订单状态校验）**禁写 URL 或 HTTP 方法**         |
   | 测试 | 1 行/模块              | `-`                                                                             |
   | 运维 | **1 行/工作项，≥2 项** | 运维工作项（部署流水线 / 监控告警 / 日志系统 / 应急预案 / 性能压测 / 灾备多活） |
   - **需求/设计/测试** 保持模块级 1 次，不按功能点展开（虚增主因）
   - **前端/后端/运维** 按上述细粒度拆行，每行独立判复杂度
   - **运维硬约束**：部署 + 监控 最低配（2 行），非平凡项目 3-5 行
   - 模块拆分有歧义 → 选最合理方案，在 `备注` 写 `假设: xxx`（不阻塞）

6. **Judge complexity** per **row** (not per feature) using the rubric in `effort-table.md`. Pick 简单 / 中等 / 复杂, give a one-sentence rationale in `备注`. 边界落判取下档，`备注` 标 `⚠ 边界偏低`。

7. **Handle NFR** per the "非功能要求处理规则" section of `effort-table.md` — performance / availability / compliance map into existing six categories, do **not** create a 7th category.

8. **Compute effort**:
   - Look up baseline
   - `k = (senior×0.8 + middle×1.0 + junior×1.3) / total`
   - Final = baseline × k, rounded to 0.5 pd granularity, 1 decimal place
   - Single work item > 5 pd → mark `⚠ 建议拆细` in 备注

9. **Apply buffer (display only)** — if `buffer > 0`, do **not** multiply individual detail rows. Keep the detail table as raw estimates; add a buffer line and a grand total to the **summary** markdown table. Pass `buffer` to `export_excel.py` via the JSON payload `meta.buffer` so the xlsx mirrors the markdown.

10. **Output both tables in Markdown** (format below).

11. **Persist to xlsx**:

    ```bash
    echo '<json>' | $SKILL_PY $SKILL_SCRIPTS_DIR/export_excel.py .
    ```

12. **Validate**:
    ```bash
    echo '<json>' | $SKILL_PY $SKILL_SCRIPTS_DIR/validate.py
    ```
    If validation fails, fix and re-emit.

## Output Format

See `references/output-example.md` for a full worked example. The minimum structure is:

### 1. 拆解依据（简要）

一段文字：业务模块如何划分、项目级/功能级边界如何取、团队系数 `k = X.XX`、是否有 NFR 提升了哪些复杂度。

### 2. 工作详单

**7 列**：`业务模块 | 功能点 | 工作项类型 | 工作内容 | 复杂度 | 工时(pd) | 备注`

- 工作项类型 ∈ {需求, 设计, 前端, 后端, 测试, 运维}
- 复杂度 ∈ {简单, 中等, 复杂}
- 工时为正数，整数或保留 1 位小数
- `工作内容` 列：
  - 前端=页面名；后端=业务动作（**禁 HTTP 方法 / URL**）；运维=工作项名
  - 需求 / 设计 / 测试 行填 `-`
- 模块级行（需求/设计/测试）：功能点列填 `-`，备注写"模块级"
- 项目级运维行：业务模块可填 `项目`，功能点 `-`
- 假设 / 边界 / 拆细建议均写在 备注 列

### 3. 工时汇总

3 列：`业务模块 | 工作项类型 | 工时(pd)`。末尾顺序追加：

- `明细合计` 行（按 (模块,类型) 聚合之和）
- 当 `buffer > 0` 时：`风险缓冲 (N%)` 行 = 明细合计 × buffer
- `总计` 行 = 明细合计 × (1 + buffer)（buffer=0 时等于明细合计）

### 4. 输出文件路径

> 已导出至 `./effort-estimation-YYYYMMDD-HHMMSS.xlsx`

## Guidelines

- **单位**：人日 pd，整数或 1 位小数
- **细粒度拆行**：前端按页面、后端按业务动作、运维按工作项各自拆行
- **工作内容用业务语言**：后端列严禁出现 `GET/POST/PUT/DELETE` 或 URL 路径；给产品/PM 看
- **运维至少 2 行**：部署 + 监控 最低配；非平凡项目 3-5 行
- **需求/设计/测试保持模块级**：1 模块 1 行，工作内容填 `-`
- **一句话依据**：每个工作项的复杂度必须有简短理由
- **假设可见**：不阻塞式提问，改为在 备注 列声明假设（`假设：xxx`）
- **NFR 映射**：查 `effort-table.md` 的 NFR 规则，不新增第 7 类
- **团队系数保留 2 位小数**（展示），最终工时保留 1 位
- **buffer 只影响展示层**：详单每行不因 buffer 改变；只有汇总表追加 `风险缓冲` 与 `总计` 行
- 工作项类型严格使用中文六类：**需求 / 设计 / 前端 / 后端 / 测试 / 运维**
