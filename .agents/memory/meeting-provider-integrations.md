---
name: Meeting provider & external integrations are UI-only
description: Zoom/Teams/Google Meet have no real API integration; what "connected" actually means
---

# Meeting providers are manual-URL only — no API integration

Zoom, Microsoft Teams, and Google Meet have **no** OAuth, API keys, or service
clients anywhere in the codebase. Selecting a provider only stores a
manually-pasted join URL; nothing is auto-created on the provider side.

**Why:** A UI honesty audit required not-fully-functional features be clearly
labeled. The canonical user-facing string is exactly:
`Integration Ready - API credentials required`
(AR: `التكامل جاهز — تتطلب بيانات اعتماد API`).

**How to apply:** Making providers actually "work" (auto-create meetings, import
cloud recordings/transcripts, calendar sync) is net-new API integration work
that does not exist yet. Do not relabel any provider state as "Connected" until
real API/OAuth wiring + backend sync are added. The Task Tracker is internal
(built-in), not an external integration.
