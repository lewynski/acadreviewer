/**
 * The quiz engine on a stub DOM: what gets drawn, what grading says on screen,
 * and what the scoreboard reports. This is the file the reader spends their
 * time in, and it is shared verbatim with the offline download.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { all, one, hidden, press, fire, reset, load } from './dom.mjs';

reset();
const AR = load('grade.js', 'quiz.js');

const ITEMS = [
  {
    id: 1,
    type: 'mcq',
    q: 'Which unit measures resistance?',
    choices: ['volt', 'ohm', 'ampere', 'watt'],
    answer: 1,
    why: 'Resistance is measured in ohms.',
    src: { at: 'Slide 3', file: 'Lecture1.pptx' },
  },
  {
    id: 2,
    type: 'identification',
    q: 'Which law relates V, I and R?',
    answer: "Ohm's law",
    accept: ['ohm law'],
    src: { at: 'Slide 4', file: 'Lecture1.pptx' },
  },
  {
    id: 3,
    type: 'enumeration',
    q: 'Name the three quantities in the Ohm relation.',
    answers: ['voltage', 'current', 'resistance'],
    src: { at: 'Slide 5', file: 'Lecture1.pptx' },
  },
  {
    id: 4,
    type: 'matching',
    q: 'Match each symbol to its unit.',
    pairs: [
      { left: 'V', right: 'volt' },
      { left: 'A', right: 'ampere' },
      { left: 'W', right: 'watt' },
    ],
    order: [2, 0, 1],
    src: { at: 'Page 2', file: 'Handout.pdf' },
  },
];

const UNITS = [
  { at: 'Slide 3', file: 'Lecture1.pptx' },
  { at: 'Slide 4', file: 'Lecture1.pptx' },
  { at: 'Slide 5', file: 'Lecture1.pptx' },
  { at: 'Page 2', file: 'Handout.pdf' },
  { at: 'Page 9', file: 'Handout.pdf' },
];

const paper = () => ({
  title: 'Circuits',
  made: '6 September 2026',
  stamp: 7,
  files: [{ name: 'Lecture1.pptx' }, { name: 'Handout.pdf' }],
  units: UNITS,
  items: structuredClone(ITEMS),
});

function open(mode, key) {
  const page = reset();
  page.api = AR.quiz.mount(page.host, paper(), {
    mode: mode || 'study',
    dock: page.dock,
    storageKey: key === undefined ? 'ar-test' : key,
  });
  page.qs = all(page.host, '.q');
  page.submit = one(page.dock, '.btn');
  page.meta = one(page.dock, '.dock-meta');
  return page;
}

const checkOf = (q) => one(q, '.btn-small');
const verdictOf = (q) => one(q, '.verdict');
const whys = (q) => all(verdictOf(q), '.verdict-why').map((node) => node.textContent);
const picks = (q, index) => all(q, 'input')[index];
const seg = (page) => all(page.host, '.seg-btn');

function tap(node, value) {
  if (value !== undefined) node.value = value;
  fire(node, node.tagName === 'INPUT' && node.type === 'text' ? 'input' : 'change');
}

/** The half-right run every scoreboard assertion below is measured against. */
function halfRight(page) {
  tap(picks(page.qs[0], 1));
  const blanks = all(page.qs[2], '.blank');
  tap(blanks[0], 'voltage');
  tap(blanks[1], 'current');
  tap(all(page.qs[3], 'select')[0], '0');
}

test('one question per item, each labelled with what it is worth', () => {
  const page = open();
  assert.equal(page.qs.length, 4);
  assert.deepEqual(
    page.qs.map((q) => one(q, '.q-kind').textContent),
    ['Multiple choice', 'Identification', 'Enumeration, 3 marks', 'Matching, 3 marks']
  );
  assert.deepEqual(
    page.qs.map((q) => one(q, '.q-no').textContent),
    ['1', '2', '3', '4']
  );
  assert.equal(
    one(page.host, '.panel-note').textContent,
    '4 questions, 8 marks, from 2 files covering 5 slides and pages'
  );
  assert.equal(one(page.host, '.quiz-h').textContent, 'Circuits');
});

test('the dock waits for an answer before it will score anything', () => {
  const page = open();
  assert.equal(page.meta.textContent, '0 of 4 answered');
  assert.equal(page.submit.disabled, true);
  assert.equal(page.submit.textContent, 'Finish and score');
  tap(picks(page.qs[0], 1));
  assert.equal(page.meta.textContent, '1 of 4 answered');
  assert.equal(page.submit.disabled, false);
  assert.equal(page.api.grade(), null);
});

test('study mode answers one question and leaves the rest alone', () => {
  const page = open();
  tap(picks(page.qs[0], 1));
  press(checkOf(page.qs[0]));
  const choices = all(page.qs[0], '.choice');
  assert.equal(verdictOf(page.qs[0]).textContent.startsWith('Correct'), true);
  assert.equal(choices[1].classList.contains('is-key'), true);
  assert.equal(choices.some((node) => node.classList.contains('is-picked')), false);
  assert.equal(hidden(checkOf(page.qs[0])), true, 'the check button has done its job');
  assert.equal(all(page.qs[0], 'input').every((node) => node.disabled), true);
  assert.equal(hidden(verdictOf(page.qs[1])), true, 'question 2 stays untouched');
  assert.equal(hidden(checkOf(page.qs[1])), false);
  assert.equal(page.api.grade(), null, 'checking one question is not submitting');
});

test('a wrong choice shows the key, the reason and where it came from', () => {
  const page = open();
  tap(picks(page.qs[0], 3));
  press(checkOf(page.qs[0]));
  const choices = all(page.qs[0], '.choice');
  assert.equal(one(verdictOf(page.qs[0]), '.verdict-wrong').textContent, 'Not quite');
  assert.equal(choices[3].classList.contains('is-miss'), true);
  assert.equal(choices[1].classList.contains('is-key'), true);
  assert.deepEqual(whys(page.qs[0]), ['Answer: B. ohm', 'Resistance is measured in ohms.']);
  assert.equal(one(verdictOf(page.qs[0]), '.source').textContent, 'Slide 3, Lecture1.pptx');
});

test('a near-miss spelling still counts, and says how it is spelled', () => {
  const page = open();
  const input = one(page.qs[1], '.answer');
  tap(input, 'ohmz law');
  press(checkOf(page.qs[1]));
  assert.equal(verdictOf(page.qs[1]).textContent.startsWith('Correct, with a small spelling slip'), true);
  assert.deepEqual(whys(page.qs[1]), ["Spelled: Ohm's law"]);
  assert.equal(input.classList.contains('is-ok'), true);
});

test('pressing Enter on an identification checks it', () => {
  const page = open();
  const input = one(page.qs[1], '.answer');
  tap(input, 'nonsense');
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(hidden(verdictOf(page.qs[1])), false);
  assert.deepEqual(whys(page.qs[1]), ["Answer: Ohm's law", 'Also accepted: ohm law']);
});

test('enumeration pays a mark per part, in any order', () => {
  const page = open();
  const blanks = all(page.qs[2], '.blank');
  tap(blanks[0], 'resistance');
  tap(blanks[1], 'voltage');
  press(checkOf(page.qs[2]));
  assert.equal(verdictOf(page.qs[2]).textContent.startsWith('2 of 3 marks'), true);
  assert.deepEqual(whys(page.qs[2]), ['Still missing: current']);
  assert.deepEqual(
    blanks.map((node) => node.classList.contains('is-ok')),
    [true, true, false]
  );
});

const shown = (select) => all(select, 'option').map((node) => node.textContent);

test('matching offers the right column shuffled, and keeps that shuffle', () => {
  const page = open();
  const selects = all(page.qs[3], 'select');
  assert.equal(selects.length, 3);
  assert.deepEqual(shown(selects[0]), ['Choose one', 'A. watt', 'B. volt', 'C. ampere']);
  assert.deepEqual(all(selects[0], 'option').map((node) => node.value), ['', '2', '0', '1']);
  assert.deepEqual(shown(selects[1]), shown(selects[0]), 'every row offers the same column');
  assert.deepEqual(shown(selects[2]), shown(selects[0]));

  const spare = reset();
  const item = structuredClone(ITEMS[3]);
  delete item.order;
  const data = { title: 'Symbols', items: [item], units: [] };
  AR.quiz.mount(spare.host, data, { dock: spare.dock });
  const first = shown(one(spare.host, 'select'));
  assert.equal(item.order.length, 3, 'the shuffle is stored on the item');
  AR.quiz.mount(spare.host, data, { dock: spare.dock });
  assert.deepEqual(shown(one(spare.host, 'select')), first, 'a remount shows the same order');
});

test('a part-right matching names the pairs that were wrong', () => {
  const page = open();
  const selects = all(page.qs[3], 'select');
  tap(selects[0], '0');
  tap(selects[1], '2');
  press(checkOf(page.qs[3]));
  assert.equal(verdictOf(page.qs[3]).textContent.startsWith('1 of 3 marks'), true);
  assert.deepEqual(whys(page.qs[3]), ['2 pairs with ampere; 3 pairs with watt']);
  assert.deepEqual(
    selects.map((node) => node.className),
    ['pick is-ok', 'pick is-no', 'pick is-no']
  );
});

const button = (root, label) => all(root, 'button').find((node) => node.textContent === label);

test('the mode switch hides and restores the per-question checks', () => {
  const page = open();
  const [study, exam] = seg(page);
  press(exam);
  assert.deepEqual(seg(page).map((node) => node.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal(page.qs.every((q) => hidden(checkOf(q))), true);
  assert.equal(page.submit.textContent, 'Check my answers');
  press(study);
  assert.equal(page.qs.some((q) => hidden(checkOf(q))), false);
  assert.equal(page.submit.textContent, 'Finish and score');
});

test('exam mode reveals nothing until the whole paper is submitted', () => {
  const page = open('exam');
  halfRight(page);
  assert.equal(page.qs.every((q) => hidden(verdictOf(q))), true);
  assert.equal(page.api.grade(), null);
  press(page.submit);
  assert.equal(page.qs.every((q) => !hidden(verdictOf(q))), true);
  assert.equal(page.qs.every((q) => hidden(checkOf(q))), true);
  assert.equal(page.api.grade().percent, 50);
  assert.equal(seg(page).every((node) => node.disabled), true, 'the mode is settled once it is marked');
});

test('the scoreboard totals the marks and splits them by type', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  assert.equal(one(page.host, '.score-value').textContent, '50%');
  assert.equal(one(page.host, '.score-sub').textContent, '4 of 8 marks, 1 of 4 questions fully right');
  assert.deepEqual(
    all(page.host, '.bar-row').map((row) => row.textContent),
    ['Multiple choice1/1', 'Identification0/1', 'Enumeration2/3', 'Matching1/3']
  );
  assert.equal(page.meta.textContent, '4 of 8 marks');
  assert.equal(page.submit.textContent, 'Start over');
});

test('the lattice colours every slide by how its questions went', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  const tiles = all(page.host, '.tile');
  assert.deepEqual(
    tiles.map((tile) => tile.className),
    ['tile is-right', 'tile is-wrong', 'tile is-part', 'tile is-part', 'tile']
  );
  assert.equal(tiles[0].getAttribute('title'), 'Slide 3, Lecture1.pptx');
  assert.equal(tiles[4].getAttribute('title'), 'Page 9, Handout.pdf (no question from here)');
  assert.equal(
    one(page.host, '.measure').textContent,
    'Questions came from 4 of 5 slides and pages, and 3 parts still need work.'
  );
});

test('what to go over holds the misses, what you put, and the key', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  const rows = all(page.host, '.review-item');
  assert.deepEqual(
    rows.map((row) => one(row, '.review-q').textContent),
    [
      '2. Which law relates V, I and R?',
      '3. Name the three quantities in the Ohm relation.',
      '4. Match each symbol to its unit.',
    ]
  );
  assert.deepEqual(
    all(rows[0], '.review-line').map((line) => line.textContent),
    ['You putnothing', "AnswerOhm's law", 'FromSlide 4, Lecture1.pptx']
  );
  assert.deepEqual(
    all(rows[1], '.review-line').map((line) => line.textContent),
    ['You putvoltage, current', 'Answervoltage, current, resistance', 'FromSlide 5, Lecture1.pptx']
  );
  assert.deepEqual(
    all(rows[2], '.review-line').map((line) => line.textContent),
    ['You put1: volt; 2: blank; 3: blank', 'Answer1: volt; 2: ampere; 3: watt', 'FromPage 2, Handout.pdf']
  );
  assert.ok(button(rows[0], 'Go to question 2'), 'each miss links back to the question');
});

test('a clean run leaves nothing to go over', () => {
  const page = open('exam');
  tap(picks(page.qs[0], 1));
  tap(one(page.qs[1], '.answer'), "Ohm's law");
  const blanks = all(page.qs[2], '.blank');
  ['voltage', 'current', 'resistance'].forEach((value, index) => tap(blanks[index], value));
  const selects = all(page.qs[3], 'select');
  ['0', '1', '2'].forEach((value, index) => tap(selects[index], value));
  press(page.submit);
  assert.equal(one(page.host, '.score-value').textContent, '100%');
  assert.equal(all(page.host, '.review-item').length, 0);
  const notes = all(page.host, '.measure').map((node) => node.textContent);
  assert.deepEqual(notes, [
    'Questions came from 4 of 5 slides and pages. Every part you were asked about is solid.',
    'Nothing. Every question came back right.',
  ]);
});

test('attempts are remembered per reviewer, and shown on the second round', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  const first = JSON.parse(page.store.getItem('ar-test'));
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].percent, first[0].earned, first[0].points], [50, 4, 8]);

  press(button(page.host, 'Take it again'));
  assert.ok(page.calls.scroll > 0, 'a retake takes you back to the top');
  const again = all(page.host, '.q');
  assert.equal(again.length, 4);
  assert.equal(again.every((q) => hidden(verdictOf(q))), true);
  assert.equal(all(again[0], 'input').every((node) => !node.disabled), true);

  const dock = one(page.dock, '.btn');
  tap(picks(again[0], 1));
  press(dock);
  assert.equal(JSON.parse(page.store.getItem('ar-test')).length, 2);
  assert.equal(all(page.host, '.history').length, 1);
  assert.equal(all(one(page.host, '.history'), 'li').length, 2);
});

test('retrying the misses mounts only those questions', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  press(button(page.host, 'Retry just these 3'));
  const fresh = all(page.host, '.q');
  assert.deepEqual(
    fresh.map((q) => one(q, '.q-kind').textContent),
    ['Identification', 'Enumeration, 3 marks', 'Matching, 3 marks']
  );
  assert.equal(one(page.dock, '.dock-meta').textContent, '0 of 3 answered');
});

test('printing is handed to the browser, and marks are counted per part', () => {
  const page = open('exam');
  halfRight(page);
  press(page.submit);
  press(button(page.host, 'Print or save as PDF'));
  assert.equal(page.calls.print, 1);
  assert.deepEqual(AR.quiz.types, ['mcq', 'identification', 'enumeration', 'matching']);
  assert.equal(AR.quiz.labels.matching, 'Matching');
  assert.deepEqual(ITEMS.map(AR.quiz.marksOf), [1, 1, 3, 3]);
});

test('a reviewer with no stored key still runs, it just forgets', () => {
  const page = open('exam', null);
  halfRight(page);
  press(page.submit);
  assert.equal(one(page.host, '.score-value').textContent, '50%');
  assert.equal(all(page.host, '.history').length, 0);
  assert.equal(page.store.map.size, 0);
});




