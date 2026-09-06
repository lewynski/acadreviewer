import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const page = read('index.html');
const app = read('assets/js/app.js');
const css = read('assets/css/style.css');

const all = (text, pattern) => [...text.matchAll(pattern)].map((hit) => hit[1]);
const ids = new Set(all(page, /\sid="([^"]+)"/g));

test('every element the app reaches for is on the page', () => {
  const wanted = new Set(all(app, /\$\('([^']+)'\)/g));
  assert.ok(wanted.size > 15, 'the app should be looking things up: ' + wanted.size);
  wanted.forEach((id) => assert.ok(ids.has(id), 'index.html is missing #' + id));
});

test('the ids the quiz engine and the export rely on are there', () => {
  ['app', 'dock'].forEach((id) => assert.ok(ids.has(id)));
  assert.match(page, /<main class="shell" id="app">/);
  assert.match(page, /<div id="dock"><\/div>/);
});

test('nothing is loaded that is not in the repo', () => {
  const paths = all(page, /(?:src|href)="([^"]+)"/g);
  assert.ok(paths.length > 5);
  paths.forEach((at) => {
    assert.ok(!/^https?:/.test(at), 'the page should not reach out to ' + at);
    assert.ok(fs.existsSync(new URL('../' + at, import.meta.url)), 'missing file: ' + at);
  });
  assert.deepEqual(
    all(page, /<script src="assets\/js\/([a-z]+)\.js" defer><\/script>/g),
    ['zip', 'extract', 'grade', 'quiz', 'generate', 'exporter', 'app']
  );
});

test('the class names the app hands out are all styled', () => {
  const used = new Set();
  all(app, /row\('[a-z]+', '([a-z0-9 -]+)'/g).forEach((list) => list.split(' ').forEach((one) => used.add(one)));
  all(app, /classList\.toggle\('([a-z-]+)'/g).forEach((one) => used.add(one));
  all(page, /\sclass="([^"]+)"/g).forEach((list) => list.split(/\s+/).forEach((one) => used.add(one)));
  used.delete('');
  assert.ok(used.size > 20);
  used.forEach((one) => assert.ok(css.includes('.' + one), 'style.css has no rule for .' + one));
});

test('the markup is balanced', () => {
  ['div', 'section', 'span', 'ul', 'p', 'button', 'label', 'main', 'header', 'footer', 'html', 'body'].forEach(
    (tag) => {
      const open = (page.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
      const close = (page.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      assert.equal(open, close, tag + ': ' + open + ' open, ' + close + ' closed');
    }
  );
});

test('the file picker is labelled and accepts what the reader can read', () => {
  assert.match(page, /<label class="btn" for="files" id="pick">/);
  assert.match(page, /<input\s[^>]*id="files"[\s\S]*?accept="([^"]+)"/);
  const accept = /accept="([^"]+)"/.exec(page)[1].split(',');
  const readers = read('assets/js/extract.js');
  accept.forEach((one) => {
    const kind = one.replace('.', '');
    assert.match(readers, new RegExp('\\n\\s+' + kind + ': read', 'i'), kind + ' has no reader');
  });
});

test('each stepper carries the type the app stores it under', () => {
  const types = all(page, /data-type="([a-z]+)"/g);
  assert.deepEqual(types, ['mcq', 'identification', 'enumeration', 'matching']);
  assert.deepEqual(all(page, /data-level="([a-z]+)"/g), ['recall', 'balanced', 'hard']);
  types.forEach((type) => assert.ok(app.includes(type + ':'), 'app.js has no default for ' + type));
});
