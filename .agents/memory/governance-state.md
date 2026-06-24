---
name: Governance feature state
description: New governance DB tables, API routes, and client panel — what was added and where.
---

## DB tables added (src/db/database.js)
- `agenda_items` — per-meeting/schedule agenda items with title, description, presenter, expected_outcome, duration_mins
- `meeting_documents` — attached docs (mock/sample flag is_mock), linked to meeting or schedule
- `meeting_quorum` — required_members, present_members, quorum_achieved (auto-computed)
- `resolutions` — with vote counts (votes_approve/reject/abstain), status auto-derived from majority vote
- `resolution_followups` — owner, due_date, status, notes per resolution

## Existing table extensions (via ensureColumn)
- `meeting_attendees.role` (TEXT DEFAULT 'Member') — roles: Chairperson, Board Member, Executive, Presenter, Consultant, Observer, Secretary
- `meeting_attendees.attendance_status` (TEXT DEFAULT 'pending') — statuses: present, absent, excused, pending

## API routes (src/routes/governance.js → /api/gov/)
- `/agenda` GET/POST/PATCH/:id/DELETE/:id
- `/documents` GET/POST/DELETE/:id
- `/attendance` GET/POST/PATCH/:id/DELETE/:id (extends meeting_attendees)
- `/quorum` GET/PUT (upsert)
- `/resolutions` GET/POST/PATCH/:id/DELETE/:id
- `/resolutions/:id/vote` POST — vote: 'approve'|'reject'|'abstain'; auto-sets status
- `/resolutions/:id/followups` POST
- `/followups/:id` PATCH/DELETE

## Client-side
- Sidebar: "الحوكمة / Governance" section with ⚖️ button → panel-governance
- Panel: meeting selector (recorded + scheduled), then 5 collapsible cards: Agenda, Attendance & Roles, Quorum, Resolutions & Voting, Documents
- Module: public/js/governance.js — standalone Gov object, loaded after app.js
- app.js Panels switch: `case 'governance': await Gov.init(); break;`
- Attendance section only renders for recorded meetings (not schedule-only)

## Task modal reuse pattern (unrelated to governance)
- `Modals._editingId` — set before opening modal-task for edit; null means add mode
- `Modals.saveTask()` checks `_editingId` and routes to PATCH vs POST

**Why:** Governance is a multi-table feature; if schema changes are needed, update all five tables and re-check `withFollowups()` in the routes file.
