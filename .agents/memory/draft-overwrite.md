---
name: Draft overwrite bug
description: _editingDraftScheduleId must be reset to null in openCreate() and _renderCreate(reset=true) or the second draft will PATCH the first one
---

## Rule
`MT._editingDraftScheduleId` must be explicitly reset to `null` in **both**:
1. `openCreate()` — before any fresh create form opens
2. `_renderCreate(reset=true)` — when the form state is fully reset

Also clear it in the `submitCreate(isDraft=true)` success path (after `showList()`) as a third layer of defense.

**Why:** After the first "Save as Draft" succeeds, `submitCreate` sets `this._editingDraftScheduleId = draftRow.id`. This field is an instance property of `MT` and persists across form sessions. When the user opens a second New Meeting form, `_renderCreate(true)` resets `_cs` but does NOT reset `_editingDraftScheduleId`. So on the second "Save as Draft", the guard `if (isDraft && this._editingDraftScheduleId)` at the top of `submitCreate` evaluates to `true` — it enters the PATCH branch and patches the FIRST draft's schedule row with the second draft's data, then returns early without creating a new meeting record. The first draft silently disappears.

**How to apply:** Any code path that opens a fresh create form must ensure `_editingDraftScheduleId = null` first. `editDraft(scheduleId)` is the ONLY path that should SET this field (it sets it to the existing draft being edited). `openCreate()` always clears it. Server-side has no upsert logic — this is purely a frontend state management problem.
