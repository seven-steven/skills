#!/usr/bin/env python3
"""Validate daily-report output format.

Expected format:
  - 项目名称-工作内容；
  - 项目名称-工作内容；

Each line must:
  1. Start with "- "
  2. Contain exactly one "-" as separator between 项目名称 and 工作内容
  3. Both 项目名称 and 工作内容 must be non-empty
  4. End with Chinese semicolon "；"
"""

import re
import sys

PATTERN = re.compile(r"^-\s*.+-.+；$")

def validate(text: str) -> list[str]:
    errors = []
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]

    if not lines:
        errors.append("输出不能为空")
        return errors

    for i, line in enumerate(lines, 1):
        if not PATTERN.match(line):
            errors.append(f"第 {i} 行格式错误: {line!r}")
            if not line.startswith("- "):
                errors.append(f"  → 应以 \"- \" 开头")
            if not line.endswith("；"):
                errors.append(f"  → 应以中文分号 \"；\" 结尾，当前结尾: {line[-1]!r}")
            continue

        # 提取项目名称和工作内容
        body = line[1:].strip()  # 去掉 "- "
        sep_pos = body.find("-")
        project = body[:sep_pos].strip()
        work = body[sep_pos + 1:].rstrip("；").strip()

        if not project:
            errors.append(f"第 {i} 行项目名称为空: {line!r}")
        if not work:
            errors.append(f"第 {i} 行工作内容为空: {line!r}")

    # 检查换行符：每条日志必须独立一行
    if "\r" in text:
        errors.append("内容包含 \\r 字符，请使用 LF 换行符（而非 CRLF）")
    raw_lines = text.strip().splitlines()
    for i, raw in enumerate(raw_lines):
        if raw != raw.strip():
            errors.append(f"第 {i + 1} 行首尾有多余空白字符")

    return errors


def main():
    text = sys.stdin.read() if not sys.argv[1:] else open(sys.argv[1]).read()
    errors = validate(text)
    if errors:
        print("格式校验失败：")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("格式校验通过")
        sys.exit(0)


if __name__ == "__main__":
    main()
