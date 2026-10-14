#!/usr/bin/env bash
# Privacy sentinel: refuse to let personal identifiers re-enter the tracked tree.
# Scans all git-tracked files for tokens that must never be committed.
# Install as a hook:  ln -sf ../../scripts/check-privacy.sh .git/hooks/pre-push
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PATTERN='aaron|guorui|gmail|MacBook Pro|/Users/[a-z]+'

# The public repository owner's exact MIT copyright notice is intentional.
# Check the rest of LICENSE normally; do not exempt the entire file.
HITS="$(while IFS= read -r -d '' file; do
  [ "$file" = "scripts/check-privacy.sh" ] && continue
  if [ "$file" = "LICENSE" ]; then
    if sed '/^Copyright (c) 2026 AForAaron$/d' "$file" | grep -qiE "$PATTERN"; then
      printf '%s\n' "$file"
    fi
  elif [ "$file" = "scripts/launcher-resolver.mjs" ] || [ "$file" = "scripts/launcher-resolver.test.mjs" ]; then
    # Exact public project identities are required to validate launcher discovery.
    if sed -E 's#[Aa][Ff]or[Aa]aron/(agent-codex-navigator|codex-thread-navigator)##g' "$file" | grep -qiE "$PATTERN"; then
      printf '%s\n' "$file"
    fi
  elif grep -qiE "$PATTERN" "$file" 2>/dev/null; then
    printf '%s\n' "$file"
  fi
done < <(git ls-files -z))"
if [ -n "$HITS" ]; then
  echo "check-privacy: personal tokens found in tracked files:" >&2
  echo "$HITS" >&2
  exit 1
fi

AUTHOR_EMAIL="$(git log -1 --format='%ae' 2>/dev/null || true)"
if echo "$AUTHOR_EMAIL" | grep -qiE 'gmail'; then
  echo "check-privacy: HEAD author email is a gmail address (${AUTHOR_EMAIL})" >&2
  exit 1
fi

echo "check-privacy: clean"
