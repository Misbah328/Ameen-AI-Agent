---
name: Truncated app script -> artifact "crash"
description: Why the Replit canvas artifact intermittently reports a runtime crash for a healthy app, and the recovery pattern.
---

# Symptom
Canvas artifact reports "crashed with a runtime error"; browser console shows a bare
`SyntaxError: Unexpected end of input` at load. App renders fully and clean reloads
show no error — it is intermittent and coincides with dev-server restart/checkpoint windows.

# Root cause
The bare message "Unexpected end of input" (WITHOUT the word "JSON") is a *script*
parse failure, not a JSON parse failure. Chrome says "Unexpected end of **JSON** input"
for `JSON.parse('')`/`response.json()`. So this is the static app script being fetched
**truncated** by the preview/artifact iframe while the server restarts mid-transfer.

**Why:** Replit recreates the iframe on checkpoints; a fetch interrupted by a restart
yields a partial script that fails to parse. No app code change can prevent the truncated
network transfer.

# How to apply / fix
Make truncation self-recovering instead of a visible crash:
- Set a readiness flag at the very end of the main script (`window.__AMEEN_READY = true`
  right before bootstrap). If the file is truncated anywhere before that line, the flag stays unset.
- Inline bootstrap in the HEAD of index.html: catch the `Unexpected end of input` error
  scoped to the app script's filename, `preventDefault()` it, and reload exactly once
  (guard with a `sessionStorage` key to avoid reload loops; clear the key on healthy load).
- Also add a `window.load` fallback: if `__AMEEN_READY` is unset after load, reload once.

# Diagnostic trick
When the Replit console strips the stack, add a temporary inline `window.addEventListener('error', ...)`
that logs `e.filename/e.lineno/e.colno` to pinpoint the truncated resource.
