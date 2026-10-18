/* Zaan Translate — Vercel Serverless Function
 * Gemini is called on the server only. Set GEMINI_API_KEY as a Vercel Environment Variable.
 * Translation uses higher thinking effort and receives the full source sentence plus structured
 * dictionary candidates. The dictionary is authoritative for Zarephia spellings; AI chooses by meaning.
 */

const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.6-flash')
  .split(',').map(s => s.trim()).filter(Boolean);

const RULES = `You are the translation engine for Zaan Translate, a Thai ↔ Zarephia (ภาษาซาน) translator.
Zarephia is a constructed language. Do not rely on outside knowledge of it: use the supplied dictionary candidates and the grammar below.

GRAMMAR
- Basic word order: SVO.
- No inflection for gender, number, or tense; dictionary spellings remain unchanged.
- Time words may appear at the beginning or end; aspect markers precede the verb.
- Negation is a separate word before the verb (S NEG V O).
- Yes/no questions use a question marker or ?; wh-words occupy the position of the requested element.
- Modifiers stay next to the noun they modify.
- Pronunciation rules never change spelling. Preserve special letters exactly (Â Ê Î Ô Û Ä Ö Ü Š Ž Ř, TH DH Q LL).
- Proper names stay unchanged.

TRANSLATION METHOD — IMPORTANT
1. Read and understand the COMPLETE source sentence first. Determine its intended meaning, tone, phrase boundaries, and grammatical roles before choosing any dictionary entries.
2. The supplied token groups are only search aids. Thai has no spaces between many words, so the segmentation can be wrong. Some candidates may be false positives caused by substring/gloss matching. Never choose a candidate merely because it appears beside a source fragment.
3. Choose each entry only when its dictionary meaning and context hint fit the COMPLETE sentence. Do not translate every token mechanically and do not concatenate unrelated dictionary glosses.
4. Translate the intended message naturally and faithfully. Preserve greetings, honorifics, politeness, negation, relationships, and modifiers. Do not add meanings that are not in the source.
5. TH>ZA: output only exact Zarephia spellings from selected candidate entries, separated by spaces. Do not invent a Zarephia word. If the dictionary lacks a necessary concept, preserve only that missing Thai phrase in square brackets and explain the gap briefly in note.
6. ZA>TH: output natural, fluent Thai for the complete message, not a word-by-word gloss. If the source contains a word with no usable dictionary entry, preserve it in square brackets and explain briefly.
7. The ids array must contain ONLY IDs of candidates you actually used, in output order. Do not list every possible candidate. A candidate ID may appear again only if the corresponding word is genuinely repeated.
8. Check the proposed translation against the original sentence before returning. If a selected entry changes the meaning (for example, a greeting becomes an animal, a keeper, a defeat, or another unrelated concept), reject it.

Return JSON only: {"out":"","ids":[],"note":""}. note must be Thai, concise (max 30 words), and explain only a real missing-dictionary or ambiguity issue; otherwise use an empty string.`;

const CTX_RULES = `You analyze a Thai-language dictionary for the constructed language Zarephia. For every entry in each group with the same headword, write a short Thai usage hint (max 8 words) that distinguishes its meaning/context from the other entries. Do not invent meanings. Return JSON only: {"items":[{"id":"","hint":""}]}.`;

const cache = new Map();
const hits = new Map();
const LIMIT_PER_MIN = 12;

function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= LIMIT_PER_MIN) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

async function callGemini(model, system, text, schema, thinkingLevel) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinkingConfig: { thinkingLevel: thinkingLevel || 'high' }
    }
  };
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

function parseGemini(res) {
  const parts = res && res.json && res.json.candidates && res.json.candidates[0] && res.json.candidates[0].content && res.json.candidates[0].content.parts;
  const raw = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
  if (!raw) return null;
  try { return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()); }
  catch (_) { return null; }
}

async function run(system, text, schema, thinkingLevel) {
  let last = { status: 500, json: {} };
  for (const model of MODELS) {
    let res = await callGemini(model, system, text, schema, thinkingLevel || 'high');
    // Some models/settings can reject a requested thinking level; retry once at medium.
    if (res.status === 400 && (thinkingLevel || 'high') !== 'medium') {
      res = await callGemini(model, system, text, schema, 'medium');
    }
    last = res;
    if (res.status === 200) {
      const data = parseGemini(res);
      if (data && typeof data === 'object') return { ok: true, data, model };
      last = { status: 502, json: {} };
      continue;
    }
    if (res.status === 429) break; // quota/rate limit: fallback retries are unlikely to help and only add latency
    if (res.status === 404 || res.status === 503 || res.status === 400) continue;
    break;
  }
  return { ok: false, status: last.status };
}

function asCandidate(c) {
  if (!c || typeof c !== 'object') return null;
  const id = String(c.id == null ? '' : c.id);
  if (!id) return null;
  return {
    id,
    zarephia: String(c.zarephia || c.word || '').slice(0, 100),
    type: String(c.type || '').slice(0, 40),
    meaning: String(c.meaning || '').slice(0, 140),
    hint: String(c.hint || '').slice(0, 100)
  };
}

function normalizeToken(t) {
  if (!t || typeof t !== 'object') return null;
  const source = String(t.source == null ? (t.src == null ? '' : t.src) : t.source).slice(0, 120);
  if (!source) return null;
  let candidates = [];
  if (Array.isArray(t.candidates)) candidates = t.candidates.map(asCandidate).filter(Boolean).slice(0, 6);
  else if (Array.isArray(t[1])) {
    // Backward-compatible with the previous frontend payload.
    candidates = t[1].map(c => Array.isArray(c) ? asCandidate({ id: c[0], zarephia: c[1], type: c[2], meaning: c[3], hint: c[4] }) : null).filter(Boolean).slice(0, 6);
  }
  return { source, match: String(t.match || 'candidate'), candidates };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ error: 'method' }));
  if (!process.env.GEMINI_API_KEY) return res.status(500).end(JSON.stringify({ error: 'no_key' }));

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!rateOk(ip)) return res.status(429).end(JSON.stringify({ error: 'rate' }));

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};

  try {
    if (b.mode === 'ctx') {
      const groups = Array.isArray(b.groups) ? b.groups.slice(0, 15) : [];
      if (!groups.length) return res.status(400).end(JSON.stringify({ error: 'empty' }));
      const text = groups.map(g => String(g.w || '').slice(0, 120) + '\n' + (Array.isArray(g.e) ? g.e.slice(0, 20).map(x => [String(x[0] || ''), String(x[1] || ''), String(x[2] || '').slice(0, 140)].join('|')).join('\n') : '')).join('\n\n');
      if (text.length > 9000) return res.status(413).end(JSON.stringify({ error: 'big' }));
      const schema = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, hint: { type: 'STRING' } }, required: ['id', 'hint'] } } }, required: ['items'] };
      const r = await run(CTX_RULES, text, schema, 'medium');
      return r.ok ? res.status(200).end(JSON.stringify(r.data)) : res.status(r.status === 429 ? 429 : 502).end(JSON.stringify({ error: r.status === 429 ? 'quota' : 'ai' }));
    }

    const dir = b.d === 'TZ' ? 'TH>ZA' : 'ZA>TH';
    const src = String(b.t || '').trim().slice(0, 300);
    const tokens = Array.isArray(b.k) ? b.k.slice(0, 40).map(normalizeToken).filter(Boolean) : [];
    if (!src) return res.status(400).end(JSON.stringify({ error: 'empty' }));

    const requestData = { direction: dir, sourceText: src, dictionaryTokenHints: tokens };
    const text = JSON.stringify(requestData);
    if (text.length > 22000) return res.status(413).end(JSON.stringify({ error: 'big' }));

    const ck = dir + '|' + text;
    if (cache.has(ck)) return res.status(200).end(JSON.stringify(Object.assign({ cached: true }, cache.get(ck))));

    const schema = {
      type: 'OBJECT',
      properties: { out: { type: 'STRING' }, ids: { type: 'ARRAY', items: { type: 'STRING' } }, note: { type: 'STRING' } },
      required: ['out', 'ids', 'note']
    };
    const r = await run(RULES, text, schema, 'medium');
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).end(JSON.stringify({ error: r.status === 429 ? 'quota' : 'ai' }));

    const allowedIds = new Set();
    tokens.forEach(t => t.candidates.forEach(c => allowedIds.add(c.id)));
    const ids = (Array.isArray(r.data.ids) ? r.data.ids : []).map(String).filter(id => allowedIds.has(id)).slice(0, 80);
    const out = {
      out: String(r.data.out || '').trim().slice(0, 1200),
      ids,
      note: String(r.data.note || '').trim().slice(0, 240),
      model: r.model
    };
    if (!out.out) return res.status(502).end(JSON.stringify({ error: 'ai' }));
    cache.set(ck, out);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return res.status(200).end(JSON.stringify(out));
  } catch (_) {
    return res.status(500).end(JSON.stringify({ error: 'server' }));
  }
};
