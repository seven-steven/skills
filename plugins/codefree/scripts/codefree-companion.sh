#!/usr/bin/env bash
# codefree companion: minimal wrapper for /codefree:task slash command.
# Parses optional flags and forwards the remaining text as the codefree prompt.
# Defaults to --approval-mode auto-edit so file edits don't block on a TTY.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: codefree-companion.sh [subcommand] [flags] [task...]

Subcommands:
  task-resume-candidate [--json]
      Check whether a prior codefree task succeeded in the current project.
      With --json: outputs {"available":true|false}. Otherwise: "available" or "unavailable".

Task mode (default):
  Calls: codefree -p "<task>" --approval-mode <mode> [--model <name>]
                  [--include-directories ...] [--continue]

Flags:
  --resume-last         Continue the most recent codefree session (passes --continue)
  --yolo, -y            Skip all approval prompts (--approval-mode yolo)
  --model, -m <name>    Override the codefree model
  --include-dir <path>  Add an extra directory to the workspace (repeatable)
  --help, -h            Show this usage

Environment:
  CODEFREE_BIN          Override the codefree binary name/path (default: codefree)
EOF
}

CODEFREE_BIN="${CODEFREE_BIN:-codefree}"

# Per-repo marker file: created on successful task execution so the command
# layer can detect that a resumable session exists.
marker_file() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
  local hash
  hash=$(printf '%s' "$root" | md5sum | cut -c1-16)
  echo "/tmp/codefree-ran-${hash}"
}

# --- subcommand: task-resume-candidate ----------------------------------------
if [[ "${1:-}" == "task-resume-candidate" ]]; then
  shift
  JSON=false
  [[ "${1:-}" == "--json" ]] && JSON=true
  if [[ -f "$(marker_file)" ]]; then
    $JSON && echo '{"available":true}'  || echo "available"
  else
    $JSON && echo '{"available":false}' || echo "unavailable"
  fi
  exit 0
fi

# --- flag parsing (task mode) -------------------------------------------------
APPROVAL_MODE="auto-edit"
MODEL=""
INCLUDE_DIRS=()
USE_CONTINUE=false
PROMPT_PARTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resume-last)
      USE_CONTINUE=true
      shift
      ;;
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

if [[ ${#PROMPT_PARTS[@]} -eq 0 ]] && [[ "$USE_CONTINUE" != "true" ]]; then
  echo "ERROR: empty task. Usage: /codefree:task <task description>" >&2
  exit 2
fi

PROMPT="${PROMPT_PARTS[*]:-}"
ARGS=(--approval-mode "$APPROVAL_MODE")
[[ -n "$PROMPT" ]] && ARGS=(-p "$PROMPT" "${ARGS[@]}")
[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
if [[ ${#INCLUDE_DIRS[@]} -gt 0 ]]; then
  IFS=','
  ARGS+=(--include-directories "${INCLUDE_DIRS[*]}")
  unset IFS
fi
[[ "$USE_CONTINUE" == "true" ]] && ARGS+=(--continue)

"$CODEFREE_BIN" "${ARGS[@]}"
EXIT=$?
[[ $EXIT -eq 0 ]] && touch "$(marker_file)"
exit $EXIT
