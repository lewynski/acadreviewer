/**
 * The file you keep, run the way you would run it: nothing on the page but what
 * the export wrote, and no AR namespace until the inlined engine installs one.
 */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { all, one, press, fire, reset, load } from './dom.mjs';

globalThis.fetch = async (url) => ({
  ok: true,
  text: async () => fs.readFileSync(new URL('../' + url, import.meta.url), 'utf8'),
});

reset();
const AR = load('grade.js', 'quiz.js', 'exporter.js');

const paper = () => ({
  title: 'Circuits week 1',
  made: '6 September 2026',
  stamp: 99,
  files: [{ name: 'Lecture1.pptx' }],
  units: [
    { at: 'Slide 3', file: 'Lecture1.pptx' },
    { at: 'Slide 4', file: 'Lecture1.pptx' },
  ],
  items: [
    {
      id: 1,
      type: 'mcq',
      q: 'Which unit measures resistance?',
      choices: ['volt', 'ohm', 'ampere', 'watt'],
      answer: 1,
      src: { at: 'Slide 3', file: 'Lecture1.pptx' },
    },
    {
      id: 2,
      type: 'identification',
      q: 'Which law relates V, I and R? <script>alert(1)</script>',
      answer: "Ohm's law",
      accept: [],
      src: { at: 'Slide 4', file: 'Lecture1.pptx' },
    },
  ],
});

/** Pulls the three script blocks the export writes back out of the file. */
function unpack(text) {
  const data = /<script type="application\/json" id="ar-data">\n([\s\S]*?)\n<\/script>/.exec(text);
  const plain = [...text.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((hit) => hit[1]);
  assert.ok(data, 'the file should carry its questions as JSON');
  assert.equal(plain.length, 2, 'the engine and the boot script');
  return { data: data[1], engine: plain[0], boot: plain[1] };
}

/** Sets up the page the export writes, then lets the file boot itself. */
function openFile(text) {
  const parts = unpack(text);
  const page = reset();
  const node = (tag, id) => {
    const made = page.document.createElement(tag);
    made.setAttribute('id', id);
    page.document.body.appendChild(made);
    return made;
  };
  const host = node('main', 'app');
  const dock = node('div', 'dock');
  node('script', 'ar-data').textContent = parts.data;
  delete globalThis.AR;
  new Function(parts.engine)();
  new Function(parts.boot)();
  page.host = host;
  page.dock = dock;
  page.submit = one(dock, '.btn');
  globalThis.AR = AR;
  return page;
}

test('the exported file boots, marks answers and scores itself', async () => {
  const file = await AR.exporter.build(paper());
  const page = openFile(file.text);
  const qs = all(page.host, '.q');
  assert.equal(qs.length, 2);
  assert.deepEqual(
    qs.map((q) => one(q, '.q-text').textContent),
    ['Which unit measures resistance?', 'Which law relates V, I and R? <script>alert(1)</script>']
  );

  const radio = all(qs[0], 'input')[1];
  fire(radio, 'change');
  const typed = one(qs[1], '.answer');
  typed.value = 'kirchhoff';
  fire(typed, 'input');
  press(page.submit);

  assert.equal(one(page.host, '.score-value').textContent, '50%');
  assert.equal(one(page.host, '.score-sub').textContent, '1 of 2 marks, 1 of 2 questions fully right');
  assert.equal(all(page.host, '.review-item').length, 1);
  assert.deepEqual(
    all(one(page.host, '.review-item'), '.review-line').map((line) => line.textContent),
    ['You putkirchhoff', "AnswerOhm's law", 'FromSlide 4, Lecture1.pptx']
  );
  assert.equal(all(page.host, '.tile').length, 2, 'the lattice still knows the material');
});

test('the file remembers attempts on its own, per reviewer', async () => {
  const file = await AR.exporter.build(paper());
  const page = openFile(file.text);
  fire(all(all(page.host, '.q')[0], 'input')[1], 'change');
  press(page.submit);
  const saved = JSON.parse(page.store.getItem('ar-file-99'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].percent, 50);
});

test('the printed key sheet is the answers, and only prints', async () => {
  const file = await AR.exporter.build(paper());
  assert.match(file.text, /<section class="section keysheet print-only">/);
  const rows = [...file.text.matchAll(/<span class="key-a">([\s\S]*?)<\/span>/g)].map((hit) => hit[1]);
  assert.deepEqual(rows, ['B. ohm', "Ohm's law"]);
  assert.equal(file.name, 'acadex-circuits-week-1.html');
  assert.match(file.text, /Made 6 September 2026 from Lecture1\.pptx/);
});
