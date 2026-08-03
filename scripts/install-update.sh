#!/usr/bin/env bash
# Rick Desktop self-updater (POSIX). Replaces the running executable with the
# downloaded binary once the parent process exits, then relaunches it.
set -euo pipefail

NEW_BINARY="${1:-}"
TARGET="${2:-}"
PARENT_PID="${3:-}"

if [ -z "$NEW_BINARY" ] || [ -z "$TARGET" ]; then
  printf 'usage: %s <new-binary> <target> [parent-pid]\n' "$0" >&2
  exit 2
fi

# Wait for the parent (old) process to exit so the target file is unlocked.
if [ -n "$PARENT_PID" ] && [ "$PARENT_PID" -gt 0 ] 2>/dev/null; then
  timeout=90
  while kill -0 "$PARENT_PID" 2>/dev/null; do
    timeout=$((timeout - 1))
    if [ "$timeout" -le 0 ]; then
      printf 'timed out waiting for Rick Desktop to exit\n' >&2
      exit 1
    fi
    sleep 1
  done
fi

if [ ! -f "$NEW_BINARY" ]; then
  printf 'downloaded binary missing: %s\n' "$NEW_BINARY" >&2
  exit 1
fi

chmod 0755 "$NEW_BINARY"
# Backup the current binary so a failed swap can be recovered.
if [ -f "$TARGET" ]; then
  cp -f "$TARGET" "$TARGET.old" 2>/dev/null || true
fi
mv -f "$NEW_BINARY" "$TARGET"

# Relaunch the freshly installed binary, detached from this shell.
nohup "$TARGET" >/dev/null 2>&1 &
exit 0
