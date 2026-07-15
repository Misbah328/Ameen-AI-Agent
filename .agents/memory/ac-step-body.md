---
name: AC step renderer body element
description: How AC step renderers must obtain the page body element to avoid silent no-ops
---

## Rule
Every `_renderStepN*()` function in `approval-cycle.js` must obtain the writable container as:
```js
const body = document.getElementById('ac-page-body');
if (!body) return;
```

**Why:** `this.main` is never assigned on the `ApprovalCycle` object — it is `undefined`. The guard `if (!body) return` then fires immediately, the renderer exits silently, and the existing AC overview cards remain visible. The Playwright test sees the old card grid instead of the new 3-column layout.

**How to apply:** Any new `_renderStep*` function must follow the same `getElementById('ac-page-body')` pattern used by Steps 1–6. Never use `this.main`, `this.el`, or any property that isn't explicitly assigned elsewhere.
