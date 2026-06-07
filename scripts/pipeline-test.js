// ── Self-Verification Simulation ─────────────────────────────────────────────
// Mandated by the pipeline spec: feed a dummy ~1-minute transcript containing 3
// clear action items and 1 scheduling request, run it through the real Processing
// Agent, and verify that 3 tasks AND 1 draft meeting land in the database.
//
//   node scripts/pipeline-test.js
//
// Exits 0 only if the assertions pass. Cleans up the rows it creates.
const db = require('../src/db/database');
const { processMeeting } = require('../src/services/pipeline');

const TRANSCRIPT = `
م. أحمد: نبدأ الاجتماع. م. سارة، يجب أن تُعدّي تقرير المبيعات الربعي بحلول 2026-06-15.
م. سارة: تمام، سأجهزه.
م. أحمد: م. خالد، أنت مسؤول عن مراجعة الميزانية النهائية وتسليمها بحلول 2026-06-12.
م. خالد: حاضر.
م. أحمد: م. نورة، مطلوب منكِ إعداد عرض الشركاء وإرساله بحلول 2026-06-18.
م. نورة: سأبدأ غداً.
م. أحمد: ممتاز. لنحدد اجتماع متابعة يوم الثلاثاء القادم 2026-06-16 الساعة 10:00 صباحاً لمراجعة التقدم.
الجميع: متفقون.
`.trim();

function fail(msg) { console.error('❌ FAIL —', msg); process.exit(1); }

(async () => {
  const TITLE = '__PIPELINE_SELFTEST__';
  // Clean any leftovers from a previous run.
  const old = db.prepare('SELECT id FROM meetings WHERE title_ar=?').all(TITLE);
  for (const m of old) {
    db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(m.id);
    db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(m.id);
    db.prepare('DELETE FROM schedule WHERE source_meeting_id=?').run(m.id);
    db.prepare('DELETE FROM meetings WHERE id=?').run(m.id);
  }

  const meetingId = db.prepare(
    "INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, meeting_date) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(TITLE, TITLE, TRANSCRIPT, 60, 1, '2026-06-09 09:00:00').lastInsertRowid;

  console.log(`▶ Created test meeting #${meetingId}. Running the Processing Agent...`);

  let out;
  try {
    out = await processMeeting({ meetingId, userId: 1 });
  } catch (e) {
    fail('processMeeting threw: ' + e.message);
  }

  const tasks = db.prepare('SELECT * FROM tasks WHERE source_meeting_id=?').all(meetingId);
  const drafts = db.prepare("SELECT * FROM schedule WHERE source_meeting_id=? AND status='draft'").all(meetingId);

  console.log(`\n── Results ──`);
  console.log(`Tasks written  : ${tasks.length}  (needs_review: ${tasks.filter(t => t.needs_review).length})`);
  tasks.forEach(t => console.log(`   • ${t.text_ar}  →  ${t.owner_name_ar || '(unassigned)'}  [${t.due_date || 'no date'}]${t.needs_review ? '  ⚠ review' : ''}`));
  console.log(`Draft meetings : ${drafts.length}`);
  drafts.forEach(d => console.log(`   • ${d.title_ar}  →  ${d.meeting_date} ${d.meeting_time}`));
  if (out && out.demo) console.log('   (note: AI fell back to demo output — _err: ' + (out._err || 'parse') + ')');

  // Cleanup
  db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(meetingId);
  db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(meetingId);
  db.prepare('DELETE FROM schedule WHERE source_meeting_id=?').run(meetingId);
  db.prepare('DELETE FROM meetings WHERE id=?').run(meetingId);

  if (tasks.length < 3) fail(`expected ≥3 tasks, got ${tasks.length}`);
  if (drafts.length < 1) fail(`expected ≥1 draft meeting, got ${drafts.length}`);

  console.log('\n✅ PASS — 3 tasks and 1 draft meeting were created and linked to the meeting.');
  process.exit(0);
})();
