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

async function callClaude(messages, system = '', maxTokens = 1000, userId = null) {
  const key = (userId != null && sessionKeys[userId]) || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('NO_API_KEY');
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error('API_ERROR: ' + (data.error.message || JSON.stringify(data.error)));
  return data.content.map(b => b.text || '').join('');
}

module.exports = { callClaude, setSessionKey, hasKey };
