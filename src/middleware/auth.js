'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const fallback = require('crypto').randomBytes(32).toString('hex');
  console.warn('[AUTH] WARNING: JWT_SECRET not set. Using a per-process fallback — all sessions will reset on restart. Set JWT_SECRET in Replit Secrets for persistent sessions.');
  return fallback;
})();

/**
 * auth middleware — verifies JWT from httpOnly cookie "ameen_token".
 * Sets req.user = { id, email, system_role } on success.
 * Returns 401 JSON if missing or invalid.
 */
// Bearer-header fallback is DEV-ONLY (Replit preview iframes / e2e browsers
// with strict third-party-cookie blocking). Production stays cookie-only so
// the HttpOnly protection is never weakened there.
const ALLOW_BEARER_FALLBACK = !!process.env.REPLIT_DEV_DOMAIN && process.env.NODE_ENV !== 'production';

const auth = (req, res, next) => {
  let token = req.cookies && req.cookies.ameen_token;
  if (!token && ALLOW_BEARER_FALLBACK) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) token = h.slice(7);
  }
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Not logged in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email, system_role: payload.system_role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Session expired or invalid. Please log in again.' });
  }
};

/**
 * requireRole(...roles) — must be used AFTER auth middleware.
 * Usage: router.delete('/admin-route', auth, requireRole('Admin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const role = req.user.system_role || 'Employee';
    if (!roles.includes(role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'هذا الإجراء يتطلب صلاحيات خاصة / Insufficient permissions for this action'
      });
    }
    next();
  };
}

/**
 * requirePermission(...permissionKeys) — must be used AFTER auth middleware.
 * Looks up the caller's role's CURRENT granted permissions fresh from the DB
 * on every request (not cached, not baked into the JWT) so edits made in the
 * Role Management UI take effect immediately for all holders of that role.
 * Passes if the caller's role has ANY of the listed permission keys.
 * Usage: router.delete('/meetings/:id', auth, requirePermission('meetings.delete'), handler)
 */
function requirePermission(...permissionKeys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    // Lazy require to avoid a require-cycle with src/db/database.js at module load time.
    const db = require('../db/database');
    const { hasPermission } = require('../services/rbac');
    const granted = permissionKeys.some((key) => hasPermission(db, req.user.id, key));
    if (!granted) {
      return res.status(403).json({
        error: 'FORBIDDEN_PERMISSION',
        message: 'لا تملك الصلاحية اللازمة لهذا الإجراء / You do not have the required permission for this action',
        required: permissionKeys,
      });
    }
    next();
  };
}

/**
 * requireTier(minTier) — must be used AFTER auth middleware.
 * Returns HTTP 402 if the organisation's current plan is below minTier.
 * Reads the plan from organizations.plan (primary) with a fallback to the
 * legacy settings table so the single-org install still works.
 */
const TIER_RANK_TABLE = { basic: 1, plus: 2, advanced: 3, enterprise: 4 };
const TIER_NAMES_TABLE = {
  basic:      { ar: 'أساسي',   en: 'Basic'      },
  plus:       { ar: 'بلس',     en: 'Plus'        },
  advanced:   { ar: 'متقدم',   en: 'Advanced'    },
  enterprise: { ar: 'مؤسسي',  en: 'Enterprise'  },
};
function _normalizeTier(raw) {
  if (!raw) return 'basic';
  if (raw === 'free') return 'basic';
  if (raw === 'pro')  return 'advanced';
  return TIER_RANK_TABLE[raw] ? raw : 'basic';
}
/**
 * getOrgPlan(userId?) — resolve the subscription tier for a given user (or the
 * global installation when userId is omitted / the user has no org link).
 * Resolution order:
 *  1. organizations.plan WHERE id = user's organization_id   (per-org, scoped)
 *  2. organizations.plan ORDER BY id LIMIT 1                 (single-tenant fallback)
 *  3. settings.plan                                          (legacy global fallback)
 */
function getOrgPlan(userId) {
  const db = require('../db/database');
  try {
    if (userId) {
      // Org-scoped: look up the org for this user
      const user = db.prepare('SELECT organization_id FROM users WHERE id=?').get(userId);
      const orgId = user && user.organization_id;
      if (orgId) {
        const org = db.prepare('SELECT plan FROM organizations WHERE id=?').get(orgId);
        if (org && org.plan) return _normalizeTier(org.plan);
      }
    }
    // Single-tenant fallback: first org in the system
    const org = db.prepare('SELECT plan FROM organizations ORDER BY id LIMIT 1').get();
    if (org && org.plan) return _normalizeTier(org.plan);
  } catch (_) { /* column may not have been migrated yet */ }
  // Final legacy fallback: global settings key
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('plan');
  return _normalizeTier(row && row.value);
}
function requireTier(minTier) {
  return (req, res, next) => {
    // Pass req.user.id so plan is resolved for the caller's org
    const plan = getOrgPlan(req.user && req.user.id);
    if ((TIER_RANK_TABLE[plan] || 1) < (TIER_RANK_TABLE[minTier] || 1)) {
      const need = TIER_NAMES_TABLE[minTier] || { ar: minTier, en: minTier };
      return res.status(402).json({
        error: 'TIER_REQUIRED',
        required_tier: minTier,
        message: `هذه الميزة تتطلب باقة ${need.ar} أو أعلى / This feature requires the ${need.en} plan or higher`,
      });
    }
    next();
  };
}

module.exports = auth;
module.exports.requireRole = requireRole;
module.exports.requirePermission = requirePermission;
module.exports.requireTier = requireTier;
module.exports.getOrgPlan = getOrgPlan;
module.exports.JWT_SECRET = JWT_SECRET;
