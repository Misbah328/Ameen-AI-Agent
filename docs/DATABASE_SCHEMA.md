# Database Schema

## Overview

This document defines the core database structure for Ameen Secretary.

The database must support meetings, transcripts, AI summaries, decisions, action items, tasks, reports, users, teams, agents, and future governance features.

---

# Core Tables

## users

Fields:

- id
- name
- email
- role
- organization_id
- created_at
- updated_at

Roles:

- Admin
- CEO
- Executive
- Board Member
- Manager
- Employee
- Secretary
- Observer

---

## organizations

Fields:

- id
- name
- industry
- country
- created_at
- updated_at

---

## meetings

Fields:

- id
- organization_id
- title
- meeting_type
- date
- time
- duration
- status
- agenda
- notes
- created_by
- previous_meeting_id
- created_at
- updated_at

---

## meeting_participants

Fields:

- id
- meeting_id
- user_id
- name
- email
- role
- attendance_status
- expected_contribution
- expected_deliverable

---

## transcripts

Fields:

- id
- meeting_id
- transcript_text
- speaker_data
- language
- created_at

---

## ai_summaries

Fields:

- id
- meeting_id
- executive_summary
- meeting_minutes
- key_points
- risks
- follow_ups
- created_at

---

## decisions

Fields:

- id
- meeting_id
- title
- description
- owner_id
- status
- decision_date
- created_at
- updated_at

---

## action_items

Fields:

- id
- meeting_id
- title
- description
- owner_id
- due_date
- priority
- status
- source_text
- created_at
- updated_at

---

## tasks

Fields:

- id
- action_item_id
- meeting_id
- title
- description
- owner_id
- due_date
- priority
- status
- progress
- created_at
- updated_at

---

## reports

Fields:

- id
- meeting_id
- report_type
- title
- content
- generated_by
- created_at

---

# Future Governance Tables

## boards

Fields:

- id
- organization_id
- name
- chairperson_id
- description
- created_at

## committees

Fields:

- id
- board_id
- name
- chairperson_id
- description
- created_at

## resolutions

Fields:

- id
- meeting_id
- title
- description
- status
- owner_id
- due_date
- created_at

## votes

Fields:

- id
- resolution_id
- voter_id
- vote_value
- voted_at

Vote values:

- Approve
- Reject
- Abstain

---

# Database Relationships

- One organization has many users.
- One organization has many meetings.
- One meeting has many participants.
- One meeting has one or more transcripts.
- One meeting has one AI summary.
- One meeting has many decisions.
- One meeting has many action items.
- One action item can become one task.
- One meeting can generate many reports.
- One board can have many committees.
- One meeting can have many resolutions.
- One resolution can have many votes.

---

# MVP Priority

For MVP, implement first:

1. users
2. meetings
3. meeting_participants
4. transcripts
5. ai_summaries
6. decisions
7. action_items
8. tasks
9. reports

Governance tables can be added after MVP.
