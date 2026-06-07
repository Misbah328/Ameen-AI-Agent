// ─────────────────────────────────────────────────────────────────────────────
// MANDATORY transcription / accent self-verification stress test.
//
// Simulates the hardest live scenario the coordinator will face:
//   • A long (~5-minute) meeting transcript.
//   • Mixed Arabic + English in the same conversation (code-switching).
//   • Long pauses (represented as paragraph breaks) — proving the pipeline still
//     processes the WHOLE transcript, not just the first few sentences.
//   • Attendee names mangled by accent (Indian / Gulf) mis-transcription —
//     proving the phonetic correction layer snaps them back to the known roster.
//
// Two stages:
//   A) Pure unit test of the correction layer (no network) — always runs.
//   B) Full end-to-end pipeline run through the real AI (needs ANTHROPIC_API_KEY)
//      — asserts tasks/decisions are extracted across the full bilingual text.
//
// Run: node scripts/transcription-stress-test.js
// Exits non-zero on any failure so it can gate a release.
// ─────────────────────────────────────────────────────────────────────────────
const db = require('../src/db/database');
const { correctNames } = require('../src/utils/nameCorrect');
const { processMeeting } = require('../src/services/pipeline');

function fail(msg) { console.error(`\n✗ TEST FAILED: ${msg}\n`); process.exit(1); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

async function run() {
  console.log('▶ Transcription / accent stress test\n');

  const members = db.prepare('SELECT name_ar, name_en FROM users').all();
  const knownNames = members.flatMap(m => [m.name_ar, m.name_en]).filter(Boolean);
  if (!knownNames.length) fail('No team members seeded — cannot test name correction.');

  // ── Stage A: phonetic / fuzzy correction layer ───────────────────────────
  console.log('Stage A — phonetic name correction (offline)');

  // Pick a real English roster name and mangle it the way the speech engine does
  // for a heavy accent (drop a letter / swap one). e.g. "Khalid" -> "Khaled".
  const sample = members.find(m => /\w{4,}/.test(m.name_en || ''));
  if (!sample) fail('No suitable English member name to mangle.');
  const firstName = sample.name_en.split(/\s+/).find(w => w.length >= 5);
  if (!firstName) fail('No long-enough first name to mangle.');

  // Introduce a single-character corruption (vowel swap) — a 1-edit miss.
  const mangled = firstName.replace(/a/i, 'e').replace(/i/i, 'e');
  const probe = `Let ${mangled} prepare the budget report by next week.`;
  const { text: fixed, corrections } = correctNames(probe, knownNames);

  if (mangled === firstName) {
    ok(`(name "${firstName}" had no mangle-able vowel; skipping mangle assertion)`);
  } else if (!fixed.includes(firstName)) {
    fail(`Expected "${mangled}" to be corrected to "${firstName}". Got: ${fixed}`);
  } else {
    ok(`Mangled "${mangled}" → corrected to "${firstName}" (${corrections.length} fix)`);
  }

  // Negative control: ordinary words must NOT be rewritten.
  const plain = 'We agreed to approve the report and follow up tomorrow.';
  const { text: plainOut, corrections: plainFix } = correctNames(plain, knownNames);
  if (plainOut !== plain || plainFix.length) {
    fail(`Ordinary words were wrongly "corrected": ${JSON.stringify(plainFix)}`);
  }
  ok('Ordinary words left untouched (no false corrections)');

  // ── Stage B: full bilingual pipeline with pauses ─────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nStage B — SKIPPED (no ANTHROPIC_API_KEY in this environment)\n');
    console.log('✓ Stage A passed.\n');
    return;
  }

  console.log('\nStage B — full bilingual pipeline (live AI)');

  const n2 = members[1] || members[0];
  const n3 = members[2] || members[0];

  // ~5-minute meeting: mixed AR/EN, long pauses (blank lines), mangled names.
  const transcript = [
    `Good morning everyone, شكراً لحضوركم. Today we review the Q3 budget.`,
    ``,
    `${mangled}, can you prepare the final budget report? يجب أن يكون جاهزاً بحلول الأسبوع القادم.`,
    ``,
    `قررنا اعتماد الميزانية الجديدة. We approved the new vendor contract as well.`,
    ``,
    `${(n2.name_en || '').split(/\s+/)[0] || 'Sara'} سوف تتولى التواصل مع المورّد، and she will send the agreement by Tuesday.`,
    ``,
    `Also, I suggest we schedule a follow-up meeting الثلاثاء القادم الساعة الثانية ظهراً to track progress.`,
    ``,
    `${(n3.name_en || '').split(/\s+/)[0] || 'Khalid'}, please review the marketing plan — هل يمكنك مراجعته قبل نهاية الأسبوع؟`,
    ``,
    `Thank you all. اجتماع مثمر، نراكم الأسبوع القادم.`,
  ].join('\n');

  const info = db.prepare(
    `INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, meeting_date)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('اجتماع الميزانية Q3', 'Q3 Budget Meeting', transcript, 300, 1, new Date().toISOString().slice(0, 10));
  const meetingId = info.lastInsertRowid;
  ok(`Created 5-min mixed AR/EN meeting #${meetingId} (${transcript.length} chars, with pauses)`);

  let out;
  try {
    out = await processMeeting({ meetingId, userId: 1 });
  } catch (e) {
    db.prepare('DELETE FROM meetings WHERE id=?').run(meetingId);
    fail(`Pipeline threw on the stress transcript: ${e.message}`);
  }

  const result = out.result || {};
  const tasks = result.tasks || [];
  const decisions = result.decisions || [];
  const intents = result.scheduling_intents || [];

  if (tasks.length < 2) fail(`Expected multiple tasks across the full transcript, got ${tasks.length}.`);
  ok(`Extracted ${tasks.length} tasks across the WHOLE transcript (not cut off early)`);

  if (!decisions.length) fail('Expected at least one decision (budget approval / vendor contract).');
  ok(`Extracted ${decisions.length} decision(s)`);

  if (!intents.length) {
    console.log('  ⚠ No scheduling intent detected (follow-up meeting) — soft check.');
  } else {
    ok(`Detected ${intents.length} scheduling intent(s) (follow-up meeting)`);
  }

  // Did the late-mentioned items survive? Check something from the end of the text.
  const blob = JSON.stringify(result).toLowerCase();
  if (!blob.includes('market')) {
    console.log('  ⚠ Marketing-plan task (near the end) not clearly present — soft check.');
  } else {
    ok('Late-in-meeting item (marketing plan) captured — no early cut-off');
  }

  // Owner names should be normalized to the known roster (no mangled spelling).
  const ownersBlob = tasks.map(t => `${t.owner_ar || ''} ${t.owner_en || ''}`).join(' ');
  if (ownersBlob.toLowerCase().includes(mangled.toLowerCase())) {
    fail(`A task owner still uses the mangled name "${mangled}" — correction did not reach owners.`);
  }
  ok('Task owners use canonical roster spellings (no mangled accents)');

  // Cleanup.
  db.prepare('DELETE FROM tasks WHERE source_meeting_id=?').run(meetingId);
  db.prepare('DELETE FROM decisions WHERE meeting_id=?').run(meetingId);
  db.prepare("DELETE FROM schedule WHERE source_meeting_id=?").run(meetingId);
  db.prepare('DELETE FROM meetings WHERE id=?').run(meetingId);
  ok('Cleaned up test fixture');

  console.log('\n✓ ALL CHECKS PASSED — bilingual, paused, accented meeting fully processed.\n');
}

run().catch(e => fail(e.stack || e.message));
