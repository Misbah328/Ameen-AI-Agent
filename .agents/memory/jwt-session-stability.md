---
name: JWT session stability & 401 handling
description: JWT_SECRET must be persistent; api() needs a global 401→login redirect to prevent loading spinners on session expiry.
---

## The rule
Always set `JWT_SECRET` as a persistent environment variable. The global `api()` function must redirect to login on any 401, not just during `App.init()`.

**Why:** `src/middleware/auth.js` falls back to `crypto.randomBytes(32)` when `JWT_SECRET` is unset, generating a new random secret per process start. Every server restart invalidates all existing tokens. Callers that use `.catch(() => [])` silently swallow 401 errors and render empty content or leave the loading spinner permanently.

**How to apply:**
- `JWT_SECRET` must be in Replit Secrets or shared env vars before any restart
- In `api()` (public/js/app.js): check `r.status === 401` before throwing, clear `ameen_token_fb` from sessionStorage, and call `window.location.replace("/login.html")`
- This intercepts session expiry from ANY endpoint mid-use, not just at boot
