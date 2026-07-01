const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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

    const dateStr = new Date().toLocaleDateString(isAr ? 'ar-SA' : 'en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // Header block
    doc.font(boldFont).fontSize(8.5).fillColor('#666666')
      .text('Ameen Executive Secretary · أمين للاجتماعات التنفيذية', { align: textAlign });
    doc.moveDown(0.3);
    doc.font(boldFont).fontSize(17).fillColor('#1a1a2e')
      .text(title, { align: textAlign });
    doc.moveDown(0.2);
    doc.font(mainFont).fontSize(9.5).fillColor('#888888')
      .text(dateStr, { align: textAlign });
    doc.moveDown(0.5);
    doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
      .strokeColor('#1a1a2e').lineWidth(2).stroke();
    doc.moveDown(1);

    // Single content block
    if (content) {
      doc.font(mainFont).fontSize(11).fillColor('#222222')
        .text(content, { align: textAlign, lineGap: 4 });
    }

    // Multi-section (board pack)
    if (sections) {
      for (const s of sections) {
        if (!s.text && !(s.items && s.items.length)) continue;
        doc.moveDown(0.9);
        doc.font(boldFont).fontSize(12.5).fillColor('#1a1a2e')
          .text(s.title, { align: textAlign });
        doc.moveDown(0.2);
        doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
          .strokeColor('#cccccc').lineWidth(0.8).stroke();
        doc.moveDown(0.5);
        if (s.text) {
          doc.font(mainFont).fontSize(10.5).fillColor('#333333')
            .text(s.text, { align: textAlign, lineGap: 3 });
        }
        if (s.items) {
          s.items.forEach((item, i) => {
            doc.font(mainFont).fontSize(10.5).fillColor('#333333')
              .text(`${i + 1}.  ${item}`, { align: textAlign, lineGap: 2, indent: 10 });
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

// ── Ensure escalation columns exist (safe, idempotent) ───────────────────────
;[
  'escalated_at DATETIME',
  'escalated_to INTEGER',
  'escalated_to_name TEXT',
].forEach(col => {
  try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); } catch (_) {}
});
const { requireRole } = require('../middleware/auth');
const { sendEmail } = require('../utils/replitmail');
const notify = require('../utils/notify');
const { callClaude, setSessionKey } = require('../utils/claude');
const { processMeeting, findConflicts } = require('../services/pipeline');
const { readRecent } = require('../utils/ailog');
const { isValidEmail, isValidPhone, splitRecipients, partition } = require('../utils/validate');

// ── Meeting lifecycle state machine ───────────────────────────────────────────
// created → invited → scheduled → recording → uploaded → transcript_generated →
// ai_minutes_generated → secretary_review → chairman_approval → board_approval →
// archived. Every transition is persisted to meeting_lifecycle_log so the UI can
// render a real, auditable timeline instead of a decorative status label.
const LIFECYCLE_STAGES = [
  'created', 'invited', 'scheduled', 'recording', 'uploaded',
  'transcript_generated', 'ai_minutes_generated', 'secretary_review',
  'chairman_approval', 'board_approval', 'archived',
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
// the one legitimate backward loop in the process: chairman_approval →
// secretary_review when a revision is requested. No-ops (returns the current
// stage, does not log) if the meeting is already at or past `toStage`.
function transitionMeeting(meetingId, toStage, userId, note) {
  if (!LIFECYCLE_STAGES.includes(toStage)) throw new Error(`Unknown lifecycle stage: ${toStage}`);
  const meeting = db.prepare('SELECT lifecycle_stage FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return null;
  const fromStage = meeting.lifecycle_stage || 'created';
  const fromIdx = LIFECYCLE_STAGES.indexOf(fromStage);
  const toIdx = LIFECYCLE_STAGES.indexOf(toStage);
  const isRevisionLoop = fromStage === 'chairman_approval' && toStage === 'secretary_review';
  if (toIdx <= fromIdx && !isRevisionLoop) return fromStage;
  db.prepare('UPDATE meetings SET lifecycle_stage=?, lifecycle_updated_at=CURRENT_TIMESTAMP WHERE id=?').run(toStage, meetingId);
  const actor = resolveActor(userId);
  db.prepare(
    `INSERT INTO meeting_lifecycle_log (meeting_id, from_stage, to_stage, actor_id, actor_name, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(meetingId, fromStage, toStage, userId || null, actor.name, note || null);
  return toStage;
}

// ── File upload setup (multer + extractors) ──────────────────────────────────
const multer = require('multer');
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const _uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage: _uploadStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── Recording storage (audio/video files up to 500 MB) ────────────────────────
const RECORDINGS_DIR = path.join(__dirname, '../../data/recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const _recStorage = multer.diskStorage({
  destination: RECORDINGS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.webm';
    cb(null, `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const uploadRec = multer({
  storage: _recStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.webm', '.mp4', '.mp3', '.wav', '.ogg', '.m4a', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase() || '.webm';
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
router.get('/members', auth, (req, res) => {
  const members = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, created_at FROM users ORDER BY name_ar').all();
  res.json(members);
});

const VALID_SYSTEM_ROLES = ['Admin','CEO','Board Member','Committee Member','Executive','Manager','Employee','Observer'];

router.post('/members', auth, requireRole('Admin'), (req, res) => {
  const { name_ar, name_en, email, role_ar, role_en, system_role } = req.body;
  if (!name_ar || !email) return res.status(400).json({ error: 'name_ar and email are required' });
  if (system_role && !VALID_SYSTEM_ROLES.includes(system_role)) return res.status(400).json({ error: 'Invalid system_role' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('ameen2026', 10);
  try {
    const row = db.prepare(`
      INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en, system_role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name_ar, name_en || name_ar, email, hash, role_ar || 'عضو', role_en || 'Member', system_role || 'Employee');
    const member = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, created_at FROM users WHERE id=?').get(row.lastInsertRowid);
    res.json(member);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/members/:id', auth, requireRole('Admin'), (req, res) => {
  const { name_ar, name_en, email, role_ar, role_en } = req.body;
  const member = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  try {
    db.prepare(`
      UPDATE users SET
        name_ar=COALESCE(?,name_ar),
        name_en=COALESCE(?,name_en),
        email=COALESCE(?,email),
        role_ar=COALESCE(?,role_ar),
        role_en=COALESCE(?,role_en)
      WHERE id=?
    `).run(name_ar, name_en, email, role_ar, role_en, req.params.id);
    res.json(db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, system_role, created_at FROM users WHERE id=?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: e.message });
  }
});

// ── System Role (RBAC) ────────────────────────────────────────────────────────
router.patch('/members/:id/role', auth, requireRole('Admin'), (req, res) => {
  const VALID_ROLES = ['Admin','CEO','Board Member','Committee Member','Executive','Manager','Employee','Observer'];
  const { system_role } = req.body;
  if (!VALID_ROLES.includes(system_role)) return res.status(400).json({ error: 'Invalid system_role' });
  const member = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET system_role=? WHERE id=?').run(system_role, req.params.id);
  res.json({ success: true, system_role });
});

// ── POST /api/members/:id/reset-password ─────────────────────────────────────
router.post('/members/:id/reset-password', auth, requireRole('Admin'), (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const member = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(require('bcryptjs').hashSync(newPassword, 10), req.params.id);
  res.json({ success: true });
});

router.delete('/members/:id', auth, requireRole('Admin'), (req, res) => {
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
      rv.name_ar as rec_verifier_ar, rv.name_en as rec_verifier_en
    FROM meetings m
    LEFT JOIN users u  ON m.recorded_by         = u.id
    LEFT JOIN users rv ON m.recording_verified_by = rv.id
    LEFT JOIN boards b ON m.board_id = b.id
    LEFT JOIN committees c ON m.committee_id = c.id
    ORDER BY m.meeting_date DESC
  `).all();
  res.json(meetings);
});

router.get('/meetings/:id', auth, (req, res) => {
  const m = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      rv.name_ar as rec_verifier_ar, rv.name_en as rec_verifier_en
    FROM meetings m
    LEFT JOIN users u  ON m.recorded_by          = u.id
    LEFT JOIN users rv ON m.recording_verified_by = rv.id
    LEFT JOIN boards b ON m.board_id = b.id
    LEFT JOIN committees c ON m.committee_id = c.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

router.post('/meetings', auth, (req, res) => {
  const { title_ar, title_en, transcript, duration, meeting_type } = req.body;
  const row = db.prepare(`
    INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, meeting_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title_ar, title_en || title_ar, transcript || '', duration || 0, req.user.id, meeting_type || '');
  const actor = resolveActor(req.user.id);
  db.prepare(
    `INSERT INTO meeting_lifecycle_log (meeting_id, from_stage, to_stage, actor_id, actor_name, note)
     VALUES (?, NULL, 'created', ?, ?, 'Meeting created')`
  ).run(row.lastInsertRowid, req.user.id, actor.name);
  res.json({ id: row.lastInsertRowid });
});

router.patch('/meetings/:id', auth, (req, res) => {
  const { transcript, duration, title_ar, title_en, meeting_type } = req.body;
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const newTitleAr = title_ar !== undefined ? title_ar : meeting.title_ar;
  const newTitleEn = title_en !== undefined ? (title_en || title_ar || meeting.title_en) : meeting.title_en;
  const newTranscript = transcript !== undefined ? transcript : meeting.transcript;
  const newDuration = duration !== undefined ? duration : meeting.duration;
  const newMeetingType = meeting_type !== undefined ? meeting_type : meeting.meeting_type;

  db.transaction(() => {
    db.prepare('UPDATE meetings SET title_ar=?, title_en=?, transcript=?, duration=?, meeting_type=? WHERE id=?')
      .run(newTitleAr, newTitleEn, newTranscript, newDuration, newMeetingType, req.params.id);

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

// ── Hard-delete a meeting and all its dependents ───────────────────────────────
router.delete('/meetings/:id', auth, (req, res) => {
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
router.post('/meetings/:id/recording', auth, uploadRec.single('recording'), (req, res) => {
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
router.patch('/meetings/:id/recording/approve', auth, (req, res) => {
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
router.delete('/meetings/:id/recording', auth, (req, res) => {
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
router.post('/meetings/:id/recording/start', auth, (req, res) => {
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
router.post('/meetings/:id/recording/stop', auth, (req, res) => {
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

// ── File Upload ────────────────────────────────────────────────────────────────
router.post('/meetings/:id/upload', auth, upload.single('file'), async (req, res) => {
 try {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported format (PDF, DOCX, XLSX, PPTX, TXT only)' });
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Meeting not found' });
  }
  let aiSummary = '', aiKeyPoints = '[]', docClassification = '';
  try {
    const text = await extractFileText(req.file.path, req.file.originalname);
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
  const uploaderName = db.prepare('SELECT name_ar FROM users WHERE id=?').get(req.user.id)?.name_ar || '';
  const row = db.prepare(`
    INSERT INTO meeting_documents (meeting_id, title, doc_type, description, uploaded_by, upload_date, status, is_mock, created_by, file_path, file_size, file_type, ai_summary, ai_key_points, doc_classification)
    VALUES (?,?,?,?,?,date('now'),'uploaded',0,?,?,?,?,?,?,?)
  `).run(
    meeting.id,
    req.file.originalname,
    path.extname(req.file.originalname).slice(1).toUpperCase() || 'DOC',
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
  res.json({ success: true, id: row.lastInsertRowid, filename: req.file.filename, original: req.file.originalname, summary: aiSummary, classification: docClassification });
 } catch (e) {
  console.error('✗ /meetings/:id/upload failed:', e.message);
  try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
  res.status(500).json({ error: e.message });
 }
});

// ── Documents for a specific meeting ──────────────────────────────────────────
router.get('/meetings/:id/documents', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM meeting_documents WHERE meeting_id=? AND file_path IS NOT NULL AND file_path!='' ORDER BY id DESC").all(req.params.id));
});

// ── Document summary by ID ─────────────────────────────────────────────────────
router.get('/documents/:id/summary', auth, (req, res) => {
  const doc = db.prepare('SELECT id, title, doc_type, doc_classification, ai_summary, ai_key_points, upload_date, uploaded_by, file_path, file_size, meeting_id FROM meeting_documents WHERE id=?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  let key_points = [];
  try { key_points = JSON.parse(doc.ai_key_points || '[]'); } catch {}
  res.json({ ...doc, key_points });
});

// ── Document Library (all uploaded files) ─────────────────────────────────────
router.get('/documents/library', auth, (req, res) => {
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

// ── Delete an uploaded document ────────────────────────────────────────────────
router.delete('/meeting-documents/:id', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.file_path) { try { fs.unlinkSync(path.join(UPLOADS_DIR, doc.file_path)); } catch {} }
  db.prepare('DELETE FROM meeting_documents WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── AI: Process Meeting ───────────────────────────────────────────────────────
router.post('/meetings/:id/process', auth, async (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  try {
    const out = await processMeeting({ meetingId: meeting.id, userId: req.user.id });
    transitionMeeting(meeting.id, 'ai_minutes_generated', req.user.id, 'AI minutes generated');
    res.json({ success: true, ...out });
  } catch (e) {
    // NO_API_KEY (or any AI-side failure) is an environment/configuration
    // condition, not a server bug — 422 so the frontend can show a clear
    // "AI unavailable" message instead of a generic crash. The pipeline
    // deliberately never fabricates and persists fake minutes/tasks on
    // failure (see services/pipeline.js), so there is no demo fallback here.
    res.status(422).json({ error: e.message, code: /NO_API_KEY/i.test(e.message) ? 'AI_UNAVAILABLE' : 'PROCESS_FAILED' });
  }
});

// ── Deep Log Debugger: recent AI pipeline trace (what the AI "saw" + did) ──────
router.get('/ai/debug-log', auth, (req, res) => {
  res.json({ entries: readRecent(Number(req.query.limit) || 200) });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/tasks', auth, (req, res) => {
  // Auto-mark overdue: any task with a past due_date that isn't done/cancelled
  const today = new Date().toISOString().substring(0, 10);
  db.prepare(`
    UPDATE tasks SET status='overdue', updated_at=CURRENT_TIMESTAMP
    WHERE due_date != '' AND due_date IS NOT NULL AND due_date < ?
      AND status NOT IN ('done', 'cancelled', 'overdue')
  `).run(today);

  const user = db.prepare('SELECT system_role FROM users WHERE id=?').get(req.user.id);
  const role = (user && user.system_role) || 'Admin';
  const ORDER = "ORDER BY CASE status WHEN 'overdue' THEN 1 WHEN 'inprogress' THEN 2 WHEN 'new' THEN 3 ELSE 4 END, due_date ASC";
  const UPDATE_COLS = `,
      (SELECT COUNT(*) FROM task_updates WHERE task_id=t.id) AS update_count,
      (SELECT update_text FROM task_updates WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) AS latest_update_text,
      (SELECT author_name FROM task_updates WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) AS latest_update_author`;
  const tasks = (role === 'Employee')
    ? db.prepare(`SELECT t.* ${UPDATE_COLS} FROM tasks t WHERE owner_id=? ${ORDER}`).all(req.user.id)
    : db.prepare(`SELECT t.* ${UPDATE_COLS} FROM tasks t ${ORDER}`).all();
  res.json(tasks);
});

router.post('/tasks', auth, (req, res) => {
  const { text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, source_meeting_id, source_meeting_title_ar, source_meeting_title_en } = req.body;
  if (!text_ar) return res.status(400).json({ error: 'text_ar required' });
  let oNameAr = owner_name_ar || '';
  let oNameEn = owner_name_en || '';
  if (owner_id) {
    const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(owner_id);
    if (u) { oNameAr = u.name_ar; oNameEn = u.name_en; }
  }
  const row = db.prepare(`
    INSERT INTO tasks (text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(text_ar, text_en || text_ar, owner_id || null, oNameAr, oNameEn, due_date || '', priority || 'normal', source_meeting_id || null, source_meeting_title_ar || '', source_meeting_title_en || '', req.user.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/tasks/:id', auth, (req, res) => {
  const { status, notes, due_date, priority, text_ar, text_en, owner_id, owner_name_ar, owner_name_en } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  // Resolve a freshly-assigned owner (by id) to its bilingual names, so editing
  // the owner keeps owner_name_ar/en in sync with owner_id.
  let oId = (owner_id === undefined) ? undefined : (owner_id || null);
  let oNameAr = owner_name_ar;
  let oNameEn = owner_name_en;
  if (owner_id) {
    const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(owner_id);
    if (u) { oNameAr = u.name_ar; oNameEn = u.name_en; }
  }
  db.prepare(`UPDATE tasks SET
      status=COALESCE(?,status), notes=COALESCE(?,notes), due_date=COALESCE(?,due_date), priority=COALESCE(?,priority),
      text_ar=COALESCE(?,text_ar), text_en=COALESCE(?,text_en),
      owner_id=COALESCE(?,owner_id), owner_name_ar=COALESCE(?,owner_name_ar), owner_name_en=COALESCE(?,owner_name_en),
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status, notes, due_date, priority, text_ar, text_en, oId, oNameAr, oNameEn, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id));
});

router.delete('/tasks/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
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

  // Send notification to escalation target (best-effort)
  const taskTitle = task.text_en || task.text_ar || `Task #${task.id}`;
  const subject = `Task Escalated to You: ${taskTitle}`;
  const body = `${actorName} has escalated the following task to you:\n\n"${taskTitle}"\n\n${comments ? `Note: ${comments}\n\n` : ''}Please review and take action.`;
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

router.patch('/decisions/:id', auth, (req, res) => {
  db.prepare('UPDATE decisions SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ success: true });
});

router.delete('/decisions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM decisions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Schedule ─────────────────────────────────────────────────────────────────
router.get('/schedule', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, u.name_ar as creator_ar, u.name_en as creator_en,
      b.name_ar as board_name_ar, b.name_en as board_name_en,
      c.name_ar as committee_name_ar, c.name_en as committee_name_en,
      (SELECT COUNT(*) FROM meeting_documents WHERE schedule_id=s.id) as doc_count
    FROM schedule s
    LEFT JOIN users u ON s.created_by=u.id
    LEFT JOIN boards b ON s.board_id=b.id
    LEFT JOIN committees c ON s.committee_id=c.id
    ORDER BY meeting_date ASC, meeting_time ASC
  `).all());
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

router.post('/schedule', auth, (req, res) => {
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id, prev_meeting_id, recurrence, force, meeting_provider, meeting_join_url, meeting_id_external } = req.body;
  if (!title_ar || !meeting_date || !meeting_time) return res.status(400).json({ error: 'Required fields missing' });
  if (!/^\d{4}-\d{2}-\d{2}/.test(meeting_date) || isNaN(new Date(meeting_date).getTime())) {
    return res.status(400).json({ error: 'meeting_date must be a valid YYYY-MM-DD date' });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d/.test(meeting_time)) {
    return res.status(400).json({ error: 'meeting_time must be in HH:MM format' });
  }
  const chan = ['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : 'email';
  const rec = VALID_RECURRENCES.includes(recurrence) ? recurrence : 'none';
  const conflicts = findConflicts({ date: meeting_date, time: meeting_time, durationMins: duration_mins || 60 });
  if (conflicts.length && !force) return res.status(409).json(conflictPayload(conflicts));
  const groupId = rec !== 'none' ? crypto.randomUUID() : null;
  const prov = ['zoom','teams','google_meet'].includes(meeting_provider) ? meeting_provider : 'physical';
  const provPlatform = { zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet' }[prov] || (platform || 'قاعة الاجتماعات');
  const insertSched = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, status, created_by, meeting_type, board_id, committee_id, prev_meeting_id, recurrence, recurrence_group_id, meeting_provider, meeting_join_url, meeting_id_external)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const dur = duration_mins || 60;
  let row;
  db.transaction(() => {
    row = insertSched.run(title_ar, title_en || title_ar, meeting_date, meeting_time, dur, provPlatform, attendees || '', agenda_ar || '', agenda_en || '', chan, req.user.id, meeting_type || '', board_id || null, committee_id || null, prev_meeting_id || null, rec, groupId, prov, meeting_join_url || '', meeting_id_external || '');
    if (rec !== 'none') {
      for (let i = 1; i <= 3; i++) {
        const nextDate = addNPeriods(meeting_date, rec, i);
        insertSched.run(title_ar, title_en || title_ar, nextDate, meeting_time, dur, provPlatform, attendees || '', agenda_ar || '', agenda_en || '', chan, req.user.id, meeting_type || '', board_id || null, committee_id || null, null, rec, groupId, prov, meeting_join_url || '', meeting_id_external || '');
      }
    }
  })();
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.lastInsertRowid));
});

// ── Confirm a Draft meeting (finalize): runs the conflict check, then arms the
// 15-minute reminder by clearing reminder_sent. Drafts are created automatically
// from transcript scheduling intents. ───────────────────────────────────────────
router.patch('/schedule/:id/confirm', auth, (req, res) => {
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

router.post('/schedule/:id/remind', auth, async (req, res) => {
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

router.patch('/schedule/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id, meeting_provider, meeting_join_url, meeting_id_external, recording_status, recording_provider, recording_url, transcript_provider } = req.body;
  if (meeting_date !== undefined && (!/^\d{4}-\d{2}-\d{2}/.test(meeting_date) || isNaN(new Date(meeting_date).getTime()))) {
    return res.status(400).json({ error: 'meeting_date must be a valid YYYY-MM-DD date' });
  }
  if (meeting_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d/.test(meeting_time)) {
    return res.status(400).json({ error: 'meeting_time must be in HH:MM format' });
  }
  const chan = reminder_channel !== undefined
    ? (['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : row.reminder_channel)
    : row.reminder_channel;
  const updProv = meeting_provider !== undefined && ['physical','zoom','teams','google_meet'].includes(meeting_provider) ? meeting_provider : null;
  const updPlatform = updProv ? ({ zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet' }[updProv] || 'قاعة الاجتماعات') : platform;
  db.prepare(`UPDATE schedule SET
      title_ar=COALESCE(?,title_ar), title_en=COALESCE(?,title_en),
      meeting_date=COALESCE(?,meeting_date), meeting_time=COALESCE(?,meeting_time),
      duration_mins=COALESCE(?,duration_mins), platform=COALESCE(?,platform),
      attendees=COALESCE(?,attendees), agenda_ar=COALESCE(?,agenda_ar), agenda_en=COALESCE(?,agenda_en),
      reminder_channel=?, meeting_type=COALESCE(?,meeting_type),
      board_id=COALESCE(?,board_id), committee_id=COALESCE(?,committee_id),
      meeting_provider=COALESCE(?,meeting_provider), meeting_join_url=COALESCE(?,meeting_join_url),
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
      updProv,
      meeting_join_url !== undefined ? (meeting_join_url || '') : null,
      meeting_id_external !== undefined ? (meeting_id_external || '') : null,
      recording_status !== undefined ? (recording_status || '') : null,
      recording_provider !== undefined ? (recording_provider || '') : null,
      recording_url !== undefined ? (recording_url || '') : null,
      transcript_provider !== undefined ? (transcript_provider || '') : null,
      req.params.id
    );
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id));
});

router.delete('/schedule/:id/series', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.recurrence_group_id) {
    db.prepare(`DELETE FROM schedule WHERE recurrence_group_id=? AND meeting_date >= ?`).run(row.recurrence_group_id, row.meeting_date);
  } else {
    db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  }
  res.json({ success: true });
});

router.delete('/schedule/:id', auth, (req, res) => {
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
router.post('/schedule/from-template/:id', auth, (req, res) => {
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
router.post('/ai/chat', auth, async (req, res) => {
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
router.post('/ai/document', auth, requirePro, async (req, res) => {
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
  const completion = tasks_total > 0 ? Math.round((tasks_done / tasks_total) * 100) : 0;
  res.json({ meetings, tasks_total, tasks_open, tasks_overdue, tasks_done, decisions, users, schedule, completion });
});

// ── Document History ───────────────────────────────────────────────────────
router.get('/documents', auth, (req, res) => {
  res.json(db.prepare('SELECT d.*, u.name_ar as author_ar, u.name_en as author_en FROM documents d LEFT JOIN users u ON d.created_by=u.id ORDER BY d.created_at DESC LIMIT 20').all());
});

// ── Subscription Plan ──────────────────────────────────────────────────────
router.get('/plan', auth, (req, res) => {
  res.json({ plan: getPlan() });
});
router.patch('/plan', auth, requireRole('Admin','CEO'), (req, res) => {
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('plan', plan);
  res.json({ plan });
});

// ── Live AI extraction during recording (free) ─────────────────────────────
// Receives a transcript chunk + known member names; returns tasks (with owners)
// and decisions detected so far. Lightweight + fast.
router.post('/live-extract', auth, async (req, res) => {
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
  }
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id ASC').all(meetingId));
});

// ── Share meeting outcomes to selected attendees (PRO) ─────────────────────
router.post('/meetings/:id/share', auth, requirePro, async (req, res) => {
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
    const subject = `محضر ونتائج: ${meeting.title_ar} | Minutes & Actions: ${meeting.title_en || meeting.title_ar}`;
    // The full minutes / transcript text is included so recipients get the
    // complete record (boss requirement: "send the full text").
    const fullMinutes = meeting.ai_minutes_ar || meeting.ai_minutes_en || '';
    const fullTranscript = meeting.transcript || '';
    const text =
      `مرحباً ${a.name}،\n\nتمت مشاركة محضر ونتائج اجتماع "${meeting.title_ar}".\n\n` +
      `الملخص:\n${meeting.ai_summary_ar || '-'}\n\n` +
      (decisions.length ? `القرارات:\n${decisions.map(d => '• ' + d.text_ar).join('\n')}\n\n` : '') +
      (taskLines ? `المهام:\n${taskLines}\n\n` : '') +
      (fullMinutes ? `المحضر الكامل:\n${fullMinutes}\n\n` : '') +
      (fullTranscript ? `النص الكامل للاجتماع:\n${fullTranscript}\n\n` : '') +
      `لتأكيد مهامك وإضافة ملاحظاتك، افتح الرابط:\n${link}\n\n— أمين السكرتير`;
    const html =
      `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">` +
      `<h2 style="color:#0e7490">محضر ونتائج الاجتماع</h2>` +
      `<p>مرحباً <b>${esc(a.name)}</b>،</p>` +
      `<p>تمت مشاركة محضر ونتائج اجتماع «${esc(meeting.title_ar)}».</p>` +
      `<h3>الملخص</h3><p>${esc(meeting.ai_summary_ar || '-').replace(/\n/g, '<br>')}</p>` +
      (decisions.length ? `<h3>القرارات</h3><ul>${decisions.map(d => '<li>' + esc(d.text_ar) + '</li>').join('')}</ul>` : '') +
      ((mine.length ? mine : tasks).length ? `<h3>المهام</h3><ul>${(mine.length ? mine : tasks).map(t => '<li>' + esc(t.text_ar) + '</li>').join('')}</ul>` : '') +
      (fullMinutes ? `<h3>المحضر الكامل</h3><div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;font-size:13px">${esc(fullMinutes)}</div>` : '') +
      (fullTranscript ? `<h3>النص الكامل للاجتماع</h3><div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;font-size:13px">${esc(fullTranscript)}</div>` : '') +
      `<p><a href="${link}" style="background:#0e7490;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">تأكيد المهام وإضافة ملاحظات</a></p>` +
      `<p style="color:#888;font-size:12px">— أمين السكرتير</p></div>`;
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
router.post('/documents/share', auth, requirePro, async (req, res) => {
 try {
  const content = (req.body.content || '').toString().trim();
  const title = (req.body.title || 'تقرير / Report').toString().trim();
  if (!content) return res.status(400).json({ error: 'لا يوجد محتوى للمشاركة / No content to share' });
  const members = db.prepare("SELECT name_ar, name_en, email FROM users WHERE email IS NOT NULL AND email != ''").all();
  if (!members.length) return res.status(400).json({ error: 'لا يوجد أعضاء فريق بعناوين بريد / No team members with emails' });
  const subject = `تقرير من أمين: ${title}`;
  const results = [];
  for (const mem of members) {
    const text = `مرحباً ${mem.name_ar || mem.name_en || ''}،\n\nتمت مشاركة التقرير التالي معك:\n\n${content}\n\n— أمين السكرتير`;
    const html = `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">` +
      `<h2 style="color:#0e7490">${esc(title)}</h2>` +
      `<p>مرحباً <b>${esc(mem.name_ar || mem.name_en || '')}</b>،</p>` +
      `<div style="white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:14px;font-size:13px;line-height:1.7">${esc(content)}</div>` +
      `<p style="color:#888;font-size:12px">— أمين السكرتير</p></div>`;
    let out;
    try { out = await notify.sendEmail({ to: mem.email, subject, text, html }); }
    catch (e) { out = { error: e.message }; }
    results.push({ name: mem.name_ar || mem.name_en, email: mem.email, ...out });
  }
  res.json({ success: true, shared: results.length, results });
 } catch (e) {
  console.error('✗ /documents/share failed:', e.message);
  res.status(500).json({ error: e.message });
 }
});

// ── Executive Weekly Report ───────────────────────────────────────────────────
router.get('/reports/executive-weekly', auth, (req, res) => {
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
router.post('/reports/pdf', auth, async (req, res) => {
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

// ── Board Pack — merged PDF of minutes + action plan + decision log ───────────
router.post('/meetings/:id/board-pack', auth, async (req, res) => {
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

  const minutes = isAr ? meeting.ai_minutes_ar : (meeting.ai_minutes_en || meeting.ai_minutes_ar);
  if (minutes) sections.push({ title: isAr ? 'محضر الاجتماع' : 'Meeting Minutes', text: minutes });

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

// POST /api/meetings/:id/circulate
router.post('/meetings/:id/circulate', (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='circulated', circulated_at=CURRENT_TIMESTAMP, circulated_by=?, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'circulated', req.user, comments, version);
  transitionMeeting(meeting.id, 'secretary_review', req.user && req.user.id, 'Minutes circulated for review');
  res.json({ success: true, minutes_status: 'circulated' });
});

// POST /api/meetings/:id/approve
router.post('/meetings/:id/approve', (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'approved', req.user, comments, version);
  transitionMeeting(meeting.id, 'chairman_approval', req.user && req.user.id, 'Minutes approved by chairman');
  res.json({ success: true, minutes_status: 'approved' });
});

// POST /api/meetings/:id/request-revision
router.post('/meetings/:id/request-revision', (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='revision_requested', minutes_version=?, approval_comments=? WHERE id=?`
  ).run(version + 1, comments, meeting.id);
  logApprovalAction(meeting.id, 'revision_requested', req.user, comments, version);
  transitionMeeting(meeting.id, 'secretary_review', req.user && req.user.id, 'Revision requested — back to secretary review');
  res.json({ success: true, minutes_status: 'revision_requested', new_version: version + 1 });
});

// POST /api/meetings/:id/final-approve
router.post('/meetings/:id/final-approve', (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  const version = (meeting.minutes_version || 1);
  db.prepare(
    `UPDATE meetings SET minutes_status='final_approved', final_approved_by=?, final_approved_at=CURRENT_TIMESTAMP, approval_comments=? WHERE id=?`
  ).run(req.user ? req.user.id : null, comments, meeting.id);
  logApprovalAction(meeting.id, 'final_approved', req.user, comments, version);
  transitionMeeting(meeting.id, 'board_approval', req.user && req.user.id, 'Minutes given final board approval');
  res.json({ success: true, minutes_status: 'final_approved' });
});

// POST /api/meetings/:id/archive — final step of the lifecycle, only reachable
// once the board has given final approval.
router.post('/meetings/:id/archive', (req, res) => {
  const meeting = db.prepare('SELECT id, lifecycle_stage FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  if (meeting.lifecycle_stage === 'archived') return res.json({ success: true, lifecycle_stage: 'archived' });
  if (meeting.lifecycle_stage !== 'board_approval') {
    return res.status(400).json({ error: 'Meeting must reach Board Approval before it can be archived' });
  }
  const comments = (req.body.comments || '').toString().slice(0, 2000) || null;
  transitionMeeting(meeting.id, 'archived', req.user && req.user.id, comments || 'Meeting archived');
  res.json({ success: true, lifecycle_stage: 'archived' });
});

// GET /api/meetings/:id/approval-log
router.get('/meetings/:id/approval-log', (req, res) => {
  const meeting = db.prepare('SELECT id FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const log = db.prepare(
    `SELECT * FROM minutes_approval_log WHERE meeting_id=? ORDER BY created_at ASC`
  ).all(meeting.id);
  res.json({ success: true, log });
});

// GET /api/meetings/:id/lifecycle — current stage + full transition history
router.get('/meetings/:id/lifecycle', (req, res) => {
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

module.exports = router;
