// ── AI Processing Pipeline ───────────────────────────────────────────────────
// The "hidden Processing Agent": takes a transcribed meeting, runs accurate
// extraction (action items with owner + date + Pending-Review flag), detects
// scheduling intents and creates Draft meetings, and writes everything to the DB
// linked to the meeting. Every stage is traced via the Deep Log.
const db = require('../db/database');
const { callClaude } = require('../utils/claude');
const { aiLog } = require('../utils/ailog');
const { correctNames } = require('../utils/nameCorrect');

const UNTITLED = ['اجتماع بدون عنوان', 'Untitled Meeting', 'اجتماع جديد', 'New Meeting', ''];

// ── Robust JSON extraction from Claude's response ───────────────────────────
// The model is asked for JSON-only output, but in practice it can still wrap
// the object in markdown code fences, add stray prose around it, or (for long
// transcripts, e.g. pasted meeting minutes) get cut off mid-string when the
// response hits the token limit. This extracts the JSON object defensively and
// repairs simple truncation before giving up, so one malformed response can't
// crash meeting processing.
function extractJsonObject(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text;
}

// Walks the text tracking string/bracket state, remembers the last position
// where a value cleanly ended (after a comma or closing bracket, outside any
// string), then truncates there and closes whatever brackets were still open.
// Returns null if no safe cut point was found (nothing usable to repair).
function repairTruncatedJson(text) {
  let inString = false, escape = false;
  const stack = [];
  let lastSafeIndex = -1, lastSafeStack = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') stack.pop();
    if (ch === ',' || ch === '}' || ch === ']') { lastSafeIndex = i; lastSafeStack = stack.slice(); }
  }
  if (lastSafeIndex === -1 || !lastSafeStack || !lastSafeStack.length) return null;
  const truncated = text.slice(0, lastSafeIndex + 1).replace(/,\s*$/, '');
  const closers = { '{': '}', '[': ']' };
  let suffix = '';
  for (let i = lastSafeStack.length - 1; i >= 0; i--) suffix += closers[lastSafeStack[i]];
  return truncated + suffix;
}

function parseAiJson(raw) {
  const text = extractJsonObject(raw);
  try {
    return JSON.parse(text);
  } catch (e) {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (_) {
        // fall through to the friendly error below
      }
    }
    throw new Error(
      'The AI response could not be parsed as valid JSON — it may have been cut off for a very long transcript. Please try again, or shorten the pasted text and retry.',
    );
  }
}

// Parse explicit [Speaker Name]: text tags that the coordinator placed during
// recording. Returns an array of {speaker,text_ar,text_en} segments, or [] if
// the transcript has no such tags (AI-generated speaker_transcript is used instead).
function parseTaggedSpeakers(text) {
  if (!text || !/\[[^\]]+\]:/.test(text)) return [];
  const segments = text.split(/\n?\[([^\]]+)\]:\s*/);
  const result = [];
  const preamble = (segments[0] || '').trim();
  if (preamble) result.push({ speaker: '', text_ar: preamble, text_en: preamble });
  for (let i = 1; i + 1 < segments.length; i += 2) {
    const speaker = (segments[i] || '').trim();
    const content = (segments[i + 1] || '').trim();
    if (speaker || content) result.push({ speaker, text_ar: content, text_en: content });
  }
  return result;
}

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

// ── Extraction prompt (bilingual, structured facts) ───────────────────────────
// Unchanged in substance from the original single mega-prompt, MINUS the two
// free-text minutes_ar/minutes_en fields — those are now generated by their
// own dedicated, native-language prompts below (buildArabicMinutesPrompt /
// buildEnglishMinutesPrompt) so neither language has to compete with this
// call's ~10 other structured outputs for the token budget, and neither one
// can get silently truncated by the other (the original single-call design's
// root failure mode: minutes_ar/minutes_en were the LAST two keys requested,
// so a long transcript hitting the 8000-token output cap disproportionately
// cut off exactly the two fields this rewrite now protects).
function buildExtractionPrompt(memberNames, meetingDate) {
  const today = (meetingDate || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
  return `أنت "أمين"، مساعد ذكي تنفيذي متخصص في تحليل اجتماعات مجالس الإدارة بدقة عالية.
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
2) انسب كل مهمة إلى "الشخص المسؤول" بالاسم من خلال سياق الحوار. عند ذكر اسم شخص، طابقه دائماً مع أقرب اسم من قائمة أعضاء الفريق أعلاه وصحّح أي خطأ إملائي ناتج عن التعرّف الصوتي ليطابق الاسم المعروف بالضبط (لا تخترع أسماء غير موجودة في القائمة).
3) استخرج التواريخ المحددة لكل مهمة (YYYY-MM-DD). حوّل العبارات النسبية مثل "الأسبوع القادم" أو "يوم الثلاثاء" إلى تاريخ مطلق بالاعتماد على تاريخ الاجتماع المرجعي.
4) إن لم تكن متأكداً من مهمة (مسؤول غير واضح، أو لا تاريخ، أو صياغة غامضة، أو كانت مجرد اقتراح/سؤال) فلا تتجاهلها إطلاقاً — أدرجها واضبط needs_review=true مع review_reason يوضح سبب عدم اليقين.
5) تعرّف على نوايا الجدولة: عبارات مثل "لنجتمع الثلاثاء القادم" أو "حدد اجتماع متابعة" يجب أن تُنتج عنصراً في scheduling_intents بتاريخ ووقت مطلقين متى أمكن.
6) إذا كان النص يحتوي على بوادئ بالشكل [اسم]: فهذه علامات متحدث فعلية مُعيَّنة يدوياً من المنسّق — اعتمد عليها مصدراً رئيسياً لحقل speaker_transcript وللنسب الصحيحة للمهام.
7) استخرج المخاطر والتحديات: أي تهديد أو عائق أو قلق ذُكر صراحةً أو استُنتج من السياق. صنّف الخطورة: high (يهدد الهدف الرئيسي أو الجدول الزمني)، medium (يعيق التنفيذ ويحتاج متابعة)، low (ملاحظة احترازية). أضف تدابير تخفيف موجزة. إذا لم تكن هناك مخاطر واضحة أعِد مصفوفة فارغة.

أرجع JSON فقط بدون أي markdown أو شرح. الهيكل:
{
  "title_ar": "عنوان موجز مولّد من المحتوى",
  "title_en": "Concise generated title",
  "summary_ar": "ملخص عربي مفصل",
  "summary_en": "Detailed English summary",
  "speaker_transcript": [{"speaker":"الاسم","text_ar":"","text_en":""}],
  "tasks": [{"text_ar":"","text_en":"","owner_ar":"اسم المسؤول","owner_en":"Owner","due":"YYYY-MM-DD أو ''","priority":"urgent|normal","needs_review":false,"review_reason":""}],
  "decisions": [{"text_ar":"","text_en":""}],
  "risks": [{"text_ar":"","text_en":"","severity":"high|medium|low","mitigation_ar":"تدابير التخفيف","mitigation_en":"Mitigation steps"}],
  "scheduling_intents": [{"title_ar":"","title_en":"","date":"YYYY-MM-DD أو ''","time":"HH:MM أو ''","duration_mins":60,"raw_ar":"العبارة كما وردت","raw_en":""}],
  "reminders": [{"text_ar":"","text_en":""}],
  "followups": [{"text_ar":"","text_en":""}],
  "sentiment": "positive|neutral|tense",
  "speakers": ["name1"],
  "key_topics_ar": [""],
  "key_topics_en": [""]
}`;
}

// ── Arabic minutes prompt — native formal board-secretary register ───────────
// Written entirely from the perspective of a professional Gulf/Saudi corporate
// board secretary, NOT as an assistant chatbot and NOT as a translation target
// for the English prompt below. Explicitly instructs formal reporting voice
// (المبني للمجهول), rejects literal translation of English fragments in mixed
// transcripts, and asks the model to silently repair speech-to-text disfluency
// without inventing facts.
function buildArabicMinutesPrompt(memberNames, meetingDate) {
  const today = (meetingDate || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
  return `أنت أمين سر مجلس إدارة محترف في مؤسسة سعودية/خليجية، متخصص في كتابة محاضر الاجتماعات الرسمية وفق الأعراف المؤسسية والحوكمية المعتمدة في الشركات ومجالس الإدارة بدول الخليج.
أعضاء الفريق المعروفون: ${memberNames || '—'}
تاريخ الاجتماع: ${today}

مهمتك: تحويل نص اجتماع خام (قد يحتوي أخطاء تفريغ صوتي، جملاً غير مكتملة، أو خلطاً بين العربية والإنجليزية) إلى محضر اجتماع رسمي بالفصحى الرسمية المعتمدة في المحاضر المؤسسية — وليس أسلوب محادثة أو ترجمة حرفية.

قواعد الصياغة الإلزامية:
- استخدم صيغة التقرير الرسمي المتّبعة في محاضر مجالس الإدارة ("تم استعراض..."، "ناقش الأعضاء..."، "تقرر...") بدلاً من الأسلوب المباشر أو العامي.
- عند ورود أجزاء إنجليزية في النص، لا تترجمها حرفياً كلمة بكلمة؛ أعد صياغة معناها بأسلوب عربي رسمي طبيعي كما يكتبه أمين سر محترف يفهم السياق الكامل.
- صحّح تلقائياً وبصمت الركاكة الناتجة عن التفريغ الصوتي (تكرار كلمات، جمل غير مكتملة، حشو لفظي مثل "يعني"، "امم") دون تغيير المعنى أو اختلاق أي معلومة غير واردة في النص.
- استخدم علامات الترقيم العربية الصحيحة وفقرات قصيرة وواضحة — لا تكتب فقرة واحدة ضخمة تجمع كل شيء.
- طابق أي اسم شخص مذكور مع أقرب اسم من قائمة الأعضاء أعلاه وصحّح خطأه الإملائي إن وُجد.
- عند غياب معلومة (كتحديد الحضور أو موعد الاجتماع القادم) اكتب "غير محدد في النص" أو مصفوفة فارغة بدلاً من اختلاقها إطلاقاً.

أعد JSON فقط بدون أي شرح خارج JSON، بالبنية التالية:
{
  "executive_summary": "ملخص تنفيذي رسمي من 3 إلى 5 جمل بأسلوب محضر مجلس إدارة",
  "attendees": ["الاسم الكامل كما ورد أو كما طابقته من قائمة الأعضاء"],
  "apologies": ["أسماء من ذُكر اعتذارهم صراحة عن الحضور، وإلا مصفوفة فارغة"],
  "agenda": ["بند جدول الأعمال 1", "بند 2"],
  "discussion": [{"topic": "عنوان البند", "narrative": "سرد رسمي موجز (فقرة أو فقرتان قصيرتان) لما دار من نقاش حول هذا البند"}],
  "next_meeting_note": "أي إشارة لموعد الاجتماع القادم كما وردت في النص، أو نص فارغ إن لم يُذكر"
}`;
}

// ── English minutes prompt — native formal board-secretary register ──────────
// Designed independently from the Arabic prompt above (not a translation of
// it) — full corporate-secretary framing, its own explicit formality rules,
// and its own dedicated token budget so English quality no longer depends on
// whatever the Arabic-authored instructions left over.
function buildEnglishMinutesPrompt(memberNames, meetingDate) {
  const today = (meetingDate || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
  return `You are a professional corporate board secretary specializing in formal meeting minutes for boards and executive committees, following standard corporate governance conventions.
Known team members: ${memberNames || '—'}
Meeting date: ${today}

Your task: transform a raw meeting transcript (which may contain speech-to-text errors, incomplete sentences, or a mix of Arabic and English) into formal, professional English board minutes — not a literal translation and not conversational language.

Mandatory writing rules:
- Use formal minute-taking conventions and reporting voice ("The Board reviewed...", "Members discussed...", "It was noted that...") rather than casual first- or second-person phrasing.
- When the transcript contains Arabic portions, do not translate them word-for-word; rewrite their meaning in natural, professional English as an experienced corporate secretary who understood the full context would.
- Silently and automatically correct speech-to-text artifacts (repeated words, incomplete sentences, verbal filler like "um", "you know") without changing meaning or inventing any information not present in the transcript.
- Use correct punctuation and short, clear paragraphs — never one large undifferentiated paragraph.
- Match any person mentioned to the closest name in the member list above and correct minor misspellings.
- When information is missing (e.g. a specific attendee list, next meeting date), write "Not specified in the transcript" or an empty array rather than inventing it.

Return JSON only, no explanation outside the JSON, with this exact structure:
{
  "executive_summary": "A formal 3-5 sentence executive summary in board-minutes style",
  "attendees": ["Full name as stated or matched from the member list"],
  "apologies": ["Names explicitly noted as absent/excused, else empty array"],
  "agenda": ["Agenda item 1", "Item 2"],
  "discussion": [{"topic": "Item title", "narrative": "Formal, concise narrative (one or two short paragraphs) of what was discussed on this item"}],
  "next_meeting_note": "Any reference to the next meeting as stated in the transcript, or an empty string if not mentioned"
}`;
}

// ── Conservative transcript cleaner ───────────────────────────────────────────
// Raw browser Speech-to-Text output often contains immediate word/phrase
// stutter-repeats ("the the budget", "أن أن") and a small set of verbal filler
// tokens. This is deliberately narrow (whole-word/phrase matches only) so it
// can never eat real content — it runs on the COPY sent to the AI only; the
// stored transcript stays verbatim, same guarantee as correctNames().
const FILLER_WORDS = ['um', 'uh', 'umm', 'uhh', 'يعني', 'امم', 'إمم', 'آآ', 'اه', 'ااه'];
function cleanTranscriptForAI(text) {
  if (!text) return text;
  let out = text;
  // Collapse immediate repeated words/short phrases (case-insensitive), e.g.
  // "the the report" -> "the report", "أن أن نراجع" -> "أن نراجع".
  out = out.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  // Strip standalone filler tokens (word-boundary safe so it never touches
  // substrings of real words).
  const fillerPattern = new RegExp(`\\b(${FILLER_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  out = out.replace(fillerPattern, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}

// Core entry point — used by both the HTTP route and the self-verification test.
// Merges one language's minutes narrative (executive_summary/attendees/agenda/
// discussion/next_meeting_note from buildArabicMinutesPrompt or
// buildEnglishMinutesPrompt) with the canonical extraction result (decisions/
// tasks/risks/followups from buildExtractionPrompt) into ONE self-contained,
// structured document — stored as a JSON string in the existing ai_minutes_ar/
// ai_minutes_en columns (no schema change). This is the single source of
// truth rendered by both the frontend and the Board Pack PDF, so "Key
// Decisions" / "Executive Actions" shown inside the minutes document can
// never drift from the actual decisions/tasks tables. meeting_info and
// approvals are assembled from real DB fields, never asked of the model, to
// avoid the AI inventing dates/statuses that already exist as ground truth.
function assembleMinutesDoc(lang, narrative, extraction, meeting) {
  const isAr = lang === 'ar';
  const pick = (ar, en) => (isAr ? ar : (en || ar)) || '';
  const failed = !narrative || narrative._error;
  return JSON.stringify({
    format: 'structured_v1',
    generation_error: failed ? (narrative && narrative._error) || 'generation_failed' : null,
    executive_summary: failed ? '' : (narrative.executive_summary || ''),
    meeting_info: {
      date: meeting.meeting_date || '',
      type: meeting.meeting_type || '',
      duration_mins: meeting.duration || 0,
    },
    attendees: failed ? [] : (Array.isArray(narrative.attendees) ? narrative.attendees : []),
    apologies: failed ? [] : (Array.isArray(narrative.apologies) ? narrative.apologies : []),
    agenda: failed ? [] : (Array.isArray(narrative.agenda) ? narrative.agenda : []),
    discussion: failed ? [] : (Array.isArray(narrative.discussion) ? narrative.discussion : []),
    decisions: (extraction.decisions || []).map(d => pick(d.text_ar, d.text_en)).filter(Boolean),
    actions: (extraction.tasks || []).map(t => ({
      text: pick(t.text_ar, t.text_en),
      owner: pick(t.owner_ar, t.owner_en),
      due: t.due || '',
    })).filter(a => a.text),
    risks: (extraction.risks || []).map(r => ({
      text: pick(r.text_ar, r.text_en),
      severity: r.severity || 'low',
      mitigation: pick(r.mitigation_ar, r.mitigation_en),
    })).filter(r => r.text),
    followups: (extraction.followups || []).map(f => pick(f.text_ar, f.text_en)).filter(Boolean),
    next_meeting_note: failed ? '' : (narrative.next_meeting_note || ''),
    approvals: {
      status: meeting.minutes_status || 'draft',
      circulated_at: meeting.circulated_at || null,
      approved_at: meeting.approved_at || null,
      final_approved_at: meeting.final_approved_at || null,
    },
  });
}

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
  const extractionSystem = buildExtractionPrompt(memberNames, meeting.meeting_date);
  const arMinutesSystem = buildArabicMinutesPrompt(memberNames, meeting.meeting_date);
  const enMinutesSystem = buildEnglishMinutesPrompt(memberNames, meeting.meeting_date);

  // Phonetic correction layer: snap mis-transcribed attendee names back to their
  // known spelling BEFORE the AI sees them, so owner-matching and the minutes use
  // the right names. The stored transcript is left untouched (kept verbatim).
  const knownNames = members.flatMap(m => [m.name_ar, m.name_en]).filter(Boolean);
  const { text: correctedTranscript, corrections } = correctNames(transcript, knownNames);
  if (corrections.length) {
    aiLog('process:name-correction', { meetingId, count: corrections.length, corrections: corrections.slice(0, 20) });
  }
  // Light disfluency cleanup (stutter-repeats, filler words) on the copy the AI
  // sees — stored transcript stays verbatim, same guarantee as name correction.
  const aiTranscript = cleanTranscriptForAI(correctedTranscript);

  const needsTitle = !meeting.title_ar || UNTITLED.includes((meeting.title_ar || '').trim());
  const userContent = `عنوان الاجتماع: ${needsTitle ? '(بدون عنوان — يرجى توليد عنوان مناسب)' : meeting.title_ar}\nالتاريخ: ${meeting.meeting_date}\nالنص الكامل:\n${aiTranscript}`;

  // Three independent calls run in parallel (not sequentially — same total
  // latency as the old single call): structured extraction (tasks/decisions/
  // risks/followups/summary/title — the operationally critical output) plus
  // two dedicated, native-language minutes calls that no longer compete with
  // each other or with the extraction fields for token budget. Extraction
  // failing still fails the whole meeting (tasks/decisions are the critical
  // path); a minutes call failing is logged and surfaced honestly in that
  // language's document rather than silently falling back to the other
  // language's text (the original bug: every render site did
  // `ai_minutes_en || ai_minutes_ar`, so a failed/truncated English call could
  // silently display Arabic text mislabeled as English).
  const [extractionSettled, arMinutesSettled, enMinutesSettled] = await Promise.allSettled([
    callClaude([{ role: 'user', content: userContent }], extractionSystem, 4096, userId, 0.3),
    callClaude([{ role: 'user', content: userContent }], arMinutesSystem, 4096, userId, 0.3),
    callClaude([{ role: 'user', content: userContent }], enMinutesSystem, 4096, userId, 0.3),
  ]);

  let result;
  if (extractionSettled.status === 'rejected') {
    aiLog('ai:failed', { meetingId, error: extractionSettled.reason?.message });
    db.prepare("UPDATE meetings SET status='error' WHERE id=?").run(meeting.id);
    throw new Error('AI processing failed: ' + extractionSettled.reason?.message);
  }
  try {
    aiLog('ai:raw', { meetingId, chars: extractionSettled.value.length, preview: extractionSettled.value.slice(0, 400) });
    result = parseAiJson(extractionSettled.value);
    aiLog('ai:parsed', {
      meetingId,
      tasks: (result.tasks || []).length,
      decisions: (result.decisions || []).length,
      risks: (result.risks || []).length,
      followups: (result.followups || []).length,
      scheduling_intents: (result.scheduling_intents || []).length
    });
  } catch (e) {
    aiLog('ai:failed', { meetingId, error: e.message });
    db.prepare("UPDATE meetings SET status='error' WHERE id=?").run(meeting.id);
    throw new Error('AI processing failed: ' + e.message);
  }

  let arNarrative, enNarrative;
  if (arMinutesSettled.status === 'fulfilled') {
    try { arNarrative = parseAiJson(arMinutesSettled.value); }
    catch (e) { arNarrative = { _error: e.message }; aiLog('minutes:ar-parse-failed', { meetingId, error: e.message }); }
  } else {
    arNarrative = { _error: arMinutesSettled.reason?.message || 'unknown error' };
    aiLog('minutes:ar-failed', { meetingId, error: arNarrative._error });
  }
  if (enMinutesSettled.status === 'fulfilled') {
    try { enNarrative = parseAiJson(enMinutesSettled.value); }
    catch (e) { enNarrative = { _error: e.message }; aiLog('minutes:en-parse-failed', { meetingId, error: e.message }); }
  } else {
    enNarrative = { _error: enMinutesSettled.reason?.message || 'unknown error' };
    aiLog('minutes:en-failed', { meetingId, error: enNarrative._error });
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
  // If the coordinator tagged speakers during recording, parse those [Name]: markers
  // as the authoritative speaker_transcript rather than relying on AI guessing.
  const parsedSpeakers = parseTaggedSpeakers(transcript);
  const finalSpeakerTr = parsedSpeakers.length
    ? parsedSpeakers
    : (result.speaker_transcript || []);
  const finalSpeakers = parsedSpeakers.length
    ? [...new Set(parsedSpeakers.map(s => s.speaker).filter(Boolean))]
    : (result.speakers || []);
  if (parsedSpeakers.length) {
    aiLog('process:speaker-tags-parsed', { meetingId, count: parsedSpeakers.length });
  }

  const minutesAr = assembleMinutesDoc('ar', arNarrative, result, meeting);
  const minutesEn = assembleMinutesDoc('en', enNarrative, result, meeting);

  db.prepare(`
    UPDATE meetings SET
      ai_summary_ar=?, ai_summary_en=?,
      ai_tasks=?, ai_decisions=?,
      ai_reminders=?, ai_followups=?,
      ai_risks=?,
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
    JSON.stringify(result.risks || []),
    result.sentiment || 'neutral',
    JSON.stringify(finalSpeakers),
    minutesAr, minutesEn,
    JSON.stringify(finalSpeakerTr),
    meeting.id
  );

  result.title_ar = finalTitleAr;
  result.title_en = finalTitleEn;
  // Parsed (not stringified) structured minutes, for the immediate post-
  // processing response — the frontend would otherwise have no way to show
  // the just-generated minutes without a second round-trip to re-fetch the
  // meeting, since minutes_ar/minutes_en are no longer part of the
  // extraction call's own JSON contract (see buildExtractionPrompt).
  result.minutes_ar_doc = JSON.parse(minutesAr);
  result.minutes_en_doc = JSON.parse(minutesEn);

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
      INSERT INTO tasks (text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, needs_review, review_status, ai_confidence, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
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
      // AI Task Review confidence: low when the model itself flagged uncertainty
      // or owner/date are missing; high when a real team member was matched AND
      // a due date was extracted; medium otherwise (e.g. owner named but unmatched).
      const confidence = uncertain ? 'low' : (u && t.due ? 'high' : 'medium');
      insertTask.run(
        t.text_ar, t.text_en || t.text_ar,
        u ? u.id : null, t.owner_ar || '', t.owner_en || '',
        t.due || '', t.priority || 'normal', review, confidence,
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
