const router = require('express').Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

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
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages
    })
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

// ── Users ─────────────────────────────────────────────────────────────────
router.get('/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, name_ar, name_en, email, role_ar, role_en, created_at FROM users ORDER BY name_ar').all();
  res.json(users);
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

// AI process meeting
router.post('/meetings/:id/process', auth, async (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });

  const system = `أنت أمين، مساعد ذكي تنفيذي متخصص في تحليل اجتماعات مجالس الإدارة والشركات العليا.
قم بتحليل النص وأرجع JSON فقط بدون markdown أو مقدمة. الهيكل المطلوب بالضبط:
{
  "summary_ar": "ملخص عربي مفصل",
  "summary_en": "Detailed English summary",
  "tasks": [{"text_ar":"...","text_en":"...","owner_ar":"...","owner_en":"...","due":"YYYY-MM-DD or ''","priority":"urgent|normal"}],
  "decisions": [{"text_ar":"...","text_en":"..."}],
  "reminders": [{"text_ar":"...","text_en":"..."}],
  "followups": [{"text_ar":"...","text_en":"..."}],
  "sentiment": "positive|neutral|tense",
  "speakers": ["name1","name2"],
  "key_topics_ar": ["موضوع1","موضوع2"],
  "key_topics_en": ["topic1","topic2"]
}`;

  try {
    const text = await callClaude([{
      role: 'user',
      content: `عنوان الاجتماع: ${meeting.title_ar}\nالتاريخ: ${meeting.meeting_date}\nالنص:\n${meeting.transcript}`
    }], system, 2000, req.user.id);

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
      insertTask.run(t.text_ar, t.text_en || t.text_ar, t.owner_ar || '', t.owner_en || '', t.due || '', t.priority || 'normal', meeting.id, meeting.title_ar, meeting.title_en || meeting.title_ar, req.user.id);
    });

    const insertDecision = db.prepare(`
      INSERT INTO decisions (text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en)
      VALUES (?, ?, ?, ?, ?)
    `);
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
    summary_ar: `تمت مناقشة ${meeting.title_ar} بنجاح. تم تحديد المهام والقرارات الرئيسية.`,
    summary_en: `${meeting.title_en || meeting.title_ar} completed successfully. Key tasks and decisions identified.`,
    tasks: [
      { text_ar: 'متابعة بنود الاجتماع', text_en: 'Follow up on meeting items', owner_ar: 'المدير المعني', owner_en: 'Relevant Manager', due: '', priority: 'normal' }
    ],
    decisions: [{ text_ar: 'اعتماد بنود الاجتماع', text_en: 'Meeting items approved' }],
    reminders: [{ text_ar: 'متابعة في الاجتماع القادم', text_en: 'Follow up in next meeting' }],
    followups: [],
    sentiment: 'positive',
    speakers: [],
    key_topics_ar: ['اجتماع عام'],
    key_topics_en: ['General meeting']
  };
}

// ── Tasks ─────────────────────────────────────────────────────────────────
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
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(row.lastInsertRowid);
  res.json(task);
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

// ── AI: Chat ─────────────────────────────────────────────────────────────────
router.post('/ai/chat', auth, async (req, res) => {
  const { messages, lang } = req.body;

  const tasks = db.prepare('SELECT * FROM tasks WHERE status != "done" LIMIT 20').all();
  const decisions = db.prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT 10').all();
  const meetings = db.prepare('SELECT id, title_ar, title_en, meeting_date, ai_summary_ar, ai_summary_en FROM meetings ORDER BY meeting_date DESC LIMIT 5').all();
  const schedule = db.prepare('SELECT * FROM schedule ORDER BY meeting_date ASC LIMIT 5').all();
  const users = db.prepare('SELECT name_ar, name_en, role_ar, role_en FROM users').all();

  const system = `أنت أمين، المساعد الذكي التنفيذي لشركة أمين للذكاء الاصطناعي. تساعد مجالس الإدارة والمديرين التنفيذيين.
أجب ${lang === 'en' ? 'in English' : 'بالعربية'} دائماً بأسلوب رسمي ومهني.

السياق الحالي:
أعضاء الفريق: ${users.map(u => `${u.name_ar} (${u.role_ar})`).join('، ')}

المهام الجارية والمتأخرة:
${tasks.map(t => `- ${t.text_ar} | المسؤول: ${t.owner_name_ar || 'غير محدد'} | الحالة: ${t.status} | الموعد: ${t.due_date || 'مفتوح'}`).join('\n')}

قرارات المجلس الأخيرة:
${decisions.map(d => `- ${d.text_ar} | ${d.status}`).join('\n')}

آخر الاجتماعات:
${meetings.map(m => `- ${m.title_ar} (${m.meeting_date}): ${m.ai_summary_ar || 'لم يُعالج بعد'}`).join('\n')}

الاجتماعات القادمة:
${schedule.map(s => `- ${s.title_ar} | ${s.meeting_date} ${s.meeting_time} | ${s.platform}`).join('\n')}`;

  try {
    const reply = await callClaude(messages, system, 800, req.user.id);
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
    return isEn ? 'Current overdue tasks:\n\n1. Prepare 5-hire recruitment plan — Mr. Khalid (3 days overdue)\n2. Q2 shareholders report — Mr. Khalid (overdue)\n3. New investment policy review — Mr. Ahmed\n\nAll require immediate follow-up.' :
      'المهام المتأخرة حالياً:\n\n1. إعداد خطة التوظيف — م. خالد (3 أيام تأخير)\n2. تقرير المساهمين الربعي — م. خالد (متأخر)\n3. مراجعة السياسة الاستثمارية — م. أحمد\n\nجميعها تستوجب متابعة فورية.';
  if (ql.includes('قرار') || ql.includes('decision'))
    return isEn ? 'Active board decisions:\n\n⚖️ Team expansion (5 new hires) — Approved, implementation in progress\n⚖️ Gulf Partnership Contract — Under legal review\n⚖️ Projects continue per approved plan — Implemented' :
      'قرارات المجلس النشطة:\n\n⚖️ توسعة الفريق (5 موظفين) — معتمدة، التنفيذ جارٍ\n⚖️ عقد الشراكة الخليجية — قيد المراجعة القانونية\n⚖️ استمرار المشاريع وفق الخطة — مُنفَّذ';
  if (ql.includes('ملخص') || ql.includes('summary'))
    return isEn ? 'Last Board Meeting Summary (15 May 2026):\n\nQ2 results: 18% growth vs previous quarter. Key decisions: Team expansion approved (5 hires). Gulf Partnership Contract referred for legal review. 3 tasks currently overdue requiring immediate attention.' :
      'ملخص آخر اجتماع للمجلس (15 مايو 2026):\n\nنتائج الربع الثاني: نمو 18%. القرارات: الموافقة على توسعة الفريق (5 موظفين). إحالة عقد الشراكة الخليجية للمراجعة القانونية. 3 مهام متأخرة تستوجب متابعة.';
  return isEn ? "I'm Ameen, your executive AI secretary. I have full context of all meetings, tasks, and decisions. You can ask me about overdue tasks, pending decisions, meeting summaries, team performance, or anything else you need." :
    'أنا أمين، مساعدكم الذكي التنفيذي. لديّ سياق كامل لجميع الاجتماعات والمهام والقرارات. يمكنكم سؤالي عن المهام المتأخرة، القرارات المعلقة، ملخصات الاجتماعات، أداء الفريق، أو أي موضوع آخر.';
}

// ── AI: Pre-meeting Report ─────────────────────────────────────────────────
router.post('/ai/premeeting', auth, async (req, res) => {
  const { schedule_id, lang } = req.body;
  const mtg = schedule_id ? db.prepare('SELECT * FROM schedule WHERE id=?').get(schedule_id) : db.prepare('SELECT * FROM schedule ORDER BY meeting_date ASC LIMIT 1').get();

  const tasks = db.prepare('SELECT * FROM tasks ORDER BY status ASC, due_date ASC').all();
  const decisions = db.prepare('SELECT * FROM decisions WHERE status != "implemented"').all();

  const prompt = `أعدّ تقريراً شاملاً قبل اجتماع:
العنوان: ${mtg?.title_ar || 'الاجتماع القادم'}
التاريخ: ${mtg?.meeting_date} ${mtg?.meeting_time}
جدول الأعمال: ${lang === 'en' ? (mtg?.agenda_en || mtg?.agenda_ar || '') : (mtg?.agenda_ar || '')}

المهام:
${tasks.map(t => `${t.text_ar} | ${t.owner_name_ar} | ${t.status} | ${t.due_date}`).join('\n')}

القرارات المعلقة:
${decisions.map(d => d.text_ar).join('\n')}

أرجع JSON فقط:
{
  "completed_ar": ["..."],
  "completed_en": ["..."],
  "delayed_ar": [{"item":"...","owner":"...","reason":"..."}],
  "delayed_en": [{"item":"...","owner":"...","reason":"..."}],
  "decisions_needed_ar": ["..."],
  "decisions_needed_en": ["..."],
  "agenda_ar": [{"time":"HH:MM","item":"..."}],
  "agenda_en": [{"time":"HH:MM","item":"..."}]
}`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1500, req.user.id);
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ success: true, meeting: mtg, report: result });
  } catch (e) {
    res.json({
      success: true, demo: true,
      meeting: mtg,
      report: {
        completed_ar: ['مراجعة عقد الشراكة الخليجية — م. سارة ✓', 'تحديث خطة المشاريع — م. نورة ✓'],
        completed_en: ['Gulf Partnership Contract review — Sara ✓', 'Project plan update — Noura ✓'],
        delayed_ar: [{ item: 'إعداد خطة التوظيف', owner: 'م. خالد', reason: 'مراجعة الميزانية' }, { item: 'تقرير المساهمين الربعي', owner: 'م. خالد', reason: 'تأخر في جمع البيانات' }],
        delayed_en: [{ item: 'Hiring Plan Preparation', owner: 'Khalid', reason: 'Budget review pending' }, { item: 'Q2 Shareholders Report', owner: 'Khalid', reason: 'Data collection delayed' }],
        decisions_needed_ar: ['الموافقة النهائية على عقد الشراكة الخليجية', 'البت في الجدول الزمني لخطة التوظيف', 'مراجعة الفرصة الاستثمارية واتخاذ قرار'],
        decisions_needed_en: ['Final approval: Gulf Partnership Contract', 'Hiring plan timeline decision', 'Investment opportunity review and decision'],
        agenda_ar: [{ time: '09:00', item: 'افتتاح الاجتماع ومراجعة المحضر السابق' }, { time: '09:10', item: 'تقرير التقدم — المهام المتأخرة' }, { time: '09:30', item: 'قرار: عقد الشراكة الخليجية' }, { time: '10:00', item: 'قرار: خطة التوظيف والفرصة الاستثمارية' }, { time: '10:30', item: 'بنود أخرى واختتام' }],
        agenda_en: [{ time: '09:00', item: 'Opening & previous minutes review' }, { time: '09:10', item: 'Progress report — delayed tasks' }, { time: '09:30', item: 'Decision: Gulf Partnership Contract' }, { time: '10:00', item: 'Decision: Hiring Plan & Investment Opportunity' }, { time: '10:30', item: 'AOB & Close' }]
      }
    });
  }
});

// ── AI: Correspondence ─────────────────────────────────────────────────────
router.post('/ai/correspondence', auth, async (req, res) => {
  const { type, to_name, subject_ar, subject_en, situation, signature, lang } = req.body;
  if (!situation) return res.status(400).json({ error: 'Situation required' });

  const prompt = `أنت كاتب مراسلات تنفيذي محترف لشركة أمين للذكاء الاصطناعي.
اكتب ${type || 'خطاباً رسمياً'} ${lang === 'en' ? 'in formal professional English' : 'بالعربية الرسمية الفصيحة'}.
الجهة المستلمة: ${to_name || 'الجهة المعنية'}
الموضوع: ${lang === 'en' ? (subject_en || subject_ar) : (subject_ar || '')}
الموقف: ${situation}
التوقيع: ${signature || (lang === 'en' ? 'CEO, Ameen AI Solutions' : 'الرئيس التنفيذي، أمين للذكاء الاصطناعي')}
اكتب الخطاب كاملاً فقط بدون أي تعليق.`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1000, req.user.id);
    const row = db.prepare(`
      INSERT INTO correspondence (type, to_name, subject_ar, subject_en, content, lang, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(type, to_name, subject_ar, subject_en, text, lang, req.user.id);
    res.json({ success: true, content: text, id: row.lastInsertRowid });
  } catch (e) {
    if (e.message === 'NO_API_KEY') {
      const demo = generateDemoLetter(to_name, subject_ar || subject_en, situation, signature, lang);
      res.json({ success: true, content: demo, demo: true });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

function generateDemoLetter(to, subject, situation, sig, lang) {
  if (lang === 'en') {
    return `${new Date().toLocaleDateString('en-GB')}

${to || 'To Whom It May Concern'}

Subject: ${subject || 'Official Correspondence'}

Dear Sir / Madam,

We write to you on behalf of Ameen AI Solutions regarding the above-referenced subject.

${situation}

We trust this letter meets your requirements and we remain at your disposal for any further clarification.

Yours sincerely,

${sig || 'CEO, Ameen AI Solutions'}`;
  }
  return `بسم الله الرحمن الرحيم

${new Date().toLocaleDateString('ar-SA')}

السادة / ${to || 'الجهة المعنية'}
المحترمين

الموضوع: ${subject || 'موضوع المراسلة'}

تحية طيبة وبعد،

يسعدنا التواصل معكم بشأن الموضوع المشار إليه أعلاه.

${situation}

نأمل أن تجدوا في هذا الخطاب ما يلبي متطلباتكم، ونحن رهن إشارتكم لأي استفسار أو توضيح.

وتفضلوا بقبول فائق الاحترام والتقدير،

${sig || 'الرئيس التنفيذي، أمين للذكاء الاصطناعي'}`;
}

// ── AI: Document Generator ─────────────────────────────────────────────────
router.post('/ai/document', auth, async (req, res) => {
  const { doc_type, meeting_id, details, lang, detail_level } = req.body;

  let meetingContext = '';
  if (meeting_id) {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(meeting_id);
    if (m) meetingContext = `اجتماع: ${m.title_ar}\nالتاريخ: ${m.meeting_date}\nالملخص: ${m.ai_summary_ar || ''}\nالمهام: ${m.ai_tasks || '[]'}\nالقرارات: ${m.ai_decisions || '[]'}`;
  }

  const docTypeLabels = { minutes_ar: 'محضر اجتماع بالعربية', minutes_en: 'Meeting Minutes in English', minutes_bi: 'محضر ثنائي اللغة', board_report: 'تقرير مجلس الإدارة', exec_summary: 'ملخص تنفيذي', action_plan: 'خطة العمل', decision_log: 'سجل القرارات', kpi_report: 'تقرير مؤشرات الأداء' };

  const prompt = `أنت كاتب وثائق تنفيذي محترف. أنشئ ${docTypeLabels[doc_type] || doc_type} ${lang === 'en' ? 'in English' : lang === 'bi' ? 'باللغتين العربية والإنجليزية' : 'بالعربية'}.
المستوى: ${detail_level || 'standard'}
${meetingContext}
${details ? 'تفاصيل إضافية: ' + details : ''}
اكتب الوثيقة كاملة بشكل رسمي واحترافي.`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], '', 1500, req.user.id);
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
    return `MEETING MINUTES\n${date}\n\nAttendees:\n- Ahmed Al-Omrani — CEO\n- Sara Al-Zahrani — Managing Director\n- Khalid Al-Mansour — CFO\n\nAgenda & Discussion:\n1. Q2 Performance Review — 18% growth confirmed\n2. Team Expansion — 5 new hires approved\n3. Gulf Partnership Contract — referred to legal review\n\nDecisions:\n✓ Team expansion: 5 new hires\n✓ Gulf contract: legal review\n\nAction Items:\n→ Sara: Complete Gulf contract legal review by 22 May\n→ Khalid: Prepare hiring plan by 19 May\n→ Ahmed: Study investment opportunity by 26 May\n\n---\nDocumented by Ameen AI Solutions`;
  }
  return `محضر اجتماع\n${date}\n\nالحضور:\n- م. أحمد العمراني — الرئيس التنفيذي\n- م. سارة الزهراني — المدير التنفيذي\n- م. خالد المنصور — المدير المالي\n\nبنود الاجتماع:\n1. مراجعة نتائج الربع الثاني — نمو 18% مؤكد\n2. توسعة الفريق — الموافقة على 5 موظفين جدد\n3. عقد الشراكة الخليجية — إحالة للمراجعة القانونية\n\nالقرارات:\n✓ توسعة الفريق: 5 موظفين\n✓ العقد الخليجي: مراجعة قانونية\n\nالمهام:\n→ م. سارة: إتمام المراجعة القانونية للعقد بحلول 22 مايو\n→ م. خالد: إعداد خطة التوظيف بحلول 19 مايو\n→ م. أحمد: دراسة الفرصة الاستثمارية بحلول 26 مايو\n\n---\nوُثّق بواسطة أمين للذكاء الاصطناعي`;
}

// ── Dashboard stats ────────────────────────────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const meetings = db.prepare('SELECT COUNT(*) as c FROM meetings').get().c;
  const tasks_total = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
  const tasks_open = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status != 'done'").get().c;
  const tasks_overdue = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'overdue'").get().c;
  const tasks_done = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get().c;
  const decisions = db.prepare('SELECT COUNT(*) as c FROM decisions').get().c;
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const completion = tasks_total > 0 ? Math.round((tasks_done / tasks_total) * 100) : 0;
  res.json({ meetings, tasks_total, tasks_open, tasks_overdue, tasks_done, decisions, users, completion });
});

// ── Correspondence history ─────────────────────────────────────────────────
router.get('/correspondence', auth, (req, res) => {
  res.json(db.prepare('SELECT c.*, u.name_ar as author_ar, u.name_en as author_en FROM correspondence c LEFT JOIN users u ON c.created_by=u.id ORDER BY c.created_at DESC LIMIT 20').all());
});

// ── Document history ───────────────────────────────────────────────────────
router.get('/documents', auth, (req, res) => {
  res.json(db.prepare('SELECT d.*, u.name_ar as author_ar, u.name_en as author_en FROM documents d LEFT JOIN users u ON d.created_by=u.id ORDER BY d.created_at DESC LIMIT 20').all());
});

module.exports = router;
