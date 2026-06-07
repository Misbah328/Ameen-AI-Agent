// Deep Log Debugger — a hidden, append-only trace of exactly what the AI pipeline
// "sees" and does at every stage. Written to data/ai-debug.log so failures (e.g. a
// transcript that yields no tasks) can be diagnosed after the fact. Also mirrors a
// concise line to the console.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const LOG_FILE = path.join(DATA_DIR, 'ai-debug.log');
const MAX_BYTES = 2 * 1024 * 1024; // rotate at ~2MB to keep the file bounded

function ensureDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch (_) { /* file may not exist yet */ }
}

// stage: short label (e.g. 'process:start', 'ai:raw', 'task:created', 'task:none').
// detail: any JSON-serializable object describing what happened.
function aiLog(stage, detail = {}) {
  ensureDir();
  rotateIfNeeded();
  const entry = { ts: new Date().toISOString(), stage, ...detail };
  let line;
  try { line = JSON.stringify(entry); } catch (_) { line = JSON.stringify({ ts: entry.ts, stage, _unserializable: true }); }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
  console.log(`[ai] ${stage}`, detail && Object.keys(detail).length ? JSON.stringify(detail).slice(0, 300) : '');
}

function readRecent(limit = 200) {
  try {
    const txt = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = txt.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch (_) { return []; }
}

module.exports = { aiLog, readRecent, LOG_FILE };
