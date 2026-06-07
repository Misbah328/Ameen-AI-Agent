// ─────────────────────────────────────────────────────────────────────────────
// MANDATORY Edit-to-Reminder integrity test.
//
// Scenario (mirrors the live demo):
//   1) Create a scheduled meeting with the WRONG time.
//   2) Edit it to the CORRECT time (within the reminder lead window) — the same
//      two-way path the UI uses (a direct UPDATE on the schedule row).
//   3) Assert the reminder message built from the row contains the EDITED time
//      (proving edits flow through to the notification, no stale data).
//   4) Run the real reminder worker (checkAndSend) and assert it does NOT throw,
//      proving the app stays stable even if the actual Twilio/email send fails.
//
// Run: node scripts/edit-to-reminder-test.js
// Exits non-zero on any failure so it can gate a release.
// ─────────────────────────────────────────────────────────────────────────────
const db = require('../src/db/database');
const { buildReminderMessage, checkAndSend, LEAD_MINUTES } = require('../src/reminders');

function fail(msg) {
  console.error(`\n✗ TEST FAILED: ${msg}\n`);
  process.exit(1);
}
function ok(msg) { console.log(`  ✓ ${msg}`); }

// Format a Date into the YYYY-MM-DD / HH:MM the schedule table stores.
function parts(d) {
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function run() {
  console.log('▶ Edit-to-Reminder test\n');

  // A correct time inside the lead window (so the reminder is actually due), and
  // a deliberately wrong time far outside it.
  const now = new Date();
  const correctDt = new Date(now.getTime() + Math.max(1, LEAD_MINUTES - 5) * 60000);
  const wrongDt = new Date(now.getTime() + 6 * 60 * 60000); // 6h out — not due yet
  const correct = parts(correctDt);
  const wrong = parts(wrongDt);

  const TITLE_AR = 'اجتماع "مجلس الإدارة" الطارئ';
  const TITLE_EN = 'Emergency "Board" Meeting';

  // 1) Create with the WRONG time. Use a phones-only attendee so the WhatsApp
  //    channel is exercised, with a valid E.164 number.
  const ins = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, reminder_channel, status, reminder_sent)
    VALUES (?, ?, ?, ?, 60, 'Zoom', ?, 'whatsapp', 'confirmed', 0)
  `).run(TITLE_AR, TITLE_EN, wrong.date, wrong.time, '+15005550006');
  const id = ins.lastInsertRowid;
  ok(`Created meeting #${id} with WRONG time ${wrong.time}`);

  // Sanity: the wrong-time row must NOT yet contain the correct time.
  let row = db.prepare('SELECT * FROM schedule WHERE id=?').get(id);
  const wrongMsg = buildReminderMessage(row, 999);
  if (wrongMsg.body.includes(correct.time)) fail('Reminder already shows the correct time before the edit — fixture is wrong');
  ok('Pre-edit reminder does not contain the corrected time');

  // 2) Edit to the CORRECT time (two-way sync path).
  db.prepare('UPDATE schedule SET meeting_date=?, meeting_time=? WHERE id=?').run(correct.date, correct.time, id);
  row = db.prepare('SELECT * FROM schedule WHERE id=?').get(id);
  if (row.meeting_time.substring(0, 5) !== correct.time) fail('DB did not persist the edited time');
  ok(`Edited meeting #${id} to CORRECT time ${correct.time} (persisted in DB)`);

  // 3) Reminder built from the edited row must contain the EDITED time.
  const msg = buildReminderMessage(row, LEAD_MINUTES);
  if (!msg.body.includes(correct.time)) fail(`Reminder body is missing the edited time ${correct.time}`);
  if (!msg.subject.includes(correct.time)) fail(`Reminder subject is missing the edited time ${correct.time}`);
  if (msg.body.includes(wrong.time) && wrong.time !== correct.time) fail(`Reminder still contains the stale wrong time ${wrong.time}`);
  ok('Reminder subject + body contain the EDITED time and not the stale time');

  // 4) The real worker must run without throwing, even if the Twilio send fails
  //    (no live credentials / invalid sandbox number). Stability is the assertion.
  let threw = null;
  try {
    await checkAndSend();
  } catch (e) {
    threw = e;
  }
  if (threw) fail(`checkAndSend threw — app would be unstable: ${threw.message}`);
  ok('checkAndSend() completed without throwing (app stays stable)');

  // Cleanup the fixture row.
  db.prepare('DELETE FROM schedule WHERE id=?').run(id);
  ok('Cleaned up test fixture');

  console.log('\n✓ ALL CHECKS PASSED — edit flows into the reminder and the app stays stable.\n');
  process.exit(0);
}

run().catch(e => fail(e.stack || e.message));
