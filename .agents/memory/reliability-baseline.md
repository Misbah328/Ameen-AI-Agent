---
name: Reliability baseline
description: Crash-proofing, notification validation, and test scaffolding already in place — don't duplicate.
---

## What is already done (do not re-implement)

**Server crash-proofing (server.js)**
- Global Express error-handling middleware (`app.use((err,req,res,next)=>…)`) returns JSON 500.
- `process.on('unhandledRejection')` and `process.on('uncaughtException')` keep the process alive.

**Notification validation (src/utils/validate.js)**
- `isValidEmail`, `isValidPhone`, `normalizePhone`, `splitRecipients`, `partition` are exported and used.
- `/api/email/send` validates via `partition(all, isValidEmail)` — returns 400 on bad addresses.
- `/api/meetings/:id/whatsapp-summary` validates via `partition(allPhones, isValidPhone)`.
- `/api/meetings/:id/share` is wrapped in try/catch.

**Extraction prompt (src/services/pipeline.js)**
- `buildSystemPrompt` already has "قاعدة الاستخراج 100%": extracts questions, suggestions, self-commitments, passing `needs_review=true` when unsure.

**Edit-to-Reminder test (scripts/edit-to-reminder-test.js)**
- `reminders.js` exports `buildReminderMessage`, `checkAndSend`, `LEAD_MINUTES`.
- Test: creates wrong-time row → edits → asserts reminder body has edited time → runs checkAndSend without throw.
- Run: `node scripts/edit-to-reminder-test.js` — must exit 0 before any release.

**Why:** These were all built during a reliability-rebuild session. Check here before adding validation logic.
