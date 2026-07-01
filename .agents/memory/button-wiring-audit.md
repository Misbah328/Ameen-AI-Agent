---
name: Button wiring & "buttons do nothing" audits
description: How buttons are wired in the SPA and how to audit "buttons do nothing" reports without a wild goose chase
---

# Button wiring in the Ameen SPA

- Handlers are NOT on `window` (only `__AMEEN_READY` is). Objects like `App`, `Gov`, `Panels`, `Rec`, `Tasks`, `Modals`, `Schedule`, `Team`, `DocGen`, `Share`, `Chat`, `Integrations` are **top-level `const`** in `public/js/app.js` / `public/js/governance.js`.
- Inline `onclick="App.foo()"` resolves against **global scope, which includes the top-level lexical (script) environment** — so top-level `const` objects ARE reachable from inline handlers. This is correct and works; do not "fix" it by moving things onto `window`.
- Sidebar nav (`.nb[data-p=...]`) is wired via **event delegation** in `Panels.init()` (addEventListener), NOT inline onclick. An audit that only checks for `onclick` will false-positive these 12 nav buttons as "dead."
- Several download "buttons" are actually `<a href="/uploads/..." download>` styled with `.btn-ghost` — functional native links with no onclick. An onclick-only check false-positives them too.
- Only the active panel is `display:flex` (`.panel.active`); all others are `display:none`, so their buttons have 0 dimensions. Audits must switch panels (click the real `.nb`) before enumerating a panel's buttons.
- Pro-gated actions call `App.requirePro()` → opens the plan modal when plan is `free` (default). That's visible feedback, not a no-op.
- AI features (`Chat.send`, etc.) degrade to a demo reply when no AI key is set (`r.demo`), not a dead button.
- Toasts (`showToast`) render into `#global-toast-host` with `animation:fi .25s` and no `forwards` fill — momentarily `opacity:0` at frame 0, then settle at 1. Checking opacity immediately after firing gives a false "invisible" reading; wait ~300ms.

**Why:** A user reported "many buttons do nothing." A full static + runtime (headless Chromium, real login) audit found **zero broken buttons**: all onclick roots resolve, all 13 panels activate, modals/inline forms open, downloads valid, 0 console/page errors, all API GETs 2xx. The apparent "dead" buttons were audit false-positives (delegated nav + `<a download>`).

**How to apply:** To audit button health, log in via `/auth/login` (admin creds in project notes), set the JWT cookie in Puppeteer, click each real `.nb[data-p]`, then within `#panel-<name>` check each button for onclick OR an anchor href OR a delegated listener before calling it dead. Screenshots can't test inner pages (auth cookie can't be injected into the screenshot tool) — use Puppeteer.
