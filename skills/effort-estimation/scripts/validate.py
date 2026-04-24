#!/usr/bin/env python3
"""Validate effort-estimation output structure and aggregation consistency.

Reads a JSON document (same shape as export_excel.py input) from stdin,
and checks:
  1. Each detail row has required fields (module/type/complexity/effort_pd;
     work_content required for 前端/后端/运维)
  2. `type` is one of the six allowed categories
  3. `complexity` is one of the three allowed levels
  4. `effort_pd` is a positive number with at most 1 decimal place
  5. Summary = detail grouped by (module, type), totals match
  6. 前端/后端/运维 行必须有 work_content（业务语义字符串，非占位 `-`）
  7. 后端 work_content 禁止出现 HTTP 方法（GET/POST/PUT/DELETE/PATCH）或 URL 路径
  8. 至少列 2 行 运维

Usage:
  python3 validate.py < data.json
  python3 validate.py data.json

Exit 0 on success, 1 on validation failure.
"""

import json
import re
import sys
from collections import defaultdict

ALLOWED_TYPES = {"需求", "设计", "前端", "后端", "测试", "运维"}
ALLOWED_COMPLEXITY = {"简单", "中等", "复杂"}

# Required fields on every detail row
DETAIL_REQUIRED = ["module", "type", "complexity", "effort_pd"]

# Types whose work_content must be a real business description (not "-")
GRANULAR_TYPES = {"前端", "后端", "运维"}

# 后端 work_content 禁用正则：HTTP 方法或 URL 路径
BACKEND_FORBIDDEN = re.compile(
    r"\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b|/\w+/?|/api/|https?://",
    re.IGNORECASE,
)

MIN_DEVOPS_ROWS = 2


def _has_one_decimal(v: float) -> bool:
    return abs(round(v, 1) - v) < 1e-9


def validate(data: dict) -> list[str]:
    errors = []
    detail = data.get("detail")
    summary = data.get("summary")

    if not isinstance(detail, list) or not detail:
        errors.append("detail 必须是非空数组")
        return errors
    if not isinstance(summary, list):
        errors.append("summary 必须是数组")
        return errors

    devops_rows = 0

    for i, row in enumerate(detail, 1):
        for field in DETAIL_REQUIRED:
            if field not in row or row[field] in (None, ""):
                errors.append(f"detail[{i}] 缺少字段 {field}")

        t = row.get("type")
        if t and t not in ALLOWED_TYPES:
            errors.append(f"detail[{i}] type={t!r} 不在白名单 {sorted(ALLOWED_TYPES)}")

        c = row.get("complexity")
        if c and c not in ALLOWED_COMPLEXITY:
            errors.append(f"detail[{i}] complexity={c!r} 不在白名单 {sorted(ALLOWED_COMPLEXITY)}")

        e = row.get("effort_pd")
        if isinstance(e, (int, float)):
            if e <= 0:
                errors.append(f"detail[{i}] effort_pd 必须为正数，当前 {e}")
            elif not _has_one_decimal(float(e)):
                errors.append(f"detail[{i}] effort_pd 必须为整数或保留 1 位小数，当前 {e}")
        else:
            errors.append(f"detail[{i}] effort_pd 必须为数值，当前 {e!r}")

        # work_content 规则
        wc = (row.get("work_content") or "").strip()
        if t in GRANULAR_TYPES:
            if not wc or wc == "-":
                errors.append(
                    f"detail[{i}] {t} 行必须填 work_content（前端=页面 / 后端=业务动作 / 运维=工作项），当前为空或 `-`"
                )
            elif t == "后端" and BACKEND_FORBIDDEN.search(wc):
                errors.append(
                    f"detail[{i}] 后端 work_content={wc!r} 包含 HTTP 方法或 URL；请改用业务语言"
                    "（如 `新增订单` / `查询订单详情` / `订单状态校验`）"
                )
            if t == "运维":
                devops_rows += 1

    if devops_rows < MIN_DEVOPS_ROWS:
        errors.append(
            f"运维 行至少需 {MIN_DEVOPS_ROWS} 行（部署 + 监控 最低配），当前 {devops_rows} 行"
        )

    # Aggregation consistency
    detail_agg = defaultdict(float)
    for row in detail:
        key = (row.get("module"), row.get("type"))
        try:
            detail_agg[key] += float(row.get("effort_pd", 0))
        except (TypeError, ValueError):
            pass

    summary_agg = {}
    for i, row in enumerate(summary, 1):
        key = (row.get("module"), row.get("type"))
        try:
            summary_agg[key] = float(row.get("effort_pd", 0))
        except (TypeError, ValueError):
            errors.append(f"summary[{i}] effort_pd 非数值: {row.get('effort_pd')!r}")

    for key, total in detail_agg.items():
        s = summary_agg.get(key)
        if s is None:
            errors.append(f"summary 缺少 ({key[0]}, {key[1]}) 条目，detail 合计 {round(total, 1)}")
        elif abs(s - total) > 1e-6:
            errors.append(
                f"summary ({key[0]}, {key[1]}) = {s} 与 detail 合计 {round(total, 1)} 不一致"
            )

    for key in summary_agg:
        if key not in detail_agg:
            errors.append(f"summary 中出现 detail 不存在的 ({key[0]}, {key[1]})")

    return errors


def main():
    if sys.argv[1:]:
        with open(sys.argv[1], encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    errors = validate(data)
    if errors:
        print("校验失败：")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("校验通过")


if __name__ == "__main__":
    main()
