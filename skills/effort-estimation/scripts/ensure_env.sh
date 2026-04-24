#!/usr/bin/env bash
# Ensure the skill's Python venv is ready and print the venv python3 path on stdout.
#
# Behavior:
#   - Detect python3. If absent, print install hints to stderr and exit 1.
#   - Create <skill-root>/.venv/ if missing, install openpyxl + python-docx into it.
#   - On success, print absolute path of the venv python3 to stdout.
#
# The venv is co-located with the skill (under its install directory) so the
# skill stays self-contained and repeated invocations reuse the same env.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$SKILL_DIR/.venv"
PY="$VENV_DIR/bin/python3"
PIP="$VENV_DIR/bin/pip"

if ! command -v python3 >/dev/null 2>&1; then
  printf >&2 '%s\n' \
    "[effort-estimation] 未检测到 python3。" \
    "skill 需要 python3（用于解析 .docx/.xlsx 与导出 xlsx）。请安装后重试：" \
    "  macOS:    brew install python3" \
    "  Ubuntu:   sudo apt install python3 python3-venv" \
    "  Manjaro:  sudo pacman -S python" \
    "  Windows:  https://www.python.org/downloads/"
  exit 1
fi

if [ ! -x "$PY" ]; then
  # 创建 venv,真实错误(如磁盘空间、权限、缺 python3-venv)会透传到 stderr
  if ! python3 -m venv "$VENV_DIR" >&2; then
    printf >&2 '%s\n' \
      "[effort-estimation] 创建 venv 失败：$VENV_DIR" \
      "常见原因（参见上方 stderr 的真实错误）：" \
      "  - 磁盘空间不足：df -h $(dirname "$VENV_DIR" 2>/dev/null || printf .)" \
      "  - Ubuntu/Debian 缺 venv 包：sudo apt install python3-venv" \
      "  - 目录权限不足：chown/chmod 修复"
    exit 1
  fi
  if ! "$PIP" install -q --disable-pip-version-check openpyxl python-docx >&2; then
    printf >&2 '%s\n' \
      "[effort-estimation] 安装依赖失败（openpyxl / python-docx）。可手动执行：" \
      "  $PIP install openpyxl python-docx"
    exit 1
  fi
fi

echo "$PY"
