/**
 * Packs a finished reviewer into one HTML file that works with no network.
 *
 * The file carries its own copy of the stylesheet, the grader and the quiz
 * engine, plus the questions as JSON. Opening it later gives the same quiz,
 * graded the same way, with an answer key that prints on its own page. There
 * is no second implementation to keep in step: the export inlines the very
 * files this page is running.
 */
(function (root) {
  'use strict';

  var CSS = 'assets/css/style.css';
  var JS = ['assets/js/grade.js', 'assets/js/quiz.js'];
  var held = {};

  /** Reads one of our own files, once per session. */
  async function part(url) {
    if (held[url]) return held[url];
    var res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('Could not read ' + url + ' to build the file.');
    held[url] = await res.text();
    return held[url];
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Only "<" has to go: it is what would end the script element early. */
  function payload(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function letter(index) {
    return String.fromCharCode(65 + index);
  }

  /**
   * The right-hand column of a matching question is shuffled once and the order
   * is kept on the item, so the printed key and the file agree with what the
   * reader already saw on screen.
   */
  function order(item) {
    var pairs = item.pairs || [];
    if (Array.isArray(item.order) && item.order.length === pairs.length) return item.order;
    var out = pairs.map(function (pair, index) {
      return index;
    });
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    item.order = out;
    return out;
  }

  /** One line of the answer key, in the words a marker would use. */
  function answerText(item) {
    if (item.type === 'mcq') {
      var pick = item.choices && item.choices.length > item.answer ? item.choices[item.answer] : '';
      return letter(item.answer || 0) + '. ' + pick;
    }
    if (item.type === 'identification') {
      var also = (item.accept || []).filter(Boolean);
      return item.answer + (also.length ? '  (also: ' + also.join(', ') + ')' : '');
    }
    if (item.type === 'enumeration') {
      return (item.answers || [])
        .map(function (one, i) {
          return i + 1 + '. ' + one;
        })
        .join('   ');
    }
    var shown = order(item);
    return (item.pairs || [])
      .map(function (pair, index) {
        var at = shown.indexOf(index);
        return index + 1 + '-' + letter(at < 0 ? index : at);
      })
      .join('   ');
  }

  /** A key sheet, hidden on screen and printed on its own page. */
  function keySheet(items) {
    var rows = items
      .map(function (item, index) {
        return (
          '<div class="key-row"><span class="key-no">' +
          (index + 1) +
          '</span><span class="key-a">' +
          esc(answerText(item)) +
          '</span></div>'
        );
      })
      .join('\n');
    return (
      '<section class="section keysheet print-only">\n' +
      '<h2>Answer key</h2>\n' +
      '<div class="key-list">\n' +
      rows +
      '\n</div>\n</section>'
    );
  }

  var BOOT = [
    '(function () {',
    '  var host = document.getElementById("app");',
    '  try {',
    '    var data = JSON.parse(document.getElementById("ar-data").textContent);',
    '    AR.quiz.mount(host, data, {',
    '      mode: "study",',
    '      dock: document.getElementById("dock"),',
    '      storageKey: "ar-file-" + data.stamp',
    '    });',
    '  } catch (err) {',
    '    host.textContent = "This reviewer could not start: " + (err && err.message ? err.message : err);',
    '  }',
    '})();',
  ].join('\n');

  /** The whole offline file, as one string. */
  function page(data, css, js) {
    var made = data.made ? 'Made ' + data.made : '';
    var from = data.files && data.files.length
      ? ' from ' + data.files.map(function (file) { return file.name; }).join(', ')
      : '';
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + esc(data.title || 'Reviewer') + '</title>',
      '<style>',
      css,
      '</style>',
      '</head>',
      '<body>',
      '<div class="shell">',
      '<main id="app"></main>',
      '<noscript><p class="note">This reviewer needs JavaScript to mark your answers. The answer key still prints.</p></noscript>',
      keySheet(data.items || []),
      '<p class="footer">' + esc(made + from) + '. Saved from Academic Reviewer, works with no internet.</p>',
      '</div>',
      '<div id="dock"></div>',
      '<script type="application/json" id="ar-data">',
      payload(data),
      '<\/script>',
      '<script>',
      js,
      '<\/script>',
      '<script>',
      BOOT,
      '<\/script>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  /* Inlined code must not carry the sequence that would close its own script
     element. Inside real JavaScript that sequence can only occur in a string or
     a comment, where the added backslash changes nothing. */
  var CLOSER = new RegExp('<' + '/script', 'gi');

  function guard(text) {
    return String(text).replace(CLOSER, '<\\/script');
  }

  function fileName(title) {
    var slug = String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return 'academic-reviewer-' + (slug || 'quiz') + '.html';
  }

  /** Builds the file without saving it, so callers can show its size first. */
  async function build(data) {
    var css = guard(await part(CSS));
    var libs = [];
    for (var i = 0; i < JS.length; i += 1) libs.push(guard(await part(JS[i])));
    var text = page(data, css, libs.join('\n\n'));
    return {
      name: fileName(data.title),
      text: text,
      size: text.length,
      blob: new Blob([text], { type: 'text/html;charset=utf-8' }),
    };
  }

  /** Builds the file and hands it to the browser's own save dialog. */
  async function save(data) {
    var file = await build(data);
    var url = URL.createObjectURL(file.blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
    return file;
  }

  root.AR = root.AR || {};
  root.AR.exporter = {
    build: build,
    save: save,
    page: page,
    keySheet: keySheet,
    answerText: answerText,
    fileName: fileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
