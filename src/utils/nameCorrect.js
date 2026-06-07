// Phonetic / fuzzy proper-noun correction.
//
// The browser speech engine frequently mis-transcribes proper nouns (attendee
// names, places) — especially across Indian / Gulf-Arabic / mixed accents, which
// it has no way to be primed for. This layer repairs those tokens by matching
// them against the KNOWN attendee/member names and snapping near-misses back to
// the correct spelling.
//
// It is deliberately CONSERVATIVE: it only rewrites a token when it is a strong
// fuzzy match (small edit distance relative to length) to a known name token, so
// ordinary words are never corrupted.

// Classic Levenshtein edit distance.
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Similarity in [0,1] — 1 means identical.
function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

// Build a flat, de-duplicated list of name tokens (each individual word in every
// known name). Words shorter than 3 chars are dropped — too short to fuzzy-match
// safely.
function buildNameTokens(names) {
  const set = new Map(); // lowercased -> canonical
  for (const name of names) {
    if (!name) continue;
    for (const word of String(name).split(/\s+/)) {
      const w = word.trim();
      if (w.length < 3) continue;
      const key = w.toLowerCase();
      if (!set.has(key)) set.set(key, w);
    }
  }
  return [...set.values()];
}

// Correct proper nouns in `text` against `names` (array of known full names,
// each possibly "Arabic / English"). Returns { text, corrections } where
// corrections is a list of { from, to } actually applied.
function correctNames(text, names) {
  if (!text || !Array.isArray(names) || !names.length) return { text: text || '', corrections: [] };
  // Names may arrive as "name_ar / name_en" — split those halves out too.
  const flatNames = [];
  for (const n of names) {
    if (!n) continue;
    String(n).split('/').forEach(part => { const p = part.trim(); if (p) flatNames.push(p); });
  }
  const tokens = buildNameTokens(flatNames);
  if (!tokens.length) return { text, corrections: [] };

  const corrections = [];
  // Split on word boundaries but keep the separators so punctuation/spacing is
  // preserved exactly when we rejoin.
  const parts = text.split(/(\s+)/);
  const out = parts.map(part => {
    // Only consider "word" parts (not whitespace) of a meaningful length.
    if (/^\s+$/.test(part) || part.length < 4) return part;
    // Strip leading/trailing punctuation so "Ahmed," still matches "Ahmed".
    const lead = (part.match(/^[^\p{L}\p{N}]+/u) || [''])[0];
    const trail = (part.match(/[^\p{L}\p{N}]+$/u) || [''])[0];
    const core = part.slice(lead.length, part.length - trail.length);
    if (core.length < 4) return part;
    const lower = core.toLowerCase();

    let best = null, bestSim = 0, bestDist = Infinity;
    for (const tok of tokens) {
      if (tok.toLowerCase() === lower) return part; // already correct — leave as-is
      const d = levenshtein(lower, tok.toLowerCase());
      const sim = similarity(lower, tok.toLowerCase());
      if (sim > bestSim) { bestSim = sim; best = tok; bestDist = d; }
    }
    // Conservative acceptance: high similarity AND a small absolute edit distance.
    if (best && bestSim >= 0.8 && bestDist > 0 && bestDist <= 2) {
      corrections.push({ from: core, to: best });
      return lead + best + trail;
    }
    return part;
  });

  return { text: out.join(''), corrections };
}

module.exports = { correctNames, levenshtein, similarity };
