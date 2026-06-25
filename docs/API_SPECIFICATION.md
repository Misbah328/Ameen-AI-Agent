# API Specification

## Overview

This document defines the REST APIs for Ameen Secretary.

All clients (Web, Mobile, Desktop, AI Agents, Integrations) communicate through these APIs.

---

# Authentication

POST /api/auth/login

POST /api/auth/logout

POST /api/auth/refresh

GET /api/auth/profile

---

# Users

GET /api/users

GET /api/users/{id}

POST /api/users

PUT /api/users/{id}

DELETE /api/users/{id}

---

# Organizations

GET /api/organizations

POST /api/organizations

PUT /api/organizations/{id}

---

# Meetings

GET /api/meetings

GET /api/meetings/{id}

POST /api/meetings

PUT /api/meetings/{id}

DELETE /api/meetings/{id}

---

# Recording

POST /api/meetings/{id}/start-recording

POST /api/meetings/{id}/stop-recording

GET /api/meetings/{id}/recording

---

# Transcripts

GET /api/transcripts/{meetingId}

POST /api/transcripts

PUT /api/transcripts/{id}

---

# AI Summary

POST /api/ai/summarize

GET /api/ai/summary/{meetingId}

---

# Decisions

GET /api/decisions

POST /api/decisions

PUT /api/decisions/{id}

DELETE /api/decisions/{id}

---

# Action Items

GET /api/action-items

POST /api/action-items

PUT /api/action-items/{id}

DELETE /api/action-items/{id}

---

# Tasks

GET /api/tasks

POST /api/tasks

PUT /api/tasks/{id}

DELETE /api/tasks/{id}

---

# Reports

POST /api/reports/generate

GET /api/reports/{id}

GET /api/reports/download/{id}

---

# AI Chat

POST /api/chat

POST /api/chat/context

POST /api/chat/search

---

# Knowledge Base

POST /api/documents/upload

GET /api/documents

DELETE /api/documents/{id}

POST /api/search

---

# Notifications

POST /api/notifications/send

GET /api/notifications

---

# Calendar

GET /api/calendar

POST /api/calendar/event

PUT /api/calendar/event/{id}

DELETE /api/calendar/event/{id}

---

# Governance (Future)

GET /api/boards

GET /api/committees

GET /api/resolutions

POST /api/votes

GET /api/quorum

---

# External Integrations

Zoom

Google Meet

Microsoft Teams

Google Calendar

Microsoft Outlook

WhatsApp Business

Slack

Microsoft 365

Google Drive

OneDrive

SharePoint

---

# API Standards

- REST API
- JSON responses
- JWT Authentication
- HTTPS only
- OpenAPI 3.0
- Versioning (/api/v1)
- Rate limiting
- Audit logging
