/**
 * The quiz engine: renders questions, takes answers, grades, and draws the
 * scoreboard. Shared verbatim by the web app and the offline download, so it
 * must not assume anything about how it was loaded.
 */
(function (root) {
  'use strict';

  var grade = root.AR.grade;

  var LABELS = {
    mcq: 'Multiple choice',
    identification: 'Identification',
    enumeration: 'Enumeration',
    matching: 'Matching',
  };

  var ORDER = ['mcq', 'identification', 'enumeration', 'matching'];

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (name) {
        var value = props[name];
        if (value === null || value === undefined || value === false) return;
        if (name === 'text') node.textContent = value;
        else if (name === 'class') node.className = value;
        else if (name.slice(0, 2) === 'on') node.addEventListener(name.slice(2), value);
        else node.setAttribute(name, value === true ? '' : value);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function count(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function sourceText(item) {
    var src = item.src || {};
    if (src.at && src.file) return src.at + ', ' + src.file;
    return src.at || src.file || '';
  }

  /** Marks a question is worth: enumeration and matching count one per part. */
  function marksOf(item) {
    if (item.type === 'enumeration') return (item.answers || []).length;
    if (item.type === 'matching') return (item.pairs || []).length;
    return 1;
  }

  /**
   * Display order for a matching item's right-hand column. Stored back onto the
   * item so a reload, a retake and the offline copy all show the same shuffle.
   */
  function pickOrder(item) {
    if (Array.isArray(item.order) && item.order.length === item.pairs.length) return item.order;
    var order = item.pairs.map(function (pair, index) {
      return index;
    });
    for (var i = order.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    item.order = order;
    return order;
  }

  function letter(index) {
    return String.fromCharCode(65 + index);
  }

  function readHistory(key) {
    if (!key || !root.localStorage) return [];
    try {
      var raw = root.localStorage.getItem(key);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeHistory(key, list) {
    if (!key || !root.localStorage) return;
    try {
      root.localStorage.setItem(key, JSON.stringify(list.slice(-12)));
    } catch (err) {
      /* private browsing, or the quota is full: history is a nicety */
    }
  }

  /**
   * Renders a reviewer into `host`.
   *
   * data: { title, made, items, units, files }
   * opts: { mode, dock, storageKey, actions }
   *   actions: extra buttons for the results screen, e.g. the offline download.
   */
  function mount(host, data, opts) {
    var options = opts || {};
    var items = (data.items || []).slice();
    var units = data.units || [];
    var responses = {};
    var revealed = {};
    var rows = {};
    var mode = options.mode === 'exam' ? 'exam' : 'study';
    var graded = null;
    var storageKey = options.storageKey || null;

    var points = items.reduce(function (sum, item) {
      if (item.type === 'enumeration') return sum + (item.answers || []).length;
      if (item.type === 'matching') return sum + (item.pairs || []).length;
      return sum + 1;
    }, 0);

    clear(host);
    if (options.dock) clear(options.dock);

    var title = el('h1', { class: 'quiz-h', text: data.title || 'Reviewer' });
    var meta = el('p', { class: 'panel-note' });
    var modeHint = el('p', { class: 'panel-note', id: 'mode-hint' });
    var studyBtn = el('button', { type: 'button', class: 'seg-btn', text: 'Study' });
    var examBtn = el('button', { type: 'button', class: 'seg-btn', text: 'Exam' });
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Answer mode' }, [studyBtn, examBtn]);
    var board = el('div', { class: 'panel panel-gap' });
    var results = el('div', { class: 'hidden' });
    var dockHost = options.dock || el('div');

    var submitBtn = el('button', { type: 'button', class: 'btn', text: 'Check my answers' });
    var dockMeta = el('span', { class: 'dock-meta' });
    var dockTrack = el('div', { class: 'track-fill' });
    var dock = el('div', { class: 'dock no-print' }, [
      el('div', { class: 'dock-in' }, [
        el('div', { class: 'track', style: 'flex:1 1 10em' }, [dockTrack]),
        dockMeta,
        submitBtn,
      ]),
    ]);

    meta.textContent =
      count(items.length, 'question', 'questions') +
      ', ' +
      count(points, 'mark', 'marks') +
      (data.files && data.files.length ? ', from ' + count(data.files.length, 'file', 'files') : '') +
      (units.length ? ' covering ' + count(units.length, 'slide or page', 'slides and pages') : '');

    host.appendChild(
      el('section', { class: 'section section-flush' }, [
        title,
        meta,
        el('div', { class: 'field' }, [
          el('div', {}, [el('div', { class: 'field-label', text: 'How you want to be graded' }), modeHint]),
          seg,
        ]),
      ])
    );
    host.appendChild(results);
    host.appendChild(board);
    dockHost.appendChild(dock);
    if (!options.dock && dockHost.parentNode === null) host.appendChild(dockHost);

    studyBtn.addEventListener('click', function () {
      setMode('study');
    });
    examBtn.addEventListener('click', function () {
      setMode('exam');
    });
    submitBtn.addEventListener('click', function () {
      if (graded) retake(null);
      else submit();
    });


    function setMode(next) {
      if (graded) return;
      mode = next;
      studyBtn.setAttribute('aria-pressed', mode === 'study' ? 'true' : 'false');
      examBtn.setAttribute('aria-pressed', mode === 'exam' ? 'true' : 'false');
      modeHint.textContent =
        mode === 'study'
          ? 'Check one question at a time and see the answer straight away.'
          : 'Everything stays hidden until you submit, like a real exam.';
      items.forEach(function (item) {
        var row = rows[item.id];
        if (!row || !row.check) return;
        row.check.classList.toggle('hidden', mode === 'exam' || !!revealed[item.id]);
      });
      tick();
    }

    function render() {
      clear(board);
      items.forEach(function (item, index) {
        board.appendChild(renderItem(item, index));
      });
      setMode(mode);
    }

    function renderItem(item, index) {
      var marks = marksOf(item);
      var text = el('p', { class: 'q-text', id: 'label-' + item.id, text: item.q });
      var body = el('div', { class: 'q-body' });
      var verdict = el('div', { class: 'verdict hidden' });
      var check = el('button', { type: 'button', class: 'btn btn-quiet btn-small', text: 'Check' });
      var row = { item: item, body: body, verdict: verdict, check: check, inputs: [], choices: [] };
      rows[item.id] = row;

      buildInputs(item, row);
      body.appendChild(el('div', { class: 'actions' }, [check]));
      body.appendChild(verdict);
      check.addEventListener('click', function () {
        reveal(item, true);
      });

      return el('article', { class: 'q' + (index === 0 ? ' q-first' : ''), id: 'item-' + item.id }, [
        el('div', { class: 'q-head' }, [
          el('span', { class: 'q-no', text: String(index + 1) }),
          el('div', {}, [
            text,
            el('p', {
              class: 'q-kind',
              text: LABELS[item.type] + (marks > 1 ? ', ' + count(marks, 'mark', 'marks') : ''),
            }),
          ]),
        ]),
        body,
      ]);
    }

    function buildInputs(item, row) {
      if (item.type === 'mcq') return buildMcq(item, row);
      if (item.type === 'identification') return buildIdentification(item, row);
      if (item.type === 'enumeration') return buildEnumeration(item, row);
      return buildMatching(item, row);
    }

    function buildMcq(item, row) {
      var group = el('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'label-' + item.id });
      (item.choices || []).forEach(function (choice, index) {
        var input = el('input', { type: 'radio', name: 'pick-' + item.id, value: String(index) });
        var label = el('label', { class: 'choice' }, [
          input,
          el('span', {}, [el('span', { class: 'choice-key', text: letter(index) + '.' }), ' ' + String(choice)]),
        ]);
        input.addEventListener('change', function () {
          responses[item.id] = index;
          row.choices.forEach(function (node, n) {
            node.classList.toggle('is-picked', n === index);
          });
          tick();
        });
        row.inputs.push(input);
        row.choices.push(label);
        group.appendChild(label);
      });
      row.body.appendChild(group);
    }

    function buildIdentification(item, row) {
      var input = el('input', {
        type: 'text',
        class: 'answer',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'Your answer',
        'aria-labelledby': 'label-' + item.id,
      });
      input.addEventListener('input', function () {
        responses[item.id] = input.value;
        tick();
      });
      input.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (mode === 'study' && !graded) reveal(item, true);
      });
      row.inputs.push(input);
      row.body.appendChild(input);
    }

    function buildEnumeration(item, row) {
      var wrap = el('div', { class: 'blanks' });
      responses[item.id] = [];
      (item.answers || []).forEach(function (answer, index) {
        var input = el('input', {
          type: 'text',
          class: 'blank',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': 'Answer ' + (index + 1),
        });
        input.addEventListener('input', function () {
          var list = responses[item.id] || [];
          list[index] = input.value;
          responses[item.id] = list;
          tick();
        });
        row.inputs.push(input);
        wrap.appendChild(
          el('div', { class: 'blank-row' }, [
            el('span', { class: 'blank-no', text: index + 1 + '.' }),
            input,
          ])
        );
      });
      row.body.appendChild(wrap);
    }

    function buildMatching(item, row) {
      var order = pickOrder(item);
      var wrap = el('div', {});
      responses[item.id] = [];
      item.pairs.forEach(function (pair, index) {
        var select = el('select', { class: 'pick', 'aria-label': 'Match for ' + pair.left }, [
          el('option', { value: '', text: 'Choose one' }),
        ]);
        order.forEach(function (target, slot) {
          select.appendChild(
            el('option', { value: String(target), text: letter(slot) + '. ' + item.pairs[target].right })
          );
        });
        select.addEventListener('change', function () {
          var list = responses[item.id] || [];
          list[index] = select.value === '' ? null : parseInt(select.value, 10);
          responses[item.id] = list;
          tick();
        });
        row.inputs.push(select);
        wrap.appendChild(
          el('div', { class: 'pair' + (index === 0 ? ' pair-first' : '') }, [
            el('div', { class: 'pair-left', text: index + 1 + '. ' + pair.left }),
            select,
          ])
        );
      });
      row.body.appendChild(wrap);
    }

    function setDisabled(row, off) {
      row.inputs.forEach(function (input) {
        input.disabled = !!off;
      });
    }

    /** Grades one question, marks up its inputs and shows the answer. */
    function reveal(item, lock) {
      var row = rows[item.id];
      if (!row) return null;
      var result = grade.gradeItem(item, responses[item.id]);
      revealed[item.id] = true;
      if (lock) setDisabled(row, true);
      row.check.classList.add('hidden');
      annotate(row, item, result);
      tick();
      return result;
    }

    function annotate(row, item, result) {
      var marks = marksOf(item);
      var notes = [];
      clear(row.verdict);
      row.verdict.classList.remove('hidden');
      row.verdict.appendChild(
        el('p', {
          class: result.correct ? 'verdict-right' : result.earned > 0 ? '' : 'verdict-wrong',
          text: result.correct
            ? result.typo
              ? 'Correct, with a small spelling slip'
              : 'Correct'
            : result.earned > 0
              ? result.earned + ' of ' + count(marks, 'mark', 'marks')
              : result.answered
                ? 'Not quite'
                : 'Left blank',
        })
      );

      if (item.type === 'mcq') {
        row.choices.forEach(function (node, index) {
          node.classList.remove('is-picked');
          if (index === item.answer) node.classList.add('is-key');
          else if (index === result.picked) node.classList.add('is-miss');
        });
        if (!result.correct) notes.push('Answer: ' + letter(item.answer) + '. ' + item.choices[item.answer]);
      }

      if (item.type === 'identification') {
        row.inputs[0].classList.add(result.correct ? 'is-ok' : 'is-no');
        if (!result.correct) {
          notes.push('Answer: ' + item.answer);
          if ((item.accept || []).length) notes.push('Also accepted: ' + item.accept.join(', '));
        } else if (result.typo) {
          notes.push('Spelled: ' + item.answer);
        }
      }

      if (item.type === 'enumeration') {
        (result.blanks || []).forEach(function (blank, index) {
          var input = row.inputs[index];
          if (!input) return;
          if (blank.status === 'right' || blank.status === 'typo') input.classList.add('is-ok');
          else if (blank.status === 'wrong') input.classList.add('is-no');
        });
        if ((result.missed || []).length) notes.push('Still missing: ' + result.missed.join(', '));
      }

      if (item.type === 'matching') {
        var fixes = [];
        (result.rows || []).forEach(function (entry, index) {
          var input = row.inputs[index];
          if (input) input.classList.add(entry.correct ? 'is-ok' : 'is-no');
          if (!entry.correct) fixes.push(index + 1 + ' pairs with ' + item.pairs[index].right);
        });
        if (fixes.length) notes.push(fixes.join('; '));
      }

      if (item.why) notes.push(item.why);
      notes.forEach(function (note) {
        row.verdict.appendChild(el('p', { class: 'verdict-why', text: note }));
      });
      var where = sourceText(item);
      if (where) row.verdict.appendChild(el('p', { class: 'source', text: where }));
    }

    /** Dock progress. Runs on every keystroke, so it stays cheap. */
    function tick() {
      var answered = items.filter(function (item) {
        return grade.gradeItem(item, responses[item.id]).answered;
      }).length;
      var share = items.length ? Math.round((answered / items.length) * 100) : 0;
      dockTrack.style.width = share + '%';
      if (graded) {
        dockMeta.textContent = graded.earned + ' of ' + count(graded.points, 'mark', 'marks');
        return;
      }
      dockMeta.textContent = answered + ' of ' + items.length + ' answered';
      submitBtn.disabled = answered === 0;
      submitBtn.textContent = mode === 'exam' ? 'Check my answers' : 'Finish and score';
    }

    function submit() {
      if (graded) return;
      graded = grade.scoreQuiz(items, responses);
      var byId = {};
      graded.results.forEach(function (result) {
        byId[result.id] = result;
      });
      items.forEach(function (item) {
        var row = rows[item.id];
        if (!row) return;
        setDisabled(row, true);
        row.check.classList.add('hidden');
        annotate(row, item, byId[item.id]);
      });
      studyBtn.disabled = true;
      examBtn.disabled = true;
      submitBtn.textContent = 'Start over';
      saveAttempt(graded);
      showResults(graded);
      tick();
    }

    function retake(subset) {
      var next = {
        title: data.title,
        made: data.made,
        files: data.files,
        units: units,
        items: subset && subset.length ? subset : data.items,
        partial: !!(subset && subset.length),
      };
      var carried = Object.assign({}, options, { mode: mode });
      mount(host, next, carried);
      if (root.scrollTo) root.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function saveAttempt(summary) {
      if (!storageKey) return;
      var list = readHistory(storageKey);
      list.push({
        when: new Date().toISOString(),
        percent: summary.percent,
        earned: summary.earned,
        points: summary.points,
        partial: !!data.partial,
      });
      writeHistory(storageKey, list);
    }

    function showResults(summary) {
      clear(results);
      results.classList.remove('hidden');
      results.appendChild(scorePanel(summary));
      var cover = coveragePanel(summary);
      if (cover) results.appendChild(cover);
      results.appendChild(missPanel(summary));
      results.appendChild(tailPanel(summary));
      if (results.scrollIntoView) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function scorePanel(summary) {
      var panel = el('div', { class: 'panel panel-gap' }, [
        el('div', { class: 'score' }, [
          el('div', { class: 'score-value', text: summary.percent + '%' }),
          el('p', {
            class: 'score-sub',
            text:
              summary.earned +
              ' of ' +
              count(summary.points, 'mark', 'marks') +
              ', ' +
              summary.right +
              ' of ' +
              summary.total +
              ' questions fully right',
          }),
        ]),
      ]);
      ORDER.forEach(function (type) {
        var bucket = summary.byType[type];
        if (bucket) panel.appendChild(barRow(LABELS[type], bucket.earned, bucket.points));
      });
      return panel;
    }

    function barRow(label, earned, points) {
      var fill = el('div', { class: 'track-fill' });
      fill.style.width = (points ? Math.round((earned / points) * 100) : 0) + '%';
      return el('div', { class: 'bar-row' }, [
        el('span', { text: label }),
        el('div', { class: 'track' }, [fill]),
        el('span', { class: 'bar-count', text: earned + '/' + points }),
      ]);
    }

    function unitKey(src) {
      return (src.at || '') + '|' + (src.file || '');
    }

    /** One tile per slide or page, coloured by how the questions from it went. */
    function coveragePanel(summary) {
      if (!units.length) return null;
      var byId = {};
      summary.results.forEach(function (result) {
        byId[result.id] = result;
      });
      var buckets = {};
      items.forEach(function (item) {
        var result = byId[item.id];
        if (!result) return;
        var key = unitKey(item.src || {});
        var bucket = buckets[key] || (buckets[key] = { sum: 0, n: 0 });
        bucket.sum += result.credit;
        bucket.n += 1;
      });

      var lattice = el('div', { class: 'lattice', 'aria-hidden': 'true' });
      var covered = 0;
      var shaky = 0;
      units.forEach(function (unit, index) {
        var bucket = buckets[unitKey(unit)];
        var state = '';
        if (bucket) {
          covered += 1;
          if (bucket.sum === bucket.n) state = ' is-right';
          else if (bucket.sum === 0) state = ' is-wrong';
          else state = ' is-part';
          if (bucket.sum < bucket.n) shaky += 1;
        }
        var label = (unit.at || 'Part ' + (index + 1)) + (unit.file ? ', ' + unit.file : '');
        var tile = el('span', {
          class: 'tile' + state,
          title: bucket ? label : label + ' (no question from here)',
        });
        tile.style.setProperty('--i', String(index));
        lattice.appendChild(tile);
      });

      return el('div', { class: 'panel panel-gap' }, [
        el('h2', { text: 'Where you stand in the material' }),
        el('p', {
          class: 'panel-note measure',
          text:
            'Questions came from ' +
            covered +
            ' of ' +
            count(units.length, 'slide or page', 'slides and pages') +
            (shaky ? ', and ' + count(shaky, 'part', 'parts') + ' still need work.' : '. Every part you were asked about is solid.'),
        }),
        lattice,
        el('div', { class: 'legend' }, [
          el('span', {}, [el('i', { class: 'dot is-right' }), 'All right']),
          el('span', {}, [el('i', { class: 'dot is-part' }), 'Partly right']),
          el('span', {}, [el('i', { class: 'dot is-wrong' }), 'Missed']),
          el('span', {}, [el('i', { class: 'dot' }), 'Not asked']),
        ]),
      ]);
    }

    function givenText(item, result) {
      if (item.type === 'mcq') {
        return result.picked === null || result.picked === undefined
          ? 'nothing'
          : letter(result.picked) + '. ' + item.choices[result.picked];
      }
      if (item.type === 'identification') return String(result.typed || '').trim() || 'nothing';
      if (item.type === 'enumeration') {
        var said = (result.blanks || [])
          .map(function (blank) {
            return blank.value;
          })
          .filter(function (value) {
            return String(value || '').trim() !== '';
          });
        return said.length ? said.join(', ') : 'nothing';
      }
      var picks = (result.rows || []).map(function (entry, index) {
        var right = entry.picked === null || entry.picked === undefined ? 'blank' : item.pairs[entry.picked].right;
        return index + 1 + ': ' + right;
      });
      return picks.length ? picks.join('; ') : 'nothing';
    }

    function keyText(item) {
      if (item.type === 'mcq') return letter(item.answer) + '. ' + item.choices[item.answer];
      if (item.type === 'identification') return item.answer;
      if (item.type === 'enumeration') return item.answers.join(', ');
      return item.pairs
        .map(function (pair, index) {
          return index + 1 + ': ' + pair.right;
        })
        .join('; ');
    }

    function jump(id) {
      var node = document.getElementById('item-' + id);
      if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /** The wrong answers, gathered in one place so revising has a starting point. */
    function missPanel(summary) {
      var panel = el('div', { class: 'panel panel-gap' }, [el('h2', { text: 'What to go over' })]);
      var missed = summary.results.filter(function (result) {
        return result.credit < 1;
      });
      if (!missed.length) {
        panel.appendChild(
          el('p', { class: 'panel-note measure', text: 'Nothing. Every question came back right.' })
        );
        return panel;
      }
      panel.appendChild(
        el('p', {
          class: 'panel-note measure',
          text: count(missed.length, 'question', 'questions') + ' to revisit, in the order they were asked.',
        })
      );
      var order = {};
      items.forEach(function (item, index) {
        order[item.id] = index;
      });
      missed.forEach(function (result) {
        var item = items[order[result.id]];
        panel.appendChild(reviewRow(item, result, order[result.id] + 1));
      });
      panel.appendChild(
        el('div', { class: 'actions no-print' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-quiet btn-small',
            text: 'Retry just these ' + missed.length,
            onclick: function () {
              retake(
                missed.map(function (result) {
                  return items[order[result.id]];
                })
              );
            },
          }),
        ])
      );
      return panel;
    }

    function line(key, value, cls) {
      return el('div', { class: 'review-line' }, [
        el('span', { class: 'review-key', text: key }),
        el('span', { class: 'review-value' + (cls ? ' ' + cls : ''), text: value }),
      ]);
    }

    function reviewRow(item, result, number) {
      var node = el('div', { class: 'review-item' }, [
        el('p', { class: 'review-q', text: number + '. ' + item.q }),
        line('You put', givenText(item, result), 'mark-wrong'),
        line('Answer', keyText(item), 'mark-right'),
      ]);
      if (item.why) node.appendChild(line('Why', item.why, ''));
      var where = sourceText(item);
      if (where) node.appendChild(line('From', where, ''));
      node.appendChild(
        el('button', {
          type: 'button',
          class: 'btn-link no-print',
          text: 'Go to question ' + number,
          onclick: function () {
            jump(item.id);
          },
        })
      );
      return node;
    }

    function tailPanel() {
      var panel = el('div', { class: 'panel panel-gap no-print' }, [el('h2', { text: 'Another round' })]);
      var attempts = readHistory(storageKey);
      if (attempts.length > 1) {
        panel.appendChild(el('p', { class: 'panel-note', text: 'Your attempts on this reviewer, newest first.' }));
        var list = el('ul', { class: 'history' });
        attempts
          .slice()
          .reverse()
          .forEach(function (entry) {
            var when = new Date(entry.when);
            list.appendChild(
              el('li', {}, [
                el('span', {
                  text:
                    (isNaN(when.getTime()) ? 'Earlier' : when.toLocaleString()) +
                    (entry.partial ? ', missed questions only' : ''),
                }),
                el('span', { text: entry.percent + '%, ' + entry.earned + '/' + entry.points }),
              ])
            );
          });
        panel.appendChild(list);
      }
      var actions = el('div', { class: 'actions' }, [
        el('button', {
          type: 'button',
          class: 'btn',
          text: 'Take it again',
          onclick: function () {
            retake(null);
          },
        }),
        el('button', {
          type: 'button',
          class: 'btn btn-quiet',
          text: 'Print or save as PDF',
          onclick: function () {
            root.print();
          },
        }),
      ]);
      (options.actions || []).forEach(function (node) {
        actions.appendChild(node);
      });
      panel.appendChild(actions);
      return panel;
    }

    render();
    tick();

    return {
      submit: submit,
      grade: function () {
        return graded;
      },
    };
  }

  root.AR = root.AR || {};
  root.AR.quiz = { mount: mount, labels: LABELS, types: ORDER, marksOf: marksOf };
})(typeof window !== 'undefined' ? window : globalThis);
