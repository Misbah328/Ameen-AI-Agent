const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/auth');
const { sendEmail } = require('../utils/replitmail');
const notify = require('../utils/notify');
const { callClaude, setSessionKey } = require('../utils/claude');
const { processMeeting, findConflicts } = require('../services/pipeline');
const { readRecent } = require('../utils/ailog');
const { isValidEmail, isValidPhone, splitRecipients, partition } = require('../utils/validate');

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
      c.name_ar as committee_name_ar, c.name_en as committee_name_en
    FROM meetings m
    LEFT JOIN users u ON m.recorded_by = u.id
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
      c.name_ar as committee_name_ar, c.name_en as committee_name_en
    FROM meetings m
    LEFT JOIN users u ON m.recorded_by = u.id
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

  db.prepare('UPDATE meetings SET title_ar=?, title_en=?, transcript=?, duration=?, meeting_type=? WHERE id=?')
    .run(newTitleAr, newTitleEn, newTranscript, newDuration, newMeetingType, req.params.id);

  // Keep denormalized titles in tasks & decisions in sync
  if (title_ar !== undefined || title_en !== undefined) {
    db.prepare('UPDATE tasks SET source_meeting_title_ar=?, source_meeting_title_en=? WHERE source_meeting_id=?')
      .run(newTitleAr, newTitleEn, req.params.id);
    db.prepare('UPDATE decisions SET meeting_title_ar=?, meeting_title_en=? WHERE meeting_id=?')
      .run(newTitleAr, newTitleEn, req.params.id);
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

// ── File Upload ────────────────────────────────────────────────────────────────
router.post('/meetings/:id/upload', auth, upload.single('file'), async (req, res) => {
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
    res.json({ success: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deep Log Debugger: recent AI pipeline trace (what the AI "saw" + did) ──────
router.get('/ai/debug-log', auth, (req, res) => {
  res.json({ entries: readRecent(Number(req.query.limit) || 200) });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/tasks', auth, (req, res) => {
  const user = db.prepare('SELECT system_role FROM users WHERE id=?').get(req.user.id);
  const role = (user && user.system_role) || 'Admin';
  const ORDER = "ORDER BY CASE status WHEN 'overdue' THEN 1 WHEN 'inprogress' THEN 2 WHEN 'new' THEN 3 ELSE 4 END, due_date ASC";
  const tasks = (role === 'Employee')
    ? db.prepare(`SELECT * FROM tasks WHERE owner_id=? ${ORDER}`).all(req.user.id)
    : db.prepare(`SELECT * FROM tasks ${ORDER}`).all();
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

router.post('/schedule', auth, (req, res) => {
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id, prev_meeting_id, force } = req.body;
  if (!title_ar || !meeting_date || !meeting_time) return res.status(400).json({ error: 'Required fields missing' });
  const chan = ['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : 'email';
  const conflicts = findConflicts({ date: meeting_date, time: meeting_time, durationMins: duration_mins || 60 });
  if (conflicts.length && !force) return res.status(409).json(conflictPayload(conflicts));
  const row = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, status, created_by, meeting_type, board_id, committee_id, prev_meeting_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
  `).run(title_ar, title_en || title_ar, meeting_date, meeting_time, duration_mins || 60, platform || 'قاعة الاجتماعات', attendees || '', agenda_ar || '', agenda_en || '', chan, req.user.id, meeting_type || '', board_id || null, committee_id || null, prev_meeting_id || null);
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

router.patch('/schedule/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, meeting_type, board_id, committee_id } = req.body;
  const chan = reminder_channel !== undefined
    ? (['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : row.reminder_channel)
    : row.reminder_channel;
  db.prepare(`UPDATE schedule SET
      title_ar=COALESCE(?,title_ar), title_en=COALESCE(?,title_en),
      meeting_date=COALESCE(?,meeting_date), meeting_time=COALESCE(?,meeting_time),
      duration_mins=COALESCE(?,duration_mins), platform=COALESCE(?,platform),
      attendees=COALESCE(?,attendees), agenda_ar=COALESCE(?,agenda_ar), agenda_en=COALESCE(?,agenda_en),
      reminder_channel=?, meeting_type=COALESCE(?,meeting_type),
      board_id=COALESCE(?,board_id), committee_id=COALESCE(?,committee_id), reminder_sent=0
    WHERE id=?`)
    .run(
      title_ar, title_en !== undefined ? (title_en || title_ar) : null,
      meeting_date, meeting_time, duration_mins, platform,
      attendees, agenda_ar, agenda_en, chan,
      meeting_type !== undefined ? (meeting_type || null) : null,
      board_id !== undefined ? (board_id || null) : null,
      committee_id !== undefined ? (committee_id || null) : null,
      req.params.id
    );
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id));
});

router.delete('/schedule/:id', auth, (req, res) => {
  db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  res.json({ success: true });
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
  const tasks = JSON.parse(m.ai_tasks || '[]');
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
    res.json({ reply: getDemoReply(messages[messages.length - 1]?.content || '', lang), demo: true });
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
    const out = await notify.sendEmail({ to: mem.email, subject, text, html });
    results.push({ name: mem.name_ar || mem.name_en, email: mem.email, ...out });
  }
  res.json({ success: true, shared: results.length, results });
});

// ── Public attendee confirmation (NO AUTH — token-gated) ───────────────────
router.get('/public/:token', (req, res) => {
  const a = db.prepare('SELECT * FROM meeting_attendees WHERE share_token=?').get(req.params.token);
  if (!a) return res.status(404).json({ error: 'NOT_FOUND' });
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(a.meeting_id);
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  const tasks = JSON.parse(meeting.ai_tasks || '[]');
  const decisions = JSON.parse(meeting.ai_decisions || '[]');
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

module.exports = router;
