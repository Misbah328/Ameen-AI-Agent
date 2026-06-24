require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'data/uploads')));

app.use('/auth', require('./src/routes/auth'));
app.use('/api', require('./src/routes/api'));
app.use('/api/gov', require('./src/routes/governance'));

// Public attendee confirmation page (token-gated, no login)
app.get('/m/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirm.html'));
});

// SPA fallback — login removed, always serve the app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// Any error thrown (sync or via next(err)) in a route lands here and returns a
// clean JSON 500 instead of crashing the process or hanging the request.
app.use((err, req, res, next) => {
  console.error('✗ Unhandled route error:', err && err.message, err && err.stack);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: (err && err.message) || 'Internal server error' });
});

// Process-level safety nets — a rejected promise or stray throw (e.g. a flaky
// notification API) must never take the whole server down during a live demo.
process.on('unhandledRejection', (reason) => {
  console.error('✗ Unhandled promise rejection:', reason && (reason.message || reason));
});
process.on('uncaughtException', (err) => {
  console.error('✗ Uncaught exception (kept alive):', err && err.message, err && err.stack);
});

const { startReminderScheduler } = require('./src/reminders');

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Ameen Secretary running at http://localhost:${PORT}`);
  startReminderScheduler();
});
