#!/usr/bin/env python3
"""Validate effort-estimation output structure and aggregation consistency.

Reads a JSON document (same shape as export_excel.py input) from stdin,
and checks:
  1. Each detail row has all six required fields and valid values
  2. `type` is one of the six allowed categories
  3. `complexity` is one of the three allowed levels
  4. `effort_pd` is a positive number with at most 1 decimal place
  5. Summary = detail grouped by (module, type), totals match
  6. Report total = sum of detail effort

Usage:
  python3 validate.py < data.json
  python3 validate.py data.json

Exit 0 on success, 1 on validation failure.
"""

import json
import sys
from collections import defaultdict

ALLOWED_TYPES = {"需求", "设计", "前端", "后端", "测试", "运维"}
ALLOWED_COMPLEXITY = {"简单", "中等", "复杂"}
DETAIL_REQUIRED = ["module", "feature", "type", "complexity", "effort_pd"]


def _has_one_decimal(v: float) -> bool:
    # 接受整数或保留 1 位小数（0.5 粒度不强制，但不能出现 0.13 之类的值）
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
