// Ghost Run — end-to-end self-test for Ameen Secretary's real delivery channels.
// Sends ONE real email (Resend) and ONE real WhatsApp (Twilio) using the same
// notify helper the app uses, then logs Success/Failure per channel.
//
// Run with:  node scripts/ghost-run.js
// Requires the workflow secrets (RESEND_*, TWILIO_*) — bash has them, the
// JS code-execution sandbox does NOT, so this must be run via the shell.
//
// Optional overrides:
//   GHOST_EMAIL=you@example.com  GHOST_PHONE=+9665XXXXXXXX  node scripts/ghost-run.js

const notify = require('../src/utils/notify');

const EMAIL_TO = process.env.GHOST_EMAIL || process.env.RESEND_FROM_EMAIL || '';
const PHONE_TO = process.env.GHOST_PHONE || '';

const stamp = new Date().toISOString();

async function testEmail() {
  if (!EMAIL_TO) {
    console.log('⚠️  EMAIL: skipped — no recipient (set GHOST_EMAIL or RESEND_FROM_EMAIL)');
    return false;
  }
  try {
    const out = await notify.sendEmail({
      to: EMAIL_TO,
      subject: `Ameen Ghost Run ✓ ${stamp}`,
      text: `This is an automated Ghost Run self-test from Ameen Secretary.\nIf you received this, email delivery works.\n\n${stamp}`,
      html: `<div style="font-family:Arial,sans-serif"><h2>Ameen Ghost Run ✓</h2>` +
            `<p>Automated self-test — email delivery is working.</p>` +
            `<p style="color:#888;font-size:12px">${stamp}</p></div>`,
    });
    console.log(`✓ EMAIL: sent to ${EMAIL_TO} via ${out.provider || 'unknown'} (id: ${out.id || '—'})`);
    return true;
  } catch (e) {
    console.log(`✗ EMAIL: FAILED — ${e.message}`);
    return false;
  }
}

async function testWhatsApp() {
  if (!PHONE_TO) {
    console.log('⚠️  WHATSAPP: skipped — no recipient (set GHOST_PHONE)');
    return false;
  }
  try {
    const out = await notify.sendWhatsApp({
      to: PHONE_TO,
      body: `🤖 Ameen Ghost Run ✓\nAutomated self-test — WhatsApp delivery is working.\n${stamp}`,
    });
    const sids = (out.results || []).map(r => r.sid || r.status).join(', ');
    console.log(`✓ WHATSAPP: sent to ${PHONE_TO} (${sids || 'queued'})`);
    return true;
  } catch (e) {
    console.log(`✗ WHATSAPP: FAILED — ${e.message}`);
    return false;
  }
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  Ameen Secretary — Ghost Run self-test');
  console.log(`  ${stamp}`);
  console.log('═══════════════════════════════════════════');

  const emailOk = await testEmail();
  const waOk = await testWhatsApp();

  console.log('───────────────────────────────────────────');
  if (emailOk && waOk) {
    console.log('✅ Ghost Run: Success — email + WhatsApp both fired.');
    process.exit(0);
  } else {
    console.log(`⚠️  Ghost Run: partial — email=${emailOk ? 'OK' : 'FAIL'} whatsapp=${waOk ? 'OK' : 'FAIL'}`);
    process.exit(emailOk || waOk ? 0 : 1);
  }
})();
