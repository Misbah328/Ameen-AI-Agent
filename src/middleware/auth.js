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

module.exports = auth;
module.exports.requireRole = requireRole;
module.exports.requirePermission = requirePermission;
module.exports.JWT_SECRET = JWT_SECRET;
