import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/js/grade.js', import.meta.url), 'utf8');
new Function(source)();
const grade = globalThis.AR.grade;

test('accepts punctuation and spacing differences', () => {
  assert.equal(grade.check("ohms law", ["Ohm's Law"]).match, true);
  assert.equal(grade.check("  Ohm's   law ", ["ohms law"]).match, true);
  assert.equal(grade.check('the resistor', ['resistor']).match, true);
});

test('accepts plurals, accents and acronyms', () => {
  assert.equal(grade.check('diodes', ['diode']).match, true);
  assert.equal(grade.check('resume', ['résumé']).match, true);
  assert.equal(grade.check('KCL', ["Kirchhoff's Current Law"]).match, true);
});

test('forgives a typo in a long answer but not a different word', () => {
  const typo = grade.check('photosynthisis', ['photosynthesis']);
  assert.equal(typo.match, true);
  assert.equal(typo.typo, true);
  assert.equal(grade.check('capacitor', ['resistor']).match, false);
  assert.equal(grade.check('ion', ['ohm']).match, false);
});

test('compares numbers by value', () => {
  assert.equal(grade.check('1,000', ['1000']).match, true);
  assert.equal(grade.check('.5', ['0.50']).match, true);
  assert.equal(grade.check('12', ['21']).match, false);
});

test('blank answers are never correct', () => {
  assert.equal(grade.check('', ['anything']).match, false);
  assert.equal(grade.check('   ', ['anything']).match, false);
});

test('grades multiple choice on the stored index', () => {
  const item = { id: 'q1', type: 'mcq', q: 'Unit of resistance?', choices: ['A', 'B', 'C', 'D'], answer: 2 };
  assert.equal(grade.gradeItem(item, 2).correct, true);
  assert.equal(grade.gradeItem(item, 0).correct, false);
  assert.equal(grade.gradeItem(item, null).answered, false);
});

test('enumeration gives partial credit and ignores order', () => {
  const item = { id: 'q2', type: 'enumeration', q: 'List three', answers: ['alpha', 'beta', 'gamma'] };
  const full = grade.gradeItem(item, ['gamma', 'alpha', 'beta']);
  assert.equal(full.correct, true);
  assert.equal(full.points, 3);
  assert.equal(full.earned, 3);

  const partial = grade.gradeItem(item, ['alpha', 'delta', '']);
  assert.equal(partial.correct, false);
  assert.equal(partial.earned, 1);
  assert.deepEqual(partial.missed, ['beta', 'gamma']);
  assert.deepEqual(
    partial.blanks.map((b) => b.status),
    ['right', 'wrong', 'blank']
  );
});

test('enumeration does not award the same answer twice', () => {
  const item = { id: 'q3', type: 'enumeration', q: 'List two', answers: ['alpha', 'beta'] };
  const result = grade.gradeItem(item, ['alpha', 'alpha']);
  assert.equal(result.earned, 1);
  assert.deepEqual(result.missed, ['beta']);
});

test('matching gives one point per correct row', () => {
  const item = {
    id: 'q4',
    type: 'matching',
    q: 'Match them',
    pairs: [
      { left: 'V', right: 'volt' },
      { left: 'A', right: 'ampere' },
      { left: 'W', right: 'watt' },
    ],
  };
  assert.equal(grade.gradeItem(item, [0, 1, 2]).earned, 3);
  const partial = grade.gradeItem(item, [0, 2, 1]);
  assert.equal(partial.earned, 1);
  assert.equal(partial.correct, false);
  assert.equal(grade.gradeItem(item, []).answered, false);
});

test('scoreQuiz totals points, items and per-type breakdown', () => {
  const items = [
    { id: 'a', type: 'mcq', q: 'Pick', choices: ['1', '2', '3', '4'], answer: 0 },
    { id: 'b', type: 'identification', q: 'Name it', answer: 'ampere', accept: ['A'] },
    { id: 'c', type: 'enumeration', q: 'List two', answers: ['one', 'two'] },
  ];
  const summary = grade.scoreQuiz(items, { a: 0, b: 'Ampere', c: ['one', 'nope'] });

  assert.equal(summary.total, 3);
  assert.equal(summary.answered, 3);
  assert.equal(summary.right, 2);
  assert.equal(summary.points, 4);
  assert.equal(summary.earned, 3);
  assert.equal(summary.percent, 75);
  assert.deepEqual(summary.byType.mcq, { items: 1, right: 1, points: 1, earned: 1 });
  assert.deepEqual(summary.byType.enumeration, { items: 1, right: 0, points: 2, earned: 1 });
});

test('an untouched reviewer scores zero without throwing', () => {
  const items = [{ id: 'a', type: 'mcq', q: 'Pick', choices: ['1', '2', '3', '4'], answer: 0 }];
  const summary = grade.scoreQuiz(items, undefined);
  assert.equal(summary.percent, 0);
  assert.equal(summary.answered, 0);
});
