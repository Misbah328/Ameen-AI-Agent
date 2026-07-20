---
name: Subscription tier system
description: How requireTier() works, where the plan is stored, and all enforcement points across the app.
---

# Subscription Tier System

## Rule
`requireTier(minTier)` is defined in `src/middleware/auth.js` and exported. All route modules (`api.js`, `governance.js`, `rbac.js`) import it from there — never duplicate the implementation.

**Why:** Code review rejected an earlier version that only defined requireTier locally in api.js; governance.js and rbac.js routes were ungated.

## Plan storage
- Primary: `organizations.plan` column (read first by `getOrgPlan()` in auth.js)
- Fallback: `settings` table key `'plan'` (legacy, kept in sync on writes)
- Write path: PATCH /api/plan writes BOTH organizations.plan and settings for backward compat

## Tier → rank
`{ basic: 1, plus: 2, advanced: 3, enterprise: 4 }`

## Enforcement points (backend)
- `api.js`: /meetings/:id/share → advanced; /documents/share → advanced; /tasks/:id/escalate → advanced; all approval-cycle mutating routes → plus; PATCH /ai/document → plus
- `governance.js`: boards/committees (POST/PATCH/DELETE) → advanced; circular-resolutions (all mutations) → advanced; policies (POST/PATCH/DELETE) → plus
- `rbac.js`: roles CRUD + user-permissions PUT → enterprise

## Enforcement points (frontend)
- `Panels.init()` intercepts sidebar clicks to locked panels → shows upgrade modal
- `Panels.load()` guards ALL navigation paths (hash, programmatic, back/forward)
- `api()` helper catches HTTP 402 with `error: 'TIER_REQUIRED'` → shows upgrade modal
- `App.requireTier(minTier, featureName)` used on inline action buttons
- `applySidebarTierLocks()` called by `applySidebarRoles()` to add 🔒 badge + .nb-locked class

## How to apply
When adding a new feature to a panel that has a tier gate:
1. Add its panel key to PANEL_TIER in app.js
2. Add requireTier() to all its mutating API routes
3. Wrap any inline action buttons with App.requireTier() in onclick
