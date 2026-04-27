#!/usr/bin/env bash
# codefree companion: minimal wrapper for /codefree:task slash command.
# Parses optional flags (--yolo, --model, --include-dir) and forwards the
# remaining text as the codefree prompt. Defaults to --approval-mode auto-edit
# so file edits don't block on a TTY.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: codefree-companion.sh [--yolo] [--model <name>] [--include-dir <path>] <task ...>

Calls: codefree -p "<task>" --approval-mode <mode> [--model <name>] [--include-directories ...]

Flags:
  --yolo, -y            Skip all approval prompts (--approval-mode yolo)
  --model, -m <name>    Override the codefree model
  --include-dir <path>  Add an extra directory to the workspace (repeatable)
  --help, -h            Show this usage

Environment:
  CODEFREE_BIN          Override the codefree binary name/path (default: codefree)
EOF
}

CODEFREE_BIN="${CODEFREE_BIN:-codefree}"
APPROVAL_MODE="auto-edit"
MODEL=""
INCLUDE_DIRS=()
PROMPT_PARTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yolo | -y)
      APPROVAL_MODE="yolo"
      shift
      ;;
    --model | -m)
      MODEL="${2:-}"
      [[ -z "$MODEL" ]] && { echo "ERROR: --model requires a value" >&2; exit 2; }
      shift 2
      ;;
    --include-dir)
      [[ -z "${2:-}" ]] && { echo "ERROR: --include-dir requires a value" >&2; exit 2; }
      INCLUDE_DIRS+=("$2")
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      PROMPT_PARTS+=("$1")
      shift
      ;;
  esac
done

if ! command -v "$CODEFREE_BIN" >/dev/null 2>&1; then
  echo "ERROR: '$CODEFREE_BIN' not found in PATH." >&2
  echo "Install codefree or set the CODEFREE_BIN environment variable." >&2
  exit 127
fi

if [[ ${#PROMPT_PARTS[@]} -eq 0 ]]; then
  echo "ERROR: empty task. Usage: /codefree:task <task description>" >&2
  exit 2
fi

PROMPT="${PROMPT_PARTS[*]}"
ARGS=(-p "$PROMPT" --approval-mode "$APPROVAL_MODE")
[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
if [[ ${#INCLUDE_DIRS[@]} -gt 0 ]]; then
  IFS=','
  ARGS+=(--include-directories "${INCLUDE_DIRS[*]}")
  unset IFS
fi

exec "$CODEFREE_BIN" "${ARGS[@]}"
