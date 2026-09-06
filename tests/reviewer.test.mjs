import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, parseJson, validateItems, LIMITS } from '../lib/reviewer.js';

const units = [
  { at: 'Slide 1', file: 'Lecture1.pptx', text: 'Ohm law relates voltage current resistance.' },
  { at: 'Slide 2', file: 'Lecture1.pptx', text: 'Series circuits share one current path.' },
  { at: 'Slide 12', file: 'Lecture1.pptx', text: 'Capacitors store charge on plates.' },
  { at: 'Page 3', file: 'Handout.pdf', text: 'A diode conducts in one direction only.' },
];

const mcq = {
  type: 'mcq',
  q: 'Which law relates voltage, current and resistance?',
  choices: ['Ohm law', 'Hooke law', 'Boyle law', 'Lenz law'],
  answer: 0,
  why: 'It is stated directly.',
  src: 'Slide 1 | Lecture1.pptx',
};

test('the prompt carries the labels and the mix', () => {
  const messages = buildMessages({ units, counts: { mcq: 2, identification: 1 }, difficulty: 'hard' });
  const user = messages[1].content;
  assert.equal(messages[0].role, 'system');
  assert.match(user, /Write 3 questions/);
  assert.match(user, /2 of type "mcq", 1 of type "identification"/);
  assert.match(user, /\[Slide 12 \| Lecture1\.pptx\]/);
  assert.match(user, /Capacitors store charge/);
  assert.match(messages[0].content, /Never refer to the source/);
});

test('json survives fences and surrounding prose', () => {
  assert.deepEqual(parseJson('```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(parseJson('Sure! {"items":[{"a":1}]} Hope that helps.'), { items: [{ a: 1 }] });
  assert.deepEqual(parseJson('{"items": [{"nested": {"deep": true}}]}'), {
    items: [{ nested: { deep: true } }],
  });
  assert.equal(parseJson('no json here'), null);
  assert.equal(parseJson('{"items": [oops]}'), null);
  assert.equal(parseJson(''), null);
});

test('a source label is matched in any of the forms a model uses', () => {
  const forms = ['Slide 12 | Lecture1.pptx', 'Slide 12', '[Slide 12]', 'slide 12, lecture1.pptx'];
  forms.forEach((src) => {
    const items = validateItems({ items: [{ ...mcq, src }] }, units);
    assert.equal(items.length, 1, src);
    assert.deepEqual(items[0].src, { at: 'Slide 12', file: 'Lecture1.pptx' }, src);
  });
  const pdf = validateItems({ items: [{ ...mcq, src: 'Page 3 | Handout.pdf' }] }, units);
  assert.deepEqual(pdf[0].src, { at: 'Page 3', file: 'Handout.pdf' });
});

test('a label that matches nothing falls back to the first unit', () => {
  const items = validateItems({ items: [{ ...mcq, src: 'somewhere else entirely' }] }, units);
  assert.deepEqual(items[0].src, { at: 'Slide 1', file: 'Lecture1.pptx' });
});

test('malformed items are dropped, not repaired', () => {
  const raw = {
    items: [
      mcq,
      { ...mcq, answer: 9 },
      { ...mcq, choices: ['only', 'three', 'here'] },
      { type: 'mcq', q: 'too short?', choices: ['a', 'b', 'c', 'd'] },
      { type: 'identification', q: 'What unit measures resistance?', answer: '' },
      { type: 'enumeration', q: 'List the parts', answers: ['one'] },
      { type: 'matching', q: 'Match these', pairs: [{ left: 'V', right: 'volt' }] },
      { type: 'essay', q: 'Discuss circuits at length', answer: 'no' },
    ],
  };
  const items = validateItems(raw, units);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'mcq');
});

test('extra choices are trimmed to four with the answer kept', () => {
  const raw = {
    items: [{ ...mcq, choices: ['Hooke law', 'Ohm law', 'Boyle law', 'Lenz law', 'Gauss law'], answer: 1 }],
  };
  const items = validateItems(raw, units);
  assert.equal(items[0].choices.length, 4);
  assert.equal(items[0].choices[items[0].answer], 'Ohm law');
});

test('identification keeps only distinct alternative spellings', () => {
  const raw = {
    items: [
      {
        type: 'identification',
        q: 'What is the unit of resistance?',
        answer: 'ohm',
        accept: ['Ohm', 'ohms', ' '],
        src: 'Slide 1',
      },
    ],
  };
  const items = validateItems(raw, units);
  assert.equal(items[0].answer, 'ohm');
  assert.deepEqual(items[0].accept, ['ohms']);
});

test('the same question twice is kept once', () => {
  const items = validateItems({ items: [mcq, { ...mcq, why: 'said again' }] }, units);
  assert.equal(items.length, 1);
});

test('matching pairs may not repeat a side', () => {
  const raw = {
    items: [
      {
        type: 'matching',
        q: 'Match each symbol to its unit.',
        pairs: [
          { left: 'V', right: 'volt' },
          { left: 'V', right: 'ampere' },
          { left: 'A', right: 'ampere' },
          { left: 'W', right: 'watt' },
          { left: 'F', right: 'farad' },
        ],
        src: 'Slide 2',
      },
    ],
  };
  const pairs = validateItems(raw, units)[0].pairs;
  assert.deepEqual(
    pairs.map((pair) => pair.left),
    ['V', 'A', 'W', 'F']
  );
});

test('the caps are the ones the client is written against', () => {
  assert.equal(LIMITS.maxItems, 40);
  assert.equal(LIMITS.maxUnits, 400);
  assert.equal(LIMITS.maxChars, 60000);
});
