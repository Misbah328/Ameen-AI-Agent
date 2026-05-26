const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'ameen-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid' });
  }
};

module.exports = auth;
