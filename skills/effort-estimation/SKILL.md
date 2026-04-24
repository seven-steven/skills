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

5. **Decompose** — critical: distinguish **project/module-level** from **feature-level** work items, otherwise totals inflate 20-30%:
   - **需求 / 设计 / 运维**: project- or module-level. List **once per module** (or once per project for 运维), NOT per feature. Exception: a single feature introduces a brand-new domain model, a novel architecture decision, or a dedicated deploy target — then list that category for that feature.
   - **前端 / 后端 / 测试**: feature-level. Enumerate per feature point. Skip a category when clearly inapplicable (e.g., a pure backend batch job has no 前端).

   If module decomposition is ambiguous → pick the most reasonable split and note 假设 in 备注 (do not block on asking).

6. **Judge complexity** per work item using the four dimensions in `effort-table.md` (数据实体数 / 交互点数 / 算法规则密度 / 集成点数). Pick 简单 / 中等 / 复杂 and give a **one-sentence rationale** in 备注. Boundary cases: pick the lower level and mark `⚠ 边界偏低` in 备注 (do not block).

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

6 列：`业务模块 | 功能点 | 工作项类型 | 复杂度 | 工时(pd) | 备注`

- 工作项类型 ∈ {需求, 设计, 前端, 后端, 测试, 运维}
- 复杂度 ∈ {简单, 中等, 复杂}
- 工时为正数，整数或保留 1 位小数
- 项目级工作项（需求/设计/运维）：功能点列填 `-`，备注写"项目级"或"模块级"
- 假设 / 边界 / 拆细建议均在 备注 列标注

### 3. 工时汇总

3 列：`业务模块 | 工作项类型 | 工时(pd)`。末尾顺序追加：

- `明细合计` 行（按 (模块,类型) 聚合之和）
- 当 `buffer > 0` 时：`风险缓冲 (N%)` 行 = 明细合计 × buffer
- `总计` 行 = 明细合计 × (1 + buffer)（buffer=0 时等于明细合计）

### 4. 输出文件路径

> 已导出至 `./effort-estimation-YYYYMMDD-HHMMSS.xlsx`

## Guidelines

- **单位**：人日 pd，整数或 1 位小数
- **防虚增**：需求/设计/运维 按模块/项目列一次，不按功能点展开
- **一句话依据**：每个工作项的复杂度必须有简短理由（哪怕只是"单实体 CRUD"）
- **假设可见**：不阻塞式提问，改为在 备注 列显式声明假设
- **NFR 映射**：查 `effort-table.md` 的 NFR 规则，不要新增第 7 类
- **团队系数保留 2 位小数**（展示），最终工时保留 1 位
- **buffer 只影响展示层**：详单的每条工时不因 buffer 改变；只有汇总表追加 `风险缓冲` 与 `总计` 两行
- 工作项类型严格使用中文六类：**需求 / 设计 / 前端 / 后端 / 测试 / 运维**
