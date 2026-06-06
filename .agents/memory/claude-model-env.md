---
name: Claude model env var
description: How AI model selection works in this app and how to fix deprecated-model failures.
---

All AI calls go through `callClaude()` in `src/routes/api.js`, which reads the model from `process.env.CLAUDE_MODEL` (falling back to a hardcoded default). The `ANTHROPIC_API_KEY` secret is valid.

**Symptom:** Anthropic REST returns `{"type":"error","error":{"type":"not_found_error","message":"model: <name>"}}`. This means the model name is deprecated/retired, NOT a bad key. Every AI feature (chat, document gen, live-extract, recording processing) breaks at once.

**Fix:** Set the `CLAUDE_MODEL` shared env var to a currently-available model. Verify a candidate first with a direct `curl https://api.anthropic.com/v1/messages` before setting it. A known-good model as of 2026-06: `claude-sonnet-4-5-20250929`.

**Why:** The default baked into the code goes stale as Anthropic retires older snapshots; overriding via env avoids a code edit and keeps dev/prod in sync (set in the `shared` environment).
