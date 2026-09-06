/**
 * The reader, with pdf.js replaced by a stub module on disk. The stub is a real
 * ES module, so its namespace is sealed the way the CDN copy is: assigning
 * anything to it throws, which is the bug this file exists to catch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dom.mjs';

const FAKE = `
export const GlobalWorkerOptions = { workerSrc: '' };
export function getDocument(options) {
  const state = globalThis.__pdf;
  state.options = options;
  return {
    promise: Promise.resolve({
      numPages: state.pages.length,
      getPage: async (n) => ({
        getTextContent: async () => ({
          items: state.pages[n - 1].map((str) => ({ str, hasEOL: true })),
        }),
        cleanup() {
          state.cleaned += 1;
        },
      }),
      destroy: async () => {
        state.destroyed += 1;
      },
    }),
  };
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-pdfjs-'));
const vendor = path.join(dir, 'assets', 'vendor', 'pdfjs');
fs.mkdirSync(vendor, { recursive: true });
fs.writeFileSync(path.join(vendor, 'pdf.min.mjs'), FAKE, 'utf8');

const stubUrl = pathToFileURL(path.join(vendor, 'pdf.min.mjs')).href;

/* The page the reader thinks it is running on: a site whose files happen to sit
   in a temp folder, so the vendored path resolves to the stub above. */
globalThis.document = { baseURI: pathToFileURL(dir + path.sep).href };
globalThis.location = { origin: 'https://reviewer.example' };

const AR = load('extract.js');

/** Sets what the next PDF will say, page by page. */
function pdf(pages) {
  globalThis.__pdf = { pages, cleaned: 0, destroyed: 0, options: null };
  return globalThis.__pdf;
}

const file = (name, extra) => ({
  name,
  size: 4096,
  arrayBuffer: async () => new ArrayBuffer(8),
  ...extra,
});

const SLIDE = ['Resistance is measured in ohms.', 'The symbol is the capital Greek omega.'];

test('a PDF becomes one unit per page, with the reader wired up as pdf.js wants', async () => {
  const state = pdf([SLIDE, ['Ohm relation: V equals I times R, with R in ohms.'], []]);
  const seen = [];
  const got = await AR.extract.read([file('Handout.pdf')], (step) => seen.push(step.at));
  assert.deepEqual(
    got.units.map((unit) => unit.at),
    ['Page 1', 'Page 2']
  );
  assert.equal(got.units[0].file, 'Handout.pdf');
  assert.equal(got.units[0].text, 'Resistance is measured in ohms.\nThe symbol is the capital Greek omega.');
  assert.deepEqual(seen, ['Page 1', 'Page 2', 'Page 3'], 'every page reports progress, empty ones too');
  assert.deepEqual(got.files[0], { name: 'Handout.pdf', size: 4096, units: 2, warning: '' });

  const mod = await import(stubUrl);
  assert.match(mod.GlobalWorkerOptions.workerSrc, /assets\/vendor\/pdfjs\/pdf\.worker\.min\.mjs$/);
  assert.match(state.options.cMapUrl, /assets\/vendor\/pdfjs\/cmaps\/$/);
  assert.equal(state.options.cMapPacked, true);
  assert.equal(state.options.isEvalSupported, false, 'no eval in the reader');
  assert.equal(state.destroyed, 1, 'the document is let go afterwards');
  assert.equal(state.cleaned, 3);
});

test('a scan says so instead of failing the whole upload', async () => {
  pdf([[], [], ['']]);
  const got = await AR.extract.read([file('Scanned.pdf'), file('Notes.txt', { text: async () => 'x' })]);
  assert.equal(got.units.length, 0);
  assert.match(got.files[0].warning, /looks like a scan\. Run OCR/);
  assert.match(got.files[1].warning, /no readable text/, 'each file is judged on its own');
});

test('mostly-empty pages are counted, not silently dropped', async () => {
  pdf([SLIDE, [], [], []]);
  const got = await AR.extract.read([file('Sparse.pdf')]);
  assert.equal(got.units.length, 1);
  assert.equal(got.files[0].warning, '3 of 4 pages held no text and were skipped.');
});

test('the old binary formats say what to save them as', async () => {
  const got = await AR.extract.read([file('Lecture.ppt'), file('Thesis.doc'), file('Photo.png')]);
  assert.equal(got.units.length, 0);
  assert.match(got.files[0].warning, /PowerPoint 97-2003 files cannot be read here/);
  assert.match(got.files[0].warning, /save as \.pptx, \.docx or PDF/);
  assert.match(got.files[1].warning, /Word 97-2003/);
  assert.match(got.files[2].warning, /Not a format this reads/);
});

test('notes with no page breaks are cut into slide-sized sections', async () => {
  const body = Array.from(
    { length: 40 },
    (_, i) => 'Line ' + (i + 1) + ': ' + 'a circuit carries current through a resistance, '.repeat(3)
  ).join('\n');
  const got = await AR.extract.read([file('Notes.md', { text: async () => body })]);
  assert.ok(got.units.length > 1, 'a long file is more than one unit');
  assert.deepEqual(
    got.units.slice(0, 2).map((unit) => unit.at),
    ['Section 1', 'Section 2']
  );
  assert.equal(
    got.units.every((unit) => unit.text.length <= AR.extract.limits.unitChars + 3),
    true
  );
});

test('a huge upload stops at the cap and says it stopped', async () => {
  pdf(Array.from({ length: 460 }, (_, i) => ['Page ' + (i + 1) + ' of a long handout about circuits.']));
  const got = await AR.extract.read([file('Big.pdf')]);
  assert.equal(got.units.length, AR.extract.limits.units);
  assert.equal(got.units[got.units.length - 1].at, 'Page 400');
  assert.deepEqual(got.warnings, [
    'That is a lot of material, so only the first 400 slides and pages were used.',
  ]);
});
