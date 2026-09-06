/**
 * The narrow-screen rules, read out of the stylesheet.
 *
 * These cannot be seen without a browser, so what is checked here is the thing
 * that actually broke on a phone: a label and its control sharing one line,
 * held apart by margin-left:auto, with no room to sit side by side.
 */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const css = fs.readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');

/** The body of the first @media block whose condition matches. */
function block(condition) {
  const at = css.indexOf('@media ' + condition);
  assert.notEqual(at, -1, 'no @media ' + condition + ' in the stylesheet');
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (!depth) return css.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces after @media ' + condition);
}

const bare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declarations of one selector inside a chunk of CSS. The selector must be
 * the whole list, so asking for ".field .answer" cannot be answered by a group
 * rule that merely mentions it.
 */
function rule(text, selector) {
  const found = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.[\]()"*+\/-]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(
    bare(text)
  );
  assert.ok(found, 'no rule for ' + selector);
  return found[1];
}

const phone = block('(max-width: 620px)');

test('the settings rows stack instead of overlapping', () => {
  ['.mix-row,\n  .field', '.pair'].forEach((selector) => {
    const body = rule(phone, selector);
    assert.match(body, /flex-direction:\s*column/, selector + ' should stack');
    assert.match(body, /align-items:\s*stretch/, selector + ' should fill the width');
  });
});

test('nothing is still being pushed to the far edge', () => {
  /* margin-left:auto is what put the stepper on top of its label. */
  const pushed = rule(phone, '.stepper,\n  .seg,\n  .field .answer');
  assert.match(pushed, /margin-left:\s*0/);

  const wide = css.slice(0, css.indexOf('@media (max-width: 620px)'));
  ['.stepper', '.seg'].forEach((selector) => {
    assert.match(rule(wide, selector), /margin-left:\s*auto/, selector + ' still sits right on a wide screen');
  });
});

test('the taps are big enough for a thumb', () => {
  const step = rule(phone, '.step-btn');
  assert.match(step, /width:\s*44px/);
  assert.match(step, /height:\s*44px/);
  assert.match(rule(phone, '.seg-btn'), /flex:\s*1 1 0/, 'the three levels share the row evenly');
});

test('the dropdowns and text fields use the whole width', () => {
  assert.match(rule(phone, '.pick'), /width:\s*100%/);
  const answer = rule(phone, '.field .answer');
  assert.match(answer, /width:\s*100%/);
  assert.match(answer, /max-width:\s*none/, 'the 14em cap would leave it short');
});

test('the score bars keep their numbers readable', () => {
  assert.match(rule(phone, '.bar-row'), /grid-template-columns:\s*1fr auto/);
  assert.match(rule(phone, '.bar-row .track'), /grid-column:\s*1 \/ -1/, 'the bar drops to its own line');
});

test('the page keeps its margins on a small screen', () => {
  const shell = rule(phone, '.shell,\n  .masthead-in,\n  .dock-in');
  assert.match(shell, /min\(100% - 28px/, 'a narrower gutter, but still a gutter');
  assert.match(rule(phone, '.panel'), /padding:\s*20px 18px/);
});

test('the viewport is declared, or none of this applies', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
});
