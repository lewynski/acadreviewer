import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = (name) => new URL('../' + name, import.meta.url);
const source = fs.readFileSync(here('assets/js/exporter.js'), 'utf8');

/* The exporter reads its own files. In the browser that is fetch; here it is
   the disk, which means these tests run against the real stylesheet and the
   real quiz engine rather than stand-ins. */
globalThis.fetch = async (url) => ({
  ok: true,
  text: async () => fs.readFileSync(here(url), 'utf8'),
});

new Function(source)();
const exporter = globalThis.AR.exporter;

const items = [
  {
    id: 1,
    type: 'mcq',
    q: 'Which unit measures resistance?',
    choices: ['volt', 'ohm', 'ampere', 'watt'],
    answer: 1,
    why: 'Stated on the slide.',
    src: { at: 'Slide 1', file: 'A.pptx' },
  },
  {
    id: 2,
    type: 'identification',
    q: 'Name the law relating V, I and R.',
    answer: "Ohm's law",
    accept: ['ohm law'],
    src: { at: 'Slide 2', file: 'A.pptx' },
  },
  {
    id: 3,
    type: 'enumeration',
    q: 'List the three basic circuit quantities.',
    answers: ['voltage', 'current', 'resistance'],
    src: { at: 'Slide 3', file: 'A.pptx' },
  },
  {
    id: 4,
    type: 'matching',
    q: 'Match each symbol to its unit.',
    pairs: [
      { left: 'V', right: 'volt' },
      { left: 'I', right: 'ampere' },
      { left: 'R', right: 'ohm' },
      { left: 'P', right: 'watt' },
    ],
    order: [2, 0, 3, 1],
    src: { at: 'Slide 4', file: 'A.pptx' },
  },
];

const data = {
  title: 'Circuits <midterm> & "review"',
  made: '6 September 2026',
  files: [{ name: 'A.pptx' }],
  units: [
    { at: 'Slide 1', file: 'A.pptx' },
    { at: 'Slide 2', file: 'A.pptx' },
  ],
  items,
  stamp: 1757116800000,
};

test('the key sheet reads like a marker wrote it', () => {
  assert.equal(exporter.answerText(items[0]), 'B. ohm');
  assert.equal(exporter.answerText(items[1]), "Ohm's law  (also: ohm law)");
  assert.equal(exporter.answerText(items[2]), '1. voltage   2. current   3. resistance');
  assert.equal(exporter.answerText(items[3]), '1-B   2-D   3-A   4-C');
});

test('a matching question that was never shown gets a stable order', () => {
  const fresh = { type: 'matching', pairs: items[3].pairs.slice() };
  const first = exporter.answerText(fresh);
  assert.ok(Array.isArray(fresh.order));
  assert.equal(exporter.answerText(fresh), first);
});

test('the key sheet is numbered and escaped', () => {
  const html = exporter.keySheet([{ type: 'identification', q: 'x', answer: '<b>ohm</b> & co' }]);
  assert.match(html, /class="section keysheet print-only"/);
  assert.match(html, /<span class="key-no">1<\/span>/);
  assert.match(html, /&lt;b&gt;ohm&lt;\/b&gt; &amp; co/);
  assert.ok(!html.includes('<b>ohm</b>'));
});

test('the file name is a slug of the title', () => {
  assert.equal(exporter.fileName('Circuits <midterm> & "review"'), 'academic-reviewer-circuits-midterm-review.html');
  assert.equal(exporter.fileName(''), 'academic-reviewer-quiz.html');
  assert.equal(exporter.fileName('!!!'), 'academic-reviewer-quiz.html');
});

test('the built file is one self-contained page', async () => {
  const file = await exporter.build(data);
  assert.equal(file.name, 'academic-reviewer-circuits-midterm-review.html');
  assert.match(file.text, /^<!doctype html>/);
  assert.match(file.text, /<meta charset="utf-8">/);
  assert.match(file.text, /<title>Circuits &lt;midterm&gt; &amp; &quot;review&quot;<\/title>/);
  assert.match(file.text, /<main id="app"><\/main>/);
  assert.match(file.text, /<div id="dock"><\/div>/);
  assert.ok(file.size > 40000, 'the stylesheet and engine should be inside: ' + file.size);
  assert.equal(file.blob.type, 'text/html;charset=utf-8');

  assert.ok(!/<link[^>]+href/.test(file.text), 'nothing may be linked from outside');
  assert.ok(!/<script[^>]+src=/.test(file.text), 'nothing may be loaded from outside');
  assert.ok(!/https?:\/\/(?!www\.w3|schemas)/.test(file.text.replace(/@media[^{]*/g, '')));
});

test('the questions travel intact and cannot break out of the script', async () => {
  const risky = JSON.parse(JSON.stringify(data));
  risky.items[0].q = 'Does </script><img src=x onerror=alert(1)> break it?';
  const file = await exporter.build(risky);
  const found = file.text.match(/<script type="application\/json" id="ar-data">\n([\s\S]*?)\n<\/script>/);
  assert.ok(found, 'the data block should be there');
  assert.ok(!found[1].includes('</script'), 'the data must not close its own tag');
  const back = JSON.parse(found[1]);
  assert.deepEqual(back, risky);
  assert.equal(back.items[0].q, risky.items[0].q);
});

test('the inlined engine is valid javascript with no stray closing tag', async () => {
  const file = await exporter.build(data);
  const blocks = file.text.split(/<script[^>]*>\n?/).slice(1).map((part) => part.split('<\/script>')[0]);
  assert.equal(blocks.length, 3, 'data, engine, boot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-export-'));
  const at = path.join(dir, 'inlined.js');
  fs.writeFileSync(at, blocks[1] + '\n' + blocks[2]);
  execFileSync(process.execPath, ['--check', at]);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(blocks[2], /AR\.quiz\.mount/);
  assert.match(blocks[1], /root\.AR\.grade =/);
});
