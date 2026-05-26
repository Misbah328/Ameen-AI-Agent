const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

// POST /auth/signup
router.post('/signup', (req, res) => {
  const { name_ar, name_en, email, password, role_ar, role_en, invite_code } = req.body;
  const expected = process.env.INVITE_CODE || 'ameen2026';
  if (invite_code !== expected) return res.status(403).json({ error: 'رمز الدعوة غير صحيح / Invalid invite code' });
  if (!name_ar || !email || !password) return res.status(400).json({ error: 'بيانات ناقصة / Missing required fields' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const row = db.prepare(`
      INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name_ar, name_en || name_ar, email, hash, role_ar || 'عضو', role_en || 'Member');
    const user = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, lang_pref FROM users WHERE id=?').get(row.lastInsertRowid);
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'ameen-secret', { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ success: true, user, token });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'البريد الإلكتروني مستخدم / Email already in use' });
    res.status(500).json({ error: e.message });
  }
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة / Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'ameen-secret', { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, token });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /auth/me
router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, lang_pref FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

// PATCH /auth/lang
router.patch('/lang', require('../middleware/auth'), (req, res) => {
  db.prepare('UPDATE users SET lang_pref=? WHERE id=?').run(req.body.lang, req.user.id);
  res.json({ success: true });
});

module.exports = router;
