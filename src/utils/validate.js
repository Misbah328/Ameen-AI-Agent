// Recipient validation for notifications. Used before any email/WhatsApp send so
// malformed input is rejected with a clear message instead of failing deep inside
// the provider API (or crashing the request).

// Pragmatic email check — good enough to catch typos/empty values without
// rejecting valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// E.164-ish: optional +, 7–15 digits after stripping spaces/()/-.
function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).trim().replace(/[\s()-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return s;
}

function isValidEmail(e) {
  return typeof e === 'string' && EMAIL_RE.test(e.trim());
}

function isValidPhone(p) {
  const s = normalizePhone(p);
  return /^\+?\d{7,15}$/.test(s);
}

// Split a free-text recipients field (commas/semicolons/newlines) into a trimmed,
// de-duplicated list.
function splitRecipients(raw) {
  if (Array.isArray(raw)) return [...new Set(raw.map(s => String(s).trim()).filter(Boolean))];
  return [...new Set(String(raw || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean))];
}

// Partition a recipients list into { valid, invalid } using the given validator.
function partition(list, validator) {
  const valid = [], invalid = [];
  for (const item of list) (validator(item) ? valid : invalid).push(item);
  return { valid, invalid };
}

module.exports = { isValidEmail, isValidPhone, normalizePhone, splitRecipients, partition, EMAIL_RE };
