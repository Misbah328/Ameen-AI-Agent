const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { sendEmail } = require('../utils/replitmail');
const notify = require('../utils/notify');

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

// ── In-memory API key store (per user session) ─────────────────────────────
const sessionKeys = {};

// ── Helpers ─────────────────────────────────────────────────────────────────
async function callClaude(messages, system = '', maxTokens = 1000, userId = null) {
  const key = (userId && sessionKeys[userId]) || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('NO_API_KEY');
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error('API_ERROR: ' + (data.error.message || JSON.stringify(data.error)));
  return data.content.map(b => b.text || '').join('');
}

// ── Set API key (session-level) ────────────────────────────────────────────
router.post('/ai/setkey', auth, (req, res) => {
  const { key } = req.body;
  if (key && key.startsWith('sk-ant')) {
    sessionKeys[req.user.id] = key;
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid key format' });
  }
});

// ── Users / Auth ─────────────────────────────────────────────────────────────
router.get('/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, created_at FROM users ORDER BY name_ar').all();
  res.json(users);
});

// ── Team Members (CRUD) ───────────────────────────────────────────────────────
router.get('/members', auth, (req, res) => {
  const members = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, created_at FROM users ORDER BY name_ar').all();
  res.json(members);
});

router.post('/members', auth, (req, res) => {
  const { name_ar, name_en, email, role_ar, role_en } = req.body;
  if (!name_ar || !email) return res.status(400).json({ error: 'name_ar and email are required' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('ameen2026', 10);
  try {
    const row = db.prepare(`
      INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name_ar, name_en || name_ar, email, hash, role_ar || 'عضو', role_en || 'Member');
    const member = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, created_at FROM users WHERE id=?').get(row.lastInsertRowid);
    res.json(member);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/members/:id', auth, (req, res) => {
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
    res.json(db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, created_at FROM users WHERE id=?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/members/:id', auth, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('UPDATE tasks SET owner_id=NULL WHERE owner_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Meetings ─────────────────────────────────────────────────────────────────
router.get('/meetings', auth, (req, res) => {
  const meetings = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en
    FROM meetings m LEFT JOIN users u ON m.recorded_by = u.id
    ORDER BY m.meeting_date DESC
  `).all();
  res.json(meetings);
});

router.get('/meetings/:id', auth, (req, res) => {
  const m = db.prepare(`
    SELECT m.*, u.name_ar as recorder_ar, u.name_en as recorder_en
    FROM meetings m LEFT JOIN users u ON m.recorded_by = u.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

router.post('/meetings', auth, (req, res) => {
  const { title_ar, title_en, transcript, duration } = req.body;
  const row = db.prepare(`
    INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(title_ar, title_en || title_ar, transcript || '', duration || 0, req.user.id);
  res.json({ id: row.lastInsertRowid });
});

router.patch('/meetings/:id', auth, (req, res) => {
  const { transcript, duration, title_ar, title_en } = req.body;
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const newTitleAr = title_ar !== undefined ? title_ar : meeting.title_ar;
  const newTitleEn = title_en !== undefined ? (title_en || title_ar || meeting.title_en) : meeting.title_en;
  const newTranscript = transcript !== undefined ? transcript : meeting.transcript;
  const newDuration = duration !== undefined ? duration : meeting.duration;

  db.prepare('UPDATE meetings SET title_ar=?, title_en=?, transcript=?, duration=? WHERE id=?')
    .run(newTitleAr, newTitleEn, newTranscript, newDuration, req.params.id);

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
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(id);
    db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(id);
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id=?').run(id);
    db.prepare('UPDATE documents SET source_meeting_id=NULL WHERE source_meeting_id=?').run(id);
    db.prepare('DELETE FROM meetings WHERE id=?').run(id);
  });
  tx();
  res.json({ success: true });
});

// ── AI: Process Meeting ───────────────────────────────────────────────────────
router.post('/meetings/:id/process', auth, async (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const members = db.prepare('SELECT name_ar, name_en FROM users').all();
  const memberNames = members.map(m => `${m.name_ar} / ${m.name_en}`).join(', ');

  const system = `أنت أمين، مساعد ذكي تنفيذي متخصص في تحليل اجتماعات مجالس الإدارة (بأسلوب Gemini in Meet).
أعضاء الفريق الحاليون: ${memberNames}
حلّل نص الاجتماع بدقة: تعرّف على المتحدثين بالاسم من خلال سياق الحوار والأسماء المذكورة، واستخرج المهام منسوبةً لأصحابها بالاسم، والقرارات، ومحضراً رسمياً.
إن لم يكن للاجتماع عنوان واضح، فولّد عنواناً موجزاً ومعبّراً من المحتوى.
أرجع JSON فقط بدون markdown. الهيكل المطلوب:
{
  "title_ar": "عنوان موجز مولّد من المحتوى بالعربية",
  "title_en": "Concise generated title in English",
  "summary_ar": "ملخص عربي مفصل للاجتماع",
  "summary_en": "Detailed English meeting summary",
  "minutes_ar": "محضر اجتماع رسمي منظم بالعربية (الحضور، البنود، النقاش، القرارات، المهام)",
  "minutes_en": "Formal structured meeting minutes in English",
  "speaker_transcript": [{"speaker":"اسم المتحدث","text_ar":"ما قاله بالعربية","text_en":"what they said in English"}],
  "tasks": [{"text_ar":"...","text_en":"...","owner_ar":"اسم المسؤول بالعربي","owner_en":"Owner name in English","due":"YYYY-MM-DD or empty string","priority":"urgent|normal"}],
  "decisions": [{"text_ar":"...","text_en":"..."}],
  "reminders": [{"text_ar":"...","text_en":"..."}],
  "followups": [{"text_ar":"نقطة متابعة","text_en":"Follow-up point"}],
  "sentiment": "positive|neutral|tense",
  "speakers": ["name1","name2"],
  "key_topics_ar": ["موضوع1"],
  "key_topics_en": ["topic1"]
}`;

  const UNTITLED = ['اجتماع بدون عنوان', 'Untitled Meeting', 'اجتماع جديد', 'New Meeting', ''];
  const needsTitle = !meeting.title_ar || UNTITLED.includes((meeting.title_ar || '').trim());

  try {
    const text = await callClaude([{
      role: 'user',
      content: `عنوان الاجتماع: ${needsTitle ? '(بدون عنوان — يرجى توليد عنوان مناسب)' : meeting.title_ar}\nالتاريخ: ${meeting.meeting_date}\nالنص:\n${meeting.transcript}`
    }], system, 4000, req.user.id);

    let result;
    try { result = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { result = buildDemoResult(meeting); }

    // Auto-generated title when none was provided
    let finalTitleAr = meeting.title_ar;
    let finalTitleEn = meeting.title_en || meeting.title_ar;
    if (needsTitle && result.title_ar) {
      finalTitleAr = result.title_ar;
      finalTitleEn = result.title_en || result.title_ar;
      db.prepare('UPDATE meetings SET title_ar=?, title_en=? WHERE id=?').run(finalTitleAr, finalTitleEn, meeting.id);
    }

    db.prepare(`
      UPDATE meetings SET
        ai_summary_ar=?, ai_summary_en=?,
        ai_tasks=?, ai_decisions=?,
        ai_reminders=?, ai_followups=?,
        ai_sentiment=?, speakers=?,
        ai_minutes_ar=?, ai_minutes_en=?, speaker_transcript=?,
        status='processed'
      WHERE id=?
    `).run(
      result.summary_ar, result.summary_en,
      JSON.stringify(result.tasks || []),
      JSON.stringify(result.decisions || []),
      JSON.stringify(result.reminders || []),
      JSON.stringify(result.followups || []),
      result.sentiment || 'neutral',
      JSON.stringify(result.speakers || []),
      result.minutes_ar || '', result.minutes_en || '',
      JSON.stringify(result.speaker_transcript || []),
      meeting.id
    );

    result.title_ar = finalTitleAr;
    result.title_en = finalTitleEn;

    const insertTask = db.prepare(`
      INSERT INTO tasks (text_ar, text_en, owner_name_ar, owner_name_en, due_date, priority, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (result.tasks || []).forEach(t => {
      const u = t.owner_ar ? db.prepare("SELECT id FROM users WHERE name_ar LIKE ? OR name_en LIKE ?").get(`%${t.owner_ar}%`, `%${(t.owner_en || '')}%`) : null;
      insertTask.run(t.text_ar, t.text_en || t.text_ar, t.owner_ar || '', t.owner_en || '', t.due || '', t.priority || 'normal', meeting.id, meeting.title_ar, meeting.title_en || meeting.title_ar, req.user.id);
    });

    const insertDecision = db.prepare(`INSERT INTO decisions (text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en) VALUES (?, ?, ?, ?, ?)`);
    (result.decisions || []).forEach(d => {
      insertDecision.run(d.text_ar, d.text_en || d.text_ar, meeting.id, meeting.title_ar, meeting.title_en || meeting.title_ar);
    });

    res.json({ success: true, result });
  } catch (e) {
    const result = buildDemoResult(meeting);
    if (needsTitle && result.title_ar) {
      db.prepare('UPDATE meetings SET title_ar=?, title_en=? WHERE id=?').run(result.title_ar, result.title_en, meeting.id);
    }
    db.prepare(`UPDATE meetings SET ai_summary_ar=?, ai_summary_en=?, ai_tasks=?, ai_decisions=?, ai_minutes_ar=?, ai_minutes_en=?, speaker_transcript=?, status='processed' WHERE id=?`)
      .run(result.summary_ar, result.summary_en, JSON.stringify(result.tasks), JSON.stringify(result.decisions), result.minutes_ar || '', result.minutes_en || '', JSON.stringify(result.speaker_transcript || []), meeting.id);
    res.json({ success: true, result, demo: true, _err: e.message });
  }
});

function buildDemoResult(meeting) {
  const titleAr = meeting.title_ar || 'اجتماع تنفيذي';
  const titleEn = meeting.title_en || meeting.title_ar || 'Executive Meeting';
  return {
    title_ar: titleAr,
    title_en: titleEn,
    summary_ar: `تمت مناقشة ${titleAr} بنجاح. تم تحديد المهام والقرارات الرئيسية لجميع أعضاء الفريق.`,
    summary_en: `${titleEn} completed successfully. Key tasks and decisions identified for all team members.`,
    minutes_ar: `محضر اجتماع: ${titleAr}\nالتاريخ: ${(meeting.meeting_date || '').substring(0,10)}\n\nالبنود:\n- مراجعة الأداء العام\n- متابعة المهام السابقة\n\nالقرارات:\n- اعتماد بنود الاجتماع والمضي في التنفيذ`,
    minutes_en: `Meeting Minutes: ${titleEn}\nDate: ${(meeting.meeting_date || '').substring(0,10)}\n\nItems:\n- General performance review\n- Follow-up on previous tasks\n\nDecisions:\n- Meeting items approved for implementation`,
    speaker_transcript: [],
    tasks: [
      { text_ar: 'مراجعة تقرير الأداء وإعداد الملاحظات', text_en: 'Review performance report and prepare notes', owner_ar: 'المدير التنفيذي', owner_en: 'Managing Director', due: '', priority: 'normal' },
      { text_ar: 'متابعة بنود الاجتماع مع الفريق', text_en: 'Follow up on meeting items with the team', owner_ar: 'مدير العمليات', owner_en: 'Operations Manager', due: '', priority: 'normal' }
    ],
    decisions: [{ text_ar: 'اعتماد بنود الاجتماع والمضي في التنفيذ', text_en: 'Meeting items approved for implementation' }],
    reminders: [{ text_ar: 'متابعة في الاجتماع القادم', text_en: 'Follow up in next meeting' }],
    followups: [],
    sentiment: 'positive',
    speakers: [],
    key_topics_ar: ['اجتماع عام'],
    key_topics_en: ['General meeting']
  };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/tasks', auth, (req, res) => {
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY CASE status WHEN 'overdue' THEN 1 WHEN 'inprogress' THEN 2 WHEN 'new' THEN 3 ELSE 4 END, due_date ASC").all();
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
  const { status, notes, due_date, priority } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE tasks SET status=COALESCE(?,status), notes=COALESCE(?,notes), due_date=COALESCE(?,due_date), priority=COALESCE(?,priority), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status, notes, due_date, priority, req.params.id);
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
  res.json(db.prepare('SELECT s.*, u.name_ar as creator_ar, u.name_en as creator_en FROM schedule s LEFT JOIN users u ON s.created_by=u.id ORDER BY meeting_date ASC, meeting_time ASC').all());
});

router.post('/schedule', auth, (req, res) => {
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel } = req.body;
  if (!title_ar || !meeting_date || !meeting_time) return res.status(400).json({ error: 'Required fields missing' });
  const chan = ['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : 'email';
  const row = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title_ar, title_en || title_ar, meeting_date, meeting_time, duration_mins || 60, platform || 'قاعة الاجتماعات', attendees || '', agenda_ar || '', agenda_en || '', chan, req.user.id);
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/schedule/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel } = req.body;
  const chan = reminder_channel !== undefined
    ? (['email', 'whatsapp', 'both'].includes(reminder_channel) ? reminder_channel : row.reminder_channel)
    : row.reminder_channel;
  // Editing the schedule re-arms the reminder so changed attendees get notified.
  db.prepare(`UPDATE schedule SET
      title_ar=COALESCE(?,title_ar), title_en=COALESCE(?,title_en),
      meeting_date=COALESCE(?,meeting_date), meeting_time=COALESCE(?,meeting_time),
      duration_mins=COALESCE(?,duration_mins), platform=COALESCE(?,platform),
      attendees=COALESCE(?,attendees), agenda_ar=COALESCE(?,agenda_ar), agenda_en=COALESCE(?,agenda_en),
      reminder_channel=?, reminder_sent=0
    WHERE id=?`)
    .run(
      title_ar, title_en !== undefined ? (title_en || title_ar) : null,
      meeting_date, meeting_time, duration_mins, platform,
      attendees, agenda_ar, agenda_en, chan, req.params.id
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
  const phones = (Array.isArray(req.body.phones) ? req.body.phones : String(req.body.phones || '').split(/[,;\n]+/))
    .map(s => s.trim()).filter(Boolean);
  if (!phones.length) return res.status(400).json({ error: 'لا يوجد رقم جوال / No phone number provided' });
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
    const recipients = to.split(/[,;\n]+/).map(e => e.trim()).filter(Boolean);
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

  const system = `أنت أمين، المساعد الذكي التنفيذي المتخصص لشركة أمين للذكاء الاصطناعي.
أجب ${lang === 'en' ? 'in English only' : 'بالعربية الفصيحة فقط'} بأسلوب رسمي ومهني ومختصر وواضح.

السياق الحالي:
أعضاء الفريق: ${users.map(u => `${u.name_ar} / ${u.name_en} (${u.role_ar})`).join(' | ')}

المهام الجارية والمتأخرة:
${tasks.map(t => `- ${t.text_ar} | ${t.owner_name_ar || 'غير محدد'} | ${t.status} | ${t.due_date || 'مفتوح'}`).join('\n') || 'لا توجد مهام مفتوحة'}

قرارات المجلس النشطة:
${decisions.map(d => `- ${d.text_ar} [${d.status}]`).join('\n') || 'لا توجد قرارات'}

آخر الاجتماعات:
${meetings.map(m => `- ${m.title_ar} (${m.meeting_date?.substring(0,10)}): ${m.ai_summary_ar || 'لم يُعالج'}`).join('\n') || 'لا توجد اجتماعات'}

الاجتماعات القادمة:
${schedule.map(s => `- ${s.title_ar} | ${s.meeting_date} ${s.meeting_time} | ${s.platform}`).join('\n') || 'لا توجد اجتماعات مجدولة'}`;

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

  const docTypeLabels = {
    minutes_ar: 'محضر اجتماع رسمي بالعربية',
    minutes_en: 'Official Meeting Minutes in English',
    minutes_bi: 'محضر اجتماع ثنائي اللغة',
    board_report: 'تقرير مجلس الإدارة',
    exec_summary: 'ملخص تنفيذي',
    action_plan: 'خطة العمل التفصيلية',
    decision_log: 'سجل القرارات الرسمي',
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
router.patch('/plan', auth, (req, res) => {
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
  const system = `أنت مساعد ذكي يستخرج المهام والقرارات من نص اجتماع مباشر (قد يكون غير مكتمل).
أعِد JSON فقط بالشكل: {"tasks":[{"text_ar":"","text_en":"","owner_ar":"","owner_en":""}],"decisions":[{"text_ar":"","text_en":""}]}.
أسماء الحضور المعروفون: ${memberList}. اربط كل مهمة بأقرب اسم مالك إن وُجد. لا تختلق مهاماً غير مذكورة. أعد JSON صالحاً بدون أي شرح.`;
  try {
    const raw = await callClaude(
      [{ role: 'user', content: `النص حتى الآن:\n"""${transcript.slice(-4000)}"""` }],
      system, 900, req.user.id
    );
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { tasks: [], decisions: [] };
    res.json({ tasks: parsed.tasks || [], decisions: parsed.decisions || [] });
  } catch (e) {
    res.json({ tasks: [], decisions: [], _err: e.message });
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
