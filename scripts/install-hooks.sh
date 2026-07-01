#!/usr/bin/env bash
# install-hooks.sh — Safely install the lint-compat pre-commit hook.
# Skips silently if .git/hooks does not exist (CI, deployment artifacts, etc.).

set -euo pipefail

HOOKS_DIR=".git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "Skipping hook install: no .git/hooks directory found (non-dev environment)."
  exit 0
fi

cp scripts/lint-compat.sh "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "pre-commit hook installed at $HOOKS_DIR/pre-commit"
