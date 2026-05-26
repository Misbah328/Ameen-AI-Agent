const router = require('express').Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const nodemailer = require('nodemailer');

// ── In-memory API key store (per user session) ─────────────────────────────
const sessionKeys = {};

// ── Helpers ─────────────────────────────────────────────────────────────────
async function callClaude(messages, system = '', maxTokens = 1000, userId = null) {
  const key = (userId && sessionKeys[userId]) || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('NO_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
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
  const { transcript, duration } = req.body;
  db.prepare('UPDATE meetings SET transcript=?, duration=? WHERE id=?').run(transcript, duration, req.params.id);
  res.json({ success: true });
});

// ── AI: Process Meeting ───────────────────────────────────────────────────────
router.post('/meetings/:id/process', auth, async (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const members = db.prepare('SELECT name_ar, name_en FROM users').all();
  const memberNames = members.map(m => `${m.name_ar} / ${m.name_en}`).join(', ');

  const system = `أنت أمين، مساعد ذكي تنفيذي متخصص في تحليل اجتماعات مجالس الإدارة.
أعضاء الفريق الحاليون: ${memberNames}
قم بتحليل النص وأرجع JSON فقط بدون markdown. الهيكل المطلوب:
{
  "summary_ar": "ملخص عربي مفصل للاجتماع",
  "summary_en": "Detailed English meeting summary",
  "tasks": [{"text_ar":"...","text_en":"...","owner_ar":"اسم المسؤول بالعربي","owner_en":"Owner name in English","due":"YYYY-MM-DD or empty string","priority":"urgent|normal"}],
  "decisions": [{"text_ar":"...","text_en":"..."}],
  "reminders": [{"text_ar":"...","text_en":"..."}],
  "followups": [{"text_ar":"نقطة متابعة","text_en":"Follow-up point"}],
  "sentiment": "positive|neutral|tense",
  "speakers": ["name1","name2"],
  "key_topics_ar": ["موضوع1"],
  "key_topics_en": ["topic1"]
}`;

  try {
    const text = await callClaude([{
      role: 'user',
      content: `عنوان الاجتماع: ${meeting.title_ar}\nالتاريخ: ${meeting.meeting_date}\nالنص:\n${meeting.transcript}`
    }], system, 2500, req.user.id);

    let result;
    try { result = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { result = buildDemoResult(meeting); }

    db.prepare(`
      UPDATE meetings SET
        ai_summary_ar=?, ai_summary_en=?,
        ai_tasks=?, ai_decisions=?,
        ai_reminders=?, ai_followups=?,
        ai_sentiment=?, speakers=?, status='processed'
      WHERE id=?
    `).run(
      result.summary_ar, result.summary_en,
      JSON.stringify(result.tasks || []),
      JSON.stringify(result.decisions || []),
      JSON.stringify(result.reminders || []),
      JSON.stringify(result.followups || []),
      result.sentiment || 'neutral',
      JSON.stringify(result.speakers || []),
      meeting.id
    );

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
    if (e.message === 'NO_API_KEY') {
      const result = buildDemoResult(meeting);
      db.prepare(`UPDATE meetings SET ai_summary_ar=?, ai_summary_en=?, ai_tasks=?, ai_decisions=?, status='processed' WHERE id=?`)
        .run(result.summary_ar, result.summary_en, JSON.stringify(result.tasks), JSON.stringify(result.decisions), meeting.id);
      res.json({ success: true, result, demo: true });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

function buildDemoResult(meeting) {
  return {
    summary_ar: `تمت مناقشة ${meeting.title_ar} بنجاح. تم تحديد المهام والقرارات الرئيسية لجميع أعضاء الفريق.`,
    summary_en: `${meeting.title_en || meeting.title_ar} completed successfully. Key tasks and decisions identified for all team members.`,
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
  const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en } = req.body;
  if (!title_ar || !meeting_date || !meeting_time) return res.status(400).json({ error: 'Required fields missing' });
  const row = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title_ar, title_en || title_ar, meeting_date, meeting_time, duration_mins || 60, platform || 'قاعة الاجتماعات', attendees || '', agenda_ar || '', agenda_en || '', req.user.id);
  res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(row.lastInsertRowid));
});

router.delete('/schedule/:id', auth, (req, res) => {
  db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Email Reminders ───────────────────────────────────────────────────────────
router.post('/email/send', auth, async (req, res) => {
  const { to, subject, body, html } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body are required' });

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    return res.status(503).json({
      error: 'SMTP_NOT_CONFIGURED',
      message: 'Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables.'
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: smtpUser, pass: smtpPass }
    });

    const recipients = to.split(/[,;\n]+/).map(e => e.trim()).filter(Boolean);

    await transporter.sendMail({
      from: process.env.SMTP_FROM || smtpUser,
      to: recipients.join(', '),
      subject,
      text: body,
      html: html || `<div style="font-family:Arial,sans-serif;direction:auto">${body.replace(/\n/g, '<br>')}</div>`
    });

    res.json({ success: true, sent_to: recipients.length });
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
    if (e.message === 'NO_API_KEY') {
      res.json({ reply: getDemoReply(messages[messages.length - 1]?.content || '', lang), demo: true });
    } else {
      res.status(500).json({ error: e.message });
    }
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

// ── AI: Correspondence ─────────────────────────────────────────────────────
router.post('/ai/correspondence', auth, async (req, res) => {
  const { type, to_name, subject_ar, subject_en, situation, signature, lang } = req.body;
  if (!situation) return res.status(400).json({ error: 'Situation required' });
  const typeLang = (type || '').includes('_en') || lang === 'en' ? 'en' : 'ar';
  const prompt = `أنت كاتب مراسلات تنفيذي محترف لشركة أمين للذكاء الاصطناعي.
اكتب ${type || 'خطاباً رسمياً'} ${typeLang === 'en' ? 'in formal professional English only' : 'بالعربية الرسمية الفصيحة فقط'}.
الجهة المستلمة: ${to_name || (typeLang === 'en' ? 'The Concerned Party' : 'الجهة المعنية')}
الموضوع: ${typeLang === 'en' ? (subject_en || subject_ar || '') : (subject_ar || subject_en || '')}
الموقف: ${situation}
التوقيع: ${signature || (typeLang === 'en' ? 'CEO, Ameen AI Solutions' : 'الرئيس التنفيذي، أمين للذكاء الاصطناعي')}
اكتب الخطاب كاملاً فقط بدون أي تعليق إضافي.`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1200, req.user.id);
    const row = db.prepare(`INSERT INTO correspondence (type, to_name, subject_ar, subject_en, content, lang, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(type, to_name, subject_ar, subject_en, text, lang, req.user.id);
    res.json({ success: true, content: text, id: row.lastInsertRowid });
  } catch (e) {
    if (e.message === 'NO_API_KEY') {
      const demo = generateDemoLetter(to_name, subject_ar || subject_en, situation, signature, lang || typeLang);
      res.json({ success: true, content: demo, demo: true });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

function generateDemoLetter(to, subject, situation, sig, lang) {
  if (lang === 'en') {
    return `${new Date().toLocaleDateString('en-GB')}\n\n${to || 'To Whom It May Concern'}\n\nSubject: ${subject || 'Official Correspondence'}\n\nDear Sir / Madam,\n\nWe write on behalf of Ameen AI Solutions regarding the above-referenced subject.\n\n${situation}\n\nWe trust this meets your requirements and remain at your disposal for any clarification.\n\nYours sincerely,\n\n${sig || 'CEO, Ameen AI Solutions'}`;
  }
  return `بسم الله الرحمن الرحيم\n\n${new Date().toLocaleDateString('ar-SA')}\n\nالسادة / ${to || 'الجهة المعنية'}\nالمحترمين\n\nالموضوع: ${subject || 'موضوع المراسلة'}\n\nتحية طيبة وبعد،\n\nيسعدنا التواصل معكم بشأن الموضوع المشار إليه أعلاه.\n\n${situation}\n\nنأمل أن تجدوا في هذا الخطاب ما يلبي متطلباتكم، ونحن رهن إشارتكم لأي استفسار.\n\nوتفضلوا بقبول فائق الاحترام والتقدير،\n\n${sig || 'الرئيس التنفيذي، أمين للذكاء الاصطناعي'}`;
}

// ── AI: Document Generator ─────────────────────────────────────────────────
router.post('/ai/document', auth, async (req, res) => {
  const { doc_type, meeting_id, details, lang, detail_level } = req.body;
  let meetingContext = '';
  if (meeting_id) {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(meeting_id);
    if (m) meetingContext = `اجتماع: ${m.title_ar}\nالتاريخ: ${m.meeting_date}\nالملخص: ${m.ai_summary_ar || ''}\nالمهام: ${m.ai_tasks || '[]'}\nالقرارات: ${m.ai_decisions || '[]'}`;
  }
  const docTypeLabels = {
    minutes_ar: 'محضر اجتماع رسمي بالعربية',
    minutes_en: 'Official Meeting Minutes in English',
    minutes_bi: 'محضر اجتماع ثنائي اللغة',
    board_report: 'تقرير مجلس الإدارة',
    exec_summary: 'ملخص تنفيذي',
    action_plan: 'خطة العمل التفصيلية',
    decision_log: 'سجل القرارات الرسمي',
    kpi_report: 'تقرير مؤشرات الأداء الرئيسية'
  };
  const docLang = lang === 'en' ? 'in English only' : lang === 'bi' ? 'باللغتين العربية والإنجليزية (كل قسم بلغتين)' : 'بالعربية فقط';
  const prompt = `أنت كاتب وثائق تنفيذي محترف. أنشئ ${docTypeLabels[doc_type] || doc_type} ${docLang}.
مستوى التفصيل: ${detail_level || 'standard'}
${meetingContext ? meetingContext + '\n' : ''}${details ? 'تفاصيل إضافية: ' + details : ''}
اكتب الوثيقة كاملة بشكل رسمي واحترافي ومنظم.`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1800, req.user.id);
    const row = db.prepare(`INSERT INTO documents (type, title_ar, title_en, content, source_meeting_id, lang, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(doc_type, docTypeLabels[doc_type] || doc_type, doc_type, text, meeting_id || null, lang, req.user.id);
    res.json({ success: true, content: text, id: row.lastInsertRowid });
  } catch (e) {
    if (e.message === 'NO_API_KEY') {
      res.json({ success: true, content: generateDemoDoc(doc_type, lang, meetingContext), demo: true });
    } else {
      res.status(500).json({ error: e.message });
    }
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

// ── Correspondence History ─────────────────────────────────────────────────
router.get('/correspondence', auth, (req, res) => {
  res.json(db.prepare('SELECT c.*, u.name_ar as author_ar, u.name_en as author_en FROM correspondence c LEFT JOIN users u ON c.created_by=u.id ORDER BY c.created_at DESC LIMIT 20').all());
});

// ── Document History ───────────────────────────────────────────────────────
router.get('/documents', auth, (req, res) => {
  res.json(db.prepare('SELECT d.*, u.name_ar as author_ar, u.name_en as author_en FROM documents d LEFT JOIN users u ON d.created_by=u.id ORDER BY d.created_at DESC LIMIT 20').all());
});

module.exports = router;
