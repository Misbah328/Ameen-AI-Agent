---
name: Outbound HTML email escaping
description: All dynamic fields placed into outbound email HTML must be HTML-escaped to prevent injection.
---

Every dynamic value interpolated into an outbound email's HTML body (share routes, document/report share) must pass through the backend `esc()` helper.

**Why:** Attendee names, meeting titles, AI-generated summaries/tasks/decisions, and transcript text are all attacker- or model-influenced. Code review flagged a real XSS/HTML-injection risk where only the full-minutes/transcript blocks were escaped while names, titles, summaries, and task/decision text were injected raw.

**How to apply:** In `src/routes/api.js`, any `${...}` inside an HTML email template string needs `esc(...)`. Plain-text email bodies do not need escaping. The `esc()` helper is defined near the top of api.js.
