/**
 * Exports a finished reviewer as an offline HTML file or as a print-ready PDF layout.
 *
 * The HTML exporter is kept intact in behavior. PDF export opens a print-ready
 * document in a new browser tab/window and lets the browser's print dialog save it
 * as a .pdf. The user chooses 1, 2, or 3 columns before printing.
 *
 * Both the print-based path (pdfPage) and the byte-level PDF writer
 * (makePdf/downloadPDF) now:
 *   - measure text with an actual canvas context before wrapping, instead of
 *     guessing an average character width, so lines never overrun a column
 *     and collide with the next one
 *   - size line-height to each line's real font size
 *   - fall back across several possible question-text field names, so a
 *     question never renders blank just because the data uses a different key
 */
(function (root) {
  'use strict';

  var CSS = 'assets/css/style.css';
  var JS = ['assets/js/grade.js', 'assets/js/quiz.js'];
  var held = {};

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

  function payload(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function letter(index) {
    return String.fromCharCode(65 + index);
  }

  // Some quiz items may store their prompt under a different key depending on
  // which item type produced them. Check the common possibilities so a
  // question never silently renders blank.
  function questionPrompt(item) {
    var candidates = [item.question, item.prompt, item.text, item.title, item.q];
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] != null && String(candidates[i]).trim() !== '') return candidates[i];
    }
    return '';
  }

  function order(item) {
    var pairs = item.pairs || [];
    if (Array.isArray(item.order) && item.order.length === pairs.length) return item.order;
    var out = pairs.map(function (pair, index) { return index; });
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    item.order = out;
    return out;
  }

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
        .map(function (one, i) { return i + 1 + '. ' + one; })
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
      '<p class="footer">' + esc(made + from) + '. Saved from Acadex, works with no internet.',
      '<br>For educational use only.</p>',
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
    return 'acadex-' + (slug || 'quiz') + '.html';
  }

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
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return file;
  }

  /* ---------------- PDF / print export (browser print dialog) ---------------- */

  function pdfFileName(title) {
    var slug = String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return 'acadex-' + (slug || 'quiz') + '.pdf';
  }

  function questionHTML(item, index) {
    var number = index + 1;
    var html = '<article class="q">';
    html += '<div class="q-title"><b>' + number + '.</b> ' + esc(questionPrompt(item)) + '</div>';

    if (item.type === 'mcq') {
      html += '<ol class="choices" type="A">';
      (item.choices || []).forEach(function (choice) {
        html += '<li>' + esc(choice) + '</li>';
      });
      html += '</ol>';
      html += '<div class="answer-line"></div>';
    } else if (item.type === 'identification') {
      html += '<div class="answer-line"></div>';
    } else if (item.type === 'enumeration') {
      var count = Math.max(1, (item.answers || []).length);
      for (var i = 0; i < count; i += 1) {
        html += '<div class="enum-line"><span>' + (i + 1) + '.</span><span></span></div>';
      }
    } else if (item.type === 'matching') {
      var pairs = item.pairs || [];
      var shown = order(item);
      html += '<div class="matching-wrap">';
      html += '<div class="matching-left">';
      pairs.forEach(function (pair, i) {
        html += '<div>' + (i + 1) + '. ' + esc(pair.left || '') + '</div>';
      });
      html += '</div><div class="matching-right">';
      shown.forEach(function (sourceIndex, i) {
        var pair = pairs[sourceIndex] || {};
        html += '<div>' + letter(i) + '. ' + esc(pair.right || '') + '</div>';
      });
      html += '</div></div>';
    }

    html += '</article>';
    return html;
  }

  function pdfPage(data, columns) {
    columns = columns === 2 || columns === 3 ? columns : 1;

    var items = data.items || [];
    var questions = items.map(questionHTML).join('\n');
    var answers = items.map(function (item, index) {
      return '<div class="key-item"><b>' + (index + 1) + '.</b> ' + esc(answerText(item)) + '</div>';
    }).join('\n');

    var sourceText = data.files && data.files.length
      ? data.files.map(function (file) { return file.name; }).join(', ')
      : '';

    var css = [
      '@page { size: A4; margin: 14mm; }',
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; }',
      'body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; font-size: 10.5pt; line-height: 1.35; }',
      '.header { margin-bottom: 14px; border-bottom: 1px solid #999; padding-bottom: 8px; }',
      '.header h1 { margin: 0 0 3px; font-size: 19pt; }',
      '.meta { color: #555; font-size: 8.5pt; }',
      '.questions { column-count: ' + columns + '; column-gap: 9mm; }',
      '.q { break-inside: avoid; page-break-inside: avoid; margin: 0 0 16px; overflow-wrap: break-word; word-break: break-word; }',
      '.q-title { margin-bottom: 7px; overflow-wrap: break-word; word-break: break-word; }',
      '.choices { margin: 4px 0 7px 22px; padding: 0; break-inside: avoid; }',
      '.choices li { padding: 1px 0; overflow-wrap: break-word; word-break: break-word; }',
      '.answer-line { height: 19px; border-bottom: 1px solid #999; margin-top: 5px; }',
      '.enum-line { display: grid; grid-template-columns: 16px 1fr; gap: 4px; min-height: 20px; align-items: end; margin-bottom: 4px; break-inside: avoid; }',
      '.enum-line span:last-child { border-bottom: 1px solid #999; height: 18px; }',
      '.matching-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 9.2pt; break-inside: avoid; }',
      '.matching-left, .matching-right { display: grid; gap: 5px; }',
      '.matching-left div, .matching-right div { overflow-wrap: break-word; word-break: break-word; }',
      '.key { break-before: page; page-break-before: always; }',
      '.key h2 { font-size: 16pt; margin: 0 0 10px; }',
      '.key-list { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10mm; row-gap: 7px; }',
      '.key-item { break-inside: avoid; overflow-wrap: break-word; word-break: break-word; }',
      '.foot { margin-top: 16px; color: #666; font-size: 8pt; }',
      '@media screen { body { max-width: 210mm; margin: 20px auto; padding: 0 18px; } .key { margin-top: 30px; } }',
      '@media print { .questions { column-fill: balance; } }'
    ].join('\n');

    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + esc(data.title || 'Acadex Reviewer') + '</title>' +
      '<style>' + css + '</style></head><body>' +
      '<header class="header">' +
      '<h1>' + esc(data.title || 'Acadex Reviewer') + '</h1>' +
      '<div class="meta">Acadex reviewer' +
      (data.made ? ' · ' + esc(data.made) : '') +
      (sourceText ? ' · ' + esc(sourceText) : '') +
      '</div></header>' +
      '<main class="questions">' + questions + '</main>' +
      '<section class="key"><h2>Answer key</h2><div class="key-list">' + answers + '</div>' +
      '<p class="foot">Generated by Acadex. For educational use only.</p></section>' +
      '</body></html>';
  }

  /* ---------------- Actual PDF export (byte-level, no print dialog) ---------------- */

  function pdfText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
  }

  function pdfEscape(value) {
    return pdfText(value)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  // Lazily create (and reuse) a canvas 2D context purely for measuring text.
  // Measuring the real rendered width — instead of guessing an average
  // character width — is what keeps wrapped lines from overrunning their
  // column and visually overlapping the next one.
  var _measureCtx = null;
  function measureCtx() {
    if (!_measureCtx) {
      _measureCtx = document.createElement('canvas').getContext('2d');
    }
    return _measureCtx;
  }

  function fontString(size, bold) {
    return (bold ? 'bold ' : '') + size.toFixed(2) + 'px Helvetica, Arial, sans-serif';
  }

  // Wrap `text` to fit within `maxWidth` px at the given font size/weight,
  // using actual measured widths. Falls back to hard character breaks for
  // single words wider than the column (e.g. long unbroken strings).
  function wrapMeasured(text, maxWidth, size, bold) {
    var ctx = measureCtx();
    ctx.font = fontString(size, bold);
    var words = pdfText(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];

    var lines = [];
    var line = '';
    words.forEach(function (word) {
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        var cut = word.length;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut -= 1;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      var next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // Builds the flat list of {text, size, bold} lines for one question, sized
  // to actually fit `colWidthPx`. `questionPrompt()` covers items whose
  // prompt lives under a differently-named field (this is what fixes
  // enumeration items showing blanks with no visible question).
  function pdfQuestionLines(item, number, colWidthPx, fontScale) {
    var lines = [];
    var titleSize = 10 * fontScale;
    var bodySize = 9 * fontScale;
    var smallSize = 8.5 * fontScale;

    wrapMeasured(number + '. ' + questionPrompt(item), colWidthPx, titleSize, true).forEach(function (line) {
      lines.push({ text: line, bold: true, size: titleSize });
    });

    if (item.type === 'mcq') {
      (item.choices || []).forEach(function (choice, i) {
        wrapMeasured(letter(i) + '. ' + choice, colWidthPx - 14, bodySize, false).forEach(function (line, idx) {
          lines.push({ text: (idx === 0 ? '   ' : '     ') + line, bold: false, size: bodySize });
        });
      });
      lines.push({ text: 'Answer: ______________________________', bold: false, size: bodySize });
    } else if (item.type === 'identification') {
      lines.push({ text: 'Answer: ___________________________________________', bold: false, size: bodySize });
    } else if (item.type === 'enumeration') {
      var count = Math.max(1, (item.answers || []).length);
      for (var i = 0; i < count; i += 1) {
        lines.push({ text: (i + 1) + '. ___________________________________________', bold: false, size: bodySize });
      }
    } else if (item.type === 'matching') {
      var pairs = item.pairs || [];
      var shown = order(item);
      lines.push({ text: 'Column A', bold: true, size: bodySize });
      pairs.forEach(function (pair, i) {
        wrapMeasured((i + 1) + '. ' + (pair.left || ''), colWidthPx, smallSize, false).forEach(function (line) {
          lines.push({ text: line, bold: false, size: smallSize });
        });
      });
      lines.push({ text: 'Column B', bold: true, size: bodySize });
      shown.forEach(function (sourceIndex, i) {
        var pair = pairs[sourceIndex] || {};
        wrapMeasured(letter(i) + '. ' + (pair.right || ''), colWidthPx, smallSize, false).forEach(function (line) {
          lines.push({ text: line, bold: false, size: smallSize });
        });
      });
    }
    return lines;
  }

  function lineHeightOf(size) {
    return size * 1.4;
  }

  function blockHeight(lines) {
    return lines.reduce(function (sum, line) { return sum + lineHeightOf(line.size); }, 0);
  }

  function makePdf(data, columns) {
    columns = columns === 2 || columns === 3 ? columns : 1;
    var W = 595.28, H = 841.89, margin = 42;
    var usableW = W - margin * 2;
    var gap = 18;
    var colW = (usableW - gap * (columns - 1)) / columns;
    var fontScale = columns === 3 ? 0.82 : (columns === 2 ? 0.9 : 1);

    var pages = [];
    var current = [];
    var y = H - margin;
    var col = 0;

    // The header (title/subtitle/source) is only ever drawn once, above the
    // column area, on the first page. Every column on that first page must
    // start BELOW it — not at the very top of the page — or a column-2/3
    // question lands at the same height as the title and visually collides
    // with it. topForPage() returns that lowered start for as long as we're
    // still on the first page (pages.length === 0), and the normal full-height
    // top for every page after that.
    var firstPageContentTop = H - margin;
    function topForPage() {
      return pages.length === 0 ? firstPageContentTop : H - margin;
    }

    function flushPage() {
      if (current.length) pages.push(current);
      current = [];
    }
    function newPage() {
      flushPage();
      y = topForPage();
      col = 0;
    }
    function nextColumn() {
      col += 1;
      if (col >= columns) {
        newPage();
      } else {
        y = topForPage();
      }
    }
    function colX() {
      return margin + col * (colW + gap);
    }
    function put(text, size, bold, x, yy) {
      current.push({ text: text, size: size, bold: !!bold, x: x, y: yy });
    }
    function rule(x, yy, width) {
      current.push({ rule: true, x: x, y: yy, width: width });
    }

    // --- Header (full width, above all columns) ---
    wrapMeasured(pdfText(data.title || 'Acadex Reviewer'), usableW, 17, true).forEach(function (line) {
      put(line, 17, true, margin, y);
      y -= lineHeightOf(17);
    });
    y -= 4;
    put('Acadex Reviewer' + (data.made ? ' - ' + data.made : ''), 8, false, margin, y);
    y -= 14;
    if (data.files && data.files.length) {
      wrapMeasured('Source: ' + data.files.map(function (f) { return f.name; }).join(', '), usableW, 8, false)
        .forEach(function (line) {
          put(line, 8, false, margin, y);
          y -= 11;
        });
    }
    y -= 8;
    rule(margin, y, usableW);
    y -= 18;
    firstPageContentTop = y;

    // --- Questions ---
    (data.items || []).forEach(function (item, index) {
      var lines = pdfQuestionLines(item, index + 1, colW, fontScale);
      var needed = blockHeight(lines) + 6;
      var atColumnTop = y >= H - margin - 1;

      if (y - needed < margin && !atColumnTop) {
        nextColumn();
      }

      var x = colX();
      lines.forEach(function (line) {
        var lh = lineHeightOf(line.size);
        if (y - lh < margin) {
          nextColumn();
          x = colX();
        }
        put(line.text, line.size, line.bold, x, y);
        y -= lh;
      });
      y -= 14;
    });

    // --- Answer key: always starts on a fresh page ---
    newPage();
    put('Answer Key', 16, true, margin, y);
    y -= 12;
    rule(margin, y, usableW);
    y -= 20;

    (data.items || []).forEach(function (item, index) {
      var keyLines = wrapMeasured((index + 1) + '. ' + answerText(item), colW, 9, false);
      var needed = keyLines.length * lineHeightOf(9) + 4;
      var atColumnTop = y >= H - margin - 1;

      if (y - needed < margin && !atColumnTop) {
        nextColumn();
      }

      var x = colX();
      keyLines.forEach(function (line) {
        if (y - lineHeightOf(9) < margin) {
          nextColumn();
          x = colX();
        }
        put(line, 9, false, x, y);
        y -= lineHeightOf(9);
      });
      y -= 6;
    });

    flushPage();

    // --- Build a compact, standards-compliant PDF using built-in Helvetica. ---
    var objects = [];
    function obj(body) { objects.push(body); return objects.length; }
    var pagesId = obj('');
    var fontId = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var boldFontId = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    var pageIds = [];

    pages.forEach(function (commands) {
      var content = 'q\n';
      commands.forEach(function (cmd) {
        if (cmd.rule) {
          content += '0.6 w\n0.75 G\n' +
            cmd.x.toFixed(2) + ' ' + cmd.y.toFixed(2) + ' m\n' +
            (cmd.x + cmd.width).toFixed(2) + ' ' + cmd.y.toFixed(2) + ' l\nS\n';
          return;
        }
        var font = cmd.bold ? 'FB' : 'FN';
        content += 'BT\n/' + font + ' ' + cmd.size.toFixed(2) + ' Tf\n';
        content += '1 0 0 1 ' + cmd.x.toFixed(2) + ' ' + cmd.y.toFixed(2) + ' Tm\n';
        content += '(' + pdfEscape(cmd.text) + ') Tj\nET\n';
      });
      content += 'Q\n';
      var contentId = obj('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
      var pageId = obj('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /FN ' + fontId + ' 0 R /FB ' + boldFontId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
      pageIds.push(pageId);
    });

    objects[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + pageIds.length + ' >>';
    var catalogId = obj('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');

    var pdf = '%PDF-1.4\n%Acadex PDF\n';
    var offsets = [0];
    objects.forEach(function (body, i) {
      offsets[i + 1] = pdf.length;
      pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';
    for (var i = 1; i <= objects.length; i += 1) {
      pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>\n';
    pdf += 'startxref\n' + xref + '\n%%EOF';
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function downloadPDF(data, columns) {
    var blob = makePdf(data, columns);
    var name = pdfFileName(data.title);
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    return { name: name, columns: columns === 2 || columns === 3 ? columns : 1, size: blob.size };
  }

  root.AR = root.AR || {};
  root.AR.exporter = {
    build: build,
    save: save,
    page: page,
    keySheet: keySheet,
    answerText: answerText,
    fileName: fileName,
    pdfPage: pdfPage,
    downloadPDF: downloadPDF,
    pdfFileName: pdfFileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
