const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bidi = require('bidi-js')();

// PDFKit (via fontkit) already applies Arabic contextual letter-joining
// automatically when rendering, but it lays text out as a plain left-to-right
// character stream with no bidi reordering of its own — so raw Arabic renders
// with words in the wrong visual order (verified empirically: pre-shaping
// with a reshaper library before reordering actually breaks fontkit's own
// shaping and collapses spacing between words — do NOT reshape, only
// reorder). Run the Unicode Bidi Algorithm to get the correct left-to-right
// visual order for PDFKit to draw as-is. Applied per explicit line (not per
// pdfkit-wrapped line) since wrapping happens after this call — long
// paragraphs still read correctly, just without perfect bidi-aware
// re-wrapping exactly at the wrap point.
function shapeArabicText(text) {
  if (!text) return text;
  return String(text).split('\n').map(line => {
    if (!line.trim() || !/[؀-ۿ]/.test(line)) return line;
    const levels = bidi.getEmbeddingLevels(line);
    return bidi.getReorderedString(line, levels);
  }).join('\n');
}

// ── Arabic font (Amiri) — downloaded once, cached on disk ────────────────────
const FONTS_DIR = path.join(__dirname, '../../data/fonts');
let _arabicFontPath = null;
async function getArabicFont() {
  if (_arabicFontPath && fs.existsSync(_arabicFontPath)) return _arabicFontPath;
  const fontPath = path.join(FONTS_DIR, 'Amiri-Regular.ttf');
  if (fs.existsSync(fontPath)) { _arabicFontPath = fontPath; return fontPath; }
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });
  const https = require('https');
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    https.get('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf', r => {
      if (r.statusCode !== 200) return reject(new Error(`font HTTP ${r.statusCode}`));
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
      r.on('error', reject);
    }).on('error', reject);
  });
  fs.writeFileSync(fontPath, buf);
  _arabicFontPath = fontPath;
  return fontPath;
}

// ── PDF builder using pdfkit ──────────────────────────────────────────────────
async function buildPdf({ title, lang, content, sections }) {
  let arabicFontPath = null;
  try { arabicFontPath = await getArabicFont(); } catch (_) {}

  return new Promise((resolve, reject) => {
    const isAr = lang !== 'en';
    const doc = new PDFDocument({
      margin: 60, size: 'A4', bufferPages: true,
      info: { Title: title, Author: 'Ameen Executive Secretary' }
    });
    const bufs = [];
    doc.on('data', d => bufs.push(d));
    doc.on('error', reject);

    if (arabicFontPath) doc.registerFont('Arabic', arabicFontPath);
    const mainFont  = (isAr && arabicFontPath) ? 'Arabic' : 'Helvetica';
    const boldFont  = (isAr && arabicFontPath) ? 'Arabic' : 'Helvetica-Bold';
    const textAlign = isAr ? 'right' : 'left';
    const az = isAr ? shapeArabicText : (t) => t;

    const dateStr = new Date().toLocaleDateString(isAr ? 'ar-SA' : 'en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // Header block — this line is always bilingual (contains Arabic text
    // regardless of the report's own language), so it needs the Arabic-
    // capable font and shaping even when the rest of the document is
    // English/Helvetica, or the Arabic half renders as garbled glyphs.
    doc.font(arabicFontPath ? 'Arabic' : boldFont).fontSize(8.5).fillColor('#666666')
      .text(shapeArabicText('Ameen Executive Secretary · أمين للاجتماعات التنفيذية'), { align: textAlign });
    doc.moveDown(0.3);
    doc.font(boldFont).fontSize(17).fillColor('#1a1a2e')
      .text(az(title), { align: textAlign });
    doc.moveDown(0.2);
    doc.font(mainFont).fontSize(9.5).fillColor('#888888')
      .text(az(dateStr), { align: textAlign });
    doc.moveDown(0.5);
    doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
      .strokeColor('#1a1a2e').lineWidth(2).stroke();
    doc.moveDown(1);

    // Single content block
    if (content) {
      doc.font(mainFont).fontSize(11).fillColor('#222222')
        .text(az(content), { align: textAlign, lineGap: 4 });
    }

    // Multi-section (board pack)
    if (sections) {
      for (const s of sections) {
        if (!s.text && !(s.items && s.items.length)) continue;
        doc.moveDown(0.9);
        doc.font(boldFont).fontSize(12.5).fillColor('#1a1a2e')
          .text(az(s.title), { align: textAlign });
        doc.moveDown(0.2);
        doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
          .strokeColor('#cccccc').lineWidth(0.8).stroke();
        doc.moveDown(0.5);
        if (s.text) {
          doc.font(mainFont).fontSize(10.5).fillColor('#333333')
            .text(az(s.text), { align: textAlign, lineGap: 3 });
        }
        if (s.items) {
          s.items.forEach((item, i) => {
            doc.font(mainFont).fontSize(10.5).fillColor('#333333')
              .text(az(`${i + 1}.  ${item}`), { align: textAlign, lineGap: 2, indent: 10 });
          });
        }
      }
    }

    // Page numbers (requires bufferPages:true)
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8.5).fillColor('#bbbbbb')
        .text(`${i + 1} / ${total}`, 0, doc.page.height - 40, {
          align: 'center', width: doc.page.width
        });
    }
    doc.flushPages();

    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.end();
  });
}
const db = require('../db/database');
const auth = require('../middleware/auth');
const { createNotification, notifyUsers } = require('../services/notifications');

// ── Ensure escalation columns exist (safe, idempotent) ───────────────────────
;[
  'escalated_at DATETIME',
  'escalated_to INTEGER',
  'escalated_to_name TEXT',
].forEach(col => {
  try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); } catch (_) {}
});
const { requireRole, requirePermission } = require('../middleware/auth');
const { sendEmail } = require('../utils/replitmail');
const notify = require('../utils/notify');
const rbacService = require('../services/rbac');
const { callClaude, setSessionKey } = require('../utils/claude');
const { processMeeting, findConflicts } = require('../services/pipeline');
const { readRecent } = require('../utils/ailog');
const { isValidEmail, isValidPhone, splitRecipients, partition } = require('../utils/validate');

// ── Meeting lifecycle state machine ───────────────────────────────────────────
// created → invited → scheduled → recording → uploaded → transcript_generated →
// ai_minutes_generated → review → approval → archived.
// (Approval cycle = Draft → Review → Approval → Archived)
// Every transition is persisted to meeting_lifecycle_log so the UI can render a
// real, auditable timeline instead of a decorative status label.
const LIFECYCLE_STAGES = [
  'created', 'invited', 'scheduled', 'recording', 'uploaded',
  'transcript_generated', 'ai_minutes_generated', 'review',
  'approval', 'archived',
];

// req.user only carries { id, email, system_role } (see src/middleware/auth.js) —
// resolve a display name/role from the users table for audit-log entries instead
// of reading undefined user.name/user.role fields.
function resolveActor(userId) {
  if (!userId) return { name: null, role: null };
  const u = db.prepare('SELECT name_ar, name_en, role_ar, role_en, system_role FROM users WHERE id=?').get(userId);
  if (!u) return { name: null, role: null };
  return { name: u.name_en || u.name_ar || null, role: u.role_en || u.role_ar || u.system_role || null };
}

// Advances a meeting to `toStage` and logs the transition. Forward-only, except
// the one legitimate backward loop in the process: approval → review when a
// revision is requested. No-ops (returns the current stage, does not log) if
// the meeting is already at or past `toStage`.
function transitionMeeting(meetingId, toStage, userId, note) {
  if (!LIFECYCLE_STAGES.includes(toStage)) throw new Error(`Unknown lifecycle stage: ${toStage}`);
  const meeting = db.prepare('SELECT lifecycle_stage FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return null;
  const fromStage = meeting.lifecycle_stage || 'created';
  const fromIdx = LIFECYCLE_STAGES.indexOf(fromStage);
  const toIdx = LIFECYCLE_STAGES.indexOf(toStage);
  const isRevisionLoop = fromStage === 'approval' && toStage === 'review';
  if (toIdx <= fromIdx && !isRevisionLoop) return fromStage;
  db.prepare('UPDATE meetings SET lifecycle_stage=?, lifecycle_updated_at=CURRENT_TIMESTAMP WHERE id=?').run(toStage, meetingId);
  const actor = resolveActor(userId);
  db.prepare(
    `INSERT INTO meeting_lifecycle_log (meeting_id, from_stage, to_stage, actor_id, actor_name, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(meetingId, fromStage, toStage, userId || null, actor.name, note || null);
  return toStage;
}

// ── Meeting Series (Phase 2) helpers ──────────────────────────────────────────
// Accepts either an existing series_id ("Continue Existing Meeting Series") or
// an inline new_series payload ("Create New Meeting Series") from a meeting/
// schedule create form and returns the series id to link, or null for a
// standalone meeting. Mirrors the create-or-link pattern already used for
// board_id/committee_id, just with an added inline-create path.
function resolveOrCreateSeriesId(body, userId) {
  if (body.new_series && body.new_series.name_ar) {
    const ns = body.new_series;
    const row = db.prepare(`
      INSERT INTO meeting_series (name_ar, name_en, description_ar, description_en, category, owner_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ns.name_ar, ns.name_en || ns.name_ar, ns.description_ar || '', ns.description_en || '', ns.category || '', ns.owner_id || null, userId);
    return row.lastInsertRowid;
  }
  if (body.series_id) return body.series_id;
  return null;
}

// Denormalizes effective_prev_meeting_id/next_meeting_id onto a list of already-
// fetched meeting rows by grouping same-series rows and walking them in date
// order — the automatic "Meeting Timeline" continuity. Meetings outside any
// series fall back to their manual prev_meeting_id link (Phase 1 behavior).
function attachSeriesContinuity(meetings) {
  const bySeries = {};
  for (const m of meetings) {
    if (!m.series_id) continue;
    (bySeries[m.series_id] = bySeries[m.series_id] || []).push(m);
  }
  for (const list of Object.values(bySeries)) {
    list.sort((a, b) => (a.meeting_date || '').localeCompare(b.meeting_date || ''));
  }
  return meetings.map(m => {
    let effectivePrevId = m.prev_meeting_id || null;
    let nextId = null;
    const list = m.series_id && bySeries[m.series_id];
    if (list) {
      const idx = list.findIndex(x => x.id === m.id);
      if (idx > 0) effectivePrevId = list[idx - 1].id;
      if (idx >= 0 && idx < list.length - 1) nextId = list[idx + 1].id;
    }
    return { ...m, effective_prev_meeting_id: effectivePrevId, next_meeting_id: nextId };
  });
}

// ── File upload setup (multer + extractors) ──────────────────────────────────
const multer = require('multer');
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer (via busboy) decodes multipart Content-Disposition filenames as
// Latin-1 (ISO-8859-1) per the old HTTP spec. Modern browsers send UTF-8,
// so Arabic filenames arrive garbled (Ø§Ù„...). Re-encoding from latin1→utf8
// is a no-op for pure ASCII (English filenames stay unchanged) and correctly
// restores Arabic/non-Latin text. Apply to every use of file.originalname.
function fixFilename(name) {
  if (!name) return name;
  try { return Buffer.from(name, 'latin1').toString('utf8'); }
  catch { return name; }
}

const _uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(fixFilename(file.originalname)).toLowerCase();
    cb(null, `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage: _uploadStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt'];
    const ext = path.extname(fixFilename(file.originalname)).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── Recording storage (audio/video files up to 500 MB) ────────────────────────
const RECORDINGS_DIR = path.join(__dirname, '../../data/recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const _recStorage = multer.diskStorage({
  destination: RECORDINGS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(fixFilename(file.originalname)).toLowerCase() || '.webm';
    cb(null, `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const uploadRec = multer({
  storage: _recStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.webm', '.mp4', '.mp3', '.wav', '.ogg', '.m4a', '.aac'];
    const ext = path.extname(fixFilename(file.originalname)).toLowerCase() || '.webm';
    cb(null, allowed.includes(ext));
  }
});

async function extractFileText(filePath, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const result = await pdfParse(buf);
      return (result.text || '').slice(0, 8000);
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, 8000);
    } else if (ext === '.txt') {
      return fs.readFileSync(filePath, 'utf8').slice(0, 8000);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const lines = [];
      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(ws);
        if (csv.trim()) lines.push(`[Sheet: ${name}]\n${csv}`);
      });
      return lines.join('\n\n').slice(0, 8000);
    } else if (ext === '.pptx') {
      const JSZip = require('jszip');
      const buf = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buf);
      const slideFiles = Object.keys(zip.files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => {
          const na = parseInt(a.match(/\d+/)?.[0] || 0);
          const nb = parseInt(b.match(/\d+/)?.[0] || 0);
          return na - nb;
        });
      const texts = [];
      for (const sf of slideFiles) {
        const xml = await zip.files[sf].async('string');
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        const slideText = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').trim();
        if (slideText) texts.push(slideText);
      }
      return texts.join('\n').slice(0, 8000);
    }
  } catch {}
  return '';
}

// ── Plan helpers ────────────────────────────────────────────────────────────
function getPlan() {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('plan');
  return (row && row.value) || 'free';
}
function requirePro(req, res, next) {
  if (getPlan() !== 'pro') {
    return res.status(402).json({ error: 'PRO_REQUIRED', message: 'هذه الميزة متاحة في الباقة المدفوعة / This feature requires the Pro plan' });
  }
  next();
}
function token() { return crypto.randomBytes(16).toString('hex'); }
function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}`;
}

// ── Public attendee confirmation (NO AUTH — token-gated) ───────────────────
// Must stay ABOVE router.use(auth) below — this is reached by external
// attendees via an emailed/texted link who have no login session at all.
// (It previously lived after the auth gate, which silently 401'd every real
// visitor since they can never carry a valid session cookie.)
router.get('/public/:token', (req, res) => {
  const a = db.prepare('SELECT * FROM meeting_attendees WHERE share_token=?').get(req.params.token);
  if (!a) return res.status(404).json({ error: 'NOT_FOUND' });
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(a.meeting_id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  let tasks = [], decisions = [];
  try { tasks = JSON.parse(meeting.ai_tasks || '[]'); } catch { tasks = []; }
  try { decisions = JSON.parse(meeting.ai_decisions || '[]'); } catch { decisions = []; }
  const mine = tasks.filter(t => (t.owner_ar && (t.owner_ar.includes(a.name) || a.name.includes(t.owner_ar))) ||
                                 (t.owner_en && a.name && t.owner_en.toLowerCase().includes(a.name.toLowerCase())));
  res.json({
    attendee: { name: a.name, confirmed: !!a.confirmed, comment: a.comment || '' },
    meeting: {
      title_ar: meeting.title_ar, title_en: meeting.title_en,
      date: (meeting.meeting_date || '').substring(0, 10),
      summary_ar: meeting.ai_summary_ar || '', summary_en: meeting.ai_summary_en || '',
      minutes_ar: meeting.ai_minutes_ar || '', minutes_en: meeting.ai_minutes_en || '',
    },
    my_tasks: mine.length ? mine : tasks,
    decisions,
  });
});

router.post('/public/:token', (req, res) => {
  const a = db.prepare('SELECT * FROM meeting_attendees WHERE share_token=?').get(req.params.token);
  if (!a) return res.status(404).json({ error: 'NOT_FOUND' });
  const confirmed = req.body.confirmed ? 1 : 0;
  const comment = (req.body.comment || '').toString().slice(0, 2000);
  db.prepare('UPDATE meeting_attendees SET confirmed=?, confirmed_at=CURRENT_TIMESTAMP, comment=?, responded_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(confirmed, comment, a.id);
  res.json({ success: true });
});

// ── Require authentication for all API routes ─────────────────────────────────
router.use(auth);

// ── Set API key (session-level) ────────────────────────────────────────────
router.post('/ai/setkey', auth, (req, res) => {
  const { key } = req.body;
  if (key && key.startsWith('sk-ant')) {
    setSessionKey(req.user.id, key);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid key format' });
  }
});

// ── Users / Auth ─────────────────────────────────────────────────────────────
router.get('/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, created_at FROM users ORDER BY name_ar').all();
  res.json(users);
});

// ── Team Members (CRUD) ───────────────────────────────────────────────────────
// Kept open to any authenticated user (not gated behind admin.users) because
// many features across most roles need it for name-based dropdowns — owner
// pickers, attendee fields, escalation targets. But phone was going out to
// every logged-in user including Guest/Observer, who have no legitimate need
// for it; strip it unless the caller can actually manage users.
router.get('/members', auth, (req, res) => {
  const canManageUsers = rbacService.hasPermission(db, req.user.id, 'admin.users');
  const cols = canManageUsers
    ? 'id, name_ar, name_en, email, role_ar, role_en, system_role, department, phone, created_at'
    : 'id, name_ar, name_en, email, role_ar, role_en, system_role, department, created_at';
  const members = db.prepare(`SELECT ${cols} FROM users ORDER BY name_ar`).all();
  res.json(members);
});

router.post('/members', auth, requirePermission('admin.users'), (req, res) => {
  const { name_ar, name_en, email, role_ar, role_en, system_role, department, phone } = req.body;
  if (!name_ar || !email) return res.status(400).json({ error: 'name_ar and email are required' });
  if (system_role && !db.prepare('SELECT role_key FROM roles WHERE role_key=? AND is_active=1').get(system_role)) {
    return res.status(400).json({ error: 'Invalid system_role' });
  }
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('ameen2026', 10);
  try {
    const row = db.prepare(`
      INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en, system_role, department, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name_ar, name_en || name_ar, email, hash, role_ar || 'عضو', role_en || 'Member', system_role || 'Employee', department || '', phone || '');
    const member = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, department, phone, created_at FROM users WHERE id=?').get(row.lastInsertRowid);
    res.json(member);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/members/:id', auth, requirePermission('admin.users'), (req, res) => {
  const { name_ar, name_en, email, role_ar, role_en, department, phone } = req.body;
  const member = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  try {
    db.prepare(`
      UPDATE users SET
        name_ar=COALESCE(?,name_ar),
        name_en=COALESCE(?,name_en),
        email=COALESCE(?,email),
        role_ar=COALESCE(?,role_ar),
        role_en=COALESCE(?,role_en),
        department=COALESCE(?,department),
        phone=COALESCE(?,phone)
      WHERE id=?
    `).run(name_ar, name_en, email, role_ar, role_en, department, phone, req.params.id);
    res.json(db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, department, phone, created_at FROM users WHERE id=?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: e.message });
  }
});

// ── System Role (RBAC) ────────────────────────────────────────────────────────
// Validates against the live `roles` table (built-in + custom, active roles
// only) rather than a hardcoded list, so newly created custom roles from the
// Role Management page are immediately assignable here.
router.patch('/members/:id/role', auth, requirePermission('admin.users'), (req, res) => {
  const { system_role } = req.body;
  const validRole = db.prepare('SELECT role_key FROM roles WHERE role_key=? AND is_active=1').get(system_role);
  if (!validRole) return res.status(400).json({ error: 'Invalid system_role' });
  const member = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET system_role=? WHERE id=?').run(system_role, req.params.id);
  res.json({ success: true, system_role });
});

// ── POST /api/members/:id/reset-password ─────────────────────────────────────
router.post('/members/:id/reset-password', auth, requirePermission('admin.users'), (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const member = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(require('bcryptjs').hashSync(newPassword, 10), req.params.id);
  res.json({ success: true });
});

router.delete('/members/:id', auth, requirePermission('admin.users'), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('UPDATE tasks SET owner_id=NULL WHERE owner_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Meetings ─────────────────────────────────────────────────────────────────
router.get('/meetings', auth, (req, res) => {
  const meetings = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      rv.name_ar as rec_verifier_ar, rv.name_en as rec_verifier_en,
      ms.name_ar as series_name_ar, ms.name_en as series_name_en, ms.category as series_category
    FROM meetings m
    LEFT JOIN users u  ON m.recorded_by         = u.id
    LEFT JOIN users rv ON m.recording_verified_by = rv.id
    LEFT JOIN boards b ON m.board_id = b.id
    LEFT JOIN committees c ON m.committee_id = c.id
    LEFT JOIN meeting_series ms ON m.series_id = ms.id
    ORDER BY m.meeting_date DESC
  `).all();
  res.json(attachSeriesContinuity(meetings));
});

router.get('/meetings/:id', auth, (req, res) => {
  const m = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      rv.name_ar as rec_verifier_ar, rv.name_en as rec_verifier_en,
      ms.name_ar as series_name_ar, ms.name_en as series_name_en, ms.category as series_category
    FROM meetings m
    LEFT JOIN users u  ON m.recorded_by          = u.id
    LEFT JOIN users rv ON m.recording_verified_by = rv.id
    LEFT JOIN boards b ON m.board_id = b.id
    LEFT JOIN committees c ON m.committee_id = c.id
    LEFT JOIN meeting_series ms ON m.series_id = ms.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

// GET /api/meetings/:id/full — aggregated Meeting History detail view.
// Reads exclusively from tables already populated by the recording/processing
// pipeline (no new capture points, no duplicated storage) so the frontend can
// render overview/attendees/agenda/decisions/tasks/documents/timeline in one call.
router.get('/meetings/:id/full', auth, (req, res) => {
  const id = req.params.id;
  const meeting = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      rv.name_ar as rec_verifier_ar, rv.name_en as rec_verifier_en,
      ms.name_ar as series_name_ar, ms.name_en as series_name_en, ms.category as series_category, ms.description_ar as series_description_ar, ms.description_en as series_description_en
    FROM meetings m
    LEFT JOIN users u  ON m.recorded_by          = u.id
    LEFT JOIN users rv ON m.recording_verified_by = rv.id
    LEFT JOIN boards b ON m.board_id = b.id
    LEFT JOIN committees c ON m.committee_id = c.id
    LEFT JOIN meeting_series ms ON m.series_id = ms.id
    WHERE m.id=?
  `).get(id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const attendees = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id ASC').all(id);
  const agenda = db.prepare('SELECT * FROM agenda_items WHERE meeting_id=? ORDER BY sort_order ASC, id ASC').all(id);
  const tasks = db.prepare('SELECT * FROM tasks WHERE source_meeting_id=? ORDER BY id ASC').all(id);
  const decisions = db.prepare('SELECT * FROM decisions WHERE meeting_id=? ORDER BY id ASC').all(id);
  const documents = db.prepare("SELECT * FROM meeting_documents WHERE meeting_id=? AND file_path IS NOT NULL AND file_path!='' ORDER BY id DESC").all(id);
  const lifecycle = db.prepare('SELECT * FROM meeting_lifecycle_log WHERE meeting_id=? ORDER BY created_at ASC').all(id);

  // ── Series continuity: previous/next held meeting in the same series
  // (falls back to the manual prev_meeting_id link for standalone meetings) ──
  let effectivePrevId = meeting.prev_meeting_id || null;
  let nextMeetingId = null;
  let seriesTimeline = [];
  let seriesStats = null;
  if (meeting.series_id) {
    const prevInSeries = db.prepare('SELECT id FROM meetings WHERE series_id=? AND id!=? AND meeting_date < ? ORDER BY meeting_date DESC LIMIT 1').get(meeting.series_id, id, meeting.meeting_date);
    if (prevInSeries) effectivePrevId = prevInSeries.id;
    const nextInSeries = db.prepare('SELECT id FROM meetings WHERE series_id=? AND id!=? AND meeting_date > ? ORDER BY meeting_date ASC LIMIT 1').get(meeting.series_id, id, meeting.meeting_date);
    if (nextInSeries) nextMeetingId = nextInSeries.id;
    const held = db.prepare('SELECT id, title_ar, title_en, meeting_date, status FROM meetings WHERE series_id=?').all(meeting.series_id).map(x => ({ ...x, kind: 'held' }));
    const planned = db.prepare("SELECT id, title_ar, title_en, meeting_date, status FROM schedule WHERE series_id=? AND status != 'cancelled'").all(meeting.series_id).map(x => ({ ...x, kind: 'planned' }));
    seriesTimeline = [...held, ...planned].sort((a, b) => (a.meeting_date || '').localeCompare(b.meeting_date || ''));
    const totalMeetings = held.length + planned.length;
    seriesStats = { total_meetings: totalMeetings, completed_meetings: held.length, pending_meetings: planned.length, completion_pct: totalMeetings ? Math.round((held.length / totalMeetings) * 100) : 0 };
  }

  // ── Previous Meeting Review: assembled once, server-side, from the same
  // tables the current meeting's own sections already read — no new storage.
  let previous_review = null;
  if (effectivePrevId) {
    const prevMeeting = db.prepare('SELECT id, title_ar, title_en, ai_summary_ar, ai_summary_en, ai_minutes_ar, ai_minutes_en, ai_risks, meeting_date FROM meetings WHERE id=?').get(effectivePrevId);
    if (prevMeeting) {
      const prevTasks = db.prepare('SELECT * FROM tasks WHERE source_meeting_id=?').all(effectivePrevId);
      const prevDecisions = db.prepare('SELECT * FROM decisions WHERE meeting_id=?').all(effectivePrevId);
      const prevDocuments = db.prepare("SELECT * FROM meeting_documents WHERE meeting_id=? AND file_path IS NOT NULL AND file_path!=''").all(effectivePrevId);
      const today = new Date().toISOString().substring(0, 10);
      previous_review = {
        meeting: prevMeeting,
        outstanding_decisions: prevDecisions.filter(d => d.status !== 'implemented'),
        completed_decisions: prevDecisions.filter(d => d.status === 'implemented'),
        pending_actions: prevTasks.filter(t => !['done', 'cancelled'].includes(t.status)),
        blocked_actions: prevTasks.filter(t => t.status === 'blocked'),
        overdue_actions: prevTasks.filter(t => t.due_date && t.due_date < today && !['done', 'cancelled'].includes(t.status)),
        open_risks: (() => { try { return JSON.parse(prevMeeting.ai_risks || '[]'); } catch { return []; } })(),
        attachments: prevDocuments,
      };
    }
  }

  res.json({ meeting, attendees, agenda, tasks, decisions, documents, lifecycle, effective_prev_meeting_id: effectivePrevId, next_meeting_id: nextMeetingId, series_timeline: seriesTimeline, series_stats: seriesStats, previous_review });
});

router.post('/meetings', auth, requirePermission('meetings.create'), (req, res) => {
  const {
    title_ar, title_en, transcript, duration, meeting_type,
    board_id, committee_id, series_id, new_series, prev_meeting_id, meeting_date,
    platform, organizer_id, purpose_ar, purpose_en, expected_decisions, expected_actions,
    meeting_join_url, meeting_location, meeting_provider,
  } = req.body;
  let resolvedSeriesId = (series_id || new_series) ? resolveOrCreateSeriesId({ series_id, new_series }, req.user.id) : null;
  const resolvedPrevId = prev_meeting_id || null;
  // Auto-link to a series via the chosen previous meeting when no explicit series was given
  if (!resolvedSeriesId && resolvedPrevId) {
    const prevM = db.prepare('SELECT id, series_id, title_ar, title_en FROM meetings WHERE id=?').get(resolvedPrevId);
    if (prevM) {
      if (prevM.series_id) {
        resolvedSeriesId = prevM.series_id;
      } else {
        // Create a new series named after the previous meeting and retroactively link it
        const sNameEn = prevM.title_en || prevM.title_ar || 'Meeting Series';
        const sNameAr = prevM.title_ar || sNameEn;
        resolvedSeriesId = resolveOrCreateSeriesId({ new_series: { name_ar: sNameAr, name_en: sNameEn } }, req.user.id);
        db.prepare('UPDATE meetings SET series_id=? WHERE id=?').run(resolvedSeriesId, prevM.id);
      }
    }
  }
  const row = db.prepare(`
    INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, meeting_type,
      board_id, committee_id, series_id, prev_meeting_id, meeting_date, platform, organizer_id,
      purpose_ar, purpose_en, expected_decisions, expected_actions, meeting_location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title_ar, title_en || title_ar, transcript || '', duration || 0, req.user.id, meeting_type || '',
    board_id || null, committee_id || null, resolvedSeriesId || null, resolvedPrevId, meeting_date || null,
    platform || '', organizer_id || req.user.id, purpose_ar || '', purpose_en || '',
    JSON.stringify(Array.isArray(expected_decisions) ? expected_decisions : []),
    JSON.stringify(Array.isArray(expected_actions) ? expected_actions : []),
    meeting_location || '',
  );
  const actor = resolveActor(req.user.id);
  db.prepare(
    `INSERT INTO meeting_lifecycle_log (meeting_id, from_stage, to_stage, actor_id, actor_name, note)
     VALUES (?, NULL, 'created', ?, ?, 'Meeting created')`
  ).run(row.lastInsertRowid, req.user.id, actor.name);
  res.json(db.prepare('SELECT * FROM meetings WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/meetings/:id', auth, requirePermission('meetings.edit'), (req, res) => {
  const {
    transcript, duration, title_ar, title_en, meeting_type, source_type, series_id, new_series,
    board_id, committee_id, prev_meeting_id, meeting_date, platform, organizer_id,
    purpose_ar, purpose_en, expected_decisions, expected_actions,
  } = req.body;
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const newTitleAr = title_ar !== undefined ? title_ar : meeting.title_ar;
  const newTitleEn = title_en !== undefined ? (title_en || title_ar || meeting.title_en) : meeting.title_en;
  const newTranscript = transcript !== undefined ? transcript : meeting.transcript;
  const newDuration = duration !== undefined ? duration : meeting.duration;
  const newMeetingType = meeting_type !== undefined ? meeting_type : meeting.meeting_type;
  const newSourceType = source_type !== undefined ? source_type : meeting.source_type;
  const newSeriesId = (series_id !== undefined || new_series)
    ? resolveOrCreateSeriesId({ series_id, new_series }, req.user.id)
    : meeting.series_id;
  const newBoardId = board_id !== undefined ? (board_id || null) : meeting.board_id;
  const newCommitteeId = committee_id !== undefined ? (committee_id || null) : meeting.committee_id;
  const newPrevMeetingId = prev_meeting_id !== undefined ? (prev_meeting_id || null) : meeting.prev_meeting_id;
  const newMeetingDate = meeting_date !== undefined ? (meeting_date || meeting.meeting_date) : meeting.meeting_date;
  const newPlatform = platform !== undefined ? platform : meeting.platform;
  const newOrganizerId = organizer_id !== undefined ? (organizer_id || null) : meeting.organizer_id;
  const newPurposeAr = purpose_ar !== undefined ? purpose_ar : meeting.purpose_ar;
  const newPurposeEn = purpose_en !== undefined ? purpose_en : meeting.purpose_en;
  const newExpectedDecisions = expected_decisions !== undefined ? JSON.stringify(Array.isArray(expected_decisions) ? expected_decisions : []) : meeting.expected_decisions;
  const newExpectedActions = expected_actions !== undefined ? JSON.stringify(Array.isArray(expected_actions) ? expected_actions : []) : meeting.expected_actions;
  const newMeetingLocation = req.body.meeting_location !== undefined ? (req.body.meeting_location || '') : meeting.meeting_location;

  db.transaction(() => {
    db.prepare(`UPDATE meetings SET title_ar=?, title_en=?, transcript=?, duration=?, meeting_type=?, source_type=?, series_id=?,
        board_id=?, committee_id=?, prev_meeting_id=?, meeting_date=?, platform=?, organizer_id=?,
        purpose_ar=?, purpose_en=?, expected_decisions=?, expected_actions=?, meeting_location=?
      WHERE id=?`)
      .run(newTitleAr, newTitleEn, newTranscript, newDuration, newMeetingType, newSourceType, newSeriesId,
        newBoardId, newCommitteeId, newPrevMeetingId, newMeetingDate, newPlatform, newOrganizerId,
        newPurposeAr, newPurposeEn, newExpectedDecisions, newExpectedActions, newMeetingLocation, req.params.id);

    // Keep denormalized titles in tasks & decisions in sync
    if (title_ar !== undefined || title_en !== undefined) {
      db.prepare('UPDATE tasks SET source_meeting_title_ar=?, source_meeting_title_en=? WHERE source_meeting_id=?')
        .run(newTitleAr, newTitleEn, req.params.id);
      db.prepare('UPDATE decisions SET meeting_title_ar=?, meeting_title_en=? WHERE meeting_id=?')
        .run(newTitleAr, newTitleEn, req.params.id);
    }
  })();

  if (transcript !== undefined && newTranscript) {
    transitionMeeting(req.params.id, 'transcript_generated', req.user.id, 'Transcript saved');
  }

  res.json({ success: true, title_ar: newTitleAr, title_en: newTitleEn });
});

// ── Unified import for the Record panel's "Import Meeting Content" section ────
// Resolves or creates the target meeting, saves text-based content (paste or an
// already-extracted .txt file) as the transcript, and — for text content only —
// runs the existing AI pipeline. Audio/video content just resolves/creates the
// meeting here; the actual file bytes go through the existing, already-tested
// POST /meetings/:id/recording endpoint from the frontend.
router.post('/meetings/import-content', auth, requirePermission('meetings.create'), async (req, res) => {
  const { meeting_target, meeting_id, title, type, meeting_date, meeting_provider, prev_meeting_id, series_id, new_series, content_type, text } = req.body;
  const isTextContent = content_type === 'paste_text' || content_type === 'text_file';

  let targetId;
  let created = false;

  if (meeting_target === 'new') {
    const titleAr = (title || '').trim();
    if (!titleAr) return res.status(400).json({ error: 'title is required to create a new meeting' });
    const row = db.prepare(`
      INSERT INTO meetings (title_ar, title_en, meeting_type, recorded_by, source_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(titleAr, titleAr, type || '', req.user.id, isTextContent ? 'text_minutes' : '');
    targetId = row.lastInsertRowid;
    created = true;
    const actor = resolveActor(req.user.id);
    db.prepare(
      `INSERT INTO meeting_lifecycle_log (meeting_id, from_stage, to_stage, actor_id, actor_name, note)
       VALUES (?, NULL, 'created', ?, ?, 'Meeting created via content import')`
    ).run(targetId, req.user.id, actor.name);
    if (meeting_date) db.prepare('UPDATE meetings SET meeting_date=? WHERE id=?').run(meeting_date, targetId);
    if (meeting_provider) db.prepare('UPDATE meetings SET recording_capture_type=? WHERE id=?').run(meeting_provider, targetId);
    if (prev_meeting_id) db.prepare('UPDATE meetings SET prev_meeting_id=? WHERE id=?').run(prev_meeting_id, targetId);
    const resolvedSeriesId = resolveOrCreateSeriesId({ series_id, new_series }, req.user.id);
    if (resolvedSeriesId) db.prepare('UPDATE meetings SET series_id=? WHERE id=?').run(resolvedSeriesId, targetId);
  } else {
    if (!meeting_id) return res.status(400).json({ error: 'meeting_id is required when meeting_target is existing' });
    const exists = db.prepare('SELECT id FROM meetings WHERE id=?').get(meeting_id);
    if (!exists) return res.status(404).json({ error: 'Meeting not found' });
    targetId = meeting_id;
  }

  let aiStatus = 'skipped';
  let keyTopicsAr = [], keyTopicsEn = [];

  if (isTextContent) {
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required for this content type' });
    }
    db.prepare("UPDATE meetings SET transcript=?, source_type='text_minutes' WHERE id=?").run(text, targetId);
    transitionMeeting(targetId, 'transcript_generated', req.user.id, 'Transcript imported');

    try {
      const out = await processMeeting({ meetingId: targetId, userId: req.user.id });
      transitionMeeting(targetId, 'ai_minutes_generated', req.user.id, 'AI minutes generated');
      aiStatus = 'ok';
      keyTopicsAr = out.result.key_topics_ar || [];
      keyTopicsEn = out.result.key_topics_en || [];
    } catch (e) {
      aiStatus = /NO_API_KEY/i.test(e.message) ? 'unavailable' : 'error';
    }
  }

  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(targetId);
  let tasks = [], decisions = [], followups = [], risks = [];
  try { tasks = JSON.parse(meeting.ai_tasks || '[]'); } catch {}
  try { decisions = JSON.parse(meeting.ai_decisions || '[]'); } catch {}
  try { followups = JSON.parse(meeting.ai_followups || '[]'); } catch {}
  try { risks = JSON.parse(meeting.ai_risks || '[]'); } catch {}

  res.json({
    success: true,
    created,
    ai_status: aiStatus,
    meeting: {
      id: meeting.id, title_ar: meeting.title_ar, title_en: meeting.title_en,
      status: meeting.status, meeting_date: meeting.meeting_date,
    },
    summary_ar: meeting.ai_summary_ar || '',
    summary_en: meeting.ai_summary_en || '',
    key_topics_ar: keyTopicsAr,
    key_topics_en: keyTopicsEn,
    decisions, tasks, followups, risks,
  });
});

// ── Hard-delete a meeting and all its dependents ───────────────────────────────
router.delete('/meetings/:id', auth, requirePermission('meetings.delete'), (req, res) => {
  const id = req.params.id;
  const m = db.prepare('SELECT id FROM meetings WHERE id=?').get(id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const meetingDocs = db.prepare("SELECT file_path FROM meeting_documents WHERE meeting_id=? AND file_path IS NOT NULL AND file_path!=''").all(id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(id);
    db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(id);
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id=?').run(id);
    db.prepare('DELETE FROM meeting_documents WHERE meeting_id=?').run(id);
    db.prepare('UPDATE documents SET source_meeting_id=NULL WHERE source_meeting_id=?').run(id);
    db.prepare('DELETE FROM meetings WHERE id=?').run(id);
  });
  tx();
  meetingDocs.forEach(d => { try { fs.unlinkSync(path.join(UPLOADS_DIR, d.file_path)); } catch {} });
  res.json({ success: true });
});

// ── Recording Storage & Approval ──────────────────────────────────────────────

// POST /api/meetings/:id/recording — upload audio/video file to platform
router.post('/meetings/:id/recording', auth, requirePermission('meetings.create', 'meetings.edit'), uploadRec.single('recording'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported format (webm, mp4, mp3, wav, ogg, m4a, aac)' });
  const meeting = db.prepare('SELECT id, audio_recording_url FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Meeting not found' });
  }
  // Remove previous recording file if one existed
  if (meeting.audio_recording_url) {
    const prevFile = path.basename(meeting.audio_recording_url);
    try { fs.unlinkSync(path.join(RECORDINGS_DIR, prevFile)); } catch {}
  }
  const publicUrl = `/recordings/${req.file.filename}`;
  const { capture_type, scope } = req.body;
  const resolvedScope = capture_type && ['zoom_cloud','teams_cloud','google_meet_cloud','uploaded_recording'].includes(capture_type)
    ? 'full_meeting_recording'
    : (scope || 'local_microphone_only');
  db.prepare(`
    UPDATE meetings SET
      audio_recording_url       = ?,
      recording_file_name       = ?,
      recording_file_size       = ?,
      recording_uploaded_at     = CURRENT_TIMESTAMP,
      recording_approval_status = 'pending',
      recording_status          = 'uploaded',
      recording_capture_type    = COALESCE(NULLIF(?, ''), recording_capture_type, 'browser_microphone'),
      recording_scope           = ?
    WHERE id = ?
  `).run(publicUrl, req.file.originalname, req.file.size, capture_type || '', resolvedScope, meeting.id);
  transitionMeeting(meeting.id, 'uploaded', req.user.id, 'Recording file uploaded');
  res.json({ success: true, audio_recording_url: publicUrl, recording_approval_status: 'pending', recording_status: 'uploaded' });
});

// PATCH /api/meetings/:id/recording/approve — approval workflow
// body: { action: 'approve' | 'reject' | 'submit' }
router.patch('/meetings/:id/recording/approve', auth, requirePermission('minutes.approve'), (req, res) => {
  const meeting = db.prepare('SELECT id, audio_recording_url, recording_approval_status FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (!meeting.audio_recording_url) return res.status(400).json({ error: 'No recording stored for this meeting' });

  const { action } = req.body;
  const VALID = ['submit', 'approve', 'reject'];
  if (!VALID.includes(action)) return res.status(400).json({ error: `action must be one of: ${VALID.join(', ')}` });

  if (action === 'submit') {
    db.prepare(`UPDATE meetings SET recording_approval_status='pending' WHERE id=?`).run(meeting.id);
    return res.json({ success: true, recording_approval_status: 'pending' });
  }
  if (action === 'approve') {
    db.prepare(`
      UPDATE meetings SET
        recording_approval_status = 'approved',
        recording_verified_by     = ?,
        recording_verified_at     = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id, meeting.id);
    return res.json({ success: true, recording_approval_status: 'approved' });
  }
  if (action === 'reject') {
    db.prepare(`
      UPDATE meetings SET
        recording_approval_status = 'rejected',
        recording_verified_by     = ?,
        recording_verified_at     = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id, meeting.id);
    return res.json({ success: true, recording_approval_status: 'rejected' });
  }
});

// DELETE /api/meetings/:id/recording — remove recording file and clear columns
router.delete('/meetings/:id/recording', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const meeting = db.prepare('SELECT id, audio_recording_url FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.audio_recording_url) {
    try { fs.unlinkSync(path.join(RECORDINGS_DIR, path.basename(meeting.audio_recording_url))); } catch {}
  }
  db.prepare(`
    UPDATE meetings SET
      audio_recording_url       = '',
      video_recording_url       = '',
      recording_file_name       = '',
      recording_file_size       = 0,
      recording_uploaded_at     = NULL,
      recording_verified_by     = NULL,
      recording_verified_at     = NULL,
      recording_approval_status = 'none',
      recording_status          = 'not_started'
    WHERE id = ?
  `).run(meeting.id);
  res.json({ success: true });
});

// ── Recording Governance Routes ───────────────────────────────────────────────

// GET /api/meetings/:id/recording-status
router.get('/meetings/:id/recording-status', auth, (req, res) => {
  const m = db.prepare(`
    SELECT id, recording_status, recording_capture_type, recording_source, recording_scope,
           recording_started_at, recording_stopped_at, recording_started_by,
           recording_approval_status, audio_recording_url, recording_file_name,
           recording_file_size, recording_verified_at, recording_notes,
           recording_uploaded_at
    FROM meetings WHERE id = ?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

// POST /api/meetings/:id/recording/start
router.post('/meetings/:id/recording/start', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const { capture_type, source, scope } = req.body;
  db.prepare(`
    UPDATE meetings SET
      recording_status       = 'recording',
      recording_started_by   = ?,
      recording_started_at   = CURRENT_TIMESTAMP,
      recording_capture_type = COALESCE(NULLIF(?, ''), recording_capture_type, 'browser_microphone'),
      recording_source       = COALESCE(NULLIF(?, ''), recording_source, ''),
      recording_scope        = COALESCE(NULLIF(?, ''), recording_scope, 'unknown')
    WHERE id = ?
  `).run(req.user.id, capture_type || '', source || '', scope || '', meeting.id);
  transitionMeeting(meeting.id, 'recording', req.user.id, 'Recording started');
  res.json({ success: true, recording_status: 'recording' });
});

// POST /api/meetings/:id/recording/stop
router.post('/meetings/:id/recording/stop', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const { notes } = req.body;
  db.prepare(`
    UPDATE meetings SET
      recording_status     = 'stopped',
      recording_stopped_at = CURRENT_TIMESTAMP,
      recording_notes      = COALESCE(NULLIF(?, ''), recording_notes, '')
    WHERE id = ?
  `).run(notes || '', meeting.id);
  transitionMeeting(meeting.id, 'uploaded', req.user.id, 'Recording stopped');
  res.json({ success: true, recording_status: 'stopped' });
});

// ── Live Meeting Endpoints ─────────────────────────────────────────────────────

// POST /api/meetings/:id/events — append an immutable live-meeting event
router.post('/meetings/:id/events', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const mid = req.params.id;
  const { event_type, entity_id, source, previous_value, new_value, metadata } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });
  const result = db.prepare(`
    INSERT INTO meeting_events
      (meeting_id, event_type, entity_id, user_id, actor_name, source, previous_value, new_value, metadata)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    mid, event_type, entity_id || null,
    req.user.id, req.user.name_ar || req.user.name_en || '',
    source || 'user',
    previous_value || '', new_value || '',
    typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || '{}')
  );
  res.json({ id: result.lastInsertRowid });
});

// GET /api/meetings/:id/events — full event log for this meeting
router.get('/meetings/:id/events', auth, requirePermission('meetings.view'), (req, res) => {
  const events = db.prepare(
    'SELECT * FROM meeting_events WHERE meeting_id=? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(events);
});

// POST /api/meetings/:id/start — start meeting (records actual_start_time & recording preference)
router.post('/meetings/:id/start', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const meeting = db.prepare('SELECT id, lifecycle_stage FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const withRec = req.body.with_recording !== false ? 1 : 0;
  db.prepare(`
    UPDATE meetings SET
      actual_start_time = COALESCE(actual_start_time, CURRENT_TIMESTAMP),
      with_recording    = ?,
      recording_status  = CASE WHEN ? THEN 'recording' ELSE recording_status END,
      recording_started_by   = CASE WHEN ? THEN ? ELSE recording_started_by END,
      recording_started_at   = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE recording_started_at END,
      recording_capture_type = CASE WHEN ? THEN 'browser_microphone' ELSE recording_capture_type END,
      recording_scope        = CASE WHEN ? THEN 'local_microphone_only' ELSE recording_scope END
    WHERE id = ?
  `).run(withRec, withRec, withRec, req.user.id, withRec, withRec, withRec, meeting.id);
  transitionMeeting(
    meeting.id, 'recording', req.user.id,
    withRec ? 'Meeting started with recording' : 'Meeting started without recording'
  );
  db.prepare(`
    INSERT INTO meeting_events (meeting_id, event_type, user_id, actor_name, source, new_value, metadata)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    meeting.id,
    withRec ? 'RECORDING_STARTED' : 'MEETING_STARTED',
    req.user.id, req.user.name_ar || req.user.name_en || '', 'user',
    withRec ? 'recording' : 'started',
    JSON.stringify({ with_recording: withRec })
  );
  res.json({ success: true, with_recording: withRec });
});

// POST /api/meetings/:id/end — end meeting, persist transcript & notes, trigger AI flag
router.post('/meetings/:id/end', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const meeting = db.prepare('SELECT id, lifecycle_stage FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const { live_notes, transcript } = req.body;
  db.prepare(`
    UPDATE meetings SET
      actual_end_time  = CURRENT_TIMESTAMP,
      recording_status = 'stopped',
      recording_stopped_at = CURRENT_TIMESTAMP,
      live_notes = COALESCE(NULLIF(?,''), live_notes),
      transcript = COALESCE(NULLIF(?,''), transcript)
    WHERE id = ?
  `).run(live_notes || '', transcript || '', meeting.id);
  transitionMeeting(meeting.id, 'uploaded', req.user.id, 'Meeting ended');
  db.prepare(`
    INSERT INTO meeting_events (meeting_id, event_type, user_id, actor_name, source, metadata)
    VALUES (?,?,?,?,?,?)
  `).run(meeting.id, 'MEETING_ENDED', req.user.id, req.user.name_ar || req.user.name_en || '', 'user', '{}');
  res.json({ success: true });
});

// PATCH /api/meetings/:id/agenda-items/:itemId — update agenda item live status
router.patch('/meetings/:id/agenda-items/:itemId', auth, requirePermission('meetings.create', 'meetings.edit'), (req, res) => {
  const { live_status } = req.body;
  if (!live_status) return res.status(400).json({ error: 'live_status required' });
  const valid = ['not_started', 'in_progress', 'completed', 'deferred', 'skipped'];
  if (!valid.includes(live_status)) return res.status(400).json({ error: 'invalid live_status' });
  db.prepare('UPDATE agenda_items SET live_status=? WHERE id=? AND meeting_id=?')
    .run(live_status, req.params.itemId, req.params.id);
  res.json({ success: true });
});

// ── File Upload ────────────────────────────────────────────────────────────────
router.post('/meetings/:id/upload', auth, requirePermission('documents.upload'), upload.single('file'), async (req, res) => {
 try {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported format (PDF, DOCX, XLSX, PPTX, TXT only)' });
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Meeting not found' });
  }
  const originalName = fixFilename(req.file.originalname);
  let aiSummary = '', aiKeyPoints = '[]', docClassification = '';
  try {
    const text = await extractFileText(req.file.path, originalName);
    if (text.length > 80) {
      const aiPrompt = `ما يلي هو محتوى وثيقة من اجتماع. استخرج ما يلي وأعد JSON صالحاً فقط بلا أي شرح:
{"summary":"ملخص موجز 3-5 جمل","key_points":["نقطة 1","نقطة 2","نقطة 3"],"classification":"تقرير مالي أو محضر أو خطة عمل أو سياسة أو عرض أو بيانات أو أخرى"}

محتوى الوثيقة:
"""
${text.slice(0, 3500)}
"""`;
      const raw = await callClaude([{ role: 'user', content: aiPrompt }], '', 500, req.user.id);
      const mMatch = raw.match(/\{[\s\S]*\}/);
      if (mMatch) {
        const parsed = JSON.parse(mMatch[0]);
        aiSummary = (parsed.summary || '').slice(0, 1000);
        aiKeyPoints = JSON.stringify(Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 7) : []);
        docClassification = (parsed.classification || '').slice(0, 100);
      }
    }
  } catch {}
  const _uRow = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(req.user.id);
  const uploaderName = (_uRow?.name_ar || _uRow?.name_en || '');
  const row = db.prepare(`
    INSERT INTO meeting_documents (meeting_id, title, doc_type, description, uploaded_by, upload_date, status, is_mock, created_by, file_path, file_size, file_type, ai_summary, ai_key_points, doc_classification)
    VALUES (?,?,?,?,?,date('now'),'uploaded',0,?,?,?,?,?,?,?)
  `).run(
    meeting.id,
    originalName,
    path.extname(originalName).slice(1).toUpperCase() || 'DOC',
    aiSummary.slice(0, 500),
    uploaderName,
    req.user.id,
    req.file.filename,
    req.file.size,
    req.file.mimetype || '',
    aiSummary,
    aiKeyPoints,
    docClassification
  );
  res.json({ success: true, id: row.lastInsertRowid, filename: req.file.filename, original: originalName, summary: aiSummary, classification: docClassification });
 } catch (e) {
  console.error('✗ /meetings/:id/upload failed:', e.message);
  try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
  res.status(500).json({ error: e.message });
 }
});

// ── Documents for a specific meeting ──────────────────────────────────────────
router.get('/meetings/:id/documents', auth, requirePermission('documents.download'), (req, res) => {
  res.json(db.prepare("SELECT * FROM meeting_documents WHERE meeting_id=? AND file_path IS NOT NULL AND file_path!='' ORDER BY id DESC").all(req.params.id));
});

// ── Document summary by ID ─────────────────────────────────────────────────────
router.get('/documents/:id/summary', auth, requirePermission('documents.download'), (req, res) => {
  const doc = db.prepare('SELECT id, title, doc_type, doc_classification, ai_summary, ai_key_points, upload_date, uploaded_by, file_path, file_size, meeting_id FROM meeting_documents WHERE id=?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  let key_points = [];
  try { key_points = JSON.parse(doc.ai_key_points || '[]'); } catch {}
  res.json({ ...doc, key_points });
});

// ── Document Library (all uploaded files) ─────────────────────────────────────
router.get('/documents/library', auth, requirePermission('documents.download'), (req, res) => {
  const { q, type } = req.query;
  let sql = `SELECT md.*, m.title_ar as meeting_title_ar, m.title_en as meeting_title_en, m.meeting_date
    FROM meeting_documents md LEFT JOIN meetings m ON md.meeting_id=m.id
    WHERE md.file_path IS NOT NULL AND md.file_path!=''`;
  const params = [];
  if (q) { sql += ` AND (md.title LIKE ? OR md.ai_summary LIKE ? OR md.doc_classification LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (type) { sql += ` AND md.doc_type=?`; params.push(type); }
  sql += ' ORDER BY md.id DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

// ── Document download with correct Arabic filename header ──────────────────────
// Instead of relying on express.static (which serves with the opaque storage
// name like doc_1234.pdf), this endpoint sets a proper Content-Disposition
// so the browser saves the file under its original name, including Arabic.
router.get('/documents/:id/download', auth, requirePermission('documents.download'), (req, res) => {
  const doc = db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(req.params.id);
  if (!doc || !doc.file_path) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(UPLOADS_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  const originalName = doc.title || doc.file_path;
  // RFC 5987: filename= (ASCII fallback) + filename*= (UTF-8 encoded)
  const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_');
  const encodedName = encodeURIComponent(originalName).replace(/'/g, '%27');
  res.setHeader('Content-Type', doc.file_type || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`);
  res.sendFile(filePath);
});

// ── Task attachment download with correct Arabic filename header ───────────────
router.get('/tasks/:id/attachments/:attId/download', auth, (req, res) => {
  const att = db.prepare('SELECT * FROM task_attachments WHERE id=? AND task_id=?').get(req.params.attId, req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  const filePath = path.join(UPLOADS_DIR, att.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  const originalName = att.file_name || att.file_path;
  const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_');
  const encodedName = encodeURIComponent(originalName).replace(/'/g, '%27');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`);
  res.sendFile(filePath);
});

// ── Delete an uploaded document ────────────────────────────────────────────────
router.delete('/meeting-documents/:id', auth, requirePermission('documents.delete'), (req, res) => {
  const doc = db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.file_path) { try { fs.unlinkSync(path.join(UPLOADS_DIR, doc.file_path)); } catch {} }
  db.prepare('DELETE FROM meeting_documents WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── AI: Process Meeting ───────────────────────────────────────────────────────
router.post('/meetings/:id/process', auth, requirePermission('ai.generate_minutes'), async (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  try {
    const out = await processMeeting({ meetingId: meeting.id, userId: req.user.id });
    transitionMeeting(meeting.id, 'ai_minutes_generated', req.user.id, 'AI minutes generated');
    res.json({ success: true, ...out });
  } catch (e) {
    const raw = e.message || '';
    // Always log the raw technical error server-side for admins to diagnose
    console.error(`[AI Process] Meeting ${meeting.id} failed — raw error: ${raw}`);

    // Translate raw AI/infra errors into user-friendly messages; never expose
    // internal API error strings (e.g. "credit balance", "API_ERROR:") to users.
    let userMsg, code;
    if (/NO_API_KEY/i.test(raw)) {
      userMsg = 'AI service is not configured. Please contact your administrator.';
      code = 'AI_UNAVAILABLE';
    } else if (/credit balance|insufficient_quota|quota|billing/i.test(raw)) {
      userMsg = 'AI processing is temporarily unavailable — the AI credit limit has been reached. Please contact your administrator or try again later.';
      code = 'AI_QUOTA';
    } else if (/API_ERROR/i.test(raw)) {
      userMsg = 'The AI service returned an error. Please try again in a few minutes, or contact your administrator.';
      code = 'AI_SERVICE_ERROR';
    } else if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(raw)) {
      userMsg = 'The AI service timed out. Please try again.';
      code = 'AI_TIMEOUT';
    } else {
      userMsg = 'AI processing could not be completed. Your meeting data has been preserved — you can try again or continue manually.';
      code = 'PROCESS_FAILED';
    }
    res.status(422).json({ error: userMsg, code, retry_allowed: true });
  }
});

// ── Deep Log Debugger: recent AI pipeline trace (what the AI "saw" + did) ──────
router.get('/ai/debug-log', auth, (req, res) => {
  res.json({ entries: readRecent(Number(req.query.limit) || 200) });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
// Best-effort "you've been assigned an executive task" notification. Reuses
// the same notify.notify() helper as escalation/reminders/minutes-sharing —
// no new send logic — and never throws, so a notification failure can never
// block a task create/update response.
async function notifyTaskAssigned(task, actorUserId) {
  if (!task.owner_id) return;
  const actor = resolveActor(actorUserId);
  const actorName = actor.name || 'Ameen';
  const taskTitleAr = task.text_ar || `مهمة #${task.id}`;
  const taskTitleEn = task.text_en || task.text_ar || `Task #${task.id}`;
  // In-app notification — independent of whether the owner has an email on
  // file, so it always shows up in the Notification Center.
  createNotification(db, {
    userId: task.owner_id,
    type: 'task_assigned',
    titleAr: 'تم تعيين مهمة تنفيذية لك',
    titleEn: 'Executive task assigned to you',
    bodyAr: `${actorName} عيّن لك: "${taskTitleAr}"${task.due_date ? ` — تاريخ الاستحقاق ${task.due_date}` : ''}`,
    bodyEn: `${actorName} assigned you: "${taskTitleEn}"${task.due_date ? ` — due ${task.due_date}` : ''}`,
    sourceType: 'task', sourceId: task.id, deepLink: 'tasks',
  });
  try {
    const owner = db.prepare('SELECT email, phone FROM users WHERE id=?').get(task.owner_id);
    if (!owner || !owner.email) return;
    const subject = `تم تعيين مهمة تنفيذية لك: ${taskTitleAr} / Executive Task Assigned to You: ${taskTitleEn}`;
    const body =
      `${actorName} قام بتعيين المهمة التالية لك:\n\n"${taskTitleAr}"\n\n${task.due_date ? `تاريخ الاستحقاق: ${task.due_date}\n\n` : ''}يرجى المراجعة ضمن "مهامي التنفيذية".\n\n———\n\n` +
      `${actorName} has assigned the following task to you:\n\n"${taskTitleEn}"\n\n${task.due_date ? `Due date: ${task.due_date}\n\n` : ''}Please review it under "My Executive Tasks".`;
    await notify.notify({
      channel: owner.phone ? 'both' : 'email',
      email: owner.email,
      phone: owner.phone || undefined,
      subject, text: body,
    });
  } catch (e) {
    console.error('[notifyTaskAssigned] email failed for task', task.id, e.message);
  }
}

// ── Meeting invite emails ─────────────────────────────────────────────────────
// Sends email (+ in-app notification if the attendee is a registered user) to
// every attendee in the list.  Never throws — a delivery failure must never
// block the meeting write that triggered it.
//
// attendees: Array of { name, email, phone } — external rows from
//   meeting_attendees, or plain objects built from a raw "attendees" string.
// meeting: Object with id (may be null for /schedule rows), title_ar,
//   title_en, meeting_date, meeting_time.
async function notifyMeetingInvite(meeting, attendees, actorUserId) {
  const actor   = resolveActor(actorUserId);
  const actorName = actor.name || 'Ameen';
  const titleAr = meeting.title_ar || 'اجتماع';
  const titleEn = meeting.title_en || meeting.title_ar || 'Meeting';
  const dateStr = [meeting.meeting_date, meeting.meeting_time].filter(Boolean).join(' الساعة ');
  const dateStrEn = [meeting.meeting_date, meeting.meeting_time].filter(Boolean).join(' at ');

  for (const att of attendees) {
    if (!att.email) continue;

    // In-app notification if the attendee has a registered account
    try {
      const user = db.prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?)').get(att.email);
      if (user && user.id !== actorUserId) {
        createNotification(db, {
          userId: user.id,
          type: 'meeting_invited',
          titleAr: 'تمت دعوتك لحضور اجتماع',
          titleEn: 'You have been invited to a meeting',
          bodyAr: `"${titleAr}"${dateStr ? ` — ${dateStr}` : ''}`,
          bodyEn: `"${titleEn}"${dateStrEn ? ` — ${dateStrEn}` : ''}`,
          sourceType: 'meeting', sourceId: meeting.id || null, deepLink: 'scheduled',
        });
      }
    } catch (e) {
      console.error('[notifyMeetingInvite] in-app failed', att.email, e.message);
    }

    // Email (and WhatsApp if phone present)
    try {
      const subject = `دعوة اجتماع: ${titleAr} / Meeting Invitation: ${titleEn}`;
      const text =
        `${actorName} دعاك لحضور الاجتماع التالي:\n\n"${titleAr}"` +
        (dateStr ? `\nالموعد: ${dateStr}` : '') +
        `\n\nيرجى تأكيد حضورك.\n\n` +
        `———\n\n` +
        `${actorName} has invited you to the following meeting:\n\n"${titleEn}"` +
        (dateStrEn ? `\nDate & Time: ${dateStrEn}` : '') +
        `\n\nPlease confirm your attendance.`;
      await notify.notify({
        channel: att.phone ? 'both' : 'email',
        email: att.email,
        phone: att.phone || undefined,
        subject,
        text,
      });
    } catch (e) {
      console.error('[notifyMeetingInvite] email failed for', att.email, e.message);
    }
  }
}

// ── Executive Action permissions (RBAC, Phase 4) ────────────────────────────
// Full management (reassign owner, change text/priority/due date, delete) now
// requires the granular `actions.assign` permission instead of a hardcoded
// role-name list — the default seed (src/services/rbac.js) grants it to the
// exact same six roles the old TASK_FULL_MANAGE_ROLES list did, so this is a
// drop-in enhancement, not a behavior change. `actions.view` (present without
// actions.assign, e.g. Employee) scopes GET /tasks to the caller's own tasks;
// having neither permission is a full 403 (was previously implicit/undefined
// for any role outside the two hardcoded checks).
function canFullyManageActions(userId) {
  return rbacService.hasPermission(db, userId, 'actions.assign');
}

// SQLite's CURRENT_TIMESTAMP produces 'YYYY-MM-DD HH:MM:SS' (UTC, no
// fractional seconds or offset) — match that format exactly when a
// timestamp needs to be computed in JS instead, so string comparisons
// against other DATETIME columns (e.g. date-range queries) stay correct.
function sqlNow() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

router.get('/tasks', auth, (req, res) => {
  // Auto-mark overdue: any task with a past due_date that isn't in a
  // terminal/held state. Waiting and Blocked are deliberately excluded —
  // like Done/Cancelled, they're states a human set on purpose and the
  // automatic sweep must not silently overwrite them.
  const today = new Date().toISOString().substring(0, 10);
  const OVERDUE_WHERE = `due_date != '' AND due_date IS NOT NULL AND due_date < ?
      AND status NOT IN ('done', 'cancelled', 'overdue', 'waiting', 'blocked')`;
  // Read the about-to-flip rows before the sweep UPDATE so their owners can
  // be notified exactly once — once a task's status becomes 'overdue' it no
  // longer matches this WHERE clause on subsequent polls, so this can't
  // double-notify.
  const flippingToOverdue = db.prepare(`SELECT id, owner_id, text_ar, text_en, due_date FROM tasks WHERE ${OVERDUE_WHERE}`).all(today);
  db.prepare(`UPDATE tasks SET status='overdue', updated_at=CURRENT_TIMESTAMP WHERE ${OVERDUE_WHERE}`).run(today);
  for (const t of flippingToOverdue) {
    if (!t.owner_id) continue;
    createNotification(db, {
      userId: t.owner_id,
      type: 'task_overdue',
      titleAr: 'مهمة تنفيذية متأخرة',
      titleEn: 'Executive task overdue',
      bodyAr: `تجاوزت المهمة "${t.text_ar || t.id}" تاريخ استحقاقها (${t.due_date})`,
      bodyEn: `"${t.text_en || t.text_ar || t.id}" is past its due date (${t.due_date})`,
      priority: 'high', sourceType: 'task', sourceId: t.id, deepLink: 'tasks',
    });
  }

  const hasView = rbacService.hasPermission(db, req.user.id, 'actions.view');
  const hasUpdate = rbacService.hasPermission(db, req.user.id, 'actions.update');
  if (!hasView && !hasUpdate) return res.status(403).json({ error: 'Not permitted to view executive actions' });

  const ORDER = "ORDER BY CASE status WHEN 'overdue' THEN 1 WHEN 'blocked' THEN 2 WHEN 'inprogress' THEN 3 WHEN 'waiting' THEN 4 WHEN 'new' THEN 5 WHEN 'open' THEN 5 WHEN 'assigned' THEN 5 ELSE 6 END, due_date ASC";
  const UPDATE_COLS = `,
      (SELECT COUNT(*) FROM task_updates WHERE task_id=t.id) AS update_count,
      (SELECT update_text FROM task_updates WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) AS latest_update_text,
      (SELECT author_name FROM task_updates WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) AS latest_update_author`;
  const params = [];
  let where = '';
  if (!hasView) { where = 'WHERE owner_id=?'; params.push(req.user.id); }
  if (req.query.meeting_id) { where += (where ? ' AND ' : 'WHERE ') + 'source_meeting_id=?'; params.push(req.query.meeting_id); }
  const tasks = db.prepare(`SELECT t.* ${UPDATE_COLS} FROM tasks t ${where} ${ORDER}`).all(...params);
  res.json(tasks);
});

// ── Manager rollups: Team Overview, Department Overview, Bottlenecks, Workload ──
// Reuses the same tasks table the individual "My Actions" views already read —
// no new tracking, just aggregated differently for whoever can fully manage
// actions (the same actions.assign bar the Team/Department quick filters use).
// Factored out so the Dashboard Intelligence endpoint below can reuse the same
// per-department aggregation instead of recomputing it.
function computeTaskRollups() {
  const rows = db.prepare(`
    SELECT t.owner_id, t.owner_name_ar, t.owner_name_en, t.status, t.due_date, t.priority,
           t.text_ar, t.text_en, t.id, t.updated_at, t.created_at,
           u.department
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
    WHERE t.owner_name_ar IS NOT NULL AND t.owner_name_ar != ''
  `).all();

  const byPerson = {};
  const byDept = {};
  const bottlenecks = [];
  const today = new Date().toISOString().substring(0, 10);

  for (const t of rows) {
    const personKey = t.owner_id || t.owner_name_ar;
    const dept = t.department || null;
    if (!byPerson[personKey]) {
      byPerson[personKey] = { owner_id: t.owner_id, name_ar: t.owner_name_ar, name_en: t.owner_name_en, department: dept, total: 0, done: 0, open: 0, overdue: 0, blocked: 0 };
    }
    const p = byPerson[personKey];
    p.total++;
    if (t.status === 'done') p.done++;
    else if (t.status === 'cancelled') { /* excluded from open/total-active counts */ }
    else {
      p.open++;
      if (t.status === 'overdue') p.overdue++;
      if (t.status === 'blocked') p.blocked++;
    }
    if (dept) {
      if (!byDept[dept]) byDept[dept] = { department: dept, total: 0, done: 0, open: 0, overdue: 0, blocked: 0, people: new Set() };
      const d = byDept[dept];
      d.total++;
      d.people.add(personKey);
      if (t.status === 'done') d.done++;
      else if (t.status !== 'cancelled') {
        d.open++;
        if (t.status === 'overdue') d.overdue++;
        if (t.status === 'blocked') d.blocked++;
      }
    }
    if (t.status === 'blocked' || (t.status === 'overdue' && t.due_date)) {
      const daysLate = t.due_date ? Math.round((new Date(today) - new Date(t.due_date)) / 86400000) : 0;
      bottlenecks.push({
        id: t.id, text_ar: t.text_ar, text_en: t.text_en, status: t.status, priority: t.priority,
        owner_name_ar: t.owner_name_ar, owner_name_en: t.owner_name_en, department: dept,
        due_date: t.due_date, days_late: daysLate,
      });
    }
  }

  const byPersonArr = Object.values(byPerson).map(p => ({ ...p, pct: p.total ? Math.round(p.done / p.total * 100) : 0 })).sort((a, b) => b.open - a.open);
  const byDeptArr = Object.values(byDept).map(d => ({ ...d, people: d.people.size, pct: d.total ? Math.round(d.done / d.total * 100) : 0 })).sort((a, b) => b.open - a.open);
  bottlenecks.sort((a, b) => b.days_late - a.days_late);

  return { byPerson: byPersonArr, byDepartment: byDeptArr, bottlenecks };
}

router.get('/tasks/manager-overview', auth, requirePermission('actions.assign'), (req, res) => {
  const { byPerson, byDepartment, bottlenecks } = computeTaskRollups();
  res.json({ byPerson, byDepartment, bottlenecks: bottlenecks.slice(0, 30) });
});

// ── Team Performance analytics ───────────────────────────────────────────────
// Workload and department comparison reuse computeTaskRollups() (same
// aggregation as manager-overview/dashboard-intelligence — not recomputed
// three different ways). Two things genuinely don't exist anywhere yet:
// ── Risk Register — aggregate AI-extracted risks across all meetings ──────────
router.get('/risks', auth, (req, res) => {
  const { severity, q } = req.query;
  const rows = db.prepare(`SELECT id, title_ar, title_en, meeting_date, ai_risks FROM meetings WHERE ai_risks IS NOT NULL AND ai_risks != '' AND ai_risks != '[]' ORDER BY meeting_date DESC`).all();
  const risks = [];
  rows.forEach(m => {
    let list = [];
    try { list = JSON.parse(m.ai_risks); if (!Array.isArray(list)) list = []; } catch { return; }
    list.forEach((r, i) => {
      const sev = r.severity || 'medium';
      if (severity && sev !== severity) return;
      const textAr = r.text_ar || (typeof r === 'string' ? r : '');
      const textEn = r.text_en || textAr;
      if (q && ![textAr, textEn].join(' ').toLowerCase().includes(q.toLowerCase())) return;
      risks.push({ id: `${m.id}-${i}`, meeting_id: m.id, meeting_title_ar: m.title_ar, meeting_title_en: m.title_en, meeting_date: (m.meeting_date || '').substring(0, 10), text_ar: textAr, text_en: textEn, severity: sev, mitigation: r.mitigation || '' });
    });
  });
  res.json(risks);
});

router.get('/analytics/team-performance', auth, requirePermission('actions.assign'), (req, res) => {
  const { byPerson, byDepartment } = computeTaskRollups();

  // Average completion time — the tasks table has no dedicated
  // completed_at column, so this is updated_at minus created_at for rows
  // currently status='done'. That's an approximation (updated_at moves on
  // any edit, not only the completing one) rather than a fabricated number;
  // documented here and in the frontend label so it isn't read as more
  // precise than it is.
  const completionTimes = db.prepare(`
    SELECT owner_id, (julianday(updated_at) - julianday(created_at)) as days
    FROM tasks WHERE status='done' AND created_at IS NOT NULL AND updated_at IS NOT NULL
  `).all();
  const avgCompletionDays = completionTimes.length
    ? Math.round((completionTimes.reduce((s, r) => s + r.days, 0) / completionTimes.length) * 10) / 10
    : null;

  // Overdue trend — there's no historical snapshot of status changes, so
  // "overdue over time" is reconstructed from real due_date/updated_at data:
  // for each of the last 8 weeks (bucketed by due date), how many of the
  // tasks due that week are either still overdue now, or were completed
  // after their due date (i.e. were late when they finished).
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.now() - i * 7 * 86400000);
    start.setUTCHours(0, 0, 0, 0);
    const startStr = start.toISOString().substring(0, 10);
    const end = new Date(start.getTime() + 7 * 86400000).toISOString().substring(0, 10);
    const row = db.prepare(`
      SELECT
        COUNT(*) as due_count,
        SUM(CASE WHEN status='overdue' THEN 1
                 WHEN status='done' AND date(updated_at) > date(due_date) THEN 1
                 ELSE 0 END) as late_count
      FROM tasks WHERE due_date >= ? AND due_date < ? AND due_date != ''
    `).get(startStr, end);
    weeks.push({ week_start: startStr, due_count: row.due_count || 0, late_count: row.late_count || 0 });
  }

  const atRiskDepartments = byDepartment
    .filter(d => d.open >= 3 && d.overdue / d.open >= 0.3)
    .map(d => ({ department: d.department, overdue: d.overdue, open: d.open, ratio: Math.round((d.overdue / d.open) * 100) }));

  res.json({
    workload: byPerson.map(p => ({ name_ar: p.name_ar, name_en: p.name_en, department: p.department, open: p.open, done: p.done, total: p.total, pct: p.pct })),
    department_comparison: byDepartment,
    avg_completion_days: avgCompletionDays,
    overdue_trend: weeks,
    risk_areas: atRiskDepartments,
  });
});

router.post('/tasks', auth, async (req, res) => {
  const canTouch = ['actions.view', 'actions.update', 'actions.assign', 'actions.close']
    .some((k) => rbacService.hasPermission(db, req.user.id, k));
  if (!canTouch) return res.status(403).json({ error: 'Not permitted to create tasks' });
  const { text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, review_status } = req.body;
  if (!text_ar) return res.status(400).json({ error: 'text_ar required' });
  let oNameAr = owner_name_ar || '';
  let oNameEn = owner_name_en || '';
  if (owner_id) {
    const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(owner_id);
    if (u) { oNameAr = u.name_ar; oNameEn = u.name_en; }
  }
  const row = db.prepare(`
    INSERT INTO tasks (text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, status, review_status, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by, assigned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(text_ar, text_en || text_ar, owner_id || null, oNameAr, oNameEn, due_date || '', priority || 'normal', owner_id ? 'assigned' : 'open', review_status || 'approved', source_meeting_id || null, source_meeting_title_ar || '', source_meeting_title_en || '', req.user.id, owner_id ? sqlNow() : null);
  const created = db.prepare('SELECT * FROM tasks WHERE id=?').get(row.lastInsertRowid);
  await notifyTaskAssigned(created, req.user.id);
  res.json(created);
});

router.patch('/tasks/:id', auth, async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const canFullyManage = canFullyManageActions(req.user.id);
  if (!canFullyManage) {
    const hasOwnUpdate = rbacService.hasPermission(db, req.user.id, 'actions.update');
    if (!hasOwnUpdate || task.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not permitted to manage this task' });
    }
  }
  // Employees may only move their own task's status/notes/progress forward —
  // not reassign, retitle, reprioritize, or reschedule it.
  const body = canFullyManage
    ? req.body
    : { status: req.body.status, notes: req.body.notes, progress: req.body.progress };

  const { status, notes, due_date, priority, text_ar, text_en, owner_id, owner_name_ar, owner_name_en, progress, review_status } = body;
  // Resolve a freshly-assigned owner (by id) to its bilingual names, so editing
  // the owner keeps owner_name_ar/en in sync with owner_id.
  let oId = (owner_id === undefined) ? undefined : (owner_id || null);
  let oNameAr = owner_name_ar;
  let oNameEn = owner_name_en;
  if (owner_id) {
    const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(owner_id);
    if (u) { oNameAr = u.name_ar; oNameEn = u.name_en; }
  }
  // If an owner is newly attached and the caller didn't also specify a status,
  // move a still-unowned task straight to "Assigned" — a manager assigning a
  // task shouldn't have to separately flip its status too.
  let newStatus = status;
  if (newStatus === undefined && oId && !task.owner_id && ['new', 'open'].includes(task.status)) {
    newStatus = 'assigned';
  }
  // Real (re)assignment vs. an unrelated field edit — used both to decide
  // whether to notify the new owner and to stamp assigned_at, so "Recently
  // Assigned" reflects genuine ownership changes, not every touch of the row.
  const ownerChanged = oId !== undefined && oId !== null && oId !== task.owner_id;
  db.prepare(`UPDATE tasks SET
      status=COALESCE(?,status), notes=COALESCE(?,notes), due_date=COALESCE(?,due_date), priority=COALESCE(?,priority),
      text_ar=COALESCE(?,text_ar), text_en=COALESCE(?,text_en), progress=COALESCE(?,progress),
      review_status=COALESCE(?,review_status),
      owner_id=COALESCE(?,owner_id), owner_name_ar=COALESCE(?,owner_name_ar), owner_name_en=COALESCE(?,owner_name_en),
      assigned_at=COALESCE(?,assigned_at),
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(newStatus, notes, due_date, priority, text_ar, text_en, progress, review_status, oId, oNameAr, oNameEn, ownerChanged ? sqlNow() : null, req.params.id);
  const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  // Only notify when the owner actually changed to a new, real assignee —
  // not on every unrelated field edit (status/notes/etc. don't re-notify).
  if (ownerChanged) {
    await notifyTaskAssigned(updated, req.user.id);
  }
  res.json(updated);
});

router.delete('/tasks/:id', auth, (req, res) => {
  if (!canFullyManageActions(req.user.id)) return res.status(403).json({ error: 'Not permitted to delete tasks' });
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── AI Draft Task approve / reject ─────────────────────────────────────────────
function logMeetingEvent(meetingId, eventType, entityId, userId, prevVal, newVal, meta) {
  if (!meetingId) return;
  try {
    db.prepare(`INSERT INTO meeting_events (meeting_id, event_type, entity_id, user_id, source, previous_value, new_value, metadata) VALUES (?, ?, ?, ?, 'user', ?, ?, ?)`)
      .run(meetingId, eventType, entityId || null, userId || null, prevVal || '', newVal || '', JSON.stringify(meta || {}));
  } catch (_) {}
}

router.post('/tasks/:id/approve', auth, async (req, res) => {
  if (!canFullyManageActions(req.user.id)) return res.status(403).json({ error: 'Not permitted to approve tasks' });
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const { owner_id, due_date, priority, text_ar, text_en, notes } = req.body;
  let oId = owner_id || task.owner_id || null;
  let oNameAr = task.owner_name_ar || '';
  let oNameEn = task.owner_name_en || '';
  if (owner_id) {
    const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(owner_id);
    if (u) { oNameAr = u.name_ar; oNameEn = u.name_en; }
  }
  const newStatus = oId ? 'assigned' : 'open';
  db.prepare(`UPDATE tasks SET
    ai_status='approved', status=?, review_status='approved',
    approved_by=?, approved_at=CURRENT_TIMESTAMP,
    owner_id=COALESCE(?,owner_id), owner_name_ar=COALESCE(?,owner_name_ar), owner_name_en=COALESCE(?,owner_name_en),
    due_date=COALESCE(?,due_date), priority=COALESCE(?,priority),
    text_ar=COALESCE(?,text_ar), text_en=COALESCE(?,text_en), notes=COALESCE(?,notes),
    assigned_at=CASE WHEN ? IS NOT NULL AND (owner_id IS NULL OR owner_id != ?) THEN CURRENT_TIMESTAMP ELSE assigned_at END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(newStatus, req.user.id, oId, oNameAr || null, oNameEn || null,
      due_date || null, priority || null, text_ar || null, text_en || null, notes || null,
      owner_id || null, owner_id || null, req.params.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  logMeetingEvent(task.source_meeting_id, 'AI_TASK_APPROVED', task.id, req.user.id, 'ai_draft', 'approved', { text_ar: task.text_ar });
  if (owner_id && owner_id !== task.owner_id) {
    logMeetingEvent(task.source_meeting_id, 'TASK_ASSIGNED', task.id, req.user.id, task.owner_name_ar || '', oNameAr, { owner_id });
    await notifyTaskAssigned(updated, req.user.id);
  }
  res.json(updated);
});

router.post('/tasks/:id/reject', auth, (req, res) => {
  if (!canFullyManageActions(req.user.id)) return res.status(403).json({ error: 'Not permitted to reject tasks' });
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { reason } = req.body;
  db.prepare(`UPDATE tasks SET ai_status='rejected', status='cancelled', rejection_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(reason || '', req.params.id);
  logMeetingEvent(task.source_meeting_id, 'AI_TASK_REJECTED', task.id, req.user.id, 'ai_draft', 'rejected', { reason: reason || '' });
  res.json({ success: true });
});

// ── AI Draft Decision approve / reject ─────────────────────────────────────────
router.post('/decisions/:id/approve', auth, (req, res) => {
  if (!canFullyManageActions(req.user.id)) return res.status(403).json({ error: 'Not permitted to approve decisions' });
  const dec = db.prepare('SELECT * FROM decisions WHERE id=?').get(req.params.id);
  if (!dec) return res.status(404).json({ error: 'Not found' });
  const { text_ar, text_en, notes, implementation_notes, decided_by, owner_id } = req.body;
  let ownerName = decided_by || dec.decided_by || '';
  if (owner_id) {
    const u = db.prepare('SELECT name_ar FROM users WHERE id=?').get(owner_id);
    if (u) ownerName = u.name_ar;
  }
  db.prepare(`UPDATE decisions SET
    ai_status='approved', status='active', approved_by=?, approved_at=CURRENT_TIMESTAMP,
    text_ar=COALESCE(?,text_ar), text_en=COALESCE(?,text_en),
    notes=COALESCE(?,notes), implementation_notes=COALESCE(?,implementation_notes),
    decided_by=COALESCE(?,decided_by), owner_id=COALESCE(?,owner_id)
    WHERE id=?`)
    .run(req.user.id, text_ar || null, text_en || null, notes || null, implementation_notes || null,
      ownerName || null, owner_id || null, req.params.id);
  const updated = db.prepare('SELECT * FROM decisions WHERE id=?').get(req.params.id);
  logMeetingEvent(dec.meeting_id, 'AI_DECISION_APPROVED', dec.id, req.user.id, 'ai_draft', 'approved', { text_ar: dec.text_ar });
  res.json(updated);
});

router.post('/decisions/:id/reject', auth, (req, res) => {
  if (!canFullyManageActions(req.user.id)) return res.status(403).json({ error: 'Not permitted to reject decisions' });
  const dec = db.prepare('SELECT * FROM decisions WHERE id=?').get(req.params.id);
  if (!dec) return res.status(404).json({ error: 'Not found' });
  const { reason } = req.body;
  db.prepare(`UPDATE decisions SET ai_status='rejected', status='cancelled', rejection_reason=? WHERE id=?`)
    .run(reason || '', req.params.id);
  logMeetingEvent(dec.meeting_id, 'AI_DECISION_REJECTED', dec.id, req.user.id, 'ai_draft', 'rejected', { reason: reason || '' });
  res.json({ success: true });
});

// ── Task Progress History ──────────────────────────────────────────────────────

router.get('/tasks/:id/updates', auth, (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const updates = db.prepare(
    'SELECT * FROM task_updates WHERE task_id=? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(updates);
});

router.post('/tasks/:id/updates', auth, (req, res) => {
  const task = db.prepare('SELECT id, status FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const update_text = (req.body.update_text || '').toString().trim();
  if (!update_text) return res.status(400).json({ error: 'update_text is required' });
  const user = db.prepare('SELECT name_ar, name_en, role_ar, role_en, system_role FROM users WHERE id=?').get(req.user.id);
  const author_name = user ? (user.name_en || user.name_ar || req.user.email) : req.user.email;
  const author_role = user ? (user.role_en || user.role_ar || user.system_role || null) : null;
  const row = db.prepare(
    `INSERT INTO task_updates (task_id, author_id, author_name, author_role, update_text, status_snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(task.id, req.user.id, author_name, author_role, update_text, task.status);
  const created = db.prepare('SELECT * FROM task_updates WHERE id=?').get(row.lastInsertRowid);
  res.json(created);
});

// ── Task Attachments (progress evidence / completion proof) ───────────────────
router.get('/tasks/:id/attachments', auth, (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(db.prepare('SELECT * FROM task_attachments WHERE task_id=? ORDER BY created_at DESC').all(req.params.id));
});

router.post('/tasks/:id/attachments', auth, upload.single('file'), (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
  if (!task) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Task not found' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported format (PDF, DOCX, XLSX, PPTX, TXT only)' });
  const uploaderName = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(req.user.id);
  const kind = ['completion', 'evidence'].includes(req.body.kind) ? 'completion' : 'attachment';
  const row = db.prepare(`
    INSERT INTO task_attachments (task_id, file_name, file_path, file_size, kind, uploaded_by, uploaded_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, fixFilename(req.file.originalname), req.file.filename, req.file.size, kind, req.user.id, uploaderName ? (uploaderName.name_en || uploaderName.name_ar) : '');
  res.json(db.prepare('SELECT * FROM task_attachments WHERE id=?').get(row.lastInsertRowid));
});

router.delete('/tasks/:id/attachments/:attId', auth, (req, res) => {
  const att = db.prepare('SELECT * FROM task_attachments WHERE id=? AND task_id=?').get(req.params.attId, req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  if (att.uploaded_by !== req.user.id && !canFullyManageActions(req.user.id)) {
    return res.status(403).json({ error: 'Only the uploader or a manager can remove this attachment' });
  }
  try { fs.unlinkSync(path.join(UPLOADS_DIR, att.file_path)); } catch {}
  db.prepare('DELETE FROM task_attachments WHERE id=?').run(req.params.attId);
  res.json({ success: true });
});

// ── Task Escalation ────────────────────────────────────────────────────────────
router.post('/tasks/:id/escalate', auth, async (req, res) => {
 try {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { escalate_to_id, comments } = req.body;
  if (!escalate_to_id) return res.status(400).json({ error: 'escalate_to_id is required' });

  // Resolve escalation target
  const target = db.prepare('SELECT id, name_en, name_ar, role_en, role_ar, email FROM users WHERE id=?').get(escalate_to_id);
  if (!target) return res.status(404).json({ error: 'Escalation target user not found' });

  const targetName = target.name_en || target.name_ar || String(target.id);

  // Resolve escalating user
  const actor = db.prepare('SELECT name_en, name_ar, role_en, role_ar FROM users WHERE id=?').get(req.user.id);
  const actorName = actor ? (actor.name_en || actor.name_ar || req.user.email) : req.user.email;
  const actorNameAr = actor ? (actor.name_ar || actor.name_en || req.user.email) : req.user.email;

  // Update task
  db.prepare(
    `UPDATE tasks SET escalated_at=CURRENT_TIMESTAMP, escalated_to=?, escalated_to_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(target.id, targetName, task.id);

  // Build update text
  const updateText = comments
    ? `Task Escalated to ${targetName}: ${comments}`
    : `Task Escalated to ${targetName}`;

  // Insert task_updates record
  const actorRole = actor ? (actor.role_en || actor.role_ar || null) : null;
  db.prepare(
    `INSERT INTO task_updates (task_id, author_id, author_name, author_role, update_text, status_snapshot) VALUES (?,?,?,?,?,?)`
  ).run(task.id, req.user.id, actorName, actorRole, updateText, task.status);

  // Send notification to escalation target (best-effort). Bilingual — Arabic
  // block followed by English, same convention as the meeting-reminder email
  // (src/reminders.js buildReminderMessage), since the recipient's preferred
  // language isn't known with certainty at send time.
  const taskTitleEn = task.text_en || task.text_ar || `Task #${task.id}`;
  const taskTitleAr = task.text_ar || task.text_en || `مهمة #${task.id}`;
  const subject = `تصعيد مهمة إليك: ${taskTitleAr} / Task Escalated to You: ${taskTitleEn}`;
  const body =
    `قام ${actorNameAr} بتصعيد المهمة التالية إليك:\n\n"${taskTitleAr}"\n\n${comments ? `ملاحظة: ${comments}\n\n` : ''}يرجى المراجعة واتخاذ الإجراء اللازم.\n\n———\n\n` +
    `${actorName} has escalated the following task to you:\n\n"${taskTitleEn}"\n\n${comments ? `Note: ${comments}\n\n` : ''}Please review and take action.`;
  const notifResult = {};
  try {
    if (target.email) {
      notifResult.email = await notify.sendEmail({ to: target.email, subject, text: body });
    }
  } catch (e) {
    notifResult.error = e.message;
  }

  const updatedTask = db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
  res.json({ success: true, task: updatedTask, notification: notifResult });
 } catch (e) {
  console.error('✗ /tasks/:id/escalate failed:', e.message);
  res.status(500).json({ error: e.message });
 }
});

// ── Decisions ─────────────────────────────────────────────────────────────────
router.get('/decisions', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM decisions ORDER BY created_at DESC').all());
});

// Manually record a decision — used by the Live Meeting Quick Action "Add
// Decision" (AI-extracted decisions from processed transcripts go through the
// pipeline instead; this is for a decision the chair wants captured on the spot).
router.post('/decisions', auth, (req, res) => {
  const canTouch = ['actions.view', 'actions.update', 'actions.assign', 'actions.close']
    .some((k) => rbacService.hasPermission(db, req.user.id, k));
  if (!canTouch) return res.status(403).json({ error: 'Not permitted to record decisions' });
  const { text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en, decided_by, notes } = req.body;
  if (!text_ar) return res.status(400).json({ error: 'text_ar required' });
  const actor = resolveActor(req.user.id);
  const row = db.prepare(`
    INSERT INTO decisions (text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en, decided_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(text_ar, text_en || text_ar, meeting_id || null, meeting_title_ar || '', meeting_title_en || '', decided_by || actor.name || '', notes || '');
  res.json(db.prepare('SELECT * FROM decisions WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/decisions/:id', auth, requirePermission('actions.assign'), (req, res) => {
  const dec = db.prepare('SELECT * FROM decisions WHERE id=?').get(req.params.id);
  if (!dec) return res.status(404).json({ error: 'Not found' });
  const { status, text_ar, text_en, notes, decided_by, implementation_notes } = req.body;
  db.prepare(`UPDATE decisions SET
    status=COALESCE(?,status), text_ar=COALESCE(?,text_ar), text_en=COALESCE(?,text_en),
    notes=COALESCE(?,notes), decided_by=COALESCE(?,decided_by),
    implementation_notes=COALESCE(?,implementation_notes)
    WHERE id=?`)
    .run(status || null, text_ar || null, text_en || null, notes || null, decided_by || null, implementation_notes || null, req.params.id);
  if (status && status !== dec.status) {
    logMeetingEvent(dec.meeting_id, 'AI_DECISION_EDITED', dec.id, req.user.id, dec.status, status, {});
  }
  res.json(db.prepare('SELECT * FROM decisions WHERE id=?').get(req.params.id));
});

router.delete('/decisions/:id', auth, requirePermission('actions.assign'), (req, res) => {
  db.prepare('DELETE FROM decisions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Schedule ─────────────────────────────────────────────────────────────────
router.get('/schedule', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, u.name_ar as creator_ar, u.name_en as creator_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      ms.name_ar as series_name_ar, ms.name_en as series_name_en,
      (SELECT COUNT(*) FROM meeting_documents WHERE schedule_id=s.id OR (s.source_meeting_id IS NOT NULL AND meeting_id=s.source_meeting_id)) as doc_count
    FROM schedule s
    LEFT JOIN users u ON s.created_by=u.id
    LEFT JOIN boards b ON s.board_id=b.id
    LEFT JOIN committees c ON s.committee_id=c.id
    LEFT JOIN meeting_series ms ON s.series_id=ms.id
    ORDER BY meeting_date ASC, meeting_time ASC
  `).all());
});

// POST /api/meetings/:id/manual-minutes — save hand-written minutes
router.post('/meetings/:id/manual-minutes', auth, (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  const { minutes_ar, minutes_en } = req.body;
  if (!minutes_ar) return res.status(400).json({ error: 'minutes_ar required' });
  db.prepare('UPDATE meetings SET ai_minutes_ar=?, ai_minutes_en=? WHERE id=?')
    .run(minutes_ar, minutes_en || minutes_ar, req.params.id);
  const stagesBeforeGenerated = ['created', 'recording', 'transcript_generated'];
  if (stagesBeforeGenerated.includes(meeting.lifecycle_stage || 'created')) {
    transitionMeeting(req.params.id, 'ai_minutes_generated', req.user.id, 'Manual minutes saved');
  }
  res.json({ ok: true });
});

// GET /api/schedule/:id — fetch a single schedule row
router.get('/schedule/:id', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(s);
});

// GET /api/schedule/:id/ics — download a single meeting as an ICS calendar file
router.get('/schedule/:id/ics', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'NOT_FOUND' });
  const uid = `ameen-meeting-${s.id}@ameen-ai.sa`;
  const title = s.title_en || s.title_ar || 'Meeting';
  const desc = [s.agenda_en || s.agenda_ar || '', s.meeting_location ? `Location: ${s.meeting_location}` : (s.meeting_join_url ? `Join: ${s.meeting_join_url}` : '')].filter(Boolean).join('\\n');
  const location = s.meeting_location || s.meeting_join_url || s.platform || '';
  // Build DTSTART / DTEND in UTC (meeting is GMT+3 / Riyadh)
  const dateStr = (s.meeting_date || '').replace(/-/g, '');
  const timeStr = (s.meeting_time || '09:00').replace(':', '') + '00';
  const durationMins = s.duration_mins || 60;
  // Convert Riyadh time (UTC+3) → UTC
  const startLocalMin = parseInt(timeStr.slice(0, 2)) * 60 + parseInt(timeStr.slice(2, 4)) - 180;
  const startH = String(Math.floor(((startLocalMin % 1440) + 1440) % 1440 / 60)).padStart(2, '0');
  const startM = String(((startLocalMin % 60) + 60) % 60).padStart(2, '0');
  const endMin = startLocalMin + durationMins;
  const endH = String(Math.floor(((endMin % 1440) + 1440) % 1440 / 60)).padStart(2, '0');
  const endM = String(((endMin % 60) + 60) % 60).padStart(2, '0');
  const dtStart = `${dateStr}T${startH}${startM}00Z`;
  const dtEnd = `${dateStr}T${endH}${endM}00Z`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ameen Secretary//Meeting Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    desc ? `DESCRIPTION:${desc}` : '',
    location ? `LOCATION:${location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const filename = `meeting-${s.id}.ics`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(ics);
});

function conflictPayload(conflicts) {
  return {
    error: 'CONFLICT',
    message: 'يتعارض هذا الموعد مع اجتماع مؤكَّد آخر / This time overlaps a confirmed meeting',
    conflicts: conflicts.map(c => ({ id: c.id, title_ar: c.title_ar, title_en: c.title_en, meeting_date: c.meeting_date, meeting_time: c.meeting_time, duration_mins: c.duration_mins }))
  };
}

function addNPeriods(originDateStr, recurrence, n) {
  const [y, m, dayOfMonth] = originDateStr.split('-').map(Number);
  const pad = v => String(v).padStart(2, '0');
  if (recurrence === 'weekly') {
    const d = new Date(Date.UTC(y, m - 1, dayOfMonth));
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return d.toISOString().substring(0, 10);
  }
  if (recurrence === 'biweekly') {
    const d = new Date(Date.UTC(y, m - 1, dayOfMonth));
    d.setUTCDate(d.getUTCDate() + 14 * n);
    return d.toISOString().substring(0, 10);
  }
  const monthsToAdd = (recurrence === 'monthly' ? 1 : 3) * n;
  const rawMonth = m - 1 + monthsToAdd;
  const newYear = y + Math.floor(rawMonth / 12);
  const normMonth = ((rawMonth % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(newYear, normMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(dayOfMonth, daysInMonth);
  return `${newYear}-${pad(normMonth + 1)}-${pad(clampedDay)}`;
}

const VALID_RECURRENCES = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly'];

router.post('/schedule', auth, requirePermission('calendar.manage'), (req, res) => {
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id, prev_meeting_id, series_id, new_series, recurrence, force, meeting_provider, meeting_join_url, meeting_location, meeting_id_external, source_meeting_id, draft } = req.body;
  const isDraft = !!draft;
  const effectiveDate = meeting_date || new Date().toISOString().substring(0, 10);
  const effectiveTime = meeting_time || '09:00';
  if (!title_ar) return res.status(400).json({ error: 'Required fields missing' });
  if (!isDraft) {
    if (!meeting_date || !meeting_time) return res.status(400).json({ error: 'Required fields missing' });
    if (!/^\d{4}-\d{2}-\d{2}/.test(meeting_date) || isNaN(new Date(meeting_date).getTime())) {
      return res.status(400).json({ error: 'meeting_date must be a valid YYYY-MM-DD date' });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d/.test(meeting_time)) {
      return res.status(400).json({ error: 'meeting_time must be in HH:MM format' });
    }
  }
  const chan = ['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : 'email';
  const rec = VALID_RECURRENCES.includes(recurrence) ? recurrence : 'none';
  const status = isDraft ? 'draft' : 'confirmed';
  const conflicts = isDraft ? [] : findConflicts({ date: effectiveDate, time: effectiveTime, durationMins: duration_mins || 60 });
  if (conflicts.length && !force) return res.status(409).json(conflictPayload(conflicts));
  const groupId = rec !== 'none' && !isDraft ? crypto.randomUUID() : null;
  const VALID_PROVIDERS = ['zoom','teams','google_meet','physical','virtual','hybrid'];
  const prov = VALID_PROVIDERS.includes(meeting_provider) ? meeting_provider : 'physical';
  const provPlatform = { zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet', virtual: 'Virtual', hybrid: 'Hybrid' }[prov] || (platform || 'قاعة الاجتماعات');
  const resolvedSeriesId = resolveOrCreateSeriesId({ series_id, new_series }, req.user.id);
  const insertSched = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, status, created_by, meeting_type, board_id, committee_id, prev_meeting_id, series_id, recurrence, recurrence_group_id, meeting_provider, meeting_join_url, meeting_location, meeting_id_external, source_meeting_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const dur = duration_mins || 60;
  let row;
  db.transaction(() => {
    row = insertSched.run(title_ar, title_en || title_ar, effectiveDate, effectiveTime, dur, provPlatform, attendees || '', agenda_ar || '', agenda_en || '', chan, status, req.user.id, meeting_type || '', board_id || null, committee_id || null, prev_meeting_id || null, resolvedSeriesId || null, rec, groupId, prov, meeting_join_url || '', meeting_location || '', meeting_id_external || '', source_meeting_id || null);
    if (rec !== 'none' && !isDraft) {
      for (let i = 1; i <= 3; i++) {
        const nextDate = addNPeriods(effectiveDate, rec, i);
        insertSched.run(title_ar, title_en || title_ar, nextDate, effectiveTime, dur, provPlatform, attendees || '', agenda_ar || '', agenda_en || '', chan, status, req.user.id, meeting_type || '', board_id || null, committee_id || null, null, resolvedSeriesId || null, rec, groupId, prov, meeting_join_url || '', meeting_location || '', meeting_id_external || '', null);
      }
    }
  })();
  // Skip attendee notifications for drafts — they haven't been confirmed yet.
  if (!isDraft) {
    const { splitRecipients, isValidEmail } = require('../utils/validate');
    const attendeeEmails = splitRecipients(attendees || '').filter(isValidEmail);
    if (attendeeEmails.length) {
      const placeholders = attendeeEmails.map(() => '?').join(',');
      const matchedUsers = db.prepare(`SELECT id FROM users WHERE email IN (${placeholders})`).all(...attendeeEmails);
      notifyUsers(db, matchedUsers.map(u => u.id), {
        type: 'meeting_scheduled',
        titleAr: 'تمت جدولة اجتماع جديد',
        titleEn: 'New meeting scheduled',
        bodyAr: `"${title_ar}" — ${effectiveDate} الساعة ${effectiveTime}`,
        bodyEn: `"${title_en || title_ar}" — ${effectiveDate} at ${effectiveTime}`,
        sourceType: 'schedule', sourceId: row.lastInsertRowid, deepLink: 'schedule',
      }, req.user.id);
      // Also send email invitations to every attendee address
      const attendeeList = attendeeEmails.map(e => ({ email: e, phone: null }));
      notifyMeetingInvite(
        { id: null, title_ar, title_en: title_en || title_ar, meeting_date: effectiveDate, meeting_time: effectiveTime },
        attendeeList,
        req.user.id
      );
    }
  }
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.lastInsertRowid));
});

// ── Confirm a Draft meeting (finalize): runs the conflict check, then arms the
// 15-minute reminder by clearing reminder_sent. Drafts are created automatically
// from transcript scheduling intents. ───────────────────────────────────────────
router.patch('/schedule/:id/confirm', auth, requirePermission('calendar.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.meeting_date || !row.meeting_time) {
    return res.status(400).json({ error: 'MISSING_DATETIME', message: 'حدّد التاريخ والوقت قبل التأكيد / Set a date and time before confirming' });
  }
  const conflicts = findConflicts({ date: row.meeting_date, time: row.meeting_time, durationMins: row.duration_mins, excludeId: row.id });
  if (conflicts.length && !req.body.force) return res.status(409).json(conflictPayload(conflicts));
  db.prepare("UPDATE schedule SET status='confirmed', reminder_sent=0 WHERE id=?").run(row.id);
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.id));
});

router.post('/schedule/:id/remind', auth, requirePermission('calendar.manage'), async (req, res) => {
 try {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Meeting not found' });
  const channel = ['email','whatsapp','both'].includes(row.reminder_channel) ? row.reminder_channel : 'email';
  const { splitRecipients, isValidEmail, isValidPhone, normalizePhone } = require('../utils/validate');
  const rawList = splitRecipients(row.attendees || '');
  const emails = rawList.filter(isValidEmail);
  const phones = rawList.filter(s => !/@/.test(s) && isValidPhone(s)).map(normalizePhone);
  if (!emails.length && !phones.length) return res.status(400).json({ error: 'No valid email addresses or phone numbers found in attendees' });
  const date = (row.meeting_date || '').substring(0, 10);
  const time = (row.meeting_time || '09:00').substring(0, 5);
  const subject = `تذكير: ${row.title_ar} — ${date} ${time} | Reminder: ${row.title_en || row.title_ar} — ${date} ${time}`;
  const text = [`تذكير باجتماع قادم\n\nالعنوان: ${row.title_ar}\nالتاريخ: ${date}  الوقت: ${time}\nالمنصة: ${row.platform || '-'}`, row.agenda_ar ? `جدول الأعمال:\n${row.agenda_ar}` : '', `\n— أمين السكرتير\n\n———\n\nReminder: upcoming meeting\n\nTitle: ${row.title_en || row.title_ar}\nDate: ${date}  Time: ${time}\nPlatform: ${row.platform || '-'}`, row.agenda_en ? `Agenda:\n${row.agenda_en}` : '', '\n— Ameen Secretary'].filter(Boolean).join('\n');
  const results = { channel, emails_attempted: 0, whatsapp_attempted: 0, errors: [] };
  if ((channel === 'email' || channel === 'both') && emails.length) {
    try { await notify.sendEmail({ to: emails, subject, text }); results.emails_attempted = emails.length; }
    catch (e) { results.errors.push({ channel: 'email', error: e.message }); }
  }
  if ((channel === 'whatsapp' || channel === 'both') && phones.length) {
    try { await notify.sendWhatsApp({ to: phones, body: `${subject}\n\n${text}` }); results.whatsapp_attempted = phones.length; }
    catch (e) { results.errors.push({ channel: 'whatsapp', error: e.message }); }
  }
  const allFailed = results.errors.length > 0 && results.emails_attempted === 0 && results.whatsapp_attempted === 0;
  if (allFailed) return res.status(500).json({ error: results.errors.map(e => e.error).join('; '), results });
  res.json({ success: true, ...results });
 } catch (e) {
  console.error('✗ /schedule/:id/remind failed:', e.message);
  res.status(500).json({ error: e.message });
 }
});

router.patch('/schedule/:id', auth, requirePermission('calendar.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id, series_id, new_series, meeting_provider, meeting_join_url, meeting_id_external, recording_status, recording_provider, recording_url, transcript_provider } = req.body;
  if (meeting_date !== undefined && (!/^\d{4}-\d{2}-\d{2}/.test(meeting_date) || isNaN(new Date(meeting_date).getTime()))) {
    return res.status(400).json({ error: 'meeting_date must be a valid YYYY-MM-DD date' });
  }
  if (meeting_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d/.test(meeting_time)) {
    return res.status(400).json({ error: 'meeting_time must be in HH:MM format' });
  }
  // Create and Confirm both check for double-booking a confirmed meeting —
  // Edit never did, even though nudging an existing meeting's date/time is
  // the most common way a coordinator introduces a real double-booking.
  // Only re-check when a field that actually affects the time window changed.
  if ((meeting_date !== undefined || meeting_time !== undefined || duration_mins !== undefined) && row.status !== 'draft') {
    const conflicts = findConflicts({
      date: meeting_date !== undefined ? meeting_date : row.meeting_date,
      time: meeting_time !== undefined ? meeting_time : row.meeting_time,
      durationMins: duration_mins !== undefined ? duration_mins : row.duration_mins,
      excludeId: row.id,
    });
    if (conflicts.length && !req.body.force) return res.status(409).json(conflictPayload(conflicts));
  }
  const chan = reminder_channel !== undefined
    ? (['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : row.reminder_channel)
    : row.reminder_channel;
  const VALID_PROVIDERS_UPD = ['physical','zoom','teams','google_meet','virtual','hybrid'];
  const updProv = meeting_provider !== undefined && VALID_PROVIDERS_UPD.includes(meeting_provider) ? meeting_provider : null;
  const updPlatform = updProv ? ({ zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet', virtual: 'Virtual', hybrid: 'Hybrid' }[updProv] || 'قاعة الاجتماعات') : platform;
  const newSeriesId = (series_id !== undefined || new_series) ? resolveOrCreateSeriesId({ series_id, new_series }, req.user.id) : null;
  const { meeting_location } = req.body;
  db.prepare(`UPDATE schedule SET
      title_ar=COALESCE(?,title_ar), title_en=COALESCE(?,title_en),
      meeting_date=COALESCE(?,meeting_date), meeting_time=COALESCE(?,meeting_time),
      duration_mins=COALESCE(?,duration_mins), platform=COALESCE(?,platform),
      attendees=COALESCE(?,attendees), agenda_ar=COALESCE(?,agenda_ar), agenda_en=COALESCE(?,agenda_en),
      reminder_channel=?, meeting_type=COALESCE(?,meeting_type),
      board_id=COALESCE(?,board_id), committee_id=COALESCE(?,committee_id), series_id=COALESCE(?,series_id),
      meeting_provider=COALESCE(?,meeting_provider), meeting_join_url=COALESCE(?,meeting_join_url),
      meeting_location=COALESCE(?,meeting_location),
      meeting_id_external=COALESCE(?,meeting_id_external), recording_status=COALESCE(?,recording_status),
      recording_provider=COALESCE(?,recording_provider), recording_url=COALESCE(?,recording_url),
      transcript_provider=COALESCE(?,transcript_provider), reminder_sent=0
    WHERE id=?`)
    .run(
      title_ar, title_en !== undefined ? (title_en || title_ar) : null,
      meeting_date, meeting_time, duration_mins, updPlatform,
      attendees, agenda_ar, agenda_en, chan,
      meeting_type !== undefined ? (meeting_type || null) : null,
      board_id !== undefined ? (board_id || null) : null,
      committee_id !== undefined ? (committee_id || null) : null,
      newSeriesId,
      updProv,
      meeting_join_url !== undefined ? (meeting_join_url || '') : null,
      meeting_location !== undefined ? (meeting_location || '') : null,
      meeting_id_external !== undefined ? (meeting_id_external || '') : null,
      recording_status !== undefined ? (recording_status || '') : null,
      recording_provider !== undefined ? (recording_provider || '') : null,
      recording_url !== undefined ? (recording_url || '') : null,
      transcript_provider !== undefined ? (transcript_provider || '') : null,
      req.params.id
    );
  if (req.body.source_meeting_id !== undefined) {
    db.prepare('UPDATE schedule SET source_meeting_id=? WHERE id=?').run(req.body.source_meeting_id || null, req.params.id);
  }

  // ── Reschedule audit log: record whenever date or time changes on a
  // confirmed (non-draft) meeting so managers can see who rescheduled and why.
  if (row.status !== 'draft' && (meeting_date !== undefined || meeting_time !== undefined)) {
    const oldDate = (row.meeting_date || '').substring(0, 10);
    const oldTime = (row.meeting_time || '').substring(0, 5);
    const newDateVal = meeting_date !== undefined ? meeting_date.substring(0, 10) : oldDate;
    const newTimeVal = meeting_time !== undefined ? meeting_time.substring(0, 5) : oldTime;
    if (oldDate !== newDateVal || oldTime !== newTimeVal) {
      const actor = resolveActor(req.user.id);
      db.prepare(`INSERT INTO schedule_reschedule_log
        (schedule_id, rescheduled_by, actor_name, actor_role, old_date, old_time, new_date, new_time, reason)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(req.params.id, req.user.id, actor.name || '', actor.role || '',
             oldDate, oldTime, newDateVal, newTimeVal, req.body.note || '');
    }
  }

  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id));
});

// ── GET reschedule log for a schedule entry ──────────────────────────────────
router.get('/schedule/:id/reschedule-log', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM schedule_reschedule_log WHERE schedule_id=? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(rows);
});

router.delete('/schedule/:id/series', auth, requirePermission('calendar.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.recurrence_group_id) {
    db.prepare(`DELETE FROM schedule WHERE recurrence_group_id=? AND meeting_date >= ?`).run(row.recurrence_group_id, row.meeting_date);
  } else {
    db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  }
  res.json({ success: true });
});

router.delete('/schedule/:id', auth, requirePermission('calendar.manage'), (req, res) => {
  db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Meeting Templates ─────────────────────────────────────────────────────────
router.get('/templates', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM meeting_templates ORDER BY is_builtin DESC, created_at ASC').all());
});

router.post('/templates', auth, (req, res) => {
  const { name_ar, name_en, meeting_type, agenda_ar, agenda_en, default_duration, default_attendees } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'name_ar required' });
  const row = db.prepare(`
    INSERT INTO meeting_templates (name_ar, name_en, meeting_type, agenda_ar, agenda_en, default_duration, default_attendees, is_builtin, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(name_ar, name_en || name_ar, meeting_type || '', agenda_ar || '', agenda_en || '', default_duration || 60, default_attendees || '', req.user.id);
  res.json(db.prepare('SELECT * FROM meeting_templates WHERE id=?').get(row.lastInsertRowid));
});

router.delete('/templates/:id', auth, (req, res) => {
  const tpl = db.prepare('SELECT * FROM meeting_templates WHERE id=?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  if (tpl.is_builtin) return res.status(403).json({ error: 'Cannot delete built-in templates' });
  db.prepare('DELETE FROM meeting_templates WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.get('/schedule/from-template/:id', auth, (req, res) => {
  const tpl = db.prepare('SELECT * FROM meeting_templates WHERE id=?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json({
    title_ar: tpl.name_ar,
    title_en: tpl.name_en,
    meeting_type: tpl.meeting_type,
    agenda_ar: tpl.agenda_ar,
    agenda_en: tpl.agenda_en,
    duration_mins: tpl.default_duration,
    attendees: tpl.default_attendees,
  });
});

// Create a new schedule entry from a template's defaults, applying any request
// overrides (date/time required). Mirrors POST /schedule: conflict check + auto
// recurrence-series generation.
router.post('/schedule/from-template/:id', auth, requirePermission('calendar.manage'), (req, res) => {
  const tpl = db.prepare('SELECT * FROM meeting_templates WHERE id=?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const b = req.body || {};
  const meeting_date = b.meeting_date;
  const meeting_time = b.meeting_time;
  if (!meeting_date || !meeting_time) return res.status(400).json({ error: 'meeting_date and meeting_time are required' });
  const title_ar = b.title_ar || tpl.name_ar;
  const title_en = b.title_en || tpl.name_en || title_ar;
  const dur = b.duration_mins || tpl.default_duration || 60;
  const attendees = b.attendees != null ? b.attendees : (tpl.default_attendees || '');
  const agenda_ar = b.agenda_ar != null ? b.agenda_ar : (tpl.agenda_ar || '');
  const agenda_en = b.agenda_en != null ? b.agenda_en : (tpl.agenda_en || '');
  const meeting_type = b.meeting_type || tpl.meeting_type || '';
  const chan = ['email', 'whatsapp', 'both'].includes(b.reminder_channel) ? b.reminder_channel : 'email';
  const rec = VALID_RECURRENCES.includes(b.recurrence) ? b.recurrence : 'none';
  const conflicts = findConflicts({ date: meeting_date, time: meeting_time, durationMins: dur });
  if (conflicts.length && !b.force) return res.status(409).json(conflictPayload(conflicts));
  const groupId = rec !== 'none' ? crypto.randomUUID() : null;
  const prov = ['zoom', 'teams', 'google_meet'].includes(b.meeting_provider) ? b.meeting_provider : 'physical';
  const provPlatform = { zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet' }[prov] || (b.platform || 'قاعة الاجتماعات');
  const insertSched = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, status, created_by, meeting_type, board_id, committee_id, prev_meeting_id, recurrence, recurrence_group_id, meeting_provider, meeting_join_url, meeting_id_external)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let row;
  db.transaction(() => {
    row = insertSched.run(title_ar, title_en, meeting_date, meeting_time, dur, provPlatform, attendees, agenda_ar, agenda_en, chan, req.user.id, meeting_type, b.board_id || null, b.committee_id || null, b.prev_meeting_id || null, rec, groupId, prov, b.meeting_join_url || '', b.meeting_id_external || '');
    if (rec !== 'none') {
      for (let i = 1; i <= 3; i++) {
        const nextDate = addNPeriods(meeting_date, rec, i);
        insertSched.run(title_ar, title_en, nextDate, meeting_time, dur, provPlatform, attendees, agenda_ar, agenda_en, chan, req.user.id, meeting_type, b.board_id || null, b.committee_id || null, null, rec, groupId, prov, b.meeting_join_url || '', b.meeting_id_external || '');
      }
    }
  })();
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.lastInsertRowid));
});

// ── Push a meeting summary + tasks to WhatsApp (Last Meeting precision tab) ─────
router.post('/meetings/:id/whatsapp-summary', auth, async (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const allPhones = splitRecipients(req.body.phones);
  if (!allPhones.length) return res.status(400).json({ error: 'لا يوجد رقم جوال / No phone number provided' });
  const { valid: validPhones, invalid: badPhones } = partition(allPhones, isValidPhone);
  if (!validPhones.length) return res.status(400).json({ error: `رقم جوال غير صالح / Invalid phone number(s): ${badPhones.join(', ')}` });
  // Canonicalize so the provider only ever sees E.164-ish numbers.
  const phones = validPhones.map(normalizePhone);
  let tasks = [];
  try { tasks = JSON.parse(m.ai_tasks || '[]'); } catch { tasks = []; }
  const taskLines = tasks.map(t => `• ${t.text_ar}${t.owner_ar ? ' — ' + t.owner_ar : ''}`).join('\n');
  const body = `📋 ملخص الاجتماع: ${m.title_ar}\n${(m.meeting_date || '').substring(0, 10)}\n\n` +
    `${m.ai_summary_ar || '-'}\n\n` +
    (taskLines ? `المهام:\n${taskLines}\n\n` : '') +
    `— أمين السكرتير`;
  try {
    const out = await notify.sendWhatsApp({ to: phones, body });
    res.json({ success: true, sent: phones.length, out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Email Reminders ───────────────────────────────────────────────────────────
router.post('/email/send', auth, async (req, res) => {
  const { to, subject, body, html } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body are required' });

  try {
    const all = splitRecipients(to);
    const { valid: recipients, invalid } = partition(all, isValidEmail);
    if (!recipients.length) return res.status(400).json({ error: `بريد إلكتروني غير صالح / Invalid email address(es): ${invalid.join(', ') || '(empty)'}` });
    // Sent via Replit Mail (blueprint:replitmail) — delivered to the workspace
    // owner's verified Replit email. No SMTP credentials required.
    const result = await sendEmail({
      to: recipients,
      subject,
      text: body,
      html: html || `<div style="font-family:Arial,sans-serif;direction:auto">${body.replace(/\n/g, '<br>')}</div>`
    });
    res.json({ success: true, sent_to: recipients.length, accepted: result.accepted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI: Chat ─────────────────────────────────────────────────────────────────
router.post('/ai/chat', auth, requirePermission('ai.ask'), async (req, res) => {
  const { messages, lang } = req.body;
  const tasks = db.prepare("SELECT * FROM tasks WHERE status != 'done' LIMIT 20").all();
  const decisions = db.prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT 10').all();
  const meetings = db.prepare('SELECT id, title_ar, title_en, meeting_date, ai_summary_ar, ai_summary_en FROM meetings ORDER BY meeting_date DESC LIMIT 5').all();
  const schedule = db.prepare('SELECT * FROM schedule ORDER BY meeting_date ASC LIMIT 5').all();
  const users = db.prepare('SELECT name_ar, name_en, role_ar, role_en FROM users').all();

  const risks = db.prepare("SELECT ai_risks, title_ar FROM meetings WHERE ai_risks IS NOT NULL AND ai_risks != '[]' ORDER BY meeting_date DESC LIMIT 3").all();
  const riskLines = risks.flatMap(m => { try { return JSON.parse(m.ai_risks).map(r => `- [${m.title_ar}] ${r.text_ar} (${r.severity||'medium'})`); } catch { return []; } });

  const docRows = db.prepare(`SELECT md.title, md.ai_summary, md.doc_classification, m.title_ar as mtg_title
    FROM meeting_documents md INNER JOIN meetings m ON md.meeting_id=m.id
    WHERE md.ai_summary IS NOT NULL AND md.ai_summary!='' AND md.file_path IS NOT NULL AND md.file_path!=''
      AND m.id IN (SELECT id FROM meetings ORDER BY meeting_date DESC LIMIT 3)
    ORDER BY m.meeting_date DESC, md.id DESC`).all();
  const docContext = docRows.length
    ? '\n\nوثائق الاجتماعات المرفوعة (ملخصات ذكاء اصطناعي) من آخر 3 اجتماعات:\n' +
      docRows.map(d => `• [${d.mtg_title || ''}] ${d.title} (${d.doc_classification || ''}): ${d.ai_summary}`).join('\n')
    : '';

  const system = `أنت أمين، المساعد الذكي التنفيذي المتخصص لشركة أمين للذكاء الاصطناعي.
أجب ${lang === 'en' ? 'in English only' : 'بالعربية الفصيحة فقط'} بأسلوب رسمي ومهني ومختصر وواضح.

السياق الحالي:
أعضاء الفريق: ${users.map(u => `${u.name_ar} / ${u.name_en} (${u.role_ar})`).join(' | ')}

المهام الجارية والمتأخرة:
${tasks.map(t => `- ${t.text_ar} | ${t.owner_name_ar || 'غير محدد'} | ${t.status} | ${t.due_date || 'مفتوح'}`).join('\n') || 'لا توجد مهام مفتوحة'}

قرارات المجلس النشطة:
${decisions.map(d => `- ${d.text_ar} [${d.status}]${d.decided_by ? ' — ' + d.decided_by : ''}`).join('\n') || 'لا توجد قرارات'}

المخاطر المكتشفة من الاجتماعات الأخيرة:
${riskLines.join('\n') || 'لا توجد مخاطر مسجلة'}

آخر الاجتماعات:
${meetings.map(m => `- ${m.title_ar} (${m.meeting_date?.substring(0,10)}): ${m.ai_summary_ar || 'لم يُعالج'}`).join('\n') || 'لا توجد اجتماعات'}

الاجتماعات القادمة:
${schedule.map(s => `- ${s.title_ar} | ${s.meeting_date} ${s.meeting_time} | ${s.platform}`).join('\n') || 'لا توجد اجتماعات مجدولة'}${docContext}`;

  try {
    const reply = await callClaude(messages, system, 1000, req.user.id);
    res.json({ reply });
  } catch (e) {
    const lastMsg = Array.isArray(messages) ? (messages[messages.length - 1]?.content || '') : '';
    res.json({ reply: getDemoReply(lastMsg, lang), demo: true });
  }
});

function getDemoReply(q, lang) {
  const isEn = lang === 'en';
  const ql = q.toLowerCase();
  if (ql.includes('متأخر') || ql.includes('overdue'))
    return isEn
      ? 'Current overdue tasks:\n\n1. Prepare 5-hire recruitment plan — Khalid (3 days overdue)\n2. Q2 shareholders report — Khalid (overdue)\n3. New investment policy review — Ahmed\n\nAll require immediate follow-up.'
      : 'المهام المتأخرة حالياً:\n\n1. إعداد خطة التوظيف للموظفين الخمسة — م. خالد (3 أيام تأخير)\n2. تقرير المساهمين الربعي — م. خالد (متأخر)\n3. مراجعة السياسة الاستثمارية — م. أحمد\n\nجميعها تستوجب متابعة فورية.';
  if (ql.includes('قرار') || ql.includes('decision'))
    return isEn
      ? 'Active board decisions:\n\n⚖️ Team expansion (5 new hires) — Approved\n⚖️ Gulf Partnership Contract — Under legal review\n⚖️ Projects continue per plan — Implemented'
      : 'قرارات المجلس النشطة:\n\n⚖️ توسعة الفريق (5 موظفين) — معتمدة\n⚖️ عقد الشراكة الخليجية — قيد المراجعة القانونية\n⚖️ استمرار المشاريع وفق الخطة — مُنفَّذ';
  if (ql.includes('ملخص') || ql.includes('summary'))
    return isEn
      ? 'Last Board Meeting (15 May 2026):\n\nQ2 results showed 18% growth. Approved team expansion (5 hires). Gulf Partnership referred for legal review. 3 tasks currently overdue.'
      : 'ملخص آخر اجتماع للمجلس (15 مايو 2026):\n\nنتائج الربع الثاني: نمو 18%. الموافقة على توسعة الفريق (5 موظفين). إحالة عقد الشراكة الخليجية للمراجعة القانونية. 3 مهام متأخرة.';
  if (ql.includes('أداء') || ql.includes('performance'))
    return isEn
      ? 'Team Performance Overview:\n\n• Sara: 1 task in progress (on track)\n• Khalid: 2 tasks overdue — requires immediate action\n• Ahmed: 2 tasks in progress\n• Noura: 1 task completed ✓\n\nOverall completion rate: 29%'
      : 'ملخص أداء الفريق:\n\n• م. سارة: مهمة واحدة قيد التنفيذ\n• م. خالد: مهمتان متأخرتان — تستوجبان تدخلاً فورياً\n• م. أحمد: مهمتان جاريتان\n• م. نورة: مهمة مكتملة ✓\n\nمعدل الإنجاز الكلي: 29%';
  return isEn
    ? "I'm Ameen, your executive AI secretary. I have full context of all meetings, tasks, and decisions. Ask me about overdue tasks, pending decisions, meeting summaries, team performance, upcoming meetings, or anything else."
    : 'أنا أمين، مساعدكم الذكي التنفيذي. لديّ سياق كامل لجميع الاجتماعات والمهام والقرارات. يمكنكم سؤالي عن المهام المتأخرة، القرارات المعلقة، ملخصات الاجتماعات، أداء الفريق، الاجتماعات القادمة، أو أي موضوع آخر.';
}

// ── AI: Document Generator (PRO — reports/documents) ───────────────────────
router.post('/ai/document', auth, requirePermission('ai.generate_reports'), requirePro, async (req, res) => {
  const { doc_type, meeting_id, details, lang, detail_level } = req.body;
  let meetingContext = '';
  if (meeting_id === 'all') {
    const all = db.prepare("SELECT * FROM meetings WHERE status='processed' ORDER BY meeting_date DESC").all();
    if (all.length) {
      meetingContext = 'تقرير موحّد من جميع الاجتماعات السابقة:\n\n' + all.map(m =>
        `• اجتماع: ${m.title_ar} (${(m.meeting_date || '').substring(0,10)})\n  الملخص: ${m.ai_summary_ar || ''}\n  المهام: ${m.ai_tasks || '[]'}\n  القرارات: ${m.ai_decisions || '[]'}`
      ).join('\n\n');
    } else {
      meetingContext = 'لا توجد اجتماعات معالَجة بعد لإعداد تقرير منها.';
    }
  } else if (meeting_id) {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(meeting_id);
    if (m) meetingContext = `اجتماع: ${m.title_ar}\nالتاريخ: ${m.meeting_date}\nالملخص: ${m.ai_summary_ar || ''}\nالمهام: ${m.ai_tasks || '[]'}\nالقرارات: ${m.ai_decisions || '[]'}`;
  }
  // Per-person assigned-task breakdown — reports can list each member's tasks.
  const taskRows = (meeting_id && meeting_id !== 'all')
    ? db.prepare('SELECT * FROM tasks WHERE source_meeting_id=?').all(meeting_id)
    : db.prepare('SELECT * FROM tasks').all();
  const byPerson = {};
  taskRows.forEach(t => {
    const who = t.owner_name_ar || t.owner_name_en || 'غير محدد / Unassigned';
    (byPerson[who] = byPerson[who] || []).push(t);
  });
  const perPersonContext = Object.keys(byPerson).length
    ? '\n\nالمهام المسندة لكل شخص / Tasks assigned per person:\n' +
      Object.entries(byPerson).map(([who, ts]) =>
        `• ${who} (${ts.length}):\n` + ts.map(t =>
          `   - ${t.text_ar}${t.due_date ? ' [' + t.due_date + ']' : ''} (${t.status})`).join('\n')
      ).join('\n')
    : '';
  meetingContext += perPersonContext;

  // Append uploaded document summaries scoped to the selected meeting(s)
  const uploadedDocRows = (meeting_id && meeting_id !== 'all')
    ? db.prepare("SELECT title, ai_summary, ai_key_points, doc_classification FROM meeting_documents WHERE meeting_id=? AND ai_summary IS NOT NULL AND ai_summary!='' AND file_path IS NOT NULL AND file_path!=''").all(meeting_id)
    : db.prepare("SELECT md.title, md.ai_summary, md.ai_key_points, md.doc_classification FROM meeting_documents md INNER JOIN meetings m ON md.meeting_id=m.id WHERE md.ai_summary IS NOT NULL AND md.ai_summary!='' AND md.file_path IS NOT NULL AND md.file_path!='' ORDER BY m.meeting_date DESC LIMIT 10").all();
  if (uploadedDocRows.length) {
    meetingContext += '\n\nوثائق الاجتماع المرفوعة / Uploaded Board Papers:\n' +
      uploadedDocRows.map(d => {
        let kp = [];
        try { kp = JSON.parse(d.ai_key_points || '[]'); } catch {}
        return `• ${d.title}${d.doc_classification ? ' [' + d.doc_classification + ']' : ''}\n  الملخص: ${d.ai_summary}` +
          (kp.length ? '\n  النقاط الرئيسية: ' + kp.join(' | ') : '');
      }).join('\n\n');
  }

  const docTypeLabels = {
    minutes_ar: 'محضر اجتماع رسمي بالعربية',
    minutes_en: 'Official Meeting Minutes in English',
    minutes_bi: 'محضر اجتماع ثنائي اللغة',
    board_report: 'تقرير مجلس الإدارة',
    exec_summary: 'ملخص تنفيذي',
    action_plan: 'خطة العمل التفصيلية',
    decision_log: 'سجل القرارات الرسمي',
    followup_report: 'تقرير نقاط المتابعة والإجراءات المفتوحة / Follow-up & Open Actions Report',
    kpi_report: 'تقرير مؤشرات الأداء الرئيسية',
    team_tasks: 'تقرير المهام لكل عضو في الفريق / Tasks-per-person report'
  };
  const docLang = lang === 'en' ? 'in English only' : lang === 'bi' ? 'باللغتين العربية والإنجليزية (كل قسم بلغتين)' : 'بالعربية فقط';
  const prompt = `أنت كاتب وثائق تنفيذي محترف. أنشئ ${docTypeLabels[doc_type] || doc_type} ${docLang}.
مستوى التفصيل: ${detail_level || 'standard'}
${meetingContext ? meetingContext + '\n' : ''}${details ? 'تفاصيل إضافية: ' + details : ''}
اكتب الوثيقة كاملة بشكل رسمي واحترافي ومنظم.`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1800, req.user.id);
    const row = db.prepare(`INSERT INTO documents (type, title_ar, title_en, content, source_meeting_id, lang, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(doc_type, docTypeLabels[doc_type] || doc_type, doc_type, text, (meeting_id && meeting_id !== 'all') ? meeting_id : null, lang, req.user.id);
    res.json({ success: true, content: text, id: row.lastInsertRowid });
  } catch (e) {
    res.json({ success: true, content: generateDemoDoc(doc_type, lang, meetingContext), demo: true });
  }
});

function generateDemoDoc(type, lang, ctx) {
  const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-SA');
  if (lang === 'en' || type === 'minutes_en') {
    return `MEETING MINUTES\n${date}\n\nAttendees: Ahmed Al-Omrani (CEO), Sara Al-Zahrani (MD), Khalid Al-Mansour (CFO), Noura Al-Rashid (COO)\n\nAgenda & Discussion:\n1. Q2 Performance — 18% growth confirmed\n2. Team Expansion — 5 new hires approved\n3. Gulf Partnership Contract — referred to legal review\n\nDecisions:\n✓ Team expansion: 5 new hires approved\n✓ Gulf contract: pending legal review\n\nAction Items:\n→ Sara: Legal review of Gulf contract by 22 May\n→ Khalid: Hiring plan by 19 May\n→ Ahmed: Investment opportunity study by 26 May\n\n---\nDocumented by Ameen AI Solutions`;
  }
  return `محضر اجتماع\n${date}\n\nالحضور: م. أحمد العمراني (CEO)، م. سارة الزهراني (MD)، م. خالد المنصور (CFO)، م. نورة الراشد (COO)\n\nبنود الاجتماع:\n1. مراجعة الربع الثاني — نمو 18%\n2. توسعة الفريق — الموافقة على 5 موظفين\n3. عقد الشراكة الخليجية — إحالة للمراجعة القانونية\n\nالقرارات:\n✓ توسعة الفريق: 5 موظفين معتمدون\n✓ العقد الخليجي: قيد المراجعة القانونية\n\nالمهام:\n→ م. سارة: المراجعة القانونية للعقد بحلول 22 مايو\n→ م. خالد: خطة التوظيف بحلول 19 مايو\n→ م. أحمد: دراسة الفرصة الاستثمارية بحلول 26 مايو\n\n---\nوُثّق بواسطة أمين للذكاء الاصطناعي`;
}

// ── Analytics ──────────────────────────────────────────────────────────────
router.get('/analytics', auth, (req, res) => {
  const tasksByWeek = db.prepare(`
    SELECT date(created_at,'weekday 1','-6 days') as week_start,
      COUNT(*) as total,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status!='done' THEN 1 ELSE 0 END) as open
    FROM tasks WHERE created_at >= date('now','-56 days')
    GROUP BY week_start ORDER BY week_start
  `).all();

  const meetingsByMonth = db.prepare(`
    SELECT strftime('%Y-%m', meeting_date) as month, COUNT(*) as count
    FROM meetings WHERE meeting_date >= date('now','-6 months')
    GROUP BY month ORDER BY month
  `).all();

  const memberCompletion = db.prepare(`
    SELECT owner_name_ar, owner_name_en,
      COUNT(*) as total,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE owner_name_ar IS NOT NULL AND owner_name_ar!=''
    GROUP BY owner_name_ar ORDER BY total DESC LIMIT 10
  `).all().map(r => ({ ...r, pct: r.total > 0 ? Math.round(r.done / r.total * 100) : 0 }));

  const decisionStatus = db.prepare(
    `SELECT status, COUNT(*) as count FROM decisions GROUP BY status`
  ).all();

  const attendanceRates = db.prepare(`
    SELECT m.title_ar, m.title_en, m.meeting_date,
      COUNT(ma.id) as invited,
      SUM(CASE WHEN ma.confirmed=1 THEN 1 ELSE 0 END) as attended
    FROM meetings m LEFT JOIN meeting_attendees ma ON ma.meeting_id=m.id
    GROUP BY m.id HAVING COUNT(ma.id) > 0
    ORDER BY m.meeting_date DESC LIMIT 10
  `).all().map(r => ({ ...r, rate: r.invited > 0 ? Math.round(r.attended / r.invited * 100) : 0 })).reverse();

  const durationTrend = db.prepare(`
    SELECT strftime('%Y-%m', meeting_date) as month, ROUND(AVG(duration),0) as avg_mins
    FROM meetings WHERE duration > 0
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).all().reverse();

  const overdueByOwner = db.prepare(`
    SELECT owner_name_ar, owner_name_en, COUNT(*) as count
    FROM tasks WHERE status='overdue' AND owner_name_ar IS NOT NULL AND owner_name_ar!=''
    GROUP BY owner_name_ar ORDER BY count DESC LIMIT 8
  `).all();

  const decisionsByType = db.prepare(`
    SELECT COALESCE(NULLIF(m.meeting_type,''),'Other') as meeting_type, COUNT(d.id) as count
    FROM decisions d LEFT JOIN meetings m ON d.meeting_id=m.id
    GROUP BY meeting_type ORDER BY count DESC
  `).all();

  res.json({ tasksByWeek, meetingsByMonth, memberCompletion, decisionStatus, attendanceRates, durationTrend, overdueByOwner, decisionsByType });
});

// ── Dashboard Stats ────────────────────────────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const meetings = db.prepare('SELECT COUNT(*) as c FROM meetings').get().c;
  const tasks_total = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
  const tasks_open = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status != 'done'").get().c;
  const tasks_overdue = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'overdue'").get().c;
  const tasks_done = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get().c;
  const decisions = db.prepare('SELECT COUNT(*) as c FROM decisions').get().c;
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const schedule = db.prepare('SELECT COUNT(*) as c FROM schedule').get().c;
  const tasks_blocked = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'blocked'").get().c;
  const tasks_high = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority = 'high' AND status NOT IN ('done','cancelled')").get().c;
  const tasks_critical = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority IN ('critical','urgent') AND status NOT IN ('done','cancelled')").get().c;
  const completion = tasks_total > 0 ? Math.round((tasks_done / tasks_total) * 100) : 0;
  res.json({ meetings, tasks_total, tasks_open, tasks_overdue, tasks_done, decisions, users, schedule, tasks_blocked, tasks_high, tasks_critical, completion });
});

// ── Dashboard Intelligence ────────────────────────────────────────────────────
// Everything below is computed straight from tables the product already
// maintains (tasks, meetings, users.department) — no separate metrics store,
// no invented scores. "Executive insights" and "recommendations" are template
// sentences filled in from those same real numbers (a rules engine, not an
// LLM call) so they're always available even without an AI provider key
// configured, and every claim in them traces back to a query above it.
router.get('/dashboard/intelligence', auth, requirePermission('reports.view'), (req, res) => {
  const today = new Date().toISOString().substring(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);

  // Meeting completion rate — 'processed' vs 'draft' is the real status
  // column meetings already carry; no separate lifecycle math needed.
  const meetingTotals = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='processed' THEN 1 ELSE 0 END) as done FROM meetings").get();
  const meetingCompletionRate = meetingTotals.total > 0 ? Math.round((meetingTotals.done / meetingTotals.total) * 100) : 0;

  // Governance backlog — meetings actually in the approval pipeline (i.e.
  // circulated or further). 'draft' is the default for every meeting
  // including ones whose minutes were never even generated yet, so it does
  // NOT belong here — counting it would flag nearly every meeting as
  // "pending approval" regardless of whether anyone has touched it.
  const meetingsPendingApproval = db.prepare(`
    SELECT COUNT(*) as c FROM meetings WHERE minutes_status IN ('circulated', 'approved', 'revision_requested')
  `).get().c;

  const { byDepartment, bottlenecks } = computeTaskRollups();
  const blockedActions = bottlenecks.filter(b => b.status === 'blocked');

  const upcomingTasks = db.prepare(`
    SELECT id, text_ar, text_en, owner_name_ar, owner_name_en, due_date FROM tasks
    WHERE due_date >= ? AND due_date <= ? AND status NOT IN ('done', 'cancelled')
    ORDER BY due_date ASC LIMIT 10
  `).all(today, in7);
  const upcomingMeetings = db.prepare(`
    SELECT id, title_ar, title_en, meeting_date, meeting_time FROM schedule
    WHERE meeting_date >= ? AND meeting_date <= ? ORDER BY meeting_date ASC, meeting_time ASC LIMIT 10
  `).all(today, in7);

  // Risk flag: a department is "at risk" if a meaningful share of its open
  // work is overdue. The >=3 open-actions floor keeps a department with one
  // overdue item out of five people from reading as equally risky as a
  // department where half the team is behind.
  const atRiskDepartments = byDepartment
    .filter(d => d.open >= 3 && d.overdue / d.open >= 0.3)
    .map(d => ({ department: d.department, overdue: d.overdue, open: d.open, ratio: Math.round((d.overdue / d.open) * 100) }));

  const l = (ar, en) => ({ ar, en });
  const insights = [];
  const recommendations = [];

  insights.push(l(
    `معدل إنجاز الاجتماعات ${meetingCompletionRate}% (${meetingTotals.done} من ${meetingTotals.total} اجتماعاً تمت معالجتها).`,
    `Meeting completion rate is ${meetingCompletionRate}% (${meetingTotals.done} of ${meetingTotals.total} meetings processed).`
  ));
  if (blockedActions.length) {
    // days_late is only meaningful once a due date has actually passed — a
    // blocked task whose due date is still in the future gives a negative
    // number here, which would read as nonsense ("blocked for -6 days").
    const oldestPastDue = blockedActions.find(b => b.days_late > 0);
    insights.push(l(
      oldestPastDue
        ? `${blockedActions.length} إجراء تنفيذي معطّل حالياً، أقدمها متأخر منذ ${oldestPastDue.days_late} يوماً.`
        : `${blockedActions.length} إجراء تنفيذي معطّل حالياً.`,
      oldestPastDue
        ? `${blockedActions.length} executive action(s) are currently blocked, the oldest for ${oldestPastDue.days_late} day(s).`
        : `${blockedActions.length} executive action(s) are currently blocked.`
    ));
    recommendations.push(l(
      `راجع الإجراءات المعطّلة وأزل العوائق أمامها — ${blockedActions.length} إجراء بانتظار ذلك.`,
      `Review and unblock stalled actions — ${blockedActions.length} are currently waiting.`
    ));
  }
  if (atRiskDepartments.length) {
    atRiskDepartments.forEach(d => {
      insights.push(l(
        `قسم ${d.department} لديه ${d.overdue} من ${d.open} إجراءً مفتوحاً متأخراً (${d.ratio}%).`,
        `${d.department} has ${d.overdue} of ${d.open} open actions overdue (${d.ratio}%).`
      ));
    });
    recommendations.push(l(
      `أعد توزيع الأحمال أو صعّد المتابعة في: ${atRiskDepartments.map(d => d.department).join('، ')}.`,
      `Rebalance workload or escalate follow-up in: ${atRiskDepartments.map(d => d.department).join(', ')}.`
    ));
  }
  if (meetingsPendingApproval > 0) {
    insights.push(l(
      `${meetingsPendingApproval} محضر اجتماع بانتظار الاعتماد النهائي.`,
      `${meetingsPendingApproval} meeting minute(s) awaiting final approval.`
    ));
    recommendations.push(l(
      `تابع مع المعتمدين لإنهاء اعتماد ${meetingsPendingApproval} محضر اجتماع معلّق.`,
      `Follow up with approvers to close out ${meetingsPendingApproval} pending minutes approval(s).`
    ));
  }
  if (upcomingTasks.length) {
    insights.push(l(
      `${upcomingTasks.length} إجراء تنفيذي مستحق خلال 7 أيام القادمة.`,
      `${upcomingTasks.length} executive action(s) due within the next 7 days.`
    ));
  }
  if (!blockedActions.length && !atRiskDepartments.length && meetingsPendingApproval === 0) {
    recommendations.push(l('لا توجد مخاطر عاجلة حالياً — الأداء التشغيلي ضمن المسار الطبيعي.', 'No urgent risks detected right now — operations are on track.'));
  }

  res.json({
    meeting_completion_rate: meetingCompletionRate,
    meetings_total: meetingTotals.total,
    meetings_processed: meetingTotals.done,
    meetings_pending_approval: meetingsPendingApproval,
    department_performance: byDepartment,
    upcoming_deadlines: { tasks: upcomingTasks, meetings: upcomingMeetings },
    blocked_actions: blockedActions.slice(0, 10),
    at_risk_departments: atRiskDepartments,
    insights,
    recommendations,
  });
});

// ── Document History ───────────────────────────────────────────────────────
router.get('/documents', auth, requirePermission('documents.download'), (req, res) => {
  res.json(db.prepare('SELECT d.*, u.name_ar as author_ar, u.name_en as author_en FROM documents d LEFT JOIN users u ON d.created_by=u.id ORDER BY d.created_at DESC LIMIT 20').all());
});

// ── Subscription Plan ──────────────────────────────────────────────────────
router.get('/plan', auth, (req, res) => {
  res.json({ plan: getPlan() });
});
router.patch('/plan', auth, requirePermission('admin.settings'), (req, res) => {
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('plan', plan);
  res.json({ plan });
});

// ── Live AI extraction during recording (free) ─────────────────────────────
// Receives a transcript chunk + known member names; returns tasks (with owners)
// and decisions detected so far. Lightweight + fast.
router.post('/live-extract', auth, requirePermission('ai.generate_minutes'), async (req, res) => {
  const { transcript, members } = req.body;
  if (!transcript || transcript.trim().length < 12) return res.json({ tasks: [], decisions: [] });
  const memberList = Array.isArray(members) && members.length
    ? members.join('، ')
    : db.prepare('SELECT name_ar FROM users').all().map(u => u.name_ar).join('، ');
  const system = `أنت مساعد ذكي يستخرج المهام والقرارات والمخاطر ونقاط المتابعة من نص اجتماع مباشر (قد يكون غير مكتمل).
أعِد JSON فقط بالشكل: {"tasks":[{"text_ar":"","text_en":"","owner_ar":"","owner_en":""}],"decisions":[{"text_ar":"","text_en":""}],"risks":[{"text_ar":"","text_en":"","severity":"high|medium|low"}],"followups":[{"text_ar":"","text_en":""}]}.
أسماء الحضور المعروفون: ${memberList}. اربط كل مهمة بأقرب اسم مالك إن وُجد. لا تختلق عناصر غير مذكورة. أعد JSON صالحاً بدون أي شرح.`;
  try {
    const raw = await callClaude(
      [{ role: 'user', content: `النص حتى الآن:\n"""${transcript.slice(-4000)}"""` }],
      system, 900, req.user.id
    );
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { tasks: [], decisions: [], risks: [], followups: [] };
    res.json({ tasks: parsed.tasks || [], decisions: parsed.decisions || [], risks: parsed.risks || [], followups: parsed.followups || [] });
  } catch (e) {
    res.json({ tasks: [], decisions: [], risks: [], followups: [], _err: e.message });
  }
});

// ── Meeting Attendees ──────────────────────────────────────────────────────
router.get('/meetings/:id/attendees', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id ASC').all(req.params.id));
});

// Replace the attendee contact list for a meeting.
router.post('/meetings/:id/attendees', auth, (req, res) => {
  const meetingId = req.params.id;
  const list = Array.isArray(req.body.attendees) ? req.body.attendees : [];
  const existing = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=?').all(meetingId);
  const byName = {};
  existing.forEach(a => { byName[a.name.trim()] = a; });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id=?').run(meetingId);
    const ins = db.prepare(`INSERT INTO meeting_attendees (meeting_id, name, email, phone, share_token, shared, confirmed, confirmed_at, comment, responded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    list.forEach(a => {
      if (!a.name || !a.name.trim()) return;
      const prev = byName[a.name.trim()];
      ins.run(meetingId, a.name.trim(), a.email || '', a.phone || '',
        (prev && prev.share_token) || token(),
        prev ? prev.shared : 0, prev ? prev.confirmed : 0, prev ? prev.confirmed_at : null,
        prev ? prev.comment : '', prev ? prev.responded_at : null);
    });
  });
  tx();
  if (list.length) {
    // Adding attendees both invites them and confirms the meeting has a fixed
    // date/time — the schedule and meetings tables aren't linked by a foreign
    // key in this data model, so "scheduled" is tracked as an attribute of the
    // meeting record itself rather than a separate calendar-confirmation step.
    transitionMeeting(meetingId, 'invited', req.user.id, `${list.length} attendee(s) invited`);
    transitionMeeting(meetingId, 'scheduled', req.user.id, 'Meeting date/time confirmed');
    // Send email invitations to every attendee with an email address.
    const mtg = db.prepare('SELECT id, title_ar, title_en, meeting_date, meeting_time FROM meetings WHERE id=?').get(meetingId);
    if (mtg) {
      const invitees = list.filter(a => a.email);
      notifyMeetingInvite(mtg, invitees, req.user.id);
    }
  }
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id ASC').all(meetingId));
});

// Add a single attendee to an existing meeting without replacing others.
router.post('/meetings/:id/attendees/add', auth, (req, res) => {
  const meetingId = req.params.id;
  const meeting = db.prepare('SELECT id, title_ar, title_en, meeting_date, meeting_time FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const { name, email, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const existing = db.prepare('SELECT id FROM meeting_attendees WHERE meeting_id=? AND LOWER(name)=LOWER(?)').get(meetingId, name.trim());
  if (existing) return res.status(409).json({ error: 'Participant already added' });
  const { randomBytes } = require('crypto');
  const tok = randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO meeting_attendees (meeting_id, name, email, phone, share_token, shared, confirmed) VALUES (?, ?, ?, ?, ?, 0, 0)`)
    .run(meetingId, name.trim(), email || '', phone || '', tok);
  const attendee = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id DESC LIMIT 1').get(meetingId);
  // Send email invitation to the newly added attendee
  if (email) notifyMeetingInvite(meeting, [{ name: name.trim(), email, phone: phone || null }], req.user.id);
  res.json(attendee);
});

// Replace the agenda for a meeting — used by the Create Meeting wizard's Agenda
// step and by the Meeting Workspace's Agenda tab. Mirrors the bulk-replace
// pattern used by /attendees above.
// Setting the agenda is treated as part of creating/planning a meeting (like
// /attendees below), not a later edit — a role with meetings.create but not
// meetings.edit (e.g. Employee) must still be able to set the agenda for a
// meeting it just created.
router.post('/meetings/:id/agenda', auth, (req, res) => {
  const canTouch = ['meetings.create', 'meetings.edit'].some((k) => rbacService.hasPermission(db, req.user.id, k));
  if (!canTouch) return res.status(403).json({ error: 'Not permitted to set the agenda' });
  const meetingId = req.params.id;
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const list = Array.isArray(req.body.agenda) ? req.body.agenda : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM agenda_items WHERE meeting_id=?').run(meetingId);
    const ins = db.prepare(`INSERT INTO agenda_items
      (meeting_id, title, title_ar, title_en, description_ar, description_en, presenter, expected_outcome_ar, expected_outcome_en, duration_mins, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    list.forEach((item, i) => {
      const titleAr = (item.title_ar || '').trim();
      const titleEn = (item.title_en || '').trim();
      if (!titleAr && !titleEn) return;
      ins.run(meetingId, titleAr || titleEn, titleAr, titleEn || titleAr,
        item.description_ar || '', item.description_en || '', item.presenter || '',
        item.expected_outcome_ar || '', item.expected_outcome_en || '', item.duration_mins || 15, i);
    });
  });
  tx();
  res.json(db.prepare('SELECT * FROM agenda_items WHERE meeting_id=? ORDER BY sort_order ASC, id ASC').all(meetingId));
});

// ── Agenda item reorder (move one step up or down) ─────────────────────────────
router.patch('/meetings/:id/agenda/:itemId/reorder', auth, (req, res) => {
  const canTouch = ['meetings.create', 'meetings.edit'].some((k) => rbacService.hasPermission(db, req.user.id, k));
  if (!canTouch) return res.status(403).json({ error: 'Not permitted' });
  const { id: meetingId, itemId } = req.params;
  const { direction } = req.body; // 'up' | 'down'
  if (!['up', 'down'].includes(direction)) return res.status(400).json({ error: 'direction must be up or down' });
  const items = db.prepare('SELECT id, sort_order FROM agenda_items WHERE meeting_id=? ORDER BY sort_order ASC, id ASC').all(meetingId);
  const idx = items.findIndex((x) => String(x.id) === String(itemId));
  if (idx < 0) return res.status(404).json({ error: 'Item not found' });
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return res.json({ items }); // already at boundary
  const a = items[idx], b = items[swapIdx];
  const upd = db.prepare('UPDATE agenda_items SET sort_order=? WHERE id=?');
  db.transaction(() => {
    upd.run(b.sort_order, a.id);
    upd.run(a.sort_order, b.id);
  })();
  res.json({ success: true, items: db.prepare('SELECT * FROM agenda_items WHERE meeting_id=? ORDER BY sort_order ASC, id ASC').all(meetingId) });
});

// Append a manual, unowned note captured during a live meeting (Quick Action:
// Add Note). Stored separately from tasks/decisions so live facilitation
// scratch notes don't clutter the Executive Actions tracker.
router.post('/meetings/:id/notes', auth, (req, res) => {
  const meetingId = req.params.id;
  const meeting = db.prepare('SELECT live_notes FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const text = (req.body.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  let notes = [];
  try { notes = JSON.parse(meeting.live_notes || '[]'); } catch {}
  const actor = resolveActor(req.user.id);
  const note = { text, by: req.user.id, by_name: actor.name, at: sqlNow() };
  notes.push(note);
  db.prepare('UPDATE meetings SET live_notes=? WHERE id=?').run(JSON.stringify(notes), meetingId);
  res.json(note);
});

// ── Share meeting outcomes to selected attendees (PRO) ─────────────────────
router.post('/meetings/:id/share', auth, requirePermission('documents.share'), requirePro, async (req, res) => {
 try {
  const meetingId = req.params.id;
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const channel = ['email', 'whatsapp', 'both'].includes(req.body.channel) ? req.body.channel : 'email';
  // attendee_ids = filtered subset chosen by the coordinator (audience filter, feature #7).
  // If the caller sends the key at all, we ALWAYS honor it as the exact audience —
  // an empty/invalid list must NOT silently fall back to "share with everyone".
  const hasFilter = Object.prototype.hasOwnProperty.call(req.body, 'attendee_ids');
  const ids = Array.isArray(req.body.attendee_ids) ? req.body.attendee_ids.map(Number) : [];
  let attendees = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=?').all(meetingId);
  if (hasFilter) attendees = attendees.filter(a => ids.includes(a.id));
  if (!attendees.length) return res.status(400).json({ error: 'لا يوجد حضور محددون للمشاركة / No attendees selected' });

  const tasks = JSON.parse(meeting.ai_tasks || '[]');
  const decisions = JSON.parse(meeting.ai_decisions || '[]');
  const results = [];
  for (const a of attendees) {
    if (!a.share_token) {
      db.prepare('UPDATE meeting_attendees SET share_token=? WHERE id=?').run(token(), a.id);
      a.share_token = db.prepare('SELECT share_token FROM meeting_attendees WHERE id=?').get(a.id).share_token;
    }
    const link = `${baseUrl(req)}/m/${a.share_token}`;
    // Tasks owned by this attendee (loose name match), else all.
    const mine = tasks.filter(t => (t.owner_ar && a.name && (t.owner_ar.includes(a.name) || a.name.includes(t.owner_ar))) ||
                                   (t.owner_en && a.name && (t.owner_en.toLowerCase().includes(a.name.toLowerCase()))));
    const taskLines = (mine.length ? mine : tasks).map(t => `• ${t.text_ar}`).join('\n');
    const taskLinesEn = (mine.length ? mine : tasks).map(t => `• ${t.text_en || t.text_ar}`).join('\n');
    const titleEn = meeting.title_en || meeting.title_ar;
    const subject = `محضر ونتائج: ${meeting.title_ar} | Minutes & Actions: ${titleEn}`;
    // The full minutes / transcript text is included so recipients get the
    // complete record (boss requirement: "send the full text"). Bilingual —
    // Arabic block followed by an English block, same convention as the
    // meeting-reminder email (src/reminders.js buildReminderMessage).
    const fullMinutesAr = meeting.ai_minutes_ar || meeting.ai_minutes_en || '';
    const fullMinutesEn = meeting.ai_minutes_en || meeting.ai_minutes_ar || '';
    const fullTranscript = meeting.transcript || '';
    const text =
      `مرحباً ${a.name}،\n\nتمت مشاركة محضر ونتائج اجتماع "${meeting.title_ar}".\n\n` +
      `الملخص:\n${meeting.ai_summary_ar || '-'}\n\n` +
      (decisions.length ? `القرارات:\n${decisions.map(d => '• ' + d.text_ar).join('\n')}\n\n` : '') +
      (taskLines ? `المهام:\n${taskLines}\n\n` : '') +
      (fullMinutesAr ? `المحضر الكامل:\n${fullMinutesAr}\n\n` : '') +
      (fullTranscript ? `النص الكامل للاجتماع:\n${fullTranscript}\n\n` : '') +
      `لتأكيد مهامك وإضافة ملاحظاتك، افتح الرابط:\n${link}\n\n— أمين السكرتير\n\n———\n\n` +
      `Hello ${a.name},\n\nThe minutes and outcomes for "${titleEn}" have been shared with you.\n\n` +
      `Summary:\n${meeting.ai_summary_en || meeting.ai_summary_ar || '-'}\n\n` +
      (decisions.length ? `Decisions:\n${decisions.map(d => '• ' + (d.text_en || d.text_ar)).join('\n')}\n\n` : '') +
      (taskLinesEn ? `Tasks:\n${taskLinesEn}\n\n` : '') +
      (fullMinutesEn ? `Full minutes:\n${fullMinutesEn}\n\n` : '') +
      `To confirm your tasks and add comments, open the link:\n${link}\n\n— Ameen Secretary`;
    const html =
      `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">` +
      `<h2 style="color:#0e7490">محضر ونتائج الاجتماع</h2>` +
      `<p>مرحباً <b>${esc(a.name)}</b>،</p>` +
      `<p>تمت مشاركة محضر ونتائج اجتماع «${esc(meeting.title_ar)}».</p>` +
      `<h3>الملخص</h3><p>${esc(meeting.ai_summary_ar || '-').replace(/\n/g, '<br>')}</p>` +
      (decisions.length ? `<h3>القرارات</h3><ul>${decisions.map(d => '<li>' + esc(d.text_ar) + '</li>').join('')}</ul>` : '') +
      ((mine.length ? mine : tasks).length ? `<h3>المهام</h3><ul>${(mine.length ? mine : tasks).map(t => '<li>' + esc(t.text_ar) + '</li>').join('')}</ul>` : '') +
      (fullMinutesAr ? `<h3>المحضر الكامل</h3><div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;font-size:13px">${esc(fullMinutesAr)}</div>` : '') +
      (fullTranscript ? `<h3>النص الكامل للاجتماع</h3><div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;font-size:13px">${esc(fullTranscript)}</div>` : '') +
      `<p><a href="${link}" style="background:#0e7490;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">تأكيد المهام وإضافة ملاحظات</a></p>` +
      `<p style="color:#888;font-size:12px">— أمين السكرتير</p></div>` +
      `<hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">` +
      `<div style="font-family:Tahoma,Arial,sans-serif;direction:ltr;text-align:left">` +
      `<h2 style="color:#0e7490">Meeting Minutes &amp; Outcomes</h2>` +
      `<p>Hello <b>${esc(a.name)}</b>,</p>` +
      `<p>The minutes and outcomes for &ldquo;${esc(titleEn)}&rdquo; have been shared with you.</p>` +
      `<h3>Summary</h3><p>${esc(meeting.ai_summary_en || meeting.ai_summary_ar || '-').replace(/\n/g, '<br>')}</p>` +
      (decisions.length ? `<h3>Decisions</h3><ul>${decisions.map(d => '<li>' + esc(d.text_en || d.text_ar) + '</li>').join('')}</ul>` : '') +
      ((mine.length ? mine : tasks).length ? `<h3>Tasks</h3><ul>${(mine.length ? mine : tasks).map(t => '<li>' + esc(t.text_en || t.text_ar) + '</li>').join('')}</ul>` : '') +
      (fullMinutesEn ? `<h3>Full Minutes</h3><div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;font-size:13px">${esc(fullMinutesEn)}</div>` : '') +
      `<p><a href="${link}" style="background:#0e7490;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">Confirm Tasks &amp; Add Comments</a></p>` +
      `<p style="color:#888;font-size:12px">— Ameen Secretary</p></div>`;
    const out = await notify.notify({ channel, email: a.email, phone: a.phone, subject, text, html });
    db.prepare('UPDATE meeting_attendees SET shared=1 WHERE id=?').run(a.id);
    results.push({ id: a.id, name: a.name, link, ...out });
  }
  db.prepare("UPDATE meetings SET shared=1, shared_at=CURRENT_TIMESTAMP WHERE id=?").run(meetingId);
  res.json({ success: true, shared: results.length, channel, results });
 } catch (e) {
  console.error('✗ /share failed:', e.message);
  res.status(500).json({ error: e.message });
 }
});

// ── Share a generated document with the whole team (email) ─────────────────
router.post('/documents/share', auth, requirePermission('documents.share'), requirePro, async (req, res) => {
 try {
  const content = (req.body.content || '').toString().trim();
  const title = (req.body.title || 'تقرير / Report').toString().trim();
  if (!content) return res.status(400).json({ error: 'لا يوجد محتوى للمشاركة / No content to share' });
  const members = db.prepare("SELECT id, name_ar, name_en, email FROM users WHERE email IS NOT NULL AND email != ''").all();
  if (!members.length) return res.status(400).json({ error: 'لا يوجد أعضاء فريق بعناوين بريد / No team members with emails' });
  const subject = `تقرير من أمين: ${title} | Report from Ameen: ${title}`;
  const results = [];
  for (const mem of members) {
    const name = mem.name_ar || mem.name_en || '';
    const nameEn = mem.name_en || mem.name_ar || '';
    const text = `مرحباً ${name}،\n\nتمت مشاركة التقرير التالي معك:\n\n${content}\n\n— أمين السكرتير\n\n———\n\nHello ${nameEn},\n\nThe following report has been shared with you:\n\n${content}\n\n— Ameen Secretary`;
    const html = `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">` +
      `<h2 style="color:#0e7490">${esc(title)}</h2>` +
      `<p>مرحباً <b>${esc(name)}</b>،</p>` +
      `<div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:14px;font-size:13px;line-height:1.7">${esc(content)}</div>` +
      `<p style="color:#888;font-size:12px">— أمين السكرتير</p></div>` +
      `<hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">` +
      `<div style="font-family:Tahoma,Arial,sans-serif;direction:ltr;text-align:left">` +
      `<h2 style="color:#0e7490">${esc(title)}</h2>` +
      `<p>Hello <b>${esc(nameEn)}</b>,</p>` +
      `<div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:14px;font-size:13px;line-height:1.7">${esc(content)}</div>` +
      `<p style="color:#888;font-size:12px">— Ameen Secretary</p></div>`;
    let out;
    try { out = await notify.sendEmail({ to: mem.email, subject, text, html }); }
    catch (e) { out = { error: e.message }; }
    if (!out.error && mem.id !== req.user.id) {
      createNotification(db, {
        userId: mem.id,
        type: 'document_shared',
        titleAr: 'تمت مشاركة تقرير معك',
        titleEn: 'A report was shared with you',
        bodyAr: title,
        bodyEn: title,
        sourceType: 'document', deepLink: 'documents',
      });
    }
    results.push({ name: mem.name_ar || mem.name_en, email: mem.email, ...out });
  }
  // Every result was counted as a success regardless of whether the send
  // actually failed (out.error set) — a broken mail provider meant a manager
  // clicking "Share" saw "✓ Shared with 12 member(s)" while zero emails went
  // out, with no way to tell from the UI that a board document never reached
  // anyone.
  const failed = results.filter(r => r.error);
  const sharedCount = results.length - failed.length;
  res.json({ success: failed.length === 0, shared: sharedCount, failed: failed.length, results });
 } catch (e) {
  console.error('✗ /documents/share failed:', e.message);
  res.status(500).json({ error: e.message });
 }
});

// ── Executive Weekly Report ───────────────────────────────────────────────────
router.get('/reports/executive-weekly', auth, requirePermission('reports.view'), (req, res) => {
  const today = new Date().toISOString().substring(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);

  // 1. Open Actions — new or in-progress tasks
  const openActions = db.prepare(
    `SELECT id, text_en, text_ar, owner_name_en, owner_name_ar, due_date, priority, status
     FROM tasks WHERE status IN ('new','inprogress') ORDER BY due_date ASC`
  ).all();

  // 2. Completed this week
  const completed = db.prepare(
    `SELECT id, text_en, text_ar, owner_name_en, owner_name_ar, due_date, updated_at
     FROM tasks WHERE status='done' AND updated_at >= ? ORDER BY updated_at DESC`
  ).all(weekAgo);

  // 3. Overdue tasks
  const overdue = db.prepare(
    `SELECT id, text_en, text_ar, owner_name_en, owner_name_ar, due_date, priority
     FROM tasks WHERE status='overdue' ORDER BY due_date ASC`
  ).all();

  // 4. Escalated tasks
  const escalated = db.prepare(
    `SELECT id, text_en, text_ar, owner_name_en, owner_name_ar, due_date, status,
            escalated_at, escalated_to_name
     FROM tasks WHERE escalated_at IS NOT NULL ORDER BY escalated_at DESC`
  ).all();

  // 5. Meetings this week + upcoming 7 days
  const meetings = db.prepare(
    `SELECT id, title_en, title_ar, meeting_date, status, minutes_status, recorded_by
     FROM meetings WHERE meeting_date >= ? ORDER BY meeting_date DESC`
  ).all(weekAgo);

  // 6. Minutes pending approval (has minutes but not final_approved)
  const minutesPendingApproval = db.prepare(
    `SELECT id, title_en, title_ar, meeting_date, minutes_status, circulated_at, approval_due_date
     FROM meetings
     WHERE minutes_status IS NOT NULL
       AND minutes_status != ''
       AND minutes_status != 'final_approved'
     ORDER BY meeting_date DESC`
  ).all();

  // 7. Critical Tasks — urgent priority, not done/cancelled
  const criticalTasks = db.prepare(
    `SELECT id, text_en, text_ar, owner_name_en, owner_name_ar, due_date, status, escalated_at
     FROM tasks WHERE priority='urgent' AND status NOT IN ('done','cancelled')
     ORDER BY due_date ASC`
  ).all();

  // 8. Top 5 Risks — parse ai_risks from all meetings, return most recent 5 unique items
  const riskRows = db.prepare(
    `SELECT id, title_en, title_ar, meeting_date, ai_risks
     FROM meetings WHERE ai_risks IS NOT NULL AND ai_risks != ''
     ORDER BY meeting_date DESC LIMIT 10`
  ).all();

  const risks = [];
  for (const row of riskRows) {
    if (risks.length >= 5) break;
    let parsed = [];
    try { parsed = JSON.parse(row.ai_risks); } catch (_) {
      // plain text fallback — split by newline
      parsed = String(row.ai_risks).split('\n').map(l => l.trim()).filter(Boolean);
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (risks.length >= 5) break;
      risks.push({
        risk: typeof item === 'object' ? (item.text_en || item.text_ar || JSON.stringify(item)) : item,
        source_meeting_id: row.id,
        source_meeting_title_en: row.title_en,
        source_meeting_title_ar: row.title_ar,
        meeting_date: row.meeting_date,
      });
    }
  }

  res.json({
    generated_at: new Date().toISOString(),
    period: { from: weekAgo, to: today },
    summary: {
      open_actions_count: openActions.length,
      completed_count: completed.length,
      overdue_count: overdue.length,
      escalated_count: escalated.length,
      meetings_count: meetings.length,
      minutes_pending_approval_count: minutesPendingApproval.length,
      critical_tasks_count: criticalTasks.length,
      top_risks_count: risks.length,
    },
    open_actions: openActions,
    completed,
    overdue,
    escalated,
    meetings,
    minutes_pending_approval: minutesPendingApproval,
    critical_tasks: criticalTasks,
    top_risks: risks,
  });
});

// ── Report PDF — server-side binary PDF via pdfkit ───────────────────────────
router.post('/reports/pdf', auth, requirePermission('reports.generate'), async (req, res) => {
  const { content, title, lang } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    const pdfBuf = await buildPdf({ title: title || 'Report', lang: lang || 'ar', content: String(content) });
    const ascii = (title || 'report').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
    const encoded = encodeURIComponent((title || 'report').trim());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encoded}.pdf`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('PDF generation error:', e.message);
    res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
});

// ── Structured Reports (dashboard/department/board/committee/meeting/action) ──
// One function computes each report's real data from the tables that already
// hold it; /data, /pdf, and /excel below all call the exact same function so
// the three export formats can never drift apart or show different numbers.
const REPORT_TYPES = {
  dashboard_summary: { ar: 'ملخص لوحة التحكم التنفيذية', en: 'Executive Dashboard Summary' },
  department_performance: { ar: 'أداء الأقسام', en: 'Department Performance' },
  executive_actions: { ar: 'تقرير الإجراءات التنفيذية', en: 'Executive Actions Report' },
  board_meetings: { ar: 'تقرير اجتماعات مجلس الإدارة', en: 'Board Meetings Report' },
  committee_meetings: { ar: 'تقرير اجتماعات اللجان', en: 'Committee Meetings Report' },
  meeting_history: { ar: 'تقرير سجل الاجتماعات', en: 'Meeting History Report' },
};

function getReportData(type) {
  if (type === 'dashboard_summary') {
    const tasksTotal = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
    const tasksDone = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='done'").get().c;
    const meetingTotals = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='processed' THEN 1 ELSE 0 END) as done FROM meetings").get();
    const { byDepartment } = computeTaskRollups();
    return {
      columns: [{ key: 'metric', ar: 'المؤشر', en: 'Metric' }, { key: 'value', ar: 'القيمة', en: 'Value' }],
      rows: [
        { metric: { ar: 'إجمالي الإجراءات التنفيذية', en: 'Total Executive Actions' }, value: tasksTotal },
        { metric: { ar: 'الإجراءات المكتملة', en: 'Completed Actions' }, value: tasksDone },
        { metric: { ar: 'معدل إنجاز الإجراءات', en: 'Action Completion Rate' }, value: `${tasksTotal ? Math.round(tasksDone / tasksTotal * 100) : 0}%` },
        { metric: { ar: 'إجمالي الاجتماعات', en: 'Total Meetings' }, value: meetingTotals.total },
        { metric: { ar: 'الاجتماعات المعالجة', en: 'Meetings Processed' }, value: meetingTotals.done },
        { metric: { ar: 'معدل إنجاز الاجتماعات', en: 'Meeting Completion Rate' }, value: `${meetingTotals.total ? Math.round(meetingTotals.done / meetingTotals.total * 100) : 0}%` },
        { metric: { ar: 'عدد الأقسام النشطة', en: 'Active Departments' }, value: byDepartment.length },
      ],
    };
  }
  if (type === 'department_performance') {
    const { byDepartment } = computeTaskRollups();
    return {
      columns: [
        { key: 'department', ar: 'القسم', en: 'Department' }, { key: 'total', ar: 'الإجمالي', en: 'Total' },
        { key: 'done', ar: 'مكتملة', en: 'Done' }, { key: 'open', ar: 'مفتوحة', en: 'Open' },
        { key: 'overdue', ar: 'متأخرة', en: 'Overdue' }, { key: 'blocked', ar: 'معطّلة', en: 'Blocked' },
        { key: 'pct', ar: 'نسبة الإنجاز', en: 'Completion %' },
      ],
      rows: byDepartment.map(d => ({ department: d.department, total: d.total, done: d.done, open: d.open, overdue: d.overdue, blocked: d.blocked, pct: `${d.pct}%` })),
    };
  }
  if (type === 'executive_actions') {
    const tasks = db.prepare(`
      SELECT text_ar, text_en, owner_name_ar, owner_name_en, status, priority, due_date FROM tasks ORDER BY due_date ASC
    `).all();
    return {
      columns: [
        { key: 'text', ar: 'الإجراء', en: 'Action' }, { key: 'owner', ar: 'المسؤول', en: 'Owner' },
        { key: 'status', ar: 'الحالة', en: 'Status' }, { key: 'priority', ar: 'الأولوية', en: 'Priority' },
        { key: 'due_date', ar: 'تاريخ الاستحقاق', en: 'Due Date' },
      ],
      rows: tasks.map(t => ({
        text: { ar: t.text_ar, en: t.text_en || t.text_ar },
        owner: { ar: t.owner_name_ar || '', en: t.owner_name_en || t.owner_name_ar || '' },
        status: t.status, priority: t.priority, due_date: t.due_date || '',
      })),
    };
  }
  if (type === 'board_meetings' || type === 'committee_meetings') {
    const where = type === 'board_meetings' ? 'board_id IS NOT NULL' : 'committee_id IS NOT NULL';
    const rows = db.prepare(`
      SELECT title_ar, title_en, meeting_date, meeting_time, status, platform FROM schedule
      WHERE ${where} ORDER BY meeting_date DESC
    `).all();
    return {
      columns: [
        { key: 'title', ar: 'العنوان', en: 'Title' }, { key: 'date', ar: 'التاريخ', en: 'Date' },
        { key: 'time', ar: 'الوقت', en: 'Time' }, { key: 'status', ar: 'الحالة', en: 'Status' },
        { key: 'platform', ar: 'المنصة', en: 'Platform' },
      ],
      rows: rows.map(r => ({
        title: { ar: r.title_ar, en: r.title_en || r.title_ar },
        date: r.meeting_date, time: r.meeting_time, status: r.status, platform: r.platform,
      })),
    };
  }
  if (type === 'meeting_history') {
    const rows = db.prepare(`
      SELECT title_ar, title_en, meeting_date, status, ai_summary_ar, ai_summary_en FROM meetings ORDER BY meeting_date DESC LIMIT 200
    `).all();
    return {
      columns: [
        { key: 'title', ar: 'العنوان', en: 'Title' }, { key: 'date', ar: 'التاريخ', en: 'Date' },
        { key: 'status', ar: 'الحالة', en: 'Status' }, { key: 'summary', ar: 'الملخص', en: 'Summary' },
      ],
      rows: rows.map(r => ({
        title: { ar: r.title_ar, en: r.title_en || r.title_ar },
        date: (r.meeting_date || '').substring(0, 10), status: r.status,
        summary: { ar: (r.ai_summary_ar || '').slice(0, 150), en: (r.ai_summary_en || '').slice(0, 150) },
      })),
    };
  }
  return null;
}

function cellText(v, lang) {
  if (v == null) return '';
  if (typeof v === 'object') return lang === 'en' ? (v.en || v.ar || '') : (v.ar || v.en || '');
  return String(v);
}

router.get('/reports/:type/data', auth, requirePermission('reports.view'), (req, res) => {
  const meta = REPORT_TYPES[req.params.type];
  if (!meta) return res.status(404).json({ error: 'Unknown report type' });
  const data = getReportData(req.params.type);
  res.json({ type: req.params.type, title: meta, ...data });
});

router.get('/reports/:type/pdf', auth, requirePermission('reports.generate'), async (req, res) => {
  const meta = REPORT_TYPES[req.params.type];
  if (!meta) return res.status(404).json({ error: 'Unknown report type' });
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const data = getReportData(req.params.type);
  try {
    const items = data.rows.map(row => data.columns.map(c => `${lang === 'ar' ? c.ar : c.en}: ${cellText(row[c.key], lang)}`).join('  ·  '));
    const pdfBuf = await buildPdf({
      title: lang === 'ar' ? meta.ar : meta.en,
      lang,
      sections: [{ title: lang === 'ar' ? meta.ar : meta.en, items }],
    });
    const ascii = req.params.type.replace(/_/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}.pdf"`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('Structured report PDF error:', e.message);
    res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
});

router.get('/reports/:type/excel', auth, requirePermission('reports.generate'), (req, res) => {
  const meta = REPORT_TYPES[req.params.type];
  if (!meta) return res.status(404).json({ error: 'Unknown report type' });
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const data = getReportData(req.params.type);
  try {
    const XLSX = require('xlsx');
    const header = data.columns.map(c => lang === 'ar' ? c.ar : c.en);
    const sheetRows = data.rows.map(row => data.columns.map(c => cellText(row[c.key], lang)));
    const ws = XLSX.utils.aoa_to_sheet([header, ...sheetRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (lang === 'ar' ? meta.ar : meta.en).slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const ascii = req.params.type.replace(/_/g, '-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('Structured report Excel error:', e.message);
    res.status(500).json({ error: 'Excel generation failed', detail: e.message });
  }
});

// ── Board Pack — merged PDF of minutes + action plan + decision log ───────────
router.post('/meetings/:id/board-pack', auth, requirePermission('reports.generate'), async (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  if (meeting.status !== 'processed') {
    return res.status(400).json({
      error: meeting.status === 'processing' ? 'PROCESSING' : 'NOT_PROCESSED',
      message: 'يجب معالجة الاجتماع أولاً / Meeting must be processed first'
    });
  }

  let tasks = [], decisions = [], risks = [];
  try { tasks = JSON.parse(meeting.ai_tasks || '[]'); } catch (_) {}
  try { decisions = JSON.parse(meeting.ai_decisions || '[]'); } catch (_) {}
  try { risks = JSON.parse(meeting.ai_risks || '[]'); } catch (_) {}

  const docRows = db.prepare(
    `SELECT title, ai_summary, doc_classification FROM meeting_documents
     WHERE meeting_id=? AND ai_summary IS NOT NULL AND ai_summary!='' AND file_path IS NOT NULL AND file_path!=''`
  ).all(meeting.id);

  // Detect language from stored data
  const lang = (meeting.ai_summary_en && !meeting.ai_summary_ar) ? 'en' : 'ar';
  const isAr = lang === 'ar';
  const title = isAr ? meeting.title_ar : (meeting.title_en || meeting.title_ar);

  const sections = [];

  const summary = isAr ? meeting.ai_summary_ar : (meeting.ai_summary_en || meeting.ai_summary_ar);
  if (summary) sections.push({ title: isAr ? 'ملخص تنفيذي' : 'Executive Summary', text: summary });

  // ai_minutes_ar/en hold a JSON-encoded structured document
  // ({format:'structured_v1', meeting_info, attendees, agenda, discussion,
  // next_meeting_note, approvals, ...} — see assembleMinutesDoc() in
  // pipeline.js) for meetings processed after this rewrite. Each narrative
  // part becomes its own PDF section below instead of one raw blob passed to
  // pdfkit's plain .text() (which has no markdown support at all — the old
  // code handed pdfkit a "# Meeting Minutes\n**Date:**..." string and it drew
  // those "#"/"**" characters literally). Decisions/Actions/Risks are NOT
  // duplicated from inside the minutes doc — the existing Decision
  // Log/Action Plan/Risks sections below already source those from the same
  // canonical arrays, so repeating them here would just print everything twice.
  const minutesRaw = isAr ? meeting.ai_minutes_ar : meeting.ai_minutes_en;
  let minutesDoc = null;
  try {
    const parsed = minutesRaw ? JSON.parse(minutesRaw) : null;
    if (parsed && parsed.format === 'structured_v1') minutesDoc = parsed;
  } catch (_) { /* legacy markdown string — handled below */ }

  if (minutesDoc) {
    const mi = minutesDoc.meeting_info || {};
    const miLines = [
      mi.date ? `${isAr ? 'التاريخ' : 'Date'}: ${String(mi.date).substring(0, 16)}` : '',
      mi.type ? `${isAr ? 'النوع' : 'Type'}: ${mi.type}` : '',
      mi.duration_mins ? `${isAr ? 'المدة' : 'Duration'}: ${mi.duration_mins} ${isAr ? 'دقيقة' : 'min'}` : '',
    ].filter(Boolean);
    if (miLines.length) sections.push({ title: isAr ? 'معلومات الاجتماع' : 'Meeting Information', text: miLines.join(isAr ? '  ·  ' : '  |  ') });

    const attendeeLines = [
      ...(minutesDoc.attendees || []),
      ...(minutesDoc.apologies || []).map(a => `${a} (${isAr ? 'اعتذر' : 'apologies'})`),
    ];
    if (attendeeLines.length) sections.push({ title: isAr ? 'الحضور' : 'Attendees', items: attendeeLines });

    if ((minutesDoc.agenda || []).length) sections.push({ title: isAr ? 'جدول الأعمال' : 'Agenda', items: minutesDoc.agenda });

    if ((minutesDoc.discussion || []).length) {
      sections.push({
        title: isAr ? 'المناقشات' : 'Discussion',
        text: minutesDoc.discussion.map(d => `${d.topic}\n${d.narrative}`).join('\n\n'),
      });
    }

    if (minutesDoc.next_meeting_note) sections.push({ title: isAr ? 'الاجتماع القادم' : 'Next Meeting', text: minutesDoc.next_meeting_note });
  } else if (minutesRaw) {
    // Legacy pre-rewrite meeting: markdown string. Strip syntax markers so the
    // PDF at least reads as plain prose instead of visible "#"/"**"/"- ".
    const plain = String(minutesRaw)
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/^[-*]\s+/gm, '• ')
      .trim();
    if (plain) sections.push({ title: isAr ? 'محضر الاجتماع' : 'Meeting Minutes', text: plain });
  }

  if (decisions.length) {
    sections.push({
      title: isAr ? 'سجل القرارات' : 'Decision Log',
      items: decisions.map(d => (isAr ? (d.text_ar || d.decision_ar || '') : (d.text_en || d.decision_en || d.text_ar || '')).trim()).filter(Boolean)
    });
  }

  if (tasks.length) {
    sections.push({
      title: isAr ? 'خطة العمل والمهام' : 'Action Plan & Tasks',
      items: tasks.map(t => {
        const txt = (isAr ? (t.text_ar || '') : (t.text_en || t.text_ar || '')).trim();
        const owner = (isAr ? (t.owner_ar || '') : (t.owner_en || t.owner_ar || '')).trim();
        return txt + (owner ? ` — ${owner}` : '');
      }).filter(Boolean)
    });
  }

  if (risks.length) {
    sections.push({
      title: isAr ? 'المخاطر والملاحظات' : 'Risks & Notes',
      items: risks.map(r => {
        const sev = r.severity === 'high' ? (isAr ? '[عالٍ] ' : '[High] ') : r.severity === 'medium' ? (isAr ? '[متوسط] ' : '[Medium] ') : (isAr ? '[منخفض] ' : '[Low] ');
        const txt = (isAr ? (r.text_ar || '') : (r.text_en || r.text_ar || '')).trim();
        return sev + txt;
      }).filter(Boolean)
    });
  }

  if (docRows.length) {
    sections.push({
      title: isAr ? 'ملخص الوثائق المرفقة' : 'Attached Document Summaries',
      items: docRows.map(d => `${d.title}${d.doc_classification ? ' [' + d.doc_classification + ']' : ''}: ${d.ai_summary || ''}`)
    });
  }

  const approvalStatusLabels = {
    draft: isAr ? 'مسودة' : 'Draft',
    circulated: isAr ? 'مُعمَّم' : 'Circulated',
    approved: isAr ? 'مُعتمد' : 'Approved',
    revision_needed: isAr ? 'يتطلب تعديلاً' : 'Revision Needed',
    final_approved: isAr ? 'اعتماد نهائي' : 'Final Approved',
  };
  const approvalLines = [
    `${isAr ? 'الحالة' : 'Status'}: ${approvalStatusLabels[meeting.minutes_status] || meeting.minutes_status || approvalStatusLabels.draft}`,
    meeting.circulated_at ? `${isAr ? 'عُمِّم في' : 'Circulated'}: ${String(meeting.circulated_at).substring(0, 16)}` : '',
    meeting.final_approved_at ? `${isAr ? 'اعتُمد نهائياً في' : 'Final approved'}: ${String(meeting.final_approved_at).substring(0, 16)}` : '',
  ].filter(Boolean);
  sections.push({ title: isAr ? 'الاعتماد' : 'Approvals', text: approvalLines.join(isAr ? '  ·  ' : '  |  ') });

  try {
    const packTitle = `${isAr ? 'حزمة مجلس الإدارة' : 'Board Pack'} — ${title}`;
    const pdfBuf = await buildPdf({ title: packTitle, lang, sections });
    const ascii = (title || 'board-pack').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'board-pack';
    const encoded = encodeURIComponent(packTitle.trim());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="board-pack-${ascii}.pdf"; filename*=UTF-8''${encoded}.pdf`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('Board pack PDF error:', e.message);
    res.status(500).json({ error: 'Board pack PDF generation failed', detail: e.message });
  }
});

// ── Series Report — timeline + aggregated decisions/actions/attachments for a
// whole Meeting Series, reusing the same buildPdf() the board pack uses ─────
router.post('/meeting-series/:id/report', auth, requirePermission('reports.generate'), async (req, res) => {
  const series = db.prepare(`
    SELECT s.*, u.name_ar as owner_name_ar, u.name_en as owner_name_en
    FROM meeting_series s LEFT JOIN users u ON s.owner_id = u.id
    WHERE s.id=?
  `).get(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });
  const lang = req.body.lang === 'en' ? 'en' : 'ar';
  const isAr = lang === 'ar';
  const title = isAr ? series.name_ar : (series.name_en || series.name_ar);

  const held = db.prepare('SELECT * FROM meetings WHERE series_id=? ORDER BY meeting_date ASC').all(series.id);
  const planned = db.prepare("SELECT * FROM schedule WHERE series_id=? AND status != 'cancelled' ORDER BY meeting_date ASC").all(series.id);
  const heldIds = held.map(m => m.id);
  const tasks = heldIds.length ? db.prepare(`SELECT * FROM tasks WHERE source_meeting_id IN (${heldIds.map(() => '?').join(',')})`).all(...heldIds) : [];
  const decisions = heldIds.length ? db.prepare(`SELECT * FROM decisions WHERE meeting_id IN (${heldIds.map(() => '?').join(',')})`).all(...heldIds) : [];
  const documents = heldIds.length ? db.prepare(`SELECT * FROM meeting_documents WHERE meeting_id IN (${heldIds.map(() => '?').join(',')}) AND file_path IS NOT NULL AND file_path!=''`).all(...heldIds) : [];

  const sections = [];

  const ownerName = isAr ? (series.owner_name_ar || '') : (series.owner_name_en || series.owner_name_ar || '');
  sections.push({
    title: isAr ? 'ملخص تنفيذي' : 'Executive Summary',
    text: [
      isAr ? (series.description_ar || '') : (series.description_en || series.description_ar || ''),
      `${isAr ? 'الفئة' : 'Category'}: ${series.category || (isAr ? 'غير محدد' : 'Unspecified')}`,
      ownerName ? `${isAr ? 'المالك' : 'Owner'}: ${ownerName}` : '',
      `${isAr ? 'إجمالي الاجتماعات' : 'Total meetings'}: ${held.length + planned.length} (${isAr ? 'مكتملة' : 'completed'}: ${held.length}, ${isAr ? 'قادمة' : 'upcoming'}: ${planned.length})`,
    ].filter(Boolean).join('\n')
  });

  const timeline = [...held.map(m => ({ ...m, kind: 'held' })), ...planned.map(m => ({ ...m, kind: 'planned' }))]
    .sort((a, b) => (a.meeting_date || '').localeCompare(b.meeting_date || ''));
  if (timeline.length) {
    sections.push({
      title: isAr ? 'الجدول الزمني للاجتماعات' : 'Meeting Timeline',
      items: timeline.map(m => {
        const t = isAr ? m.title_ar : (m.title_en || m.title_ar);
        const status = m.kind === 'held' ? (isAr ? 'مكتمل' : 'Completed') : (isAr ? 'قادم' : 'Upcoming');
        return `${(m.meeting_date || '').substring(0, 10)} — ${t} [${status}]`;
      })
    });
  }

  const summaries = held.filter(m => m.ai_summary_ar || m.ai_summary_en);
  if (summaries.length) {
    sections.push({
      title: isAr ? 'ملخصات الاجتماعات' : 'Meeting Summaries',
      items: summaries.map(m => `${isAr ? m.title_ar : (m.title_en || m.title_ar)}: ${(isAr ? m.ai_summary_ar : (m.ai_summary_en || m.ai_summary_ar)) || ''}`)
    });
  }

  if (decisions.length) {
    sections.push({
      title: isAr ? 'جميع القرارات' : 'All Decisions',
      items: decisions.map(d => `${(isAr ? d.text_ar : (d.text_en || d.text_ar)) || ''} [${d.status}]`)
    });
  }

  if (tasks.length) {
    sections.push({
      title: isAr ? 'جميع إجراءات التنفيذ' : 'All Executive Actions',
      items: tasks.map(t => {
        const txt = (isAr ? t.text_ar : (t.text_en || t.text_ar)) || '';
        const owner = (isAr ? t.owner_name_ar : (t.owner_name_en || t.owner_name_ar)) || '';
        return `${txt}${owner ? ' — ' + owner : ''} [${t.status}, ${t.progress || 0}%]`;
      })
    });
  }

  if (documents.length) {
    sections.push({
      title: isAr ? 'المرفقات' : 'Attachments',
      items: documents.map(d => d.title_ar || d.title_en || d.title || '').filter(Boolean)
    });
  }

  try {
    const reportTitle = `${isAr ? 'تقرير سلسلة الاجتماعات' : 'Series Report'} — ${title}`;
    const pdfBuf = await buildPdf({ title: reportTitle, lang, sections });
    const ascii = (title || 'series-report').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'series-report';
    const encoded = encodeURIComponent(reportTitle.trim());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="series-report-${ascii}.pdf"; filename*=UTF-8''${encoded}.pdf`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('Series report PDF error:', e.message);
    res.status(500).json({ error: 'Series report PDF generation failed', detail: e.message });
  }
});

// ── Minutes Approval Workflow ────────────────────────────────────────────────

function logApprovalAction(meeting_id, action, user, comments, version) {
  const actor = user ? resolveActor(user.id) : { name: null, role: null };
  db.prepare(
    `INSERT INTO minutes_approval_log (meeting_id, action, actor_id, actor_name, actor_role, comments, version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    meeting_id,
    action,
    user ? user.id : null,
    (user && (actor.name || user.email)) || null,
    actor.role,
    comments || null,
    version || 1
  );
}

// Returns system user IDs for everyone who has view-access to a meeting's
// minutes — combines: (a) users whose email matches a meeting_attendees row,
// (b) users with minutes.view permission (board members etc.), excluding the
// acting user so they don't notify themselves.
function minutesAudienceIds(meetingId, excludeUserId = null) {
  try {
    const byEmail = db.prepare(`
      SELECT DISTINCT u.id FROM users u
      JOIN meeting_attendees ma ON LOWER(ma.email) = LOWER(u.email)
      WHERE ma.meeting_id = ?
    `).all(meetingId).map(r => r.id);
    const byPerm = db.prepare(`
      SELECT DISTINCT u.id FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.key IN ('minutes.view','minutes.approve','minutes.publish')
    `).all().map(r => r.id);
    const all = [...new Set([...byEmail, ...byPerm])];
    return excludeUserId ? all.filter(id => id !== excludeUserId) : all;
  } catch (_) { return []; }
}

// Returns user IDs of everyone with minutes.approve or minutes.publish permission.
function minutesApproverIds(excludeUserId = null) {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT u.id FROM users u
      JOIN role_permissions rp ON rp.role_id = u.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.key IN ('minutes.approve','minutes.publish')
    `).all().map(r => r.id);
    return excludeUserId ? rows.filter(id => id !== excludeUserId) : rows;
  } catch (_) { return []; }
}

// POST /api/meetings/:id/circulate
router.post('/meetings/:id/circulate', auth, requirePermission('minutes.publish'), (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='circulated', circulated_at=CURRENT_TIMESTAMP, circulated_by=?, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'circulated', req.user, comments, version);
  transitionMeeting(meeting.id, 'review', req.user && req.user.id, 'Minutes circulated for review');
  // Notify all attendees + approvers that minutes are ready for review
  try {
    const mtTitle = meeting.title_ar || meeting.title_en || '';
    const actorId = req.user ? req.user.id : null;
    const audience = minutesAudienceIds(meeting.id, actorId);
    notifyUsers(db, audience, {
      type: 'minutes_circulated',
      titleAr: 'محضر جاهز للمراجعة والاعتماد',
      titleEn: 'Minutes ready for review & approval',
      bodyAr: `تم تعميم محضر "${mtTitle}" للمراجعة والاعتماد`,
      bodyEn: `Minutes for "${mtTitle}" have been circulated for review and approval`,
      priority: 'high',
      sourceType: 'meeting',
      sourceId: meeting.id,
    }, actorId);
  } catch (e) { /* non-fatal */ }
  res.json({ success: true, minutes_status: 'circulated' });
});

// POST /api/meetings/:id/approve
router.post('/meetings/:id/approve', auth, requirePermission('minutes.approve'), (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'approved', req.user, comments, version);
  transitionMeeting(meeting.id, 'approval', req.user && req.user.id, 'Minutes approved');
  try {
    const mtTitle = meeting.title_ar || meeting.title_en || '';
    const actorId = req.user ? req.user.id : null;
    const audience = minutesAudienceIds(meeting.id, actorId);
    notifyUsers(db, audience, {
      type: 'minutes_approved',
      titleAr: 'تمت الموافقة على المحضر',
      titleEn: 'Meeting minutes approved',
      bodyAr: `تمت الموافقة على محضر "${mtTitle}"`,
      bodyEn: `The minutes for "${mtTitle}" have been approved`,
      priority: 'high',
      sourceType: 'meeting', sourceId: meeting.id, deepLink: 'transcripts',
    }, actorId);
  } catch (e) { /* non-fatal */ }
  res.json({ success: true, minutes_status: 'approved' });
});

// POST /api/meetings/:id/request-revision
router.post('/meetings/:id/request-revision', auth, requirePermission('minutes.approve'), (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='revision_requested', minutes_version=?, approval_comments=? WHERE id=?`
  ).run(version + 1, comments, meeting.id);
  logApprovalAction(meeting.id, 'revision_requested', req.user, comments, version);
  transitionMeeting(meeting.id, 'review', req.user && req.user.id, 'Revision requested — back to review');
  // Notify secretary (recorded_by) that a revision was requested
  try {
    if (meeting.recorded_by && meeting.recorded_by !== (req.user ? req.user.id : null)) {
      const mtTitle = meeting.title_ar || meeting.title_en || '';
      const requesterName = req.user ? (req.user.name_en || req.user.name_ar || req.user.email || '') : '';
      createNotification(db, {
        userId: meeting.recorded_by,
        type: 'minutes_revision_requested',
        titleAr: 'طُلب تعديل على المحضر',
        titleEn: 'Minutes revision requested',
        bodyAr: `طلب ${requesterName} مراجعة وتعديل محضر "${mtTitle}"${comments ? ` — ${comments}` : ''}`,
        bodyEn: `${requesterName} requested a revision to "${mtTitle}" minutes${comments ? ` — ${comments}` : ''}`,
        priority: 'high',
        sourceType: 'meeting', sourceId: meeting.id,
      });
    }
  } catch (e) { /* non-fatal */ }
  res.json({ success: true, minutes_status: 'revision_requested', new_version: version + 1 });
});

// POST /api/meetings/:id/final-approve
router.post('/meetings/:id/final-approve', auth, requirePermission('minutes.approve'), (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='final_approved', final_approved_by=?, final_approved_at=CURRENT_TIMESTAMP, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'final_approved', req.user, comments, version);
  transitionMeeting(meeting.id, 'approval', req.user && req.user.id, 'Minutes given final approval');
  // Notify all attendees + approvers of final approval
  try {
    const mtTitle = meeting.title_ar || meeting.title_en || '';
    const actorId = req.user ? req.user.id : null;
    const audience = minutesAudienceIds(meeting.id, actorId);
    notifyUsers(db, audience, {
      type: 'minutes_final_approved',
      titleAr: 'اعتماد نهائي لمحضر الاجتماع',
      titleEn: 'Meeting minutes — final approval',
      bodyAr: `حصل محضر "${mtTitle}" على الاعتماد النهائي من المجلس`,
      bodyEn: `"${mtTitle}" has received final board approval`,
      priority: 'high',
      sourceType: 'meeting', sourceId: meeting.id, deepLink: 'transcripts',
    }, actorId);
  } catch (e) { /* non-fatal */ }
  res.json({ success: true, minutes_status: 'final_approved' });
});

// GET /api/meetings/:id/minutes/download — generates a formatted PDF of the
// meeting minutes, decisions, and actions. Available as soon as the meeting has
// minutes content (ai_minutes_ar/en or manual minutes). lang param defaults to
// the language the minutes were generated in; pass ?lang=en to force English.
router.get('/meetings/:id/minutes/download', auth, requirePermission('minutes.view'), async (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });

  const forceLang = (req.query.lang || '').toLowerCase();
  const hasEn = !!(meeting.ai_minutes_en || meeting.ai_summary_en);
  const isAr = forceLang === 'en' ? false : forceLang === 'ar' ? true : !(hasEn && !meeting.ai_minutes_ar);
  const lang = isAr ? 'ar' : 'en';

  const t = (ar, en) => isAr ? ar : en;
  const mtTitle = (isAr ? meeting.title_ar : (meeting.title_en || meeting.title_ar)) || t('اجتماع', 'Meeting');

  const sections = [];

  // Approval status banner
  const statusMap = {
    draft: t('مسودة', 'Draft'),
    circulated: t('قيد المراجعة', 'Under Review'),
    approved: t('معتمد', 'Approved'),
    revision_requested: t('يحتاج تعديل', 'Revision Needed'),
    final_approved: t('معتمد نهائياً', 'Final Approved'),
  };
  const approvalLines = [
    `${t('الحالة', 'Status')}: ${statusMap[meeting.minutes_status] || (meeting.minutes_status || t('مسودة','Draft'))}`,
    meeting.circulated_at ? `${t('تاريخ التعميم','Circulated')}: ${String(meeting.circulated_at).substring(0,16)}` : '',
    meeting.approved_at   ? `${t('تاريخ الاعتماد','Approved')}: ${String(meeting.approved_at).substring(0,16)}` : '',
    meeting.final_approved_at ? `${t('الاعتماد النهائي','Final Approval')}: ${String(meeting.final_approved_at).substring(0,16)}` : '',
  ].filter(Boolean);
  sections.push({ title: t('حالة المحضر', 'Minutes Status'), text: approvalLines.join('  |  ') });

  // Meeting info
  const attendees = db.prepare('SELECT name FROM meeting_attendees WHERE meeting_id=? ORDER BY id').all(meeting.id);
  const infoLines = [
    meeting.meeting_date ? `${t('التاريخ','Date')}: ${String(meeting.meeting_date).substring(0,10)}` : '',
    meeting.meeting_time ? `${t('الوقت','Time')}: ${meeting.meeting_time}` : '',
    meeting.platform     ? `${t('المنصة','Platform')}: ${meeting.platform}` : '',
    meeting.location     ? `${t('المكان','Location')}: ${meeting.location}` : '',
  ].filter(Boolean);
  if (infoLines.length) sections.push({ title: t('معلومات الاجتماع', 'Meeting Information'), text: infoLines.join('  |  ') });

  if (attendees.length) {
    sections.push({
      title: t('المشاركون', 'Attendees'),
      items: attendees.map(a => a.name).filter(Boolean),
    });
  }

  // Summary
  const summary = (isAr ? meeting.ai_summary_ar : meeting.ai_summary_en) || meeting.ai_summary_ar;
  if (summary) sections.push({ title: t('الملخص التنفيذي', 'Executive Summary'), text: summary });

  // Minutes body (structured v1 or legacy markdown)
  const minutesRaw = isAr ? meeting.ai_minutes_ar : (meeting.ai_minutes_en || meeting.ai_minutes_ar);
  let minutesDoc = null;
  try {
    const parsed = minutesRaw ? JSON.parse(minutesRaw) : null;
    if (parsed && parsed.format === 'structured_v1') minutesDoc = parsed;
  } catch (_) {}

  if (minutesDoc) {
    if ((minutesDoc.agenda || []).length)
      sections.push({ title: t('جدول الأعمال', 'Agenda'), items: minutesDoc.agenda });
    if ((minutesDoc.discussion || []).length)
      sections.push({ title: t('المناقشات', 'Discussion'), text: minutesDoc.discussion.map(d => `${d.topic}\n${d.narrative}`).join('\n\n') });
    if (minutesDoc.next_meeting_note)
      sections.push({ title: t('الاجتماع القادم', 'Next Meeting'), text: minutesDoc.next_meeting_note });
  } else if (minutesRaw) {
    const plain = String(minutesRaw)
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/^[-*]\s+/gm, '• ')
      .trim();
    if (plain) sections.push({ title: t('محضر الاجتماع', 'Meeting Minutes'), text: plain });
  }

  // Decisions from DB (real rows, excluding AI drafts)
  const decisions = db.prepare(
    `SELECT text_ar, text_en, status FROM decisions WHERE meeting_id=? AND (ai_status IS NULL OR ai_status != 'ai_draft') ORDER BY id`
  ).all(meeting.id);
  if (decisions.length) {
    sections.push({
      title: t('القرارات', 'Decisions'),
      items: decisions.map((d, i) => {
        const txt = (isAr ? (d.text_ar || d.text_en) : (d.text_en || d.text_ar)) || '';
        return `${i + 1}. ${txt.trim()}`;
      }).filter(Boolean),
    });
  }

  // Tasks from DB — note: tasks reference meetings via source_meeting_id
  const tasks = db.prepare(
    `SELECT text_ar, text_en, owner_name_ar, owner_name_en, due_date, status FROM tasks WHERE source_meeting_id=? AND (ai_status IS NULL OR ai_status != 'ai_draft') ORDER BY id`
  ).all(meeting.id);
  if (tasks.length) {
    sections.push({
      title: t('الإجراءات والمهام', 'Actions & Tasks'),
      items: tasks.map((tk, i) => {
        const txt = (isAr ? (tk.text_ar || tk.text_en) : (tk.text_en || tk.text_ar)) || '';
        const owner = (isAr ? tk.owner_name_ar : (tk.owner_name_en || tk.owner_name_ar)) || '';
        const due = tk.due_date ? ` · ${t('الاستحقاق','Due')}: ${String(tk.due_date).substring(0,10)}` : '';
        return `${i + 1}. ${txt.trim()}${owner ? ' — ' + owner : ''}${due}`;
      }).filter(Boolean),
    });
  }

  if (!sections.length || sections.length <= 1) {
    return res.status(400).json({ error: 'NO_MINUTES', message: t('لا يوجد محتوى للمحضر بعد', 'No minutes content available yet') });
  }

  try {
    const docTitle = `${t('محضر اجتماع', 'Meeting Minutes')} — ${mtTitle}`;
    const pdfBuf = await buildPdf({ title: docTitle, lang, sections });
    const ascii = mtTitle.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || `meeting-${meeting.id}`;
    const encoded = encodeURIComponent(docTitle.trim());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="minutes-${ascii}.pdf"; filename*=UTF-8''${encoded}.pdf`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('Minutes PDF error:', e.message);
    res.status(500).json({ error: 'PDF_FAILED', detail: e.message });
  }
});

// POST /api/meetings/:id/archive — final step of the lifecycle, only reachable
// once the board has given final approval.
router.post('/meetings/:id/archive', auth, requirePermission('meetings.archive'), (req, res) => {
  const meeting = db.prepare('SELECT id, lifecycle_stage FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  if (meeting.lifecycle_stage === 'archived') return res.json({ success: true, lifecycle_stage: 'archived' });
  if (meeting.lifecycle_stage !== 'approval') {
    return res.status(400).json({ error: 'Meeting must reach Approval before it can be archived' });
  }
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  transitionMeeting(meeting.id, 'archived', req.user && req.user.id, comments || 'Meeting archived');
  res.json({ success: true, lifecycle_stage: 'archived' });
});

// GET /api/meetings/:id/approval-log
router.get('/meetings/:id/approval-log', auth, requirePermission('minutes.view'), (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const log = db.prepare(
    `SELECT * FROM minutes_approval_log WHERE meeting_id=? ORDER BY created_at ASC`
  ).all(meeting.id);
  res.json({ success: true, log });
});

// ── Minutes Modification Requests ────────────────────────────────────────────

// GET  /api/meetings/:id/mod-requests
router.get('/meetings/:id/mod-requests', auth, requirePermission('minutes.view'), (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const rows = db.prepare(
    `SELECT * FROM minutes_modification_requests WHERE meeting_id=? ORDER BY created_at DESC`
  ).all(meeting.id);
  res.json({ success: true, requests: rows });
});

// POST /api/meetings/:id/mod-requests  (any attendee with minutes.view)
router.post('/meetings/:id/mod-requests', auth, requirePermission('minutes.view'), (req, res) => {
  const meeting = db.prepare('SELECT id, minutes_status FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const { proposed_value, section_label, section_type } = req.body;
  if (!proposed_value || !String(proposed_value).trim())
    return res.status(400).json({ error: 'Notes are required' });
  const u = req.user;
  const name = u.name_en || u.name_ar || u.email || '';
  const result = db.prepare(
    `INSERT INTO minutes_modification_requests
     (meeting_id, requester_id, requester_name, section_type, section_label, proposed_value, status)
     VALUES (?,?,?,?,?,?,'pending')`
  ).run(meeting.id, u.id, name, section_type || 'general', section_label || '', String(proposed_value).trim());
  // Notify secretary and approvers that a modification request was submitted
  try {
    const fullMeeting = db.prepare('SELECT title_ar, title_en FROM meetings WHERE id=?').get(meeting.id);
    const mtTitle = (fullMeeting && (fullMeeting.title_ar || fullMeeting.title_en)) || '';
    const approvers = minutesApproverIds(u.id);
    notifyUsers(db, approvers, {
      type: 'minutes_mod_request',
      titleAr: 'طلب تعديل جديد على المحضر',
      titleEn: 'New minutes modification request',
      bodyAr: `${name} طلب تعديلاً على محضر "${mtTitle}"${section_label ? ` — ${section_label}` : ''}`,
      bodyEn: `${name} submitted a modification request for "${mtTitle}" minutes${section_label ? ` — ${section_label}` : ''}`,
      priority: 'high',
      sourceType: 'meeting', sourceId: meeting.id,
    }, u.id);
  } catch (e) { /* non-fatal */ }
  res.json({ success: true, id: result.lastInsertRowid });
});

// POST /api/meetings/:id/mod-requests/:reqId/decide  (secretary / minutes.publish or minutes.approve)
router.post('/meetings/:id/mod-requests/:reqId/decide', auth, (req, res) => {
  if (!req.user.permissions.includes('minutes.publish') && !req.user.permissions.includes('minutes.approve'))
    return res.status(403).json({ error: 'FORBIDDEN' });
  const row = db.prepare(
    `SELECT * FROM minutes_modification_requests WHERE id=? AND meeting_id=?`
  ).get(req.params.reqId, req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const { decision, secretary_note } = req.body;
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  const u = req.user;
  db.prepare(
    `UPDATE minutes_modification_requests
     SET status=?, secretary_id=?, secretary_name=?, secretary_note=?, decided_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).run(decision, u.id, u.name_en || u.name_ar || u.email || '', secretary_note || '', row.id);
  // Notify the requester of the decision
  try {
    if (row.requester_id && row.requester_id !== u.id) {
      const fullMeeting = db.prepare('SELECT title_ar, title_en FROM meetings WHERE id=?').get(req.params.id);
      const mtTitle = (fullMeeting && (fullMeeting.title_ar || fullMeeting.title_en)) || '';
      const secretaryName = u.name_en || u.name_ar || u.email || '';
      const accepted = decision === 'approved';
      createNotification(db, {
        userId: row.requester_id,
        type: accepted ? 'minutes_mod_accepted' : 'minutes_mod_rejected',
        titleAr: accepted ? 'تم قبول طلب التعديل على المحضر' : 'تم رفض طلب التعديل على المحضر',
        titleEn: accepted ? 'Modification request accepted' : 'Modification request rejected',
        bodyAr: accepted
          ? `قبل ${secretaryName} طلب تعديلك على محضر "${mtTitle}"${secretary_note ? ` — ${secretary_note}` : ''}`
          : `رفض ${secretaryName} طلب تعديلك على محضر "${mtTitle}"${secretary_note ? ` — ${secretary_note}` : ''}`,
        bodyEn: accepted
          ? `${secretaryName} accepted your modification request for "${mtTitle}" minutes${secretary_note ? ` — ${secretary_note}` : ''}`
          : `${secretaryName} rejected your modification request for "${mtTitle}" minutes${secretary_note ? ` — ${secretary_note}` : ''}`,
        priority: 'normal',
        sourceType: 'meeting', sourceId: parseInt(req.params.id),
      });
    }
  } catch (e) { /* non-fatal */ }
  res.json({ success: true });
});

// GET /api/meetings/:id/lifecycle — current stage + full transition history
router.get('/meetings/:id/lifecycle', auth, requirePermission('meetings.view'), (req, res) => {
  const meeting = db.prepare('SELECT id, lifecycle_stage, lifecycle_updated_at FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const log = db.prepare(
    `SELECT * FROM meeting_lifecycle_log WHERE meeting_id=? ORDER BY created_at ASC`
  ).all(meeting.id);
  res.json({
    stage: meeting.lifecycle_stage || 'created',
    updated_at: meeting.lifecycle_updated_at,
    stages: LIFECYCLE_STAGES,
    log,
  });
});

// ── Notification Center ──────────────────────────────────────────────────────
// Every notification row already belongs to a single user_id, so these
// routes never take an id parameter for "whose" — it's always req.user.

router.get('/notifications', auth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const unreadOnly = req.query.unread_only === '1' || req.query.unread_only === 'true';
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id=? ${unreadOnly ? 'AND read_at IS NULL' : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, limit);
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id);
  res.json({ notifications: rows, unread_count: unread.c });
});

router.get('/notifications/unread-count', auth, (req, res) => {
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id);
  res.json({ unread_count: unread.c });
});

router.patch('/notifications/:id/read', auth, (req, res) => {
  const row = db.prepare('SELECT id FROM notifications WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
  res.json({ success: true });
});

router.post('/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.user.id);
  res.json({ success: true });
});

// ── Global Smart Search ───────────────────────────────────────────────────────
// One query fanned out across every entity that already exists, each gated
// by the same permission its own list endpoint already requires — a Guest
// searching "budget" gets meeting/schedule matches but no task or governance
// results, exactly as if they'd tried each panel individually. Ask Ameen
// history is deliberately absent: it's stored only in the browser's
// localStorage (see Chat.STORAGE_KEY in app.js), there is no server-side
// copy to search — the frontend merges its own local matches in separately.
router.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const limitPer = Math.min(Number(req.query.limit_per) || 8, 25);
  const results = [];

  for (const m of db.prepare(`
    SELECT id, title_ar, title_en, ai_summary_ar, ai_summary_en, meeting_date
    FROM meetings
    WHERE title_ar LIKE ? OR title_en LIKE ? OR ai_summary_ar LIKE ? OR ai_summary_en LIKE ?
    ORDER BY meeting_date DESC LIMIT ?
  `).all(like, like, like, like, limitPer)) {
    results.push({
      category: 'meetings',
      title_ar: m.title_ar, title_en: m.title_en || m.title_ar,
      subtitle_ar: (m.ai_summary_ar || '').slice(0, 120), subtitle_en: (m.ai_summary_en || '').slice(0, 120),
      date: m.meeting_date, source_type: 'meeting', source_id: m.id,
    });
  }

  const hasTaskView = rbacService.hasPermission(db, req.user.id, 'actions.view');
  const taskWhere = hasTaskView
    ? `(text_ar LIKE ? OR text_en LIKE ? OR owner_name_ar LIKE ? OR owner_name_en LIKE ?)`
    : `(text_ar LIKE ? OR text_en LIKE ? OR owner_name_ar LIKE ? OR owner_name_en LIKE ?) AND owner_id=?`;
  const taskParams = hasTaskView ? [like, like, like, like, limitPer] : [like, like, like, like, req.user.id, limitPer];
  for (const t of db.prepare(`
    SELECT id, text_ar, text_en, owner_name_ar, owner_name_en, due_date, status
    FROM tasks WHERE ${taskWhere} ORDER BY updated_at DESC LIMIT ?
  `).all(...taskParams)) {
    results.push({
      category: 'tasks',
      title_ar: t.text_ar, title_en: t.text_en || t.text_ar,
      subtitle_ar: t.owner_name_ar || '', subtitle_en: t.owner_name_en || t.owner_name_ar || '',
      date: t.due_date, source_type: 'task', source_id: t.id,
    });
  }

  if (rbacService.hasPermission(db, req.user.id, 'documents.download')) {
    for (const d of db.prepare(`
      SELECT id, title, title_ar, title_en, ai_summary_ar, ai_summary_en, upload_date
      FROM meeting_documents
      WHERE title LIKE ? OR title_ar LIKE ? OR title_en LIKE ? OR ai_summary_ar LIKE ? OR ai_summary_en LIKE ?
      ORDER BY id DESC LIMIT ?
    `).all(like, like, like, like, like, limitPer)) {
      const titleAr = d.title_ar || d.title;
      const titleEn = d.title_en || d.title;
      results.push({
        category: 'documents',
        title_ar: titleAr, title_en: titleEn,
        subtitle_ar: (d.ai_summary_ar || '').slice(0, 120), subtitle_en: (d.ai_summary_en || '').slice(0, 120),
        date: d.upload_date, source_type: 'document', source_id: d.id,
      });
    }
  }

  if (rbacService.hasPermission(db, req.user.id, 'governance.resolutions')) {
    for (const r of db.prepare(`
      SELECT id, title, description, created_at FROM resolutions
      WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT ?
    `).all(like, like, limitPer)) {
      results.push({
        category: 'governance',
        title_ar: r.title, title_en: r.title,
        subtitle_ar: (r.description || '').slice(0, 120), subtitle_en: (r.description || '').slice(0, 120),
        date: r.created_at, source_type: 'resolution', source_id: r.id,
      });
    }
  }

  // schedule covers scheduled meetings, committee meetings, and general
  // assemblies — same table, split by meeting_type/committee_id/board_id
  // exactly like the Master Calendar UI already does.
  for (const s of db.prepare(`
    SELECT id, title_ar, title_en, agenda_ar, agenda_en, meeting_date, meeting_type, committee_id, board_id
    FROM schedule
    WHERE title_ar LIKE ? OR title_en LIKE ? OR agenda_ar LIKE ? OR agenda_en LIKE ?
    ORDER BY meeting_date DESC LIMIT ?
  `).all(like, like, like, like, limitPer)) {
    const category = s.meeting_type === 'general_assembly' ? 'general_assembly'
      : s.committee_id ? 'committee_meetings'
      : 'meetings';
    results.push({
      category,
      title_ar: s.title_ar, title_en: s.title_en || s.title_ar,
      subtitle_ar: (s.agenda_ar || '').slice(0, 120), subtitle_en: (s.agenda_en || '').slice(0, 120),
      date: s.meeting_date, source_type: 'schedule', source_id: s.id,
    });
  }

  res.json({ results });
});

// ── Organization-wide Activity Timeline ──────────────────────────────────────
// Every entry here comes from a table the product already writes to for its
// own reasons (lifecycle tracking, approval audit, progress notes, RBAC
// audit) — nothing is fabricated. "Report generated" from the Stage 2 spec
// is deliberately absent: report/PDF generation is synchronous and streamed
// straight back to the requester, there is no persisted record of it to
// surface here.
const MEETING_STAGE_LABELS = {
  created: { ar: 'تم إنشاء الاجتماع', en: 'Meeting created' },
  invited: { ar: 'تمت دعوة الحضور', en: 'Attendees invited' },
  scheduled: { ar: 'تمت جدولة الاجتماع', en: 'Meeting scheduled' },
  recording: { ar: 'بدأ تسجيل الاجتماع', en: 'Meeting recording started' },
  uploaded: { ar: 'تم رفع التسجيل/النص', en: 'Recording/transcript uploaded' },
  transcript_generated: { ar: 'تم توليد النص الحرفي', en: 'Transcript generated' },
  ai_minutes_generated: { ar: 'تم توليد ملخص الذكاء الاصطناعي', en: 'AI summary generated' },
  review:   { ar: 'قيد المراجعة', en: 'Under review' },
  approval: { ar: 'الاعتماد',     en: 'Approval' },
  archived: { ar: 'تمت أرشفة الاجتماع', en: 'Meeting archived' },
};

router.get('/activity', auth, requirePermission('reports.view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const q = (req.query.q || '').trim().toLowerCase();
  const canSeeAdmin = rbacService.hasPermission(db, req.user.id, 'admin.users');

  const entries = [];

  // chairman_approval/board_approval are excluded here — both are always
  // paired 1:1 with a minutes_approval_log 'approved'/'final_approved' row
  // written by the same route handler, which already covers them below with
  // clearer wording. Without this filter every approval would show twice.
  for (const row of db.prepare(`
    SELECT l.*, m.title_ar as meeting_title_ar, m.title_en as meeting_title_en
    FROM meeting_lifecycle_log l LEFT JOIN meetings m ON m.id = l.meeting_id
    WHERE l.to_stage NOT IN ('chairman_approval', 'board_approval')
    ORDER BY l.created_at DESC LIMIT 300
  `).all()) {
    const label = MEETING_STAGE_LABELS[row.to_stage] || { ar: row.to_stage, en: row.to_stage };
    const meetingTitle = row.meeting_title_ar || row.meeting_title_en || `#${row.meeting_id}`;
    entries.push({
      type: row.to_stage === 'ai_minutes_generated' ? 'ai_summary_generated' : 'meeting_lifecycle',
      category: 'meetings',
      title_ar: label.ar, title_en: label.en,
      body_ar: meetingTitle, body_en: row.meeting_title_en || row.meeting_title_ar || `#${row.meeting_id}`,
      actor_name: row.actor_name, created_at: row.created_at,
      source_type: 'meeting', source_id: row.meeting_id,
    });
  }

  for (const row of db.prepare(`
    SELECT a.*, m.title_ar as meeting_title_ar, m.title_en as meeting_title_en
    FROM minutes_approval_log a LEFT JOIN meetings m ON m.id = a.meeting_id
    WHERE a.action IN ('approved', 'final_approved', 'circulated', 'revision_requested')
    ORDER BY a.created_at DESC LIMIT 300
  `).all()) {
    const ACTION_LABELS = {
      approved: { ar: 'اعتماد محضر الاجتماع', en: 'Meeting minutes approved' },
      final_approved: { ar: 'اعتماد نهائي لمحضر الاجتماع', en: 'Minutes given final approval' },
      circulated: { ar: 'تعميم محضر الاجتماع للمراجعة', en: 'Minutes circulated for review' },
      revision_requested: { ar: 'طلب تعديل على المحضر', en: 'Revision requested on minutes' },
    };
    const label = ACTION_LABELS[row.action];
    const meetingTitle = row.meeting_title_ar || row.meeting_title_en || `#${row.meeting_id}`;
    entries.push({
      type: 'minutes_' + row.action,
      category: 'governance',
      title_ar: label.ar, title_en: label.en,
      body_ar: meetingTitle, body_en: row.meeting_title_en || row.meeting_title_ar || `#${row.meeting_id}`,
      actor_name: row.actor_name, created_at: row.created_at,
      source_type: 'meeting', source_id: row.meeting_id,
    });
  }

  for (const row of db.prepare(`
    SELECT id, task_id, author_name, update_text, status_snapshot, created_at FROM task_updates
    ORDER BY created_at DESC LIMIT 300
  `).all()) {
    entries.push({
      type: 'task_update',
      category: 'tasks',
      title_ar: 'تحديث على مهمة تنفيذية', title_en: 'Executive task update',
      body_ar: row.update_text, body_en: row.update_text,
      actor_name: row.author_name, created_at: row.created_at,
      source_type: 'task', source_id: row.task_id,
    });
  }

  for (const row of db.prepare(`
    SELECT id, text_ar, text_en, owner_name_ar, owner_name_en, assigned_at
    FROM tasks WHERE assigned_at IS NOT NULL ORDER BY assigned_at DESC LIMIT 300
  `).all()) {
    entries.push({
      type: 'task_assigned',
      category: 'tasks',
      title_ar: 'تم تعيين مهمة تنفيذية', title_en: 'Executive task assigned',
      body_ar: `${row.text_ar || row.id} ← ${row.owner_name_ar || ''}`,
      body_en: `${row.text_en || row.text_ar || row.id} ← ${row.owner_name_en || row.owner_name_ar || ''}`,
      actor_name: null, created_at: row.assigned_at,
      source_type: 'task', source_id: row.id,
    });
  }

  for (const row of db.prepare(`
    SELECT id, text_ar, text_en, owner_name_ar, owner_name_en, updated_at
    FROM tasks WHERE status='done' ORDER BY updated_at DESC LIMIT 300
  `).all()) {
    entries.push({
      type: 'task_completed',
      category: 'tasks',
      title_ar: 'تم إنجاز مهمة تنفيذية', title_en: 'Executive task completed',
      body_ar: `${row.text_ar || row.id} — ${row.owner_name_ar || ''}`,
      body_en: `${row.text_en || row.text_ar || row.id} — ${row.owner_name_en || row.owner_name_ar || ''}`,
      actor_name: null, created_at: row.updated_at,
      source_type: 'task', source_id: row.id,
    });
  }

  for (const row of db.prepare(`SELECT id, title, created_at FROM resolutions ORDER BY created_at DESC LIMIT 200`).all()) {
    entries.push({
      type: 'resolution_created',
      category: 'governance',
      title_ar: 'إضافة قرار جديد', title_en: 'New resolution added',
      body_ar: row.title, body_en: row.title,
      actor_name: null, created_at: row.created_at,
      source_type: 'resolution', source_id: row.id,
    });
  }

  if (canSeeAdmin) {
    const AUDIT_ACTION_LABELS = {
      grant: { ar: 'منح صلاحية', en: 'Permission granted' },
      revoke: { ar: 'سحب صلاحية', en: 'Permission revoked' },
    };
    for (const row of db.prepare(`SELECT * FROM permission_audit_log ORDER BY created_at DESC LIMIT 200`).all()) {
      const label = AUDIT_ACTION_LABELS[row.action] || { ar: 'تعديل صلاحيات', en: 'Permissions updated' };
      entries.push({
        type: 'permission_' + row.action,
        category: 'governance',
        title_ar: label.ar, title_en: label.en,
        body_ar: row.role_key, body_en: row.role_key,
        actor_name: row.actor_name, created_at: row.created_at,
        source_type: 'role', source_id: row.role_id,
      });
    }
  }

  entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const filtered = q
    ? entries.filter((e) =>
        (e.title_ar || '').toLowerCase().includes(q) || (e.title_en || '').toLowerCase().includes(q) ||
        (e.body_ar || '').toLowerCase().includes(q) || (e.body_en || '').toLowerCase().includes(q) ||
        (e.actor_name || '').toLowerCase().includes(q))
    : entries;

  res.json({ activity: filtered.slice(0, limit) });
});

// ── User profile (self-service) ───────────────────────────────────────────────
router.get('/profile', auth, (req, res) => {
  const u = db.prepare('SELECT id, name_ar, name_en, email, role_id FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(u);
});

router.patch('/profile', auth, async (req, res) => {
  const { name_ar, name_en, email, current_password, new_password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  const bcrypt = require('bcryptjs');
  const updates = [];
  const vals = [];
  if (name_ar !== undefined) { updates.push('name_ar=?'); vals.push(name_ar.trim()); }
  if (name_en !== undefined) { updates.push('name_en=?'); vals.push(name_en.trim()); }
  if (email !== undefined && email.trim() !== u.email) {
    const taken = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email.trim(), u.id);
    if (taken) return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email already in use' });
    updates.push('email=?'); vals.push(email.trim());
  }
  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'CURRENT_PASSWORD_REQUIRED' });
    const ok = bcrypt.compareSync(current_password, u.password || '');
    if (!ok) return res.status(401).json({ error: 'WRONG_PASSWORD', message: 'Current password is incorrect' });
    if (new_password.length < 8) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    updates.push('password=?'); vals.push(bcrypt.hashSync(new_password, 10));
  }
  if (!updates.length) return res.json({ success: true });
  vals.push(u.id);
  db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

// ── Org settings ──────────────────────────────────────────────────────────────
const ORG_KEYS = ['org_name_ar','org_name_en','org_logo_url','default_reminder_mins','default_meeting_duration','default_lang'];

router.get('/settings/org', auth, requirePermission('admin.settings'), (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${ORG_KEYS.map(()=>'?').join(',')})`).all(...ORG_KEYS);
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

router.patch('/settings/org', auth, requirePermission('admin.settings'), (req, res) => {
  const allowed = new Set(ORG_KEYS);
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  const save = db.transaction((pairs) => { pairs.forEach(([k,v]) => stmt.run(k, v)); });
  const pairs = Object.entries(req.body).filter(([k]) => allowed.has(k)).map(([k,v]) => [k, String(v)]);
  if (!pairs.length) return res.json({ success: true });
  save(pairs);
  res.json({ success: true });
});

// ── Aggregated activity log ────────────────────────────────────────────────────
// Unions all audit / event tables and returns rows newest-first.
router.get('/activity-log', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
  try {
    const rows = db.prepare(`
      SELECT
        'reschedule'  AS source_type,
        srl.actor_name,
        srl.actor_role,
        s.title_ar    AS entity_ar,
        COALESCE(s.title_en, s.title_ar) AS entity_en,
        (srl.old_date || ' ' || srl.old_time || ' → ' || srl.new_date || ' ' || srl.new_time) AS detail,
        srl.reason,
        srl.created_at
      FROM schedule_reschedule_log srl
      LEFT JOIN schedule s ON s.id = srl.schedule_id

      UNION ALL

      SELECT
        'lifecycle'   AS source_type,
        mll.actor_name,
        NULL          AS actor_role,
        m.title_ar    AS entity_ar,
        COALESCE(m.title_en, m.title_ar) AS entity_en,
        COALESCE(mll.from_stage, '—') || ' → ' || mll.to_stage AS detail,
        mll.note      AS reason,
        mll.created_at
      FROM meeting_lifecycle_log mll
      LEFT JOIN meetings m ON m.id = mll.meeting_id

      UNION ALL

      SELECT
        'minutes'     AS source_type,
        mal.actor_name,
        mal.actor_role,
        m.title_ar    AS entity_ar,
        COALESCE(m.title_en, m.title_ar) AS entity_en,
        mal.action    AS detail,
        mal.comments  AS reason,
        mal.created_at
      FROM minutes_approval_log mal
      LEFT JOIN meetings m ON m.id = mal.meeting_id

      UNION ALL

      SELECT
        'permission'  AS source_type,
        pal.actor_name,
        NULL          AS actor_role,
        pal.role_key  AS entity_ar,
        pal.role_key  AS entity_en,
        pal.action    AS detail,
        NULL          AS reason,
        pal.created_at
      FROM permission_audit_log pal

      UNION ALL

      SELECT
        'event'       AS source_type,
        me.actor_name,
        NULL          AS actor_role,
        m.title_ar    AS entity_ar,
        COALESCE(m.title_en, m.title_ar) AS entity_en,
        me.event_type AS detail,
        me.new_value  AS reason,
        me.created_at
      FROM meeting_events me
      LEFT JOIN meetings m ON m.id = me.meeting_id
      WHERE me.source = 'user' OR me.event_type NOT IN ('heartbeat','ping')

      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Integration credentials ───────────────────────────────────────────────────
const ALLOWED_PROVIDERS = ['zoom','teams','google_meet'];
router.post('/settings/integration/:provider', auth, requirePermission('admin.settings'), (req, res) => {
  const { provider } = req.params;
  if (!ALLOWED_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'UNKNOWN_PROVIDER' });
  const creds = req.body || {};
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  const save = db.transaction(() => {
    Object.entries(creds).forEach(([k, v]) => {
      if (k && typeof v === 'string') stmt.run(`integration_${provider}_${k}`, v);
    });
    stmt.run(`integration_${provider}_configured`, '1');
  });
  save();
  res.json({ success: true });
});

router.get('/settings/integration/:provider', auth, requirePermission('admin.settings'), (req, res) => {
  const { provider } = req.params;
  if (!ALLOWED_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'UNKNOWN_PROVIDER' });
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE ?`).all(`integration_${provider}_%`);
  const out = {};
  rows.forEach(r => {
    const shortKey = r.key.replace(`integration_${provider}_`, '');
    out[shortKey] = r.value;
  });
  res.json(out);
});

module.exports = router;
