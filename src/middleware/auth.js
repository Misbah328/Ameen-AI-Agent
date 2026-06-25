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
const auth = (req, res, next) => {
  const token = req.cookies && req.cookies.ameen_token;
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

module.exports = auth;
module.exports.requireRole = requireRole;
module.exports.JWT_SECRET = JWT_SECRET;
