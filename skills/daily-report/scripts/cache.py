#!/usr/bin/env python3
"""Cache management for daily-report.

Usage:
  python3 scripts/cache.py read <repo_path>              # 读取项目名称缓存
  python3 scripts/cache.py write <repo_path> <name>       # 写入项目名称缓存
  python3 scripts/cache.py read-commit <repo_path>        # 读取上次报告的最新 commit id
  python3 scripts/cache.py write-commit <repo_path> <id>  # 写入本次报告的最新 commit id
  python3 scripts/cache.py resolve                        # 解析 skill 脚本目录绝对路径
"""

import glob
import json
import os
import sys

CACHE_DIR = os.path.expanduser("~/.claude/skills/daily-report")
PROJECT_CACHE_FILE = os.path.join(CACHE_DIR, "project-name-cache.json")
COMMIT_CACHE_FILE = os.path.join(CACHE_DIR, "commit-cache.json")


def _load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}


def _save(path: str, data: dict):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _key(repo_path: str) -> str:
    return os.path.realpath(repo_path)


# --- project name cache ---

def read_project(repo_path: str) -> str:
    return _load(PROJECT_CACHE_FILE).get(_key(repo_path), "")


def write_project(repo_path: str, name: str):
    cache = _load(PROJECT_CACHE_FILE)
    cache[_key(repo_path)] = name
    _save(PROJECT_CACHE_FILE, cache)


# --- resolve scripts dir (cross-platform) ---

def resolve_scripts_dir() -> str:
    """Find the absolute path of this skill's scripts directory.

    Search order:
      1. Global plugin cache: ~/.claude/plugins/cache/**/daily-report/scripts/
      2. Current working directory: ./skills/daily-report/scripts/
    """
    anchor = "cache.py"
    search_roots = [
        os.path.expanduser("~/.claude/plugins/cache"),
        os.getcwd(),
    ]
    for root in search_roots:
        pattern = os.path.join(root, "**", "daily-report", "scripts", anchor)
        for match in glob.glob(pattern, recursive=True):
            # skip node_modules and other noise
            if "node_modules" in match:
                continue
            return os.path.dirname(os.path.abspath(match))
    return ""


# --- commit id cache ---

def read_commit(repo_path: str) -> str:
    return _load(COMMIT_CACHE_FILE).get(_key(repo_path), "")


def write_commit(repo_path: str, commit_id: str):
    cache = _load(COMMIT_CACHE_FILE)
    cache[_key(repo_path)] = commit_id
    _save(COMMIT_CACHE_FILE, cache)


def main():
    if len(sys.argv) < 2:
        print("Usage: cache.py <action> [args...]", file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]

    # resolve is the only action that doesn't require repo_path
    if action == "resolve":
        _resolve()
        return

    if len(sys.argv) < 3:
        print(f"Missing argument: <repo_path>", file=sys.stderr)
        sys.exit(1)

    repo_path = sys.argv[2]

    dispatch = {
        "read": lambda: _print_or_empty(read_project(repo_path)),
        "write": lambda: _require_arg(3, "name") or _write_project(repo_path, sys.argv[3]),
        "read-commit": lambda: _print_or_empty(read_commit(repo_path)),
        "write-commit": lambda: _require_arg(3, "commit_id") or _write_commit(repo_path, sys.argv[3]),
    }

    fn = dispatch.get(action)
    if not fn:
        print(f"Unknown action: {action}", file=sys.stderr)
        sys.exit(1)
    fn()


def _resolve():
    result = resolve_scripts_dir()
    if result:
        print(result)
    else:
        print("scripts", end="")


def _print_or_empty(value: str):
    if value:
        print(value)


def _require_arg(index: int, name: str):
    if len(sys.argv) < index + 1:
        print(f"Missing argument: {name}", file=sys.stderr)
        sys.exit(1)


def _write_project(repo_path: str, name: str):
    write_project(repo_path, name)
    print(f"已缓存项目名称: {repo_path} → {name}")


def _write_commit(repo_path: str, commit_id: str):
    write_commit(repo_path, commit_id)
    print(f"已缓存 commit id: {commit_id}")


if __name__ == "__main__":
    main()
