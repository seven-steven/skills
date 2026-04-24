#!/usr/bin/env python3
"""Export effort-estimation tables (detail + summary) to xlsx (fallback: csv).

Input: a JSON document on stdin with the shape:
  {
    "detail": [
      {"module": "...", "feature": "...", "type": "...",
       "complexity": "...", "effort_pd": 1.5, "note": "..."}
    ],
    "summary": [
      {"module": "...", "type": "...", "effort_pd": 3.0}
    ],
    "meta": {"team": "senior=1,middle=2,junior=1", "k": 1.03}
  }

Usage:
  python3 export_excel.py <output-dir>

Prints the resolved output path on stdout. Exits 0 on success.
"""

import csv
import json
import sys
from datetime import datetime
from pathlib import Path

DETAIL_HEADERS = ["业务模块", "功能点", "工作项类型", "工作内容", "复杂度", "工时(pd)", "备注"]
SUMMARY_HEADERS = ["业务模块", "工作项类型", "工时(pd)"]

DETAIL_FIELDS = ["module", "feature", "type", "work_content", "complexity", "effort_pd", "note"]
SUMMARY_FIELDS = ["module", "type", "effort_pd"]


def to_rows(items, fields):
    for item in items:
        yield [item.get(f, "") for f in fields]


def write_xlsx(out_path: Path, data: dict) -> Path:
    from openpyxl import Workbook

    wb = Workbook()

    ws_detail = wb.active
    ws_detail.title = "工作详单"
    ws_detail.append(DETAIL_HEADERS)
    for row in to_rows(data.get("detail", []), DETAIL_FIELDS):
        ws_detail.append(row)

    ws_summary = wb.create_sheet("工时汇总")
    ws_summary.append(SUMMARY_HEADERS)
    for row in to_rows(data.get("summary", []), SUMMARY_FIELDS):
        ws_summary.append(row)

    total = sum(item.get("effort_pd", 0) for item in data.get("detail", []))
    meta = data.get("meta", {})
    buffer = float(meta.get("buffer", 0) or 0)

    ws_summary.append([])
    ws_summary.append(["明细合计", "", round(total, 1)])
    if buffer > 0:
        buf_pd = round(total * buffer, 1)
        ws_summary.append([f"风险缓冲 ({int(buffer * 100)}%)", "", buf_pd])
        ws_summary.append(["总计", "", round(total * (1 + buffer), 1)])
    else:
        ws_summary.append(["总计", "", round(total, 1)])

    if meta:
        ws_summary.append([])
        ws_summary.append(["团队构成", meta.get("team", "")])
        ws_summary.append(["系数 k", meta.get("k", "")])
        if buffer > 0:
            ws_summary.append(["风险缓冲比例", buffer])

    wb.save(str(out_path))
    return out_path


def write_csv(out_dir: Path, stem: str, data: dict) -> list[Path]:
    detail_path = out_dir / f"{stem}-detail.csv"
    summary_path = out_dir / f"{stem}-summary.csv"

    with detail_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(DETAIL_HEADERS)
        for row in to_rows(data.get("detail", []), DETAIL_FIELDS):
            w.writerow(row)

    with summary_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(SUMMARY_HEADERS)
        for row in to_rows(data.get("summary", []), SUMMARY_FIELDS):
            w.writerow(row)
        total = sum(item.get("effort_pd", 0) for item in data.get("detail", []))
        meta = data.get("meta", {})
        buffer = float(meta.get("buffer", 0) or 0)
        w.writerow([])
        w.writerow(["明细合计", "", round(total, 1)])
        if buffer > 0:
            w.writerow([f"风险缓冲 ({int(buffer * 100)}%)", "", round(total * buffer, 1)])
            w.writerow(["总计", "", round(total * (1 + buffer), 1)])
        else:
            w.writerow(["总计", "", round(total, 1)])

    return [detail_path, summary_path]


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 export_excel.py <output-dir>", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(sys.argv[1]).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    data = json.load(sys.stdin)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    stem = f"effort-estimation-{ts}"

    try:
        import openpyxl  # noqa: F401
    except ImportError:
        paths = write_csv(out_dir, stem, data)
        print("openpyxl 未安装，已降级为 CSV。安装 openpyxl 可获得 xlsx 输出：pip install openpyxl", file=sys.stderr)
        for p in paths:
            print(p)
        return

    out_path = out_dir / f"{stem}.xlsx"
    write_xlsx(out_path, data)
    print(out_path)


if __name__ == "__main__":
    main()
