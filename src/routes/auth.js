'use strict';
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { JWT_SECRET } = require('../middleware/auth');

// On Replit the dev preview loads the app inside a cross-site iframe, where
// SameSite=Lax cookies are never sent on fetch/XHR — login would "succeed"
// but every subsequent API call 401s. SameSite=None (which requires Secure)
// is the standard fix there; production keeps the stricter Lax default.
const IS_REPLIT_DEV = !!process.env.REPLIT_DEV_DOMAIN && process.env.NODE_ENV !== 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: IS_REPLIT_DEV ? 'none' : 'lax',
  secure: IS_REPLIT_DEV || process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000  // 8 hours
};

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare(
    'SELECT id, name_ar, name_en, email, password, role_ar, role_en, lang_pref, system_role FROM users WHERE email = ?'
  ).get(email.trim().toLowerCase());

  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = bcrypt.compareSync(password, user.password || '');
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: user.id, email: user.email, system_role: user.system_role || 'Admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('ameen_token', token, COOKIE_OPTS);

  const { password: _pw, ...safeUser } = user;
  // DEV-ONLY: token is also returned in the body so the SPA can fall back to
  // an Authorization header when the browser blocks the cookie (see
  // middleware). In production the token stays exclusively in the HttpOnly
  // cookie — never exposed to page JavaScript.
  if (IS_REPLIT_DEV) return res.json({ success: true, user: safeUser, token });
  res.json({ success: true, user: safeUser });
});

// ── POST /auth/signup ─────────────────────────────────────────────────────────
router.post('/signup', (req, res) => {
  const { nameEn, nameAr, email, password, org } = req.body;

  // Validation
  if (!nameEn || !nameEn.trim()) return res.status(400).json({ error: 'Full name (English) is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const cleanEmail = email.trim().toLowerCase();

  // Duplicate check
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const hashed = bcrypt.hashSync(password, 10);
  const roleNote = org ? org.trim() : '';

  const result = db.prepare(
    `INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en, lang_pref, system_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    (nameAr && nameAr.trim()) || nameEn.trim(),
    nameEn.trim(),
    cleanEmail,
    hashed,
    roleNote || 'عضو',
    roleNote || 'Member',
    'ar',
    'Employee'
  );

  const user = db.prepare(
    'SELECT id, name_ar, name_en, email, role_ar, role_en, lang_pref, system_role FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);

  const token = jwt.sign(
    { id: user.id, email: user.email, system_role: user.system_role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('ameen_token', token, COOKIE_OPTS);
  if (IS_REPLIT_DEV) return res.status(201).json({ success: true, user, token });
  res.status(201).json({ success: true, user });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('ameen_token', { httpOnly: true, sameSite: COOKIE_OPTS.sameSite, secure: COOKIE_OPTS.secure });
  res.json({ success: true });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id, name_ar, name_en, email, role_ar, role_en, lang_pref, system_role FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ── PATCH /auth/lang ──────────────────────────────────────────────────────────
router.patch('/lang', auth, (req, res) => {
  db.prepare('UPDATE users SET lang_pref = ? WHERE id = ?').run(req.body.lang, req.user.id);
  res.json({ success: true });
});

// ── PATCH /auth/password ──────────────────────────────────────────────────────
router.patch('/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must differ from current' });
  const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(currentPassword, user.password || '')) return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true });
});

module.exports = router;
