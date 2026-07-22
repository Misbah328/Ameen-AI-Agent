---
name: CalendarPanel._open stale pattern
description: Never use Panels.load().then(setTimeout(MT.openDetail)) in CalendarPanel — use MT.openDetail/MT.openScheduleItem directly
---

## Rule
`CalendarPanel._open(kind, id)` must call `MT.openDetail(id)` (for held meetings) or `MT.openScheduleItem(id)` (for scheduled items) directly — never `Panels.load("scheduled").then(() => setTimeout(() => MT.openDetail(id), 300))`.

**Why:** The `Panels.load().then(setTimeout)` pattern bypasses `MT._pending`. When `Panels.load("scheduled")` runs, `MT.onPanelShow()` is called synchronously and hits the `if (this._view === "detail" && this._d) { this._renderDetail(); return; }` fallback — re-rendering whichever meeting was previously viewed. The 300ms `setTimeout` then fires the correct meeting, but the user sees a flash of the wrong meeting (or in race conditions, the wrong meeting persists).

**How to apply:** Both `MT.openDetail(id)` and `MT.openScheduleItem(id)` set `MT._pending` before calling `Panels.load` internally, so `onPanelShow` correctly handles the transition. Any future calendar/sidebar "open meeting" handler should use these methods directly — no `Panels.load` wrapping needed.
