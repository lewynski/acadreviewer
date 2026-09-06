/**
 * Wires the page together: files in, questions out, quiz on screen.
 *
 * Everything of substance lives in the other files. This one only listens to
 * the controls, keeps the small amount of state the page needs, and hands the
 * work to extract, generate, quiz and exporter in turn.
 */
(function () {
  'use strict';

  var MAX_EACH = 25;
  var MAX_TOTAL = 60;
  var CODE_STORE = 'ar-code';
  var THEME_STORE = 'ar-theme';

  var HINTS = {
    recall: 'Terms, values and definitions, straight from the material.',
    balanced: 'Mostly recall, with a few that make you apply it.',
    hard: 'Comparison and several steps of reasoning, still answerable from your files.',
  };

  var counts = { mcq: 10, identification: 6, enumeration: 3, matching: 3 };
  var difficulty = 'balanced';
  var material = { units: [], files: [] };
  var paper = null;
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  var app = $('app');
  var dock = $('dock');
  var headMeta = $('head-meta');
  var keepBtn = $('keep');
  var drop = $('drop');
  var input = $('files');
  var pick = $('pick');
  var fileList = $('filelist');
  var readStatus = $('read-status');
  var coveragePanel = $('coverage-panel');
  var coverage = $('coverage');
  var coverageNote = $('coverage-note');
  var mixPanel = $('mix-panel');
  var mix = $('mix');
  var hard = $('hard');
  var hardHint = $('hard-hint');
  var codeField = $('code-field');
  var code = $('code');
  var makeBtn = $('make');
  var totalOut = $('total');
  var track = $('track');
  var fill = $('track-fill');
  var status = $('status');
  var themeBtn = $('theme');
  var themeMark = $('theme-mark');
  var themeSaid = $('theme-said');
  var exportChooser = $('export-chooser');
  var exportHtml = $('export-html');
  var exportPdf = $('export-pdf');
  var exportPdfDownload = $('export-pdf-download');
  var exportCancel = $('export-cancel');
  var pdfLayout = $('pdf-layout');

  function show(node, on) {
    if (node) node.classList.toggle('hidden', !on);
  }

  function say(node, text, bad) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-bad', !!bad);
  }

  function clamp(n, low, high) {
    return Math.min(high, Math.max(low, n));
  }

  function asked() {
    return Object.keys(counts).reduce(function (sum, type) {
      return sum + counts[type];
    }, 0);
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function sizeText(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function row(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function madeText() {
    try {
      return new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) {
      return new Date().toDateString();
    }
  }

  /** The reviewer is named after the files it came from. */
  function titleFor() {
    var names = material.files
      .filter(function (file) {
        return file.units > 0;
      })
      .map(function (file) {
        return file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
      })
      .filter(Boolean);
    if (!names.length) return 'Reviewer';
    if (names.length === 1) return names[0];
    return names[0] + ' and ' + plural(names.length - 1, 'more file', 'more files');
  }

  function renderFiles() {
    fileList.textContent = '';
    material.files.forEach(function (file) {
      var line = row('li', 'file');
      line.appendChild(row('span', 'file-name', file.name));
      var parts = [];
      if (file.units) parts.push(plural(file.units, 'part', 'parts'));
      if (file.size) parts.push(sizeText(file.size));
      line.appendChild(row('span', 'file-meta', parts.join(', ')));
      if (file.warning) line.appendChild(row('span', 'file-warn', file.warning));
      fileList.appendChild(line);
    });
    show(fileList, material.files.length > 0);
  }

  /* One tile per slide or page, so the amount of material is visible at a
     glance. The same lattice comes back after scoring, coloured in. */
  function renderCoverage() {
    coverage.textContent = '';
    material.units.forEach(function (unit, index) {
      var tile = row('li', 'tile is-used');
      tile.style.setProperty('--i', String(index));
      coverage.appendChild(tile);
    });
    coverageNote.textContent =
      plural(material.units.length, 'slide or page', 'slides and pages') +
      ' with text on them. Questions are spread across all of it.';
    show(coveragePanel, material.units.length > 0);
  }

  function renderTotal() {
    var total = asked();
    totalOut.textContent = total ? plural(total, 'question', 'questions') : 'Nothing chosen yet';
    makeBtn.disabled = !total || !material.units.length;
  }

  function renderHead() {
    if (!material.units.length) {
      headMeta.textContent = 'Nothing uploaded yet';
      return;
    }
    var kept = material.files.filter(function (file) {
      return file.units > 0;
    }).length;
    headMeta.textContent =
      plural(kept, 'file', 'files') + ', ' + plural(material.units.length, 'part', 'parts');
  }

  async function addFiles(list) {
    var picked = Array.prototype.slice.call(list || []);
    if (!picked.length || busy) return;
    busy = true;
    makeBtn.disabled = true;
    say(readStatus, 'Reading ' + plural(picked.length, 'file', 'files') + '...');
    try {
      var got = await AR.extract.read(picked, function (at) {
        say(readStatus, 'Reading ' + at.file + ', ' + at.at + ' of ' + at.of);
      });
      material.units = material.units.concat(got.units);
      material.files = material.files.concat(got.files);
      renderFiles();
      renderCoverage();
      renderHead();
      show(mixPanel, material.units.length > 0);
      var trouble = material.files
        .filter(function (file) {
          return !file.units;
        })
        .map(function (file) {
          return file.name;
        });
      if (!material.units.length) {
        say(readStatus, got.files[0] && got.files[0].warning ? got.files[0].warning : 'Nothing readable in that.', true);
      } else {
        say(
          readStatus,
          got.warnings
            .concat(trouble.length ? ['Nothing could be read from ' + trouble.join(', ') + '.'] : [])
            .join(' ')
        );
      }
    } catch (err) {
      say(readStatus, err && err.message ? err.message : 'Those files could not be read.', true);
    }
    input.value = '';
    busy = false;
    renderTotal();
  }

  /** Builds the HTML file, preserving the original export behavior. */
  async function keep(button, note) {
    if (!paper) return;
    var was = button.textContent;
    button.disabled = true;
    button.textContent = 'Building the file...';
    try {
      var file = await AR.exporter.save(paper);
      button.textContent = 'Saved';
      if (note) note.textContent = file.name + ', ' + sizeText(file.size) + ', opens with no internet.';
      setTimeout(function () {
        button.textContent = was;
        button.disabled = false;
      }, 2400);
    } catch (err) {
      button.textContent = was;
      button.disabled = false;
      if (note) note.textContent = err && err.message ? err.message : 'The file could not be built.';
    }
  }

  function selectedPdfColumns() {
    var chosen = document.querySelector('input[name="pdf-layout"]:checked');
    var value = chosen ? Number(chosen.value) : 1;
    return value === 2 || value === 3 ? value : 1;
  }

  function closeExportChooser() {
    show(exportChooser, false);
    if (exportChooser) exportChooser.setAttribute('aria-hidden', 'true');
    show(pdfLayout, false);
    show(exportPdfDownload, false);
  }

  function openExportChooser() {
    if (!paper) return;
    show(exportChooser, true);
    if (exportChooser) exportChooser.setAttribute('aria-hidden', 'false');
    show(pdfLayout, false);
    if (exportHtml) exportHtml.focus();
  }

  async function chooseHtml() {
    closeExportChooser();
    await keep(keepBtn, null);
  }

  function choosePdf() {
    if (!paper) return;
    show(pdfLayout, true);
    var columns = selectedPdfColumns();
    try {
      var result = AR.exporter.downloadPDF(paper, columns);
      closeExportChooser();
      say(status, result.name + ' downloaded (' + columns + '-column layout).');
    } catch (err) {
      say(status, err && err.message ? err.message : 'The PDF could not be created.', true);
    }
  }

  function saveButton(label) {
    var button = row('button', 'btn btn-quiet', label);
    button.type = 'button';
    var note = row('span', 'dock-meta');
    button.addEventListener('click', function () {
      openExportChooser();
    });
    return { button: button, note: note };
  }

  /** Swaps the setup screen for the reviewer itself. */
  function showQuiz(out) {
    paper = {
      title: titleFor(),
      made: madeText(),
      stamp: Date.now(),
      files: material.files
        .filter(function (file) {
          return file.units > 0;
        })
        .map(function (file) {
          return { name: file.name };
        }),
      units: material.units.map(function (unit) {
        return { at: unit.at, file: unit.file };
      }),
      items: out.items,
      partial: !!out.partial,
    };

    var save = saveButton('Save this reviewer as a file');
    AR.quiz.mount(app, paper, {
      mode: 'study',
      dock: dock,
      storageKey: 'ar-live-' + paper.stamp,
      actions: [save.button, save.note],
    });

    show(keepBtn, true);
    renderHead();
    if (out.warnings && out.warnings.length) {
      var note = row('p', 'status is-bad', out.warnings.join(' '));
      app.appendChild(note);
    }
    window.scrollTo(0, 0);
  }

  function remember(value) {
    try {
      if (value) localStorage.setItem(CODE_STORE, value);
      else localStorage.removeItem(CODE_STORE);
    } catch (err) {
      /* private browsing; the code just will not be remembered */
    }
  }

  async function make() {
    if (busy) return;
    if (!material.units.length) return say(status, 'Add a file first.', true);
    if (!asked()) return say(status, 'Ask for at least one question.', true);
    busy = true;
    makeBtn.disabled = true;
    show(track, true);
    fill.style.width = '0%';
    say(status, 'Sending the material...');
    try {
      var out = await AR.generate.run({
        units: material.units,
        counts: counts,
        difficulty: difficulty,
        accessCode: code.value.trim(),
        onProgress: function (at) {
          if (at.total) fill.style.width = Math.round((at.done / at.total) * 100) + '%';
          say(status, at.note + (at.total > 1 ? ' (' + at.done + ' of ' + at.total + ' done)' : ''));
        },
      });
      remember(code.value.trim());
      showQuiz(out);
    } catch (err) {
      if (err && err.status === 401) {
        show(codeField, true);
        code.focus();
      }
      say(status, err && err.message ? err.message : 'The questions could not be written.', true);
      makeBtn.disabled = false;
      show(track, false);
    }
    busy = false;
  }

  function onStep(event) {
    var button = event.target.closest ? event.target.closest('.step-btn') : null;
    if (!button) return;
    var group = button.parentNode;
    var type = group.getAttribute('data-type');
    if (!(type in counts)) return;
    var step = Number(button.getAttribute('data-step')) || 0;
    var others = asked() - counts[type];
    var next = clamp(counts[type] + step, 0, Math.min(MAX_EACH, MAX_TOTAL - others));
    counts[type] = next;
    group.querySelector('.step-value').textContent = String(next);
    renderTotal();
  }

  function onLevel(event) {
    var button = event.target.closest ? event.target.closest('.seg-btn') : null;
    if (!button) return;
    difficulty = button.getAttribute('data-level') || 'balanced';
    Array.prototype.forEach.call(hard.children, function (one) {
      one.setAttribute('aria-pressed', one === button ? 'true' : 'false');
    });
    hardHint.textContent = HINTS[difficulty] || HINTS.balanced;
  }

  function hot(on) {
    drop.classList.toggle('is-hot', on);
  }

  /**
   * The theme button. Dark is what a first visit gets; a choice is remembered on
   * this device and wins over whatever the system prefers. Only an explicit
   * "light" turns the lights on, so anything unreadable in storage lands on the
   * default rather than somewhere in between.
   */
  function themeNow() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function paintTheme() {
    var dark = themeNow() === 'dark';
    var next = dark ? 'Switch to light' : 'Switch to dark';
    /* Escaped so every shipped file stays plain ASCII: crescent moon, sun. */
    themeMark.textContent = dark ? '\u263d' : '\u2600';
    themeSaid.textContent = next;
    themeBtn.setAttribute('title', next);
    themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  function setTheme(pick) {
    document.documentElement.setAttribute('data-theme', pick === 'light' ? 'light' : 'dark');
    paintTheme();
    try {
      localStorage.setItem(THEME_STORE, themeNow());
    } catch (err) {
      /* a device that refuses storage still gets the theme, just not the memory */
    }
  }

  function startTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_STORE);
    } catch (err) {
      saved = null;
    }
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
    paintTheme();
    themeBtn.addEventListener('click', function () {
      setTheme(themeNow() === 'dark' ? 'light' : 'dark');
    });
  }

  function start() {
    startTheme();

    input.addEventListener('change', function () {
      addFiles(input.files);
    });

    /* The whole panel is a target, but the label already opens the picker, so
       clicks that land on it are left alone. */
    drop.addEventListener('click', function (event) {
      if (event.target === input || event.target === pick || pick.contains(event.target)) return;
      input.click();
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        hot(true);
      });
    });
    ['dragleave', 'dragend'].forEach(function (name) {
      drop.addEventListener(name, function () {
        hot(false);
      });
    });
    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      hot(false);
      addFiles(event.dataTransfer && event.dataTransfer.files);
    });

    /* A file dropped beside the panel would otherwise replace the page. */
    ['dragover', 'drop'].forEach(function (name) {
      window.addEventListener(name, function (event) {
        if (!drop.contains(event.target)) event.preventDefault();
      });
    });

    mix.addEventListener('click', onStep);
    hard.addEventListener('click', onLevel);
    makeBtn.addEventListener('click', make);
    keepBtn.addEventListener('click', function () {
      openExportChooser();
    });

    exportCancel.addEventListener('click', closeExportChooser);
    exportHtml.addEventListener('click', chooseHtml);
    exportPdf.addEventListener('click', function () {
      show(pdfLayout, true);
      show(exportPdfDownload, true);
      exportPdfDownload.focus();
    });
    exportPdfDownload.addEventListener('click', function () {
      var columns = selectedPdfColumns();
      exportPdfDownload.disabled = true;
      exportPdfDownload.textContent = 'Creating PDF...';
      try {
        var result = AR.exporter.downloadPDF(paper, columns);
        closeExportChooser();
        say(status, result.name + ' downloaded (' + columns + '-column layout).');
      } catch (err) {
        say(status, err && err.message ? err.message : 'The PDF could not be created.', true);
      } finally {
        exportPdfDownload.disabled = false;
        exportPdfDownload.textContent = 'Download PDF';
      }
    });
    exportChooser.addEventListener('click', function (event) {
      if (event.target === exportChooser) closeExportChooser();
    });

    try {
      var saved = localStorage.getItem(CODE_STORE);
      if (saved) {
        code.value = saved;
        show(codeField, true);
      }
    } catch (err) {
      /* nothing to restore */
    }

    hardHint.textContent = HINTS[difficulty];
    renderTotal();
    renderHead();
  }

  start();
})();