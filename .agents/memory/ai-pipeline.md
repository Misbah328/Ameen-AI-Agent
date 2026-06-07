---
name: AI meeting pipeline
description: Durable constraints for the Ameen Secretary AI processing pipeline (task extraction + proactive scheduling)
---

# AI meeting pipeline (src/services/pipeline.js)

- **Re-processing must be idempotent.** `processMeeting` is triggered both automatically
  (on recording stop) AND by a manual "Extract" button, so the same meeting can be
  processed more than once. Before inserting AI-derived rows it deletes prior rows for
  that meeting (`tasks WHERE source_meeting_id`, `decisions WHERE meeting_id`,
  `schedule WHERE source_meeting_id AND status='draft'`). Confirmed drafts are preserved.
  **Why:** without this, double-processing silently duplicates tasks/drafts.

- **Never persist fabricated data on AI failure.** On callClaude/JSON-parse failure the
  pipeline sets `meetings.status='error'` and throws — it does NOT fall back to writing
  synthetic demo tasks/decisions/drafts. **Why:** the product's core promise is accurate
  extraction; writing made-up tasks on a transient API hiccup breaks trust.

- **Owner matching is bilingual.** A task is owned if EITHER `owner_ar` OR `owner_en` is
  present. The user lookup uses a `\u0000` sentinel for the empty side so a blank field
  never `LIKE '%%'`-matches every user. `needs_review` is set only when both owner fields
  are empty, the date is missing, or the model explicitly flagged it.

- **Reminders fire ~15 min before, confirmed only.** `src/reminders.js` LEAD_MINUTES=15 and
  selects `status IS NULL OR status='confirmed'`. Drafts (auto-created from scheduling
  intents) do NOT arm reminders until confirmed via `PATCH /schedule/:id/confirm`.

- **Conflict check returns 409.** Both `POST /schedule` and the confirm route call
  `findConflicts` (overlap vs confirmed rows) and return HTTP 409 with a `conflicts` list
  unless `force:true` is passed. Frontend `Schedule.confirm` uses raw `fetch` (not the
  `api()` helper) because `api()` throws on non-2xx and can't read the 409 body. Auth is
  cookie-based — do not add Authorization headers.
