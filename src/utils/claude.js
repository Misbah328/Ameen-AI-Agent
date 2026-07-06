// Shared Anthropic (Claude) client. Holds per-user session API keys (set at runtime
// via POST /api/ai/setkey) and falls back to the ANTHROPIC_API_KEY environment secret.
const sessionKeys = {};

function setSessionKey(userId, key) {
  if (userId == null) return;
  sessionKeys[userId] = key;
}

function hasKey(userId = null) {
  return Boolean((userId != null && sessionKeys[userId]) || process.env.ANTHROPIC_API_KEY);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// temperature is left unset by default (Anthropic's own default applies) so
// existing callers (chat, live-extract, document generation) keep their
// current behavior unchanged. Callers that need low-variance, factual output —
// meeting minutes and structured extraction — pass an explicit low value
// (e.g. 0.3). One retry with a short backoff covers transient 429/5xx
// failures without masking real errors (NO_API_KEY, bad JSON body, etc. still
// throw immediately).
async function callClaude(messages, system = '', maxTokens = 1000, userId = null, temperature = null) {
  const key = (userId != null && sessionKeys[userId]) || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('NO_API_KEY');
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = { model, max_tokens: maxTokens, system, messages };
      if (temperature != null) body.temperature = temperature;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) {
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt === 0) { await sleep(1200); continue; }
        throw new Error('API_ERROR: ' + (data.error.message || JSON.stringify(data.error)));
      }
      return data.content.map(b => b.text || '').join('');
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && !String(e.message).startsWith('API_ERROR') && !String(e.message).startsWith('NO_API_KEY')) {
        await sleep(1200);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { callClaude, setSessionKey, hasKey };
