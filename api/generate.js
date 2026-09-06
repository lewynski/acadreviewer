/**
 * POST /api/generate
 *
 * Turns a batch of lecture material into reviewer questions. The Groq key
 * lives only in this function's environment, so it never reaches the browser.
 *
 * Body: { units: [{ file, at, text }], counts: { mcq, identification,
 *         enumeration, matching }, difficulty: 'recall'|'balanced'|'hard' }
 * Reply: { items: [...], model, requested, kept }
 */
import { buildMessages, parseJson, validateItems, LIMITS, TYPES } from '../lib/reviewer.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Tried in order. Groq retires models regularly (llama-3.3-70b-versatile and
 * llama-3.1-8b-instant were deprecated in June 2026), so the first model that
 * answers wins and is remembered for the life of the instance.
 */
const MODEL_CANDIDATES = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-32b',
  'llama-3.3-70b-versatile',
];

const WINDOW_MS = 5 * 60 * 1000;
const recent = new Map();
let workingModel = null;

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Best-effort per-IP cap. Serverless instances do not share this map. */
function overLimit(ip, limit) {
  if (!limit) return false;
  const now = Date.now();
  const stamps = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  stamps.push(now);
  recent.set(ip, stamps);
  if (recent.size > 400) {
    for (const [k, v] of recent) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) recent.delete(k);
    }
  }
  return stamps.length > limit;
}

const label = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Keeps line breaks, since bullet structure helps the model. */
const material = (v, max) =>
  typeof v === 'string'
    ? v.replace(new RegExp('[ \\t\\u00a0]+', 'g'), ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
    : '';

function sanitizeUnits(list) {
  if (!Array.isArray(list)) return [];
  const units = [];
  let budget = LIMITS.maxChars;
  for (const raw of Array.isArray(list) ? list.slice(0, LIMITS.maxUnits) : []) {
    if (!raw || typeof raw !== 'object' || budget <= 0) break;
    const body = material(raw.text, Math.min(8000, budget));
    if (body.length < 12) continue;
    budget -= body.length;
    units.push({
      file: label(raw.file, 120),
      at: label(raw.at, 40) || 'Part ' + (units.length + 1),
      text: body,
    });
  }
  return units;
}

function sanitizeCounts(raw) {
  const counts = {};
  let total = 0;
  for (const type of TYPES) {
    const n = Math.floor(Number(raw && raw[type]) || 0);
    counts[type] = Math.max(0, Math.min(LIMITS.maxItems, n));
    total += counts[type];
  }
  if (total > LIMITS.maxItems) {
    const scale = LIMITS.maxItems / total;
    total = 0;
    for (const type of TYPES) {
      counts[type] = Math.floor(counts[type] * scale);
      total += counts[type];
    }
  }
  return { counts, total };
}

function payloadFor(model, messages, variant) {
  const payload = { model, messages, temperature: 0.35, top_p: 0.9, stream: false };
  if (variant === 2) payload.max_tokens = 8000;
  else payload.max_completion_tokens = 8000;
  if (variant === 0) payload.response_format = { type: 'json_object' };
  return payload;
}

async function post(apiKey, payload) {
  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(50000),
    });
  } catch {
    return { ok: false, status: 504, detail: 'Groq did not answer in time.', retryAfter: 0 };
  }
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data && data.error) || {};
    return {
      ok: false,
      status: res.status,
      detail: err.message || err.code || raw.slice(0, 300),
      retryAfter: Number(res.headers.get('retry-after')) || 0,
    };
  }
  return { ok: true, status: 200, data, retryAfter: 0 };
}

const modelGone = (r) =>
  r.status === 404 ||
  /decommission|does not exist|not found|no longer|invalid model|unsupported model/i.test(r.detail || '');

const badParam = (r) =>
  r.status === 400 &&
  /response_format|json_object|max_completion_tokens|max_tokens|unrecognized|unsupported|property/i.test(
    r.detail || ''
  );

/** Walks the model list, degrading request parameters before giving up. */
async function complete(apiKey, messages) {
  const models = [];
  for (const m of [process.env.GROQ_MODEL, workingModel].concat(MODEL_CANDIDATES)) {
    if (m && !models.includes(m)) models.push(m);
  }
  let last = { ok: false, status: 502, detail: 'No model answered.', retryAfter: 0 };
  for (const model of models) {
    for (let variant = 0; variant < 3; variant += 1) {
      const attempt = await post(apiKey, payloadFor(model, messages, variant));
      if (attempt.ok) {
        workingModel = model;
        return { ...attempt, model };
      }
      last = { ...attempt, model };
      if (attempt.status === 429 || attempt.status >= 500) return last;
      if (modelGone(attempt)) break;
      if (!badParam(attempt)) return last;
    }
  }
  return last;
}

function failureText(status) {
  if (status === 429) return 'Groq is rate limiting this key. Wait a moment, then try again.';
  if (status === 401 || status === 403) return 'Groq rejected the server key. Check GROQ_API_KEY in Vercel.';
  if (status === 504) return 'Groq took too long. Try fewer questions at a time.';
  return 'Groq refused the request.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return send(res, 500, { error: 'This deployment has no GROQ_API_KEY set.' });

  const code = process.env.ACCESS_CODE;
  if (code && req.headers['x-access-code'] !== code) {
    return send(res, 401, { error: 'That access code does not match.' });
  }

  if (overLimit(clientIp(req), Number(process.env.RATE_LIMIT || 40))) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, { error: 'Too many requests from this connection. Wait a minute.' });
  }

  const body = await readBody(req);
  const units = sanitizeUnits(body.units);
  const { counts, total } = sanitizeCounts(body.counts);
  if (!units.length) return send(res, 400, { error: 'No readable text in this batch.' });
  if (!total) return send(res, 400, { error: 'Ask for at least one question.' });

  const difficulty = ['recall', 'balanced', 'hard'].includes(body.difficulty)
    ? body.difficulty
    : 'balanced';

  const result = await complete(apiKey, buildMessages({ units, counts, difficulty }));
  if (!result.ok) {
    if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
    const status = result.status === 401 || result.status === 403 ? 502 : result.status;
    return send(res, status, {
      error: failureText(result.status),
      detail: String(result.detail || '').slice(0, 300),
      model: result.model,
    });
  }

  const message = (result.data.choices && result.data.choices[0] && result.data.choices[0].message) || {};
  const items = validateItems(parseJson(message.content || message.reasoning || ''), units);
  if (!items.length) {
    return send(res, 502, {
      error: 'The model did not return usable questions for this batch.',
      model: result.model,
    });
  }

  return send(res, 200, { items, model: result.model, requested: total, kept: items.length });
}
