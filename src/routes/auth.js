const router = require('express').Router();
const db = require('../db/database');

// GET /auth/me — returns the default user (no login required)
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
