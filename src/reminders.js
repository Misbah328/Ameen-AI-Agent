// Background scheduler — sends email reminders ~15 minutes before each scheduled
// meeting. Uses Replit Mail (blueprint:replitmail), delivered to the workspace
// owner's verified Replit email. No SMTP credentials required.
const db = require('./db/database');
const { sendEmail } = require('./utils/replitmail');
const notify = require('./utils/notify');

const LEAD_MINUTES = 15;

function meetingDateTime(row) {
  // meeting_date may be a full ISO string or YYYY-MM-DD; take the date part.
  const datePart = (row.meeting_date || '').substring(0, 10);
  const timePart = (row.meeting_time || '09:00').substring(0, 5);
  if (!datePart) return null;
  const dt = new Date(`${datePart}T${timePart}:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

function extractEmails(attendees) {
  if (!attendees) return [];
  return attendees.split(/[,;\n]+/).map(s => s.trim()).filter(s => /\S+@\S+\.\S+/.test(s));
}

function extractPhones(attendees) {
  if (!attendees) return [];
  return attendees.split(/[,;\n]+/).map(s => s.trim())
    .filter(s => !/@/.test(s) && /\+?\d[\d\s()-]{6,}/.test(s));
}

async function checkAndSend() {
  let rows;
  try {
    // Only confirmed meetings arm reminders — drafts (auto-created from transcript
    // scheduling intents) must be confirmed first. Legacy rows have status NULL.
    rows = db.prepare("SELECT * FROM schedule WHERE (reminder_sent IS NULL OR reminder_sent=0) AND (status IS NULL OR status='confirmed')").all();
  } catch (e) {
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    const dt = meetingDateTime(row);
    if (!dt) continue;
    const minutesUntil = (dt.getTime() - now) / 60000;
    // Send once the meeting is within the lead window but hasn't started yet.
    if (minutesUntil <= LEAD_MINUTES && minutesUntil > 0) {
      const channel = ['email', 'whatsapp', 'both'].includes(row.reminder_channel) ? row.reminder_channel : 'email';
      // Reminders go only to the meeting's actual attendees (emails/phones
      // parsed from the attendees field) — no hardcoded test recipient.
      const emails = [...new Set(extractEmails(row.attendees))];
      const phones = extractPhones(row.attendees);
      if (!emails.length && !phones.length) continue;
      const timeStr = (row.meeting_time || '').substring(0, 5);
      const subject = `تذكير: ${row.title_ar} — ${timeStr} | Reminder: ${row.title_en || row.title_ar}`;
      const body =
        `تذكير باجتماع قادم خلال ${Math.round(minutesUntil)} دقيقة تقريباً\n\n` +
        `العنوان: ${row.title_ar}\n` +
        `التاريخ: ${(row.meeting_date || '').substring(0,10)}  الوقت: ${timeStr}\n` +
        `المنصة: ${row.platform || '-'}\n` +
        `المشاركون: ${row.attendees || '-'}\n` +
        (row.agenda_ar ? `جدول الأعمال:\n${row.agenda_ar}\n` : '') +
        `\n— أمين السكرتير\n\n` +
        `———\n\n` +
        `Reminder: upcoming meeting in ~${Math.round(minutesUntil)} minutes\n\n` +
        `Title: ${row.title_en || row.title_ar}\n` +
        `Date: ${(row.meeting_date || '').substring(0,10)}  Time: ${timeStr}\n` +
        `Platform: ${row.platform || '-'}\n` +
        `Attendees: ${row.attendees || '-'}\n` +
        (row.agenda_en ? `Agenda:\n${row.agenda_en}\n` : '') +
        `\n— Ameen Secretary`;
      try {
        const wantEmail = channel === 'email' || channel === 'both';
        const wantWa = channel === 'whatsapp' || channel === 'both';
        // Only attempt a channel when there are actual recipients for it, so a
        // missing email (phones-only attendee) never blocks the WhatsApp send.
        if (wantEmail && emails.length) {
          await notify.sendEmail({ to: emails, subject, text: body });
        }
        if (wantWa && phones.length) {
          await notify.sendWhatsApp({ to: phones, body: `${subject}\n\n${body}` });
        }
        db.prepare('UPDATE schedule SET reminder_sent=1, reminder_email=? WHERE id=?').run(emails.join(', '), row.id);
        console.log(`✓ Reminder sent (${channel}) for "${row.title_en || row.title_ar}" (meeting #${row.id})`);
      } catch (e) {
        console.error(`✗ Reminder failed for meeting #${row.id}:`, e.message);
      }
    }
  }
}

function startReminderScheduler() {
  // Run every minute.
  setInterval(() => { checkAndSend().catch(() => {}); }, 60 * 1000);
  // Initial run shortly after boot.
  setTimeout(() => { checkAndSend().catch(() => {}); }, 5000);
  console.log('✓ Meeting reminder scheduler started (checks every minute, sends ~15 min before)');
}

module.exports = { startReminderScheduler, checkAndSend };
