import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/js/generate.js', import.meta.url), 'utf8');
new Function(source)();
const gen = globalThis.AR.generate;

function deck(count, chars = 2000, file = 'Lecture1.pptx') {
  return Array.from({ length: count }, (_, i) => ({
    at: 'Slide ' + (i + 1),
    file,
    text: 'x'.repeat(chars),
  }));
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

test('material is cut into contiguous batches that fit the server', () => {
  const units = deck(60);
  const batches = gen.plan(units, 24);
  assert.ok(batches.length > 1);
  batches.forEach((batch) => assert.ok(batch.chars <= gen.limits.batchChars, String(batch.chars)));
  assert.deepEqual(
    batches.flatMap((batch) => batch.units.map((unit) => unit.at)),
    units.map((unit) => unit.at)
  );
  assert.equal(batches[0].label, 'Slide 1 to ' + batches[0].units[batches[0].units.length - 1].at);
});

test('one slide is one batch, and a long deck stays under the batch ceiling', () => {
  assert.equal(gen.plan(deck(1), 5).length, 1);
  assert.equal(gen.plan(deck(1), 5)[0].label, 'Slide 1');
  const many = gen.plan(deck(400, 3000), 40);
  assert.ok(many.length <= gen.limits.batches);
  many.forEach((batch) => assert.ok(batch.chars <= gen.limits.batchChars));
});

test('fewer questions than batches go to the longest sections', () => {
  const weights = [10, 90, 20, 80, 30, 70, 40, 60, 50, 5];
  const caps = weights.map(() => 40);
  const out = gen.share(6, weights, caps);
  assert.equal(sum(out), 6);
  assert.deepEqual(out, [0, 1, 0, 1, 0, 1, 1, 1, 1, 0]);
});

test('shares respect caps and never invent questions', () => {
  assert.equal(sum(gen.share(20, [50, 50], [3, 3])), 6);
  assert.deepEqual(gen.share(4, [1, 1], [0, 9]), [0, 4]);
  assert.equal(sum(gen.share(0, [1, 2, 3], [9, 9, 9])), 0);
});

test('every requested question is placed somewhere', () => {
  const units = deck(48);
  const counts = { mcq: 12, identification: 8, enumeration: 4, matching: 4 };
  const batches = gen.allocate(gen.plan(units, 28), counts, 28);
  gen.types.forEach((type) => {
    const placed = sum(batches.map((batch) => batch.counts[type] || 0));
    assert.equal(placed, counts[type], type);
  });
  batches.forEach((batch) => assert.ok(batch.total <= gen.limits.perBatch));
  assert.equal(sum(batches.map((batch) => batch.total)), 28);
});

test('a lopsided request still fits when one batch would overflow', () => {
  const batches = gen.allocate(gen.plan(deck(3, 400), 40), { mcq: 40 }, 40);
  assert.equal(sum(batches.map((batch) => batch.counts.mcq || 0)), 40);
});

const units = [
  { at: 'Slide 1', file: 'A.pptx', text: 'one' },
  { at: 'Slide 2', file: 'A.pptx', text: 'two' },
  { at: 'Page 1', file: 'B.pdf', text: 'three' },
];

test('batches are merged into one paper in exam order', () => {
  const replies = [
    {
      model: 'openai/gpt-oss-120b',
      items: [
        { type: 'matching', q: 'Match the units', pairs: [], src: { at: 'Slide 1', file: 'A.pptx' } },
        { type: 'mcq', q: 'Later question?', choices: ['a', 'b'], answer: 0, src: { at: 'Page 1', file: 'B.pdf' } },
      ],
    },
    {
      model: 'openai/gpt-oss-120b',
      items: [
        { type: 'mcq', q: 'Earlier question?', choices: ['a', 'b'], answer: 1, src: { at: 'Slide 2', file: 'A.pptx' } },
        { type: 'identification', q: 'Name it', answer: 'ohm', src: { at: 'Slide 1', file: 'A.pptx' } },
      ],
    },
  ];
  const items = gen.collect(replies, units);
  assert.deepEqual(
    items.map((item) => item.type),
    ['mcq', 'mcq', 'identification', 'matching']
  );
  assert.deepEqual(
    items.map((item) => item.q),
    ['Earlier question?', 'Later question?', 'Name it', 'Match the units']
  );
  assert.deepEqual(
    items.map((item) => item.id),
    [1, 2, 3, 4]
  );
  assert.ok(!('rank' in items[0]));
});

test('the same question from two batches is kept once, and junk is dropped', () => {
  const replies = [
    { items: [{ type: 'mcq', q: "What is Ohm's law?", choices: ['a', 'b'], answer: 0, src: {} }] },
    {
      items: [
        { type: 'mcq', q: 'What is ohms law', choices: ['c', 'd'], answer: 1, src: {} },
        { type: 'essay', q: 'Write an essay', src: {} },
        { type: 'mcq', q: '', choices: ['a', 'b'], answer: 0, src: {} },
        null,
      ],
    },
  ];
  assert.equal(gen.collect(replies, units).length, 1);
});

test('shuffling choices keeps the answer pointing at the right one', () => {
  for (let round = 0; round < 40; round += 1) {
    const item = {
      type: 'mcq',
      q: 'Which unit measures resistance number ' + round + '?',
      choices: ['ohm', 'volt', 'ampere', 'watt'],
      answer: 0,
      src: {},
    };
    const out = gen.collect([{ items: [item] }], units)[0];
    assert.equal(out.choices[out.answer], 'ohm');
    assert.equal(out.choices.length, 4);
    assert.deepEqual([...out.choices].sort(), ['ampere', 'ohm', 'volt', 'watt']);
  }
});

test('run refuses to call out with nothing to work from', async () => {
  await assert.rejects(() => gen.run({ units: [], counts: { mcq: 4 } }), /no readable material/i);
  await assert.rejects(() => gen.run({ units: deck(2), counts: {} }), /at least one question/i);
});
