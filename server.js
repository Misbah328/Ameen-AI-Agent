require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', require('./src/routes/auth'));
app.use('/api', require('./src/routes/api'));

// SPA fallback
app.get('*', (req, res) => {
  const f = req.path.includes('login') ? 'login.html' : 'index.html';
  res.sendFile(path.join(__dirname, 'public', f));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`✓ Ameen Executive Secretary running at http://localhost:${PORT}`));
