#!/usr/bin/env bash
# lint-compat.sh — Reject ES2020+ syntax that breaks older embedded browsers.
#
# Forbidden patterns in public/js/**:
#   ?.   optional chaining
#   ??   nullish coalescing  (also catches ??=)
#   &&=  logical AND assignment
#   ||=  logical OR assignment
#
# Exit 1 if any are found; exit 0 if clean.

set -euo pipefail

TARGET="public/js"
ERRORS=0

check() {
  local label="$1"
  local pattern="$2"

  # grep -rn exits 0 if matches found, 1 if none, 2 on error
  if grep -rn --include="*.js" -E "$pattern" "$TARGET" 2>/dev/null; then
    echo "ERROR: $label found in $TARGET — not allowed for embedded-browser compatibility." >&2
    ERRORS=$((ERRORS + 1))
  fi
}

echo "==> Checking $TARGET for ES2020+ syntax…"

check "Optional chaining (?.)"             '\?\.'
check "Nullish coalescing (??)"            '\?\?'
check "Logical AND assignment (&&=)"       '&&='
check "Logical OR assignment (||=)"        '\|\|='

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAIL: $ERRORS forbidden syntax pattern(s) detected." >&2
  echo "Replace with ES2019-compatible equivalents before committing." >&2
  echo "  ?.x        → (obj && obj.x)" >&2
  echo "  a ?? b     → (a !== null && a !== undefined ? a : b)" >&2
  echo "  a &&= b    → if (a) a = b" >&2
  echo "  a ||= b    → a = a || b" >&2
  exit 1
fi

echo "OK: No forbidden ES2020+ syntax found."
exit 0
