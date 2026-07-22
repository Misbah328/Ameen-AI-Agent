---
name: window.ScheduledPanel exposure
description: const ScheduledPanel in app.js is not on window — must be explicitly exposed or all window.ScheduledPanel guards silently no-op
---

## Rule
Always add `window.ScheduledPanel = ScheduledPanel;` in app.js at the bootstrap block alongside `window.__AMEEN_READY = true`.

**Why:** `const ScheduledPanel = {...}` at the top level of a non-module `<script>` creates a binding in the global *lexical* environment but does NOT attach it to the `window` object. Every `if (window.ScheduledPanel)` guard in meetings.js (which loads after app.js) silently evaluates to false, so calls like `ScheduledPanel._pendingSel = ...` and `ScheduledPanel.select(...)` are never reached. The stale-meeting navigation bug was rooted in this: `openScheduleItem` set `_pendingSel` guarded by `window.ScheduledPanel`, the guard failed, `applyFilters()` auto-selected the first completed meeting instead.

**How to apply:** Any future singleton defined as `const Foo = {...}` in app.js that needs to be referenced via `window.Foo` in other script files must be explicitly assigned: `window.Foo = Foo;` at the bootstrap block near line 13564.

Note: `window.MT` is correctly exposed because meetings.js has an explicit `window.MT = MT;` at its end (line 2640). ScheduledPanel had no such assignment until this fix.
