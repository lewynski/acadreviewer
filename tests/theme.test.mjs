/**
 * The theme button, run against the stub DOM.
 *
 * app.js expects a whole page, so the page is built here from the ids
 * index.html declares: if the markup ever loses one, this file stops before it
 * gets to the theme at all, which is the point.
 */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reset, press } from './dom.mjs';

const read = (name) => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const page = read('index.html');
const source = read('assets/js/app.js');

/**
 * Stands up every element app.js looks up, plus the <html> element the theme is
 * written on and the window it listens to, then runs the app on it.
 */
function boot(saved) {
  const kit = reset();
  const document = kit.document;
  const root = document.createElement('html');
  document.documentElement = root;
  globalThis.window = { addEventListener() {} };
  if (saved != null) globalThis.localStorage.setItem('ar-theme', saved);

  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((hit) => hit[1]);
  const made = {};
  ids.forEach((id) => {
    if (id === 'app' || id === 'dock') return;
    const node = document.createElement(id === 'files' ? 'input' : 'div');
    node.setAttribute('id', id);
    document.body.appendChild(node);
    made[id] = node;
  });
  kit.host.setAttribute('id', 'app');
  kit.dock.setAttribute('id', 'dock');

  new Function(source)();
  return { root, node: made, store: globalThis.localStorage };
}

test('a first visit is dark, whatever the machine prefers', () => {
  const it = boot(null);
  assert.equal(it.root.getAttribute('data-theme'), 'dark');
  assert.equal(it.node.theme.getAttribute('aria-pressed'), 'true');
  assert.equal(it.node.theme.getAttribute('title'), 'Switch to light');
  assert.equal(it.node['theme-said'].textContent, 'Switch to light');
  assert.equal(it.node['theme-mark'].textContent, '☽', 'dark shows the moon');
});

test('pressing it turns the page over, and says what it will do next', () => {
  const it = boot(null);
  press(it.node.theme);
  assert.equal(it.root.getAttribute('data-theme'), 'light');
  assert.equal(it.node.theme.getAttribute('aria-pressed'), 'false');
  assert.equal(it.node.theme.getAttribute('title'), 'Switch to dark');
  assert.equal(it.node['theme-mark'].textContent, '☀', 'light shows the sun');
  assert.equal(it.store.getItem('ar-theme'), 'light', 'the choice is kept');

  press(it.node.theme);
  assert.equal(it.root.getAttribute('data-theme'), 'dark');
  assert.equal(it.store.getItem('ar-theme'), 'dark');
});

test('a remembered choice is honoured on the next visit', () => {
  assert.equal(boot('light').root.getAttribute('data-theme'), 'light');
  assert.equal(boot('dark').root.getAttribute('data-theme'), 'dark');
  assert.equal(boot('sideways').root.getAttribute('data-theme'), 'dark', 'junk falls back to dark');
});

test('the page sets the theme before it paints, from the same key', () => {
  const head = page.slice(0, page.indexOf('</head>'));
  assert.match(head, /localStorage\.getItem\('ar-theme'\)/, 'the early script reads the saved choice');
  assert.match(head, /pick === 'light' \? 'light' : 'dark'/, 'and lands on dark unless light was asked for');
  assert.ok(head.indexOf('localStorage') < page.indexOf('<body>'), 'and it runs before the body');
  assert.match(source, /THEME_STORE = 'ar-theme'/, 'app.js writes the key the early script reads');
});

test('paper is white whichever theme was on screen', () => {
  /* The print block and the theme blocks have equal specificity, so print only
     wins by coming last. A dark page printed from a reordered stylesheet would
     be black ink on black paper. */
  const css = read('assets/css/style.css');
  const print = css.indexOf('@media print');
  assert.ok(print > css.lastIndexOf('[data-theme='), 'the print override must come after every theme block');
  assert.match(css.slice(print), /:root\s*\{[^}]*--bg:\s*#ffffff/);
  assert.match(css.slice(print), /--ink:\s*#000000/);
});

test('the stylesheet is dark by default and lets a choice beat the device', () => {
  const css = read('assets/css/style.css');
  assert.match(
    css,
    /:root,\s*\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/,
    'a page with no data-theme at all is still dark'
  );
  assert.match(css, /\[data-theme="light"\]\s*\{/, 'light can be asked for');
  assert.match(
    css,
    /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)/,
    'the device preference only applies where no choice was made, so the button always wins'
  );
});
