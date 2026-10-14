#!/usr/bin/env bash
# Installed beside the resolver inside the launcher app; independent of repo name.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
RESOURCES="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${HOME}/Library/Logs/CodexNavigator"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/launcher-resolution.log" 2>&1
if ! command -v node >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "Codex Navigator" message "找不到Node.js运行时，请检查现有Node安装。" as warning' || true
  exit 2
fi
exec node "$RESOURCES/launcher-resolver.mjs"
