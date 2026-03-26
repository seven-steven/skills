#!/usr/bin/env python3
"""Project name cache management.

Usage:
  python3 scripts/cache.py read <repo_path>         # 读取项目名称缓存
  python3 scripts/cache.py write <repo_path> <name> # 写入项目名称缓存
"""

import json
import os
import sys

CACHE_DIR = os.path.expanduser("~/.claude/skills/daily-report")
CACHE_FILE = os.path.join(CACHE_DIR, "project-name-cache.json")


def load() -> dict:
    if not os.path.exists(CACHE_FILE):
        return {}
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}


def save(data: dict):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def read(repo_path: str) -> str:
    cache = load()
    key = os.path.realpath(repo_path)
    return cache.get(key, "")


def write(repo_path: str, name: str):
    cache = load()
    key = os.path.realpath(repo_path)
    cache[key] = name
    save(cache)


def main():
    if len(sys.argv) < 3:
        print("Usage: cache.py read|write <repo_path> [name]", file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]
    repo_path = sys.argv[2]

    if action == "read":
        result = read(repo_path)
        if result:
            print(result)
    elif action == "write":
        if len(sys.argv) < 4:
            print("Usage: cache.py write <repo_path> <name>", file=sys.stderr)
            sys.exit(1)
        write(repo_path, sys.argv[3])
        print(f"已缓存: {repo_path} → {sys.argv[3]}")
    else:
        print(f"Unknown action: {action}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
