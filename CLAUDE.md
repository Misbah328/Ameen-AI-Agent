CLAUDE.md
# Ameen Secretary - Claude Development Guide

## Product Vision

Ameen Secretary is an AI-powered Executive Secretary, Meeting Intelligence, Governance, and Board Intelligence Platform.

The product should evolve from an MVP into a full Executive AI Operating System for CEOs, boards, committees, and enterprise leadership teams.

## Current MVP Goal

The MVP workflow is:

Meeting → Transcript → Summary → Decisions → Action Items → Tasks → Ask Ameen → Reports → Dashboard

## MVP Modules

1. Meeting Management
2. Transcript Management
3. AI Meeting Intelligence
4. Action Item Extraction
5. Task Tracker
6. Decision Tracking
7. Ask Ameen
8. Report Generator
9. Dashboard
10. Team Members

## Development Rules

- Do not redesign the UI unless explicitly requested.
- Do not remove existing functionality.
- Do not break existing pages.
- Improve the current prototype step by step.
- Build small, safe features first.
- Always explain which files were changed.
- Always explain how to test the feature.
- Keep the code clean and reusable.
- Prefer production-ready structure, but do not over-engineer the MVP.

## MVP Boundaries

Do not implement these until the MVP is stable:

- Zoom integration
- Google Meet integration
- Microsoft Teams integration
- WhatsApp automation
- Digital signatures
- Advanced voting
- Quorum
- Payment system
- Mobile app
- Complex multi-agent orchestration

## Future Product Vision

After MVP, the product should support:

- Board Governance
- Committee Management
- Quorum
- Voting
- Resolution Tracking
- Document Management
- Calendar Integration
- Notifications
- Executive Analytics
- Multi-Agent AI System

## Future AI Agents

Future agents include:

1. Meeting Intelligence Agent
2. Task Management Agent
3. Scheduling Agent
4. Reporting Agent
5. Notification Agent
6. Governance Agent
7. Executive Knowledge Agent
8. Compliance Agent

## Coding Instructions for Claude

When working on this project:

1. Read this file first.
2. Analyze before changing code.
3. Never rewrite the full application unless requested.
4. Preserve the existing design system.
5. Keep current pages working.
6. Implement one feature at a time.
7. After every change, summarize:
   - Files changed
   - What was implemented
   - How to test it
   - What remains pending
