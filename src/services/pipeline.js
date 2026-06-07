// ── AI Processing Pipeline ───────────────────────────────────────────────────
// The "hidden Processing Agent": takes a transcribed meeting, runs accurate
// extraction (action items with owner + date + Pending-Review flag), detects
// scheduling intents and creates Draft meetings, and writes everything to the DB
// linked to the meeting. Every stage is traced via the Deep Log.
const db = require('../db/database');
const { callClaude } = require('../utils/claude');
const { aiLog } = require('../utils/ailog');

const UNTITLED = ['اجتماع بدون عنوان', 'Untitled Meeting', 'اجتماع جديد', 'New Meeting', ''];

// Keywords that signal an action item / a scheduling request. Used purely for the
// Deep Log so that when extraction yields nothing we can record WHY.
const ACTION_KW = ['يجب', 'سيتولى', 'سيقوم', 'مسؤول', 'مطلوب', 'بحلول', 'موعد', 'كلّف', 'نكلف',
  'task', 'action', 'responsible', 'deadline', 'must', 'will do', 'follow up', 'assign', 'prepare', 'review'];
const SCHEDULE_KW = ['نجتمع', 'اجتماع', 'موعد', 'نلتقي', 'الأسبوع القادم', 'الأسبوع المقبل', 'غداً', 'الثلاثاء', 'الأحد',
  'meet', 'schedule', 'next week', 'next tuesday', 'follow-up', 'follow up', 'set up a call', 'catch up'];

function hasAny(text, kws) {
  const t = (text || '').toLowerCase();
  return kws.some(k => t.includes(k.toLowerCase()));
}

function toMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Find confirmed schedule rows whose time window overlaps the candidate meeting.
// Drafts and the row itself (excludeId) are ignored — only finalized meetings count.
function findConflicts({ date, time, durationMins = 60, excludeId = null }) {
  const d = String(date || '').substring(0, 10);
  const tm = String(time || '').substring(0, 5);
  if (!d || !tm) return [];
  const start = toMinutes(tm);
  const end = start + (Number(durationMins) || 60);
  const rows = db.prepare(
    "SELECT * FROM schedule WHERE substr(meeting_date,1,10)=? AND (status IS NULL OR status='confirmed')"
  ).all(d);
  return rows.filter(r => {
    if (excludeId && r.id === excludeId) return false;
    const s = toMinutes(String(r.meeting_time || '').substring(0, 5));
    const e = s + (Number(r.duration_mins) || 60);
    return start < e && s < end; // overlap
  });
}

function buildSystemPrompt(memberNames, meetingDate) {
  const today = (meetingDate || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
  return `أنت "أمين"، مساعد ذكي تنفيذي متخصص في تحليل اجتماعات مجالس الإدارة بدقة عالية (بأسلوب Gemini in Meet).
أعضاء الفريق الحاليون: ${memberNames || '—'}
تاريخ الاجتماع المرجعي لحساب التواريخ النسبية: ${today}

مهامك بدقة مطلقة (قاعدة الاستخراج 100%):
1) استخرج **كل** بند عمل (action item) من النص دون أي استثناء. اعتبر التالي مهاماً يجب استخراجها:
   - الأوامر والتكليفات الصريحة ("جهّز التقرير").
   - الطلبات المصاغة كسؤال ("هل يمكنك مراجعة الميزانية؟").
   - الاقتراحات والأفكار ("ربما يجب أن نتواصل مع المورّد"، "أقترح أن نراجع العقد").
   - الالتزامات الذاتية ("سأتولى هذا"، "سأرسلها غداً").
   - أي متابعة أو وعد أو بند معلّق ذُكر ولو بشكل عابر.
   عند الشك في كون العبارة مهمة من عدمه، أدرجها كمهمة مع needs_review=true. الإغفال خطأ فادح؛ الإفراط في الاستخراج مقبول.
2) انسب كل مهمة إلى "الشخص المسؤول" بالاسم من خلال سياق الحوار.
3) استخرج التواريخ المحددة لكل مهمة (YYYY-MM-DD). حوّل العبارات النسبية مثل "الأسبوع القادم" أو "يوم الثلاثاء" إلى تاريخ مطلق بالاعتماد على تاريخ الاجتماع المرجعي.
4) إن لم تكن متأكداً من مهمة (مسؤول غير واضح، أو لا تاريخ، أو صياغة غامضة، أو كانت مجرد اقتراح/سؤال) فلا تتجاهلها إطلاقاً — أدرجها واضبط needs_review=true مع review_reason يوضح سبب عدم اليقين.
5) تعرّف على نوايا الجدولة: عبارات مثل "لنجتمع الثلاثاء القادم" أو "حدد اجتماع متابعة" يجب أن تُنتج عنصراً في scheduling_intents بتاريخ ووقت مطلقين متى أمكن.

أرجع JSON فقط بدون أي markdown أو شرح. الهيكل:
{
  "title_ar": "عنوان موجز مولّد من المحتوى",
  "title_en": "Concise generated title",
  "summary_ar": "ملخص عربي مفصل",
  "summary_en": "Detailed English summary",
  "minutes_ar": "محضر رسمي منظم بالعربية",
  "minutes_en": "Formal structured minutes in English",
  "speaker_transcript": [{"speaker":"الاسم","text_ar":"","text_en":""}],
  "tasks": [{"text_ar":"","text_en":"","owner_ar":"اسم المسؤول","owner_en":"Owner","due":"YYYY-MM-DD أو ''","priority":"urgent|normal","needs_review":false,"review_reason":""}],
  "decisions": [{"text_ar":"","text_en":""}],
  "scheduling_intents": [{"title_ar":"","title_en":"","date":"YYYY-MM-DD أو ''","time":"HH:MM أو ''","duration_mins":60,"raw_ar":"العبارة كما وردت","raw_en":""}],
  "reminders": [{"text_ar":"","text_en":""}],
  "followups": [{"text_ar":"","text_en":""}],
  "sentiment": "positive|neutral|tense",
  "speakers": ["name1"],
  "key_topics_ar": [""],
  "key_topics_en": [""]
}`;
}

// Core entry point — used by both the HTTP route and the self-verification test.
async function processMeeting({ meetingId, userId = null }) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) throw new Error('NOT_FOUND');

  const transcript = meeting.transcript || '';
  aiLog('process:start', {
    meetingId, title: meeting.title_ar,
    transcriptChars: transcript.length,
    hasActionKeywords: hasAny(transcript, ACTION_KW),
    hasScheduleKeywords: hasAny(transcript, SCHEDULE_KW)
  });

  if (!transcript.trim()) {
    aiLog('process:empty-transcript', { meetingId, reason: 'Transcript is empty — nothing for the AI to see' });
  }

  const members = db.prepare('SELECT name_ar, name_en FROM users').all();
  const memberNames = members.map(m => `${m.name_ar} / ${m.name_en}`).join(', ');
  const system = buildSystemPrompt(memberNames, meeting.meeting_date);

  const needsTitle = !meeting.title_ar || UNTITLED.includes((meeting.title_ar || '').trim());

  // Accuracy guarantee: we NEVER persist fabricated data. If the model call or
  // JSON parse fails, we log it and surface the failure so the coordinator can
  // retry — rather than silently writing synthetic tasks/meetings to the DB.
  let result;
  try {
    const raw = await callClaude([{
      role: 'user',
      content: `عنوان الاجتماع: ${needsTitle ? '(بدون عنوان — يرجى توليد عنوان مناسب)' : meeting.title_ar}\nالتاريخ: ${meeting.meeting_date}\nالنص الكامل:\n${transcript}`
    }], system, 4000, userId);
    aiLog('ai:raw', { meetingId, chars: raw.length, preview: raw.slice(0, 400) });
    result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    aiLog('ai:parsed', {
      meetingId,
      tasks: (result.tasks || []).length,
      decisions: (result.decisions || []).length,
      scheduling_intents: (result.scheduling_intents || []).length
    });
  } catch (e) {
    aiLog('ai:failed', { meetingId, error: e.message });
    db.prepare("UPDATE meetings SET status='error' WHERE id=?").run(meeting.id);
    throw new Error('AI processing failed: ' + e.message);
  }

  // ── Title (auto-generate if none) ─────────────────────────────────────────
  let finalTitleAr = meeting.title_ar;
  let finalTitleEn = meeting.title_en || meeting.title_ar;
  if (needsTitle && result.title_ar) {
    finalTitleAr = result.title_ar;
    finalTitleEn = result.title_en || result.title_ar;
    db.prepare('UPDATE meetings SET title_ar=?, title_en=? WHERE id=?').run(finalTitleAr, finalTitleEn, meeting.id);
  }

  // ── Persist AI fields on the meeting ──────────────────────────────────────
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

  // ── Idempotency: clear previously AI-derived rows for this meeting before
  // re-inserting, so re-processing (e.g. auto-process on stop + manual button)
  // never duplicates. Confirmed drafts are preserved (only status='draft' cleared).
  db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(meeting.id);
  db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(meeting.id);
  db.prepare("DELETE FROM schedule WHERE source_meeting_id=? AND status='draft'").run(meeting.id);

  // ── Sync tasks into the tasks table (linked to Meeting_ID) ────────────────
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  let tasksCreated = 0, needsReviewCount = 0;
  if (!tasks.length) {
    const reason = hasAny(transcript, ACTION_KW)
      ? 'AI returned no tasks despite actionable keywords being present in the transcript'
      : 'No actionable keywords found';
    aiLog('task:none', { meetingId, reason });
  } else {
    const insertTask = db.prepare(`
      INSERT INTO tasks (text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, needs_review, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of tasks) {
      // Match on whichever owner field the model returned (AR or EN). A sentinel
      // is used for the empty side so a blank field never LIKE-matches every user.
      let u = null;
      if (t.owner_ar || t.owner_en) {
        const likeAr = t.owner_ar ? `%${t.owner_ar}%` : '\u0000';
        const likeEn = t.owner_en ? `%${t.owner_en}%` : '\u0000';
        u = db.prepare("SELECT id FROM users WHERE name_ar LIKE ? OR name_en LIKE ?").get(likeAr, likeEn);
      }
      // Flag for review when the model says so, or when owner/date are missing.
      const uncertain = Boolean(t.needs_review) || !(t.owner_ar || t.owner_en) || !t.due;
      const review = uncertain ? 1 : 0;
      needsReviewCount += review;
      insertTask.run(
        t.text_ar, t.text_en || t.text_ar,
        u ? u.id : null, t.owner_ar || '', t.owner_en || '',
        t.due || '', t.priority || 'normal', review,
        meeting.id, finalTitleAr, finalTitleEn, userId || meeting.recorded_by || null
      );
      tasksCreated++;
      aiLog('task:created', {
        meetingId, text: (t.text_ar || '').slice(0, 80), owner: t.owner_ar || '(unassigned)',
        due: t.due || '(none)', needs_review: review === 1, reason: review ? (t.review_reason || 'missing owner/date') : ''
      });
    }
  }

  // ── Decisions ─────────────────────────────────────────────────────────────
  const decisions = Array.isArray(result.decisions) ? result.decisions : [];
  if (decisions.length) {
    const insertDecision = db.prepare(`INSERT INTO decisions (text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en) VALUES (?, ?, ?, ?, ?)`);
    decisions.forEach(d => insertDecision.run(d.text_ar, d.text_en || d.text_ar, meeting.id, finalTitleAr, finalTitleEn));
  }

  // ── Proactive scheduling: turn intents into Draft meetings ────────────────
  const intents = Array.isArray(result.scheduling_intents) ? result.scheduling_intents : [];
  let draftsCreated = 0;
  if (!intents.length) {
    if (hasAny(transcript, SCHEDULE_KW)) {
      aiLog('schedule:none', { meetingId, reason: 'Scheduling keywords present but AI extracted no intent' });
    }
  } else {
    const insertDraft = db.prepare(`
      INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, reminder_channel, status, source_meeting_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `);
    for (const it of intents) {
      const date = String(it.date || '').substring(0, 10);
      const time = String(it.time || '').substring(0, 5);
      const dur = Number(it.duration_mins) || 60;
      const titleAr = it.title_ar || 'اجتماع متابعة (مسودة)';
      const titleEn = it.title_en || it.title_ar || 'Follow-up meeting (draft)';
      const conflicts = findConflicts({ date, time, durationMins: dur });
      const row = insertDraft.run(
        titleAr, titleEn, date, time, dur,
        'قاعة الاجتماعات', '', it.raw_ar || '', it.raw_en || '', 'email',
        meeting.id, userId || meeting.recorded_by || null
      );
      draftsCreated++;
      aiLog('schedule:draft-created', {
        meetingId, draftId: row.lastInsertRowid, title: titleAr,
        date: date || '(unresolved)', time: time || '(unset)',
        conflicts: conflicts.length, raw: it.raw_ar || it.raw_en || ''
      });
    }
  }

  aiLog('process:done', { meetingId, tasksCreated, needsReview: needsReviewCount, draftsCreated });
  return { result, tasksCreated, needsReviewCount, draftsCreated };
}

module.exports = { processMeeting, findConflicts };
