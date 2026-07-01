---
name: Button wiring & "buttons do nothing" audits
description: How buttons are wired in this SPA and the real root-cause classes behind "buttons do nothing" reports
---

# Button wiring model

- Inline `onclick="App.foo()"` handlers are NOT on `window`. Objects like `App`, `Gov`, `Panels`, etc. are **top-level `const`** in the frontend scripts. Inline handlers resolve them via global scope (which includes the top-level lexical environment) — this is correct; do NOT "fix" it by moving handlers onto `window`.
- Sidebar navigation is wired by **event delegation** (a single addEventListener), not inline onclick. Several download "buttons" are `<a href download>` anchors with no handler. An audit that only checks for `onclick` will **false-positive** both as dead buttons — they work.
- Only the active panel is displayed; inactive panels are `display:none`, so their buttons have 0 dimensions. Any DOM audit must activate a panel (click its real nav item) before enumerating that panel's controls.
- Pro-gated actions open an upgrade modal; AI actions degrade to a demo reply when no key is set. Both are visible feedback, not dead buttons.

**How to apply:** to judge button health, click the real nav item, then within the active panel accept a control as live if it has an onclick OR an anchor href OR a delegated listener before calling it dead.

# The "button spins forever" hang class (highest-value root cause)

**Rule:** in this Express 4 app, an `async` route handler that throws/rejects **anywhere outside a try/catch** is never caught by the global error middleware (which only rescues sync throws / `next(err)`). The request hangs indefinitely → the frontend button shows a permanent loading state and appears to "do nothing". `process.on('unhandledRejection')` only logs; it never responds.

**Why:** an async function turns even a *synchronous* throw into a rejected promise, so the sync-only global handler cannot help. Every async handler must have a try/catch covering the entire body (all `await`s and any throwable pre-await code), sending a JSON error in the catch — OR be wrapped by an async wrapper that funnels rejections to `next`.

**Notify contract (the usual throw source):** `notify.notify(...)` swallows per-channel failures and returns `{emailError,...}` — safe to call unguarded. `notify.sendEmail(...)` / `sendWhatsApp(...)` **can throw** (provider failure, and for email the Replit-Mail fallback can also throw). Wrap each call in a loop so one bad recipient neither aborts the loop nor hangs the request.

**How to apply:** when a user reports "buttons do nothing," audit async handlers first for an `await` (or throwable statement) sitting outside a try/catch — that is the prime suspect, far more than missing onclick handlers.
