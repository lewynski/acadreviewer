/**
 * Prompt construction and response validation for the reviewer generator.
 *
 * This module runs server-side only. The browser sends material and the
 * question mix it wants; the prompt itself is assembled here so the endpoint
 * cannot be used as a general-purpose chat proxy.
 */

export const TYPES = ['mcq', 'identification', 'enumeration', 'matching'];

/** Hard caps. They bound how much a single request can cost. */
export const LIMITS = {
  maxChars: 60000, // total characters of material per request
  maxUnits: 400, // slides / pages per request
  maxItems: 40, // questions requested per request
};

const DIFFICULTY = {
  recall:
    'Ask for definitions, terms, values, formulas and lists exactly as the material states them.',
  balanced:
    'Mostly direct recall, plus a few questions that make the reader apply or compare ideas from the material.',
  hard:
    'Favour application, comparison and multi-step reasoning. Every question must still be answerable from the material alone.',
};

const SHAPES = [
  'mcq: {"type":"mcq","q":"question","choices":["a","b","c","d"],"answer":0,"why":"one sentence","src":"LABEL"}',
  '  - exactly 4 choices, all plausible, similar length, only one correct',
  '  - "answer" is the 0-based index of the correct choice',
  'identification: {"type":"identification","q":"question","answer":"term","accept":["variant"],"why":"...","src":"LABEL"}',
  '  - the answer is a word, term, name, number or short phrase; never a sentence',
  '  - "accept" lists other spellings, abbreviations or equivalent wordings that should be marked correct',
  'enumeration: {"type":"enumeration","q":"List the ...","answers":["one","two","three"],"why":"...","src":"LABEL"}',
  '  - only use this when the material actually enumerates 3 to 6 things',
  '  - each answer is short; order does not matter',
  'matching: {"type":"matching","q":"Match each term to its description.","pairs":[{"left":"term","right":"description"}],"why":"...","src":"LABEL"}',
  '  - 4 to 6 pairs; every left is a short term, every right is a short description',
  '  - no two pairs may share a left or a right value',
].join('\n');

const RULES = [
  'Write only what the material supports. Never invent facts, numbers or names.',
  'Never refer to the source in the question text. Do not write "according to the slide", "in the figure", "as shown above" or "the document says".',
  'Each question must stand on its own without the material in front of the reader.',
  'Set "src" to the exact bracketed label of the slide or page the question came from.',
  'Keep "why" to one short sentence explaining why the answer is right.',
  'Spread questions across the whole material instead of clustering on the first few labels.',
  'Skip title slides, outlines, references, acknowledgements and thank-you slides.',
  'Write in the same language as the material.',
  'Do not repeat a question you have already written in this batch.',
];

function describeMix(counts) {
  return TYPES.filter((t) => counts[t] > 0)
    .map((t) => counts[t] + ' of type "' + t + '"')
    .join(', ');
}

/** Builds the chat messages for one batch of material. */
export function buildMessages({ units, counts, difficulty = 'balanced' }) {
  const total = TYPES.reduce((sum, t) => sum + (counts[t] || 0), 0);
  const material = units
    .map((u) => '[' + u.at + (u.file ? ' | ' + u.file : '') + ']\n' + u.text)
    .join('\n\n');

  const system = [
    'You write exam reviewers for college students out of their own lecture material.',
    '',
    'Reply with a single JSON object and nothing else, in this form:',
    '{"items": [ ... ]}',
    '',
    'Item shapes:',
    SHAPES,
    '',
    'Rules:',
    RULES.map((r, i) => i + 1 + '. ' + r).join('\n'),
  ].join('\n');

  const user = [
    'Write ' + total + ' questions from the material below: ' + describeMix(counts) + '.',
    'Difficulty: ' + (DIFFICULTY[difficulty] || DIFFICULTY.balanced),
    '',
    'Material begins.',
    material,
    'Material ends.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const clean = (v, max = 400) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Loose key used for matching labels and spotting duplicate questions. */
const key = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Pulls the first balanced JSON object out of a model reply, tolerating code
 * fences and any prose the model adds around it.
 */
export function parseJson(text) {
  if (!text) return null;
  const s = String(text)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function uniqueStrings(list, { min, max, maxLen = 120 }) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const v = clean(raw, maxLen);
    const k = key(v);
    if (!v || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.length >= min && out.length <= max ? out : null;
}

/**
 * Labels are looked up loosely. The model is asked for the exact bracketed
 * label, but it may hand back "Slide 4", "Slide 4 | Lecture1.pptx" or
 * "[Slide 4]", so every form is indexed and a longest-prefix match closes the
 * gap. Getting this right is what keeps the coverage map honest.
 */
function labelIndex(units) {
  const index = new Map();
  for (const unit of units) {
    for (const form of [unit.at, unit.at + ' ' + (unit.file || '')]) {
      const k = key(form);
      if (k && !index.has(k)) index.set(k, unit);
    }
  }
  return index;
}

function sourceOf(raw, index, fallback) {
  const asked = key(raw && raw.src);
  let unit = asked ? index.get(asked) : null;
  if (!unit && asked) {
    let best = '';
    for (const [label, candidate] of index) {
      if (label.length > best.length && asked.startsWith(label)) {
        best = label;
        unit = candidate;
      }
    }
  }
  const hit = unit || fallback || {};
  return { file: hit.file || '', at: hit.at || '' };
}

function normalizeItem(raw, labels, fallback) {
  if (!raw || typeof raw !== 'object') return null;
  const type = clean(raw.type, 20).toLowerCase();
  const q = clean(raw.q || raw.question, 500);
  if (!TYPES.includes(type) || q.length < 8) return null;
  const base = { type, q, why: clean(raw.why, 300), src: sourceOf(raw, labels, fallback) };

  if (type === 'mcq') {
    let choices = uniqueStrings(raw.choices, { min: 4, max: 6, maxLen: 200 });
    let answer = Number(raw.answer);
    if (!choices || !Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
    if (choices.length > 4) {
      const correct = choices[answer];
      choices = [correct].concat(choices.filter((_, i) => i !== answer).slice(0, 3));
      answer = 0;
    }
    return { ...base, choices, answer };
  }

  if (type === 'identification') {
    const answer = clean(raw.answer, 80);
    if (!answer) return null;
    const accept = uniqueStrings(raw.accept, { min: 0, max: 6, maxLen: 80 }) || [];
    return { ...base, answer, accept: accept.filter((a) => key(a) !== key(answer)) };
  }

  if (type === 'enumeration') {
    const answers = uniqueStrings(raw.answers, { min: 2, max: 8, maxLen: 100 });
    return answers ? { ...base, answers } : null;
  }

  const pairs = normalizePairs(raw.pairs);
  return pairs ? { ...base, pairs } : null;
}

function normalizePairs(list) {
  if (!Array.isArray(list)) return null;
  const lefts = new Set();
  const rights = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const left = clean(raw.left, 90);
    const right = clean(raw.right, 160);
    const lk = key(left);
    const rk = key(right);
    if (!lk || !rk || lefts.has(lk) || rights.has(rk)) continue;
    lefts.add(lk);
    rights.add(rk);
    out.push({ left, right });
  }
  return out.length >= 3 ? out.slice(0, 8) : null;
}

/**
 * Keeps only well-formed, non-duplicate items. Malformed items are dropped
 * rather than repaired: a missing question is better than a wrong answer key.
 */
export function validateItems(raw, units) {
  const labels = labelIndex(units);
  const seen = new Set();
  const out = [];
  const items = raw && Array.isArray(raw.items) ? raw.items : [];
  for (const candidate of items) {
    const item = normalizeItem(candidate, labels, units[0]);
    if (!item) continue;
    const k = item.type + '|' + key(item.q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
