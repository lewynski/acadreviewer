/**
 * Packs a finished reviewer into one HTML file that works with no network,
 * or exports as a PDF with customizable column layout.
 *
 * The HTML file carries its own copy of the stylesheet, the grader and the quiz
 * engine, plus the questions as JSON. Opening it later gives the same quiz,
 * graded the same way, with an answer key that prints on its own page. There
 * is no second implementation to keep in step: the export inlines the very
 * files this page is running.
 *
 * The PDF export uses jsPDF and generates formatted notes in single, 2-column,
 * or 3-column layouts.
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

  /* Inlined code must not carry the sequence that would close its own script
     element. Inside real JavaScript that sequence can only occur in a string or
     a comment, where the added backslash changes nothing. */
  var CLOSER = new RegExp('<' + '/script', 'gi');

  function guard(text) {
    return String(text).replace(CLOSER, '<\\/script');
  }

  function fileName(title, ext) {
    var slug = String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return 'acadex-' + (slug || 'quiz') + (ext || '.html');
  }

  /** Builds the HTML file without saving it, so callers can show its size first. */
  async function buildHtml(data) {
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

  /** Generates question text for PDF export */
  function generateQuestionText(item, index) {
    var text = (index + 1) + '. ';
    
    if (item.type === 'mcq') {
      text += item.question || '';
      if (item.choices && item.choices.length) {
        text += '\n' + item.choices.map(function(choice, i) {
          return '  ' + letter(i) + ') ' + choice;
        }).join('\n');
      }
    } else if (item.type === 'identification') {
      text += item.question || '';
    } else if (item.type === 'enumeration') {
      text += item.question || '';
      if (item.count) text += ' (' + item.count + ')';
    } else if (item.type === 'matching') {
      text += item.question || '';
    }
    
    return text;
  }

  /** Builds a PDF file with specified column layout */
  async function buildPdf(data, columns) {
    // Check if jsPDF is available
    if (typeof window === 'undefined' || !window.jsPDF) {
      throw new Error('jsPDF library is not loaded. Please include it in your HTML.');
    }

    var jsPDF = window.jsPDF;
    var doc = new jsPDF.jsPDF();
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = 10;
    var contentWidth = pageWidth - (2 * margin);
    var columnWidth = contentWidth / columns;
    var lineHeight = 5;
    var currentY = margin;
    var currentColumn = 0;

    // Add title
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(data.title || 'Reviewer', margin, currentY);
    currentY += 15;

    // Add metadata
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    var meta = (data.made || '') + (data.files && data.files.length ? ' from ' + data.files.map(function(f) { return f.name; }).join(', ') : '');
    if (meta) {
      doc.text(meta, margin, currentY);
      currentY += 8;
    }

    // Add questions
    doc.setFontSize(10);
    var items = data.items || [];
    
    items.forEach(function(item, index) {
      var questionText = generateQuestionText(item, index);
      var lines = doc.splitTextToSize(questionText, columnWidth - 2);
      var blockHeight = lines.length * lineHeight + 3;

      // Check if we need a new page
      if (currentY + blockHeight > pageHeight - margin) {
        currentY = margin;
        currentColumn = 0;
        doc.addPage();
      }

      // Calculate position based on column layout
      var xPos = margin + (currentColumn * columnWidth);
      
      // Draw the question text
      doc.text(lines, xPos + 1, currentY);
      currentY += blockHeight;

      // Move to next column if we've filled the current one
      if (currentColumn < columns - 1 && currentY > pageHeight - margin - 30) {
        currentColumn += 1;
        currentY = margin + 35; // Reset to top for next column with space for title
      }
    });

    // Add answer key on a new page
    doc.addPage();
    currentY = margin;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Answer Key', margin, currentY);
    currentY += 10;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    items.forEach(function(item, index) {
      var answer = answerText(item);
      var lines = doc.splitTextToSize((index + 1) + '. ' + answer, contentWidth);
      doc.text(lines, margin, currentY);
      currentY += lines.length * lineHeight + 2;
      
      if (currentY > pageHeight - margin) {
        doc.addPage();
        currentY = margin;
      }
    });

    var pdfBlob = doc.output('blob');
    return {
      name: fileName(data.title, '.pdf'),
      blob: pdfBlob,
      size: pdfBlob.size,
    };
  }

  /** Builds the HTML file and hands it to the browser's own save dialog. */
  async function saveHtml(data) {
    var file = await buildHtml(data);
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

  /** Builds the PDF file and hands it to the browser's own save dialog. */
  async function savePdf(data, columns) {
    var file = await buildPdf(data, columns || 1);
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

  /** Shows export dialog for user to choose format and options */
  async function showExportDialog(data, callback) {
    // Create overlay (minimal styling, matches dark theme)
    var overlay = document.createElement('div');
    overlay.className = 'ar-export-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000; font-family: inherit;';

    // Create dialog (minimal design, respect existing theme)
    var dialog = document.createElement('div');
    dialog.className = 'ar-export-dialog';
    dialog.style.cssText = 'background: #1a1a1a; border-radius: 8px; padding: 24px; max-width: 450px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); color: #fff;';

    // Title
    var title = document.createElement('h2');
    title.textContent = 'Save as file';
    title.style.cssText = 'margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #fff;';

    // Subtitle
    var subtitle = document.createElement('p');
    subtitle.textContent = 'Choose file format:';
    subtitle.style.cssText = 'margin: 0 0 16px 0; color: #aaa; font-size: 13px;';

    // HTML option
    var htmlOption = document.createElement('div');
    htmlOption.style.cssText = 'margin-bottom: 12px; padding: 12px; border: 1px solid #333; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: #222;';
    htmlOption.onmouseover = function() { 
      htmlOption.style.borderColor = '#0066cc';
      htmlOption.style.backgroundColor = '#252525';
    };
    htmlOption.onmouseout = function() { 
      htmlOption.style.borderColor = '#333';
      htmlOption.style.backgroundColor = '#222';
    };

    var htmlLabel = document.createElement('div');
    htmlLabel.style.cssText = 'font-weight: 500; margin-bottom: 4px; color: #fff; font-size: 14px;';
    htmlLabel.textContent = 'HTML File';

    var htmlDesc = document.createElement('div');
    htmlDesc.style.cssText = 'font-size: 12px; color: #999;';
    htmlDesc.textContent = 'Interactive quiz with scoring. Works offline.';

    htmlOption.appendChild(htmlLabel);
    htmlOption.appendChild(htmlDesc);
    htmlOption.addEventListener('click', function() {
      overlay.remove();
      callback({ type: 'html' });
    });

    // PDF option
    var pdfOption = document.createElement('div');
    pdfOption.style.cssText = 'margin-bottom: 12px; padding: 12px; border: 1px solid #333; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: #222;';
    pdfOption.onmouseover = function() { 
      pdfOption.style.borderColor = '#0066cc';
      pdfOption.style.backgroundColor = '#252525';
    };
    pdfOption.onmouseout = function() { 
      pdfOption.style.borderColor = '#333';
      pdfOption.style.backgroundColor = '#222';
    };

    var pdfLabel = document.createElement('div');
    pdfLabel.style.cssText = 'font-weight: 500; margin-bottom: 6px; color: #fff; font-size: 14px;';
    pdfLabel.textContent = 'PDF Notes';

    var pdfDesc = document.createElement('div');
    pdfDesc.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 8px;';
    pdfDesc.textContent = 'Printable notes with answer key. Choose layout:';

    var columnsGroup = document.createElement('div');
    columnsGroup.style.cssText = 'display: flex; gap: 6px; margin-top: 8px;';

    [1, 2, 3].forEach(function(cols) {
      var btn = document.createElement('button');
      btn.textContent = cols + '-col';
      btn.style.cssText = 'flex: 1; padding: 6px 10px; border: 1px solid #444; border-radius: 4px; background: #1a1a1a; color: #aaa; cursor: pointer; font-size: 11px; transition: all 0.2s;';
      btn.onmouseover = function() { 
        btn.style.backgroundColor = '#2a2a2a';
        btn.style.borderColor = '#555';
        btn.style.color = '#fff';
      };
      btn.onmouseout = function() { 
        btn.style.backgroundColor = '#1a1a1a';
        btn.style.borderColor = '#444';
        btn.style.color = '#aaa';
      };
      btn.onclick = function() {
        overlay.remove();
        callback({ type: 'pdf', columns: cols });
      };
      columnsGroup.appendChild(btn);
    });

    pdfOption.appendChild(pdfLabel);
    pdfOption.appendChild(pdfDesc);
    pdfOption.appendChild(columnsGroup);

    // Buttons container
    var buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';

    // Cancel button
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex: 1; padding: 8px; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-size: 13px; color: #aaa; transition: all 0.2s;';
    cancelBtn.onmouseover = function() { 
      cancelBtn.style.backgroundColor = '#333';
      cancelBtn.style.color = '#fff';
    };
    cancelBtn.onmouseout = function() { 
      cancelBtn.style.backgroundColor = '#2a2a2a';
      cancelBtn.style.color = '#aaa';
    };
    cancelBtn.addEventListener('click', function() {
      overlay.remove();
      callback(null);
    });

    buttonsContainer.appendChild(cancelBtn);

    dialog.appendChild(title);
    dialog.appendChild(subtitle);
    dialog.appendChild(htmlOption);
    dialog.appendChild(pdfOption);
    dialog.appendChild(buttonsContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  /** Main export function that shows dialog and handles export */
  async function save(data) {
    return new Promise(function(resolve, reject) {
      showExportDialog(data, function(choice) {
        if (!choice) return reject(new Error('Export cancelled'));
        
        if (choice.type === 'html') {
          saveHtml(data).then(resolve).catch(reject);
        } else if (choice.type === 'pdf') {
          savePdf(data, choice.columns).then(resolve).catch(reject);
        }
      });
    });
  }

  root.AR = root.AR || {};
  root.AR.exporter = {
    buildHtml: buildHtml,
    buildPdf: buildPdf,
    saveHtml: saveHtml,
    savePdf: savePdf,
    save: save,
    page: page,
    keySheet: keySheet,
    answerText: answerText,
    fileName: fileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
