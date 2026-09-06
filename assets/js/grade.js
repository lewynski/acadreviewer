/**
 * Answer checking for Academic Reviewer.
 *
 * Deliberately free of DOM code: this same file is unit tested in Node and
 * inlined verbatim into the downloadable offline reviewer.
 */
(function (root) {
  'use strict';

  var LEADING = /^(the|a|an|ang|mga)\s+/;
  var COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');
  var STOP = { of: 1, the: 1, a: 1, an: 1, and: 1, in: 1, on: 1, for: 1, to: 1, by: 1, with: 1, ng: 1, sa: 1 };

  /** Lowercase, unaccented, punctuation-free, no leading article. */
  function norm(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(COMBINING, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(LEADING, '');
  }

  /** Spaces removed too, so "ohm's law" and "ohms law" land in the same place. */
  function tight(value) {
    return norm(value).replace(/ /g, '');
  }

  function singular(value) {
    if (value.length > 4 && /ies$/.test(value)) return value.slice(0, -3) + 'y';
    if (value.length > 4 && /(ses|xes|zes|ches|shes)$/.test(value)) return value.slice(0, -2);
    if (value.length > 3 && /s$/.test(value) && !/ss$/.test(value)) return value.slice(0, -1);
    return value;
  }

  /** "Kirchhoff's Current Law" -> "kcl", so KCL is accepted. */
  function acronym(value) {
    var words = norm(value).split(' ').filter(function (word) {
      return word.length > 1 && !STOP[word];
    });
    if (words.length < 2) return '';
    return words
      .map(function (word) {
        return word.charAt(0);
      })
      .join('');
  }

  function distance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= b.length; j += 1) prev[j] = j;
    for (i = 1; i <= a.length; i += 1) {
      var current = [i];
      for (j = 1; j <= b.length; j += 1) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = current;
    }
    return prev[b.length];
  }

  /** How many typos to forgive at a given answer length. */
  function allowance(length) {
    if (length >= 12) return 2;
    if (length >= 5) return 1;
    return 0;
  }

  function numberOf(value) {
    var raw = String(value == null ? '' : value).replace(/,/g, '').trim();
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw) ? parseFloat(raw) : null;
  }

  /** Compares one typed answer against every accepted spelling. */
  function check(value, candidates) {
    var given = tight(value);
    if (!given) return { match: false, typo: false };
    var givenNumber = numberOf(value);
    for (var i = 0; i < candidates.length; i += 1) {
      var want = tight(candidates[i]);
      if (!want) continue;
      if (given === want || singular(given) === singular(want)) return { match: true, typo: false };
      if (given === acronym(candidates[i])) return { match: true, typo: false };
      var wantNumber = numberOf(candidates[i]);
      if (givenNumber !== null && wantNumber !== null && Math.abs(givenNumber - wantNumber) < 1e-9) {
        return { match: true, typo: false };
      }
      var room = allowance(Math.max(given.length, want.length));
      if (room > 0 && distance(singular(given), singular(want)) <= room) return { match: true, typo: true };
    }
    return { match: false, typo: false };
  }

  /** Order does not matter, and every item found is worth a point. */
  function gradeEnumeration(item, response) {
    var expected = item.answers.map(function (answer) {
      return { answer: answer, used: false };
    });
    var given = Array.isArray(response) ? response : [];
    var blanks = [];
    var matched = 0;
    given.forEach(function (raw) {
      var value = String(raw == null ? '' : raw);
      if (!value.trim()) {
        blanks.push({ value: '', status: 'blank' });
        return;
      }
      var hit = -1;
      var typo = false;
      for (var i = 0; i < expected.length; i += 1) {
        if (expected[i].used) continue;
        var result = check(value, [expected[i].answer]);
        if (result.match) {
          hit = i;
          typo = result.typo;
          break;
        }
      }
      if (hit < 0) {
        blanks.push({ value: value, status: 'wrong' });
        return;
      }
      expected[hit].used = true;
      matched += 1;
      blanks.push({ value: value, status: typo ? 'typo' : 'right', answer: expected[hit].answer });
    });
    return {
      credit: matched / item.answers.length,
      points: item.answers.length,
      blanks: blanks,
      missed: expected
        .filter(function (entry) {
          return !entry.used;
        })
        .map(function (entry) {
          return entry.answer;
        }),
    };
  }

  /** picks[i] is the index of the pair whose description was chosen for row i. */
  function gradeMatching(item, response) {
    var picks = Array.isArray(response) ? response : [];
    var rows = item.pairs.map(function (pair, index) {
      var picked = Number.isInteger(picks[index]) ? picks[index] : null;
      return { picked: picked, correct: picked === index };
    });
    var right = rows.filter(function (row) {
      return row.correct;
    }).length;
    return { credit: right / item.pairs.length, points: item.pairs.length, rows: rows };
  }

  function isAnswered(item, response) {
    if (item.type === 'mcq') return Number.isInteger(response);
    if (item.type === 'identification') return String(response == null ? '' : response).trim() !== '';
    var list = Array.isArray(response) ? response : [];
    if (item.type === 'enumeration') {
      return list.some(function (value) {
        return String(value == null ? '' : value).trim() !== '';
      });
    }
    return list.some(function (value) {
      return Number.isInteger(value);
    });
  }

  function gradeItem(item, response) {
    var detail;
    if (item.type === 'mcq') {
      var picked = Number.isInteger(response) ? response : null;
      detail = { credit: picked === item.answer ? 1 : 0, points: 1, picked: picked };
    } else if (item.type === 'identification') {
      var typed = String(response == null ? '' : response);
      var result = check(typed, [item.answer].concat(item.accept || []));
      detail = { credit: result.match ? 1 : 0, points: 1, typed: typed, typo: result.typo };
    } else if (item.type === 'enumeration') {
      detail = gradeEnumeration(item, response);
    } else {
      detail = gradeMatching(item, response);
    }
    var credit = Math.max(0, Math.min(1, detail.credit || 0));
    detail.id = item.id;
    detail.type = item.type;
    detail.credit = credit;
    detail.correct = credit === 1;
    detail.earned = Math.round(credit * detail.points * 100) / 100;
    detail.answered = isAnswered(item, response);
    return detail;
  }

  /**
   * Grades a whole reviewer. Enumeration and matching carry one point per
   * item, so a five-part enumeration is worth five marks, the way a paper
   * exam would count it.
   */
  function scoreQuiz(items, responses) {
    var answers = responses || {};
    var results = items.map(function (item) {
      return gradeItem(item, answers[item.id]);
    });
    var summary = { total: items.length, right: 0, points: 0, earned: 0, answered: 0, byType: {} };
    results.forEach(function (result) {
      if (!summary.byType[result.type]) {
        summary.byType[result.type] = { items: 0, right: 0, points: 0, earned: 0 };
      }
      var bucket = summary.byType[result.type];
      bucket.items += 1;
      bucket.points += result.points;
      bucket.earned = Math.round((bucket.earned + result.earned) * 100) / 100;
      summary.points += result.points;
      summary.earned = Math.round((summary.earned + result.earned) * 100) / 100;
      if (result.answered) summary.answered += 1;
      if (result.correct) {
        summary.right += 1;
        bucket.right += 1;
      }
    });
    summary.percent = summary.points ? Math.round((summary.earned / summary.points) * 100) : 0;
    summary.results = results;
    return summary;
  }

  root.AR = root.AR || {};
  root.AR.grade = {
    norm: norm,
    tight: tight,
    check: check,
    distance: distance,
    gradeItem: gradeItem,
    scoreQuiz: scoreQuiz,
  };
})(typeof window !== 'undefined' ? window : globalThis);
