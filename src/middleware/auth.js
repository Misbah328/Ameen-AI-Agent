const db = require('../db/database');

// Login has been removed. Every request runs as the default executive user
// (the first/seed user, typically the CEO). This keeps req.user.id available
// for all routes without requiring a token or sign-in.
let cachedUser = null;

function getDefaultUser() {
  if (cachedUser) return cachedUser;
  const u = db.prepare('SELECT id, email FROM users ORDER BY id ASC LIMIT 1').get();
  if (u) cachedUser = u;
  return u;
}

const auth = (req, res, next) => {
  const u = getDefaultUser();
  req.user = u ? { id: u.id, email: u.email } : { id: 1, email: 'system@ameen.ai' };
  next();
};

module.exports = auth;
