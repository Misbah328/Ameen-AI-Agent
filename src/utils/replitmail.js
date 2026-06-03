// Replit Mail integration (blueprint:replitmail)
// Sends email via Replit's authenticated mail service — no SMTP credentials required.
// Adapted to CommonJS. Supports explicit `to` recipients.
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

async function getAuthToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const { stdout } = await promisify(execFile)(
    'replit',
    ['identity', 'create', '--audience', `https://${hostname}`],
    { encoding: 'utf8' }
  );
  const replitToken = stdout.trim();
  if (!replitToken) throw new Error('Replit Identity Token not found for repl/depl');
  return { authToken: `Bearer ${replitToken}`, hostname };
}

async function sendEmail(message) {
  const { hostname, authToken } = await getAuthToken();
  const response = await fetch(`https://${hostname}/api/v2/mailer/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Replit-Authentication': authToken,
    },
    body: JSON.stringify({
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    }),
  });
  if (!response.ok) {
    let error = {};
    try { error = await response.json(); } catch (e) {}
    throw new Error(error.message || `Failed to send email (HTTP ${response.status})`);
  }
  return await response.json();
}

module.exports = { sendEmail };
