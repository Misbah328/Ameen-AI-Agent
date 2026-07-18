'use strict';
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { JWT_SECRET } = require('../middleware/auth');
const { sendEmail } = require('../utils/notify');

const IS_REPLIT_DEV = !!process.env.REPLIT_DEV_DOMAIN && process.env.NODE_ENV !== 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: IS_REPLIT_DEV ? 'none' : 'lax',
  secure: IS_REPLIT_DEV || process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function storeCode(userId, email, code) {
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)'
  ).run(userId, email, code, expiresAt);
}

async function sendVerificationEmail(email, code, lang) {
  const isAr = lang === 'ar';
  const subject = isAr ? 'رمز التحقق — أمين السكرتير' : 'Verification Code — Ameen Secretary';
  const html = `
<!DOCTYPE html>
<html dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}">
<body style="background:#0a0c14;font-family:'Segoe UI',system-ui,sans-serif;padding:0;margin:0;">
  <div style="max-width:480px;margin:40px auto;background:#12151f;border:1px solid #252a3d;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(145deg,#0d1f3c,#0a0c14);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #252a3d;">
      <div style="font-size:2rem;margin-bottom:8px;">🔐</div>
      <div style="color:#C9A84C;font-size:1.2rem;font-weight:800;">${isAr ? 'أمين السكرتير' : 'Ameen Secretary'}</div>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#b4b8cc;font-size:0.95rem;margin-bottom:24px;line-height:1.6;">
        ${isAr ? 'استخدم الرمز التالي لتأكيد بريدك الإلكتروني. صالح لمدة 15 دقيقة.' : 'Use the code below to verify your email address. Valid for 15 minutes.'}
      </p>
      <div style="background:#1a1e2e;border:2px solid #C9A84C;border-radius:12px;padding:20px 32px;display:inline-block;margin-bottom:24px;">
        <div style="color:#C9A84C;font-size:2.5rem;font-weight:900;letter-spacing:0.25em;font-family:monospace;">${code}</div>
      </div>
      <p style="color:#6b7190;font-size:0.8rem;">
        ${isAr ? 'إذا لم تطلب هذا، يمكنك تجاهل هذا البريد بأمان.' : "If you didn\'t request this, you can safely ignore this email."}
      </p>
    </div>
    <div style="padding:16px 32px;background:#0f1728;text-align:center;border-top:1px solid #252a3d;">
      <div style="color:#6b7190;font-size:0.75rem;">Ameen Secretary · ${isAr ? 'نظام الأمانة التنفيذية الذكية' : 'Smart Executive Secretariat'}</div>
    </div>
  </div>
</body>
</html>`;
  await sendEmail({ to: email, subject, html, text: `${subject}: ${code}` });
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare(
    'SELECT id, name_ar, name_en, email, password, role_ar, role_en, lang_pref, system_role, email_verified FROM users WHERE email = ?'
  ).get(email.trim().toLowerCase());

  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = bcrypt.compareSync(password, user.password || '');
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  // Block unverified users — send them back to verify
  if (!user.email_verified) {
    return res.status(403).json({ error: 'email_not_verified', email: user.email });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, system_role: user.system_role || 'Admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('ameen_token', token, COOKIE_OPTS);
  const { password: _pw, email_verified: _ev, ...safeUser } = user;
  if (IS_REPLIT_DEV) return res.json({ success: true, user: safeUser, token });
  res.json({ success: true, user: safeUser });
});

// ── POST /auth/signup ─────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { nameEn, nameAr, email, password, org } = req.body;

  if (!nameEn || !nameEn.trim()) return res.status(400).json({ error: 'Full name (English) is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(cleanEmail);

  // If account exists but unverified — resend code instead of error
  if (existing && !existing.email_verified) {
    const code = generateCode();
    storeCode(existing.id, cleanEmail, code);
    try { await sendVerificationEmail(cleanEmail, code, 'ar'); } catch (e) { console.error('Email send error:', e.message); }
    return res.status(200).json({ success: true, pending: true, email: cleanEmail });
  }

  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const hashed = bcrypt.hashSync(password, 10);
  const roleNote = org ? org.trim() : '';

  const result = db.prepare(
    `INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en, lang_pref, system_role, email_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`
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

  const code = generateCode();
  storeCode(result.lastInsertRowid, cleanEmail, code);

  try {
    await sendVerificationEmail(cleanEmail, code, 'ar');
  } catch (e) {
    console.error('Verification email error:', e.message);
  }

  res.status(201).json({ success: true, pending: true, email: cleanEmail });
});

// ── POST /auth/verify-email ───────────────────────────────────────────────────
router.post('/verify-email', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

  const cleanEmail = email.trim().toLowerCase();
  const row = db.prepare(
    `SELECT ev.*, u.id as uid, u.name_ar, u.name_en, u.role_ar, u.role_en, u.lang_pref, u.system_role
     FROM email_verifications ev
     JOIN users u ON u.id = ev.user_id
     WHERE ev.email = ? AND ev.used = 0
     ORDER BY ev.created_at DESC LIMIT 1`
  ).get(cleanEmail);

  if (!row) return res.status(400).json({ error: 'invalid_code' });
  if (row.used) return res.status(400).json({ error: 'invalid_code' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'code_expired' });
  if (row.code !== String(code).trim()) return res.status(400).json({ error: 'invalid_code' });

  // Mark code used + user verified
  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.uid);

  const user = db.prepare(
    'SELECT id, name_ar, name_en, email, role_ar, role_en, lang_pref, system_role FROM users WHERE id = ?'
  ).get(row.uid);

  const token = jwt.sign(
    { id: user.id, email: user.email, system_role: user.system_role || 'Admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('ameen_token', token, COOKIE_OPTS);
  if (IS_REPLIT_DEV) return res.json({ success: true, user, token });
  res.json({ success: true, user });
});

// ── POST /auth/resend-code ────────────────────────────────────────────────────
router.post('/resend-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT id, email_verified, lang_pref FROM users WHERE email = ?').get(cleanEmail);

  if (!user) return res.status(404).json({ error: 'No account found for this email' });
  if (user.email_verified) return res.status(400).json({ error: 'already_verified' });

  // Rate-limit: allow resend only if last code is older than 60s
  const last = db.prepare(
    "SELECT created_at FROM email_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(user.id);
  if (last) {
    const age = Date.now() - new Date(last.created_at).getTime();
    if (age < 60000) {
      const wait = Math.ceil((60000 - age) / 1000);
      return res.status(429).json({ error: 'rate_limited', wait });
    }
  }

  const code = generateCode();
  storeCode(user.id, cleanEmail, code);

  try {
    await sendVerificationEmail(cleanEmail, code, user.lang_pref || 'ar');
    res.json({ success: true });
  } catch (e) {
    console.error('Resend error:', e.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
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
