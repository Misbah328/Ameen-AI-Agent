// Unified notification service.
//  • Email  → Resend connector (falls back to Replit Mail if Resend not connected)
//  • WhatsApp → Twilio connector
// Credentials are pulled live from the Replit connectors proxy on every call
// (never cached — tokens expire).
const { sendEmail: sendReplitMail } = require('./replitmail');

async function getConnectorSettings(connectorName) {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) throw new Error('Connectors host not available');
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;
  if (!xReplitToken) throw new Error('Replit identity token not found');
  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
    { headers: { Accept: 'application/json', X_REPLIT_TOKEN: xReplitToken } }
  );
  if (!res.ok) throw new Error(`Connector lookup failed (HTTP ${res.status})`);
  const data = await res.json();
  const item = data.items && data.items[0];
  if (!item) throw new Error(`${connectorName} not connected`);
  return { ...(item.settings || {}), oauth: item.oauth };
}

function connectorToken(settings) {
  // OAuth-based connectors expose the access token under oauth.credentials.
  return (
    settings.api_key ||
    settings.apiKey ||
    settings.access_token ||
    (settings.oauth && settings.oauth.credentials && settings.oauth.credentials.access_token)
  );
}

// ── Email via Resend ─────────────────────────────────────────────────────────
async function sendViaResend({ to, subject, text, html }) {
  const settings = await getConnectorSettings('resend');
  const apiKey = connectorToken(settings);
  if (!apiKey) throw new Error('Resend API key not found in connector settings');
  const from =
    settings.from_email ||
    settings.from ||
    process.env.MAIL_FROM ||
    'Ameen Secretary <onboarding@resend.dev>';
  const recipients = Array.isArray(to) ? to : [to];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: recipients, subject, text, html: html || undefined }),
  });
  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch (e) {}
    throw new Error(err.message || `Resend send failed (HTTP ${res.status})`);
  }
  return { provider: 'resend', result: await res.json() };
}

async function sendEmail({ to, subject, text, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) throw new Error('No email recipients');
  try {
    return await sendViaResend({ to: recipients, subject, text, html });
  } catch (e) {
    // Fall back to Replit Mail (delivers to workspace owner) so the message is
    // never silently lost in development before Resend is connected.
    console.warn('Resend unavailable, falling back to Replit Mail:', e.message);
    await sendReplitMail({ to: recipients, subject, text, html });
    return { provider: 'replitmail', fallback: true, reason: e.message };
  }
}

// ── WhatsApp via Twilio ──────────────────────────────────────────────────────
async function sendWhatsApp({ to, body }) {
  const numbers = (Array.isArray(to) ? to : [to]).map(normalizePhone).filter(Boolean);
  if (!numbers.length) throw new Error('No WhatsApp recipients');
  const settings = await getConnectorSettings('twilio');
  const accountSid = settings.account_sid || settings.accountSid || settings.sid;
  const authToken =
    settings.auth_token || settings.authToken || connectorToken(settings);
  const fromRaw =
    settings.whatsapp_from ||
    settings.from_number ||
    settings.phone_number ||
    process.env.TWILIO_WHATSAPP_FROM ||
    '+14155238886'; // Twilio WhatsApp sandbox number
  if (!accountSid || !authToken) throw new Error('Twilio credentials not found in connector settings');
  const from = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const results = [];
  for (const num of numbers) {
    const params = new URLSearchParams({ From: from, To: `whatsapp:${num}`, Body: body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }
    );
    if (!res.ok) {
      let err = {};
      try { err = await res.json(); } catch (e) {}
      throw new Error(err.message || `Twilio send failed (HTTP ${res.status})`);
    }
    results.push(await res.json());
  }
  return { provider: 'twilio', results };
}

function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).trim().replace(/[\s()-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return s;
}

// Send across a chosen channel: 'email' | 'whatsapp' | 'both'
async function notify({ channel = 'email', email, phone, subject, text, html }) {
  const out = {};
  const wantEmail = channel === 'email' || channel === 'both';
  const wantWa = channel === 'whatsapp' || channel === 'both';
  if (wantEmail && email) {
    try { out.email = await sendEmail({ to: email, subject, text, html }); }
    catch (e) { out.emailError = e.message; }
  }
  if (wantWa && phone) {
    try { out.whatsapp = await sendWhatsApp({ to: phone, body: `${subject}\n\n${text}` }); }
    catch (e) { out.whatsappError = e.message; }
  }
  return out;
}

module.exports = { sendEmail, sendWhatsApp, notify, getConnectorSettings, normalizePhone };
