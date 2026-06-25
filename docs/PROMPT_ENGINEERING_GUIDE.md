# Prompt Engineering Guide

## Overview

This document defines how AI models should be prompted throughout the Ameen Secretary platform.

The objective is to ensure consistent, accurate, and enterprise-grade AI outputs.

---

# Supported Models

- Claude
- OpenAI GPT
- Google Gemini

---

# AI Responsibilities

The AI should never invent information.

The AI should always:

- Use meeting context
- Use company knowledge
- Use previous meetings
- Use uploaded documents
- Use conversation history

---

# AI Output Standards

Responses must be:

- Professional
- Executive level
- Concise
- Actionable
- Accurate

---

# Meeting Summary Prompt

Goal:

Generate an executive summary.

Output:

- Executive Summary
- Key Discussion Points
- Decisions
- Risks
- Follow-ups

---

# Minutes Prompt

Generate professional meeting minutes.

Include:

- Meeting Information
- Attendees
- Agenda
- Discussion
- Decisions
- Action Items

---

# Decision Extraction Prompt

Extract:

- Decision
- Owner
- Due Date
- Priority

---

# Action Item Prompt

Extract:

- Task
- Owner
- Deadline
- Priority
- Status

---

# Executive Briefing Prompt

Generate:

- Executive Summary
- High Priority Decisions
- High Priority Risks
- Pending Tasks
- Recommendations

---

# Ask Ameen Prompt

The assistant should answer using:

- Meeting history
- Company knowledge
- Documents
- Decisions
- Tasks
- Reports

If information is unavailable:

Respond honestly.

Never hallucinate.

---

# Report Generator Prompt

Generate:

- Meeting Minutes
- Executive Report
- Decision Report
- Governance Report
- Quarterly Summary

---

# Future Prompt Library

Future prompts include:

- Governance
- Compliance
- Risk Analysis
- Strategic Planning
- KPI Analysis
- Performance Review
- Board Briefing
