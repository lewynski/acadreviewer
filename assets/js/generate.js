/**
 * Turns extracted material into a set of questions.
 *
 * The material is cut into contiguous batches of slides and pages, each batch
 * is given its own share of the requested questions, and the batches are sent
 * to /api/generate a couple at a time. That is what makes a reviewer cover a
 * whole deck instead of its first few slides, and it keeps every request small
 * enough to finish inside the serverless time limit.
 */
(function (root) {
  'use strict';

  var ENDPOINT = 'api/generate';
  var TYPES = ['mcq', 'identification', 'enumeration', 'matching'];

  var TARGET_CHARS = 12000; // aimed-for size of one batch
  var MAX_BATCH_CHARS = 45000; // the server refuses more than 60000
  var MAX_BATCHES = 40;
  var MAX_PER_BATCH = 40; // the server's own cap on items per request
  var CONCURRENCY = 2;
  var TRIES = 3;

  function clamp(n, low, high) {
    return Math.min(high, Math.max(low, n));
  }

  function charsOf(unit) {
    return String(unit.text || '').length + String(unit.at || '').length + 8;
  }

  function labelOf(batch) {
    var first = batch.units[0];
    var last = batch.units[batch.units.length - 1];
    return first.at === last.at ? first.at : first.at + ' to ' + last.at;
  }

  /**
   * Contiguous batches of roughly equal length. Contiguous matters: a batch
   * that holds one run of slides reads like a section of the lecture, so the
   * questions written from it hang together.
   */
  function plan(units, wanted) {
    var total = units.reduce(function (sum, unit) {
      return sum + charsOf(unit);
    }, 0);
    var count = clamp(Math.ceil(total / TARGET_CHARS), 1, 24);
    if (total / count > MAX_BATCH_CHARS) {
      count = Math.min(MAX_BATCHES, Math.ceil(total / MAX_BATCH_CHARS));
    }
    count = Math.max(count, Math.ceil((wanted || 1) / MAX_PER_BATCH));
    count = clamp(count, 1, Math.min(MAX_BATCHES, units.length));

    var per = Math.ceil(total / count);
    var batches = [];
    var current = null;
    units.forEach(function (unit) {
      var size = charsOf(unit);
      var full = current && current.chars + size > MAX_BATCH_CHARS;
      if (!current || full || (current.chars >= per && batches.length < count)) {
        current = { units: [], chars: 0, counts: {}, total: 0 };
        batches.push(current);
      }
      current.units.push(unit);
      current.chars += size;
    });
    batches.forEach(function (batch) {
      batch.label = labelOf(batch);
    });
    return batches;
  }

  /**
   * Whole numbers that add up to total, split in proportion to weights and
   * never above caps. Remainders go to the heaviest batches, so when there are
   * fewer questions than batches it is the longest sections that get them.
   */
  function share(total, weights, caps) {
    var out = weights.map(function () {
      return 0;
    });
    var sum = weights.reduce(function (a, b) {
      return a + b;
    }, 0) || 1;
    var slots = weights.map(function (weight, i) {
      return { at: i, exact: (total * weight) / sum, weight: weight };
    });
    slots.forEach(function (slot) {
      out[slot.at] = Math.min(caps[slot.at], Math.floor(slot.exact));
    });
    slots.sort(function (a, b) {
      var fa = a.exact - Math.floor(a.exact);
      var fb = b.exact - Math.floor(b.exact);
      return fb - fa || b.weight - a.weight;
    });
    var left = total - out.reduce(function (a, b) {
      return a + b;
    }, 0);
    while (left > 0) {
      var moved = false;
      for (var k = 0; k < slots.length && left > 0; k += 1) {
        var at = slots[k].at;
        if (out[at] >= caps[at]) continue;
        out[at] += 1;
        left -= 1;
        moved = true;
      }
      if (!moved) break;
    }
    return out;
  }

  /** Gives every batch its share of each type. */
  function allocate(batches, counts, wanted) {
    var weights = batches.map(function (batch) {
      return batch.chars;
    });
    var room = Math.max(3, Math.ceil(wanted / batches.length) + 1);
    var caps = batches.map(function (batch) {
      return Math.min(MAX_PER_BATCH, Math.max(1, batch.units.length * room));
    });
    TYPES.forEach(function (type) {
      if (!counts[type]) return;
      share(counts[type], weights, caps).forEach(function (n, i) {
        batches[i].counts[type] = n;
        batches[i].total += n;
        caps[i] -= n;
      });
    });
    return batches;
  }

  function sleep(ms) {
    return new Promise(function (done) {
      setTimeout(done, ms);
    });
  }

  async function body(res) {
    var text = '';
    try {
      text = await res.text();
    } catch (err) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      return { error: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) };
    }
  }

  /* Statuses worth a second attempt are the busy and the briefly broken. A bad
     access code or a missing key will answer the same way every time, so those
     stop the run instead of wasting three round trips per batch. */
  var AGAIN = { 408: 1, 429: 1, 502: 1, 503: 1, 504: 1 };

  function complain(status, said) {
    var text = said && said.error ? String(said.error) : '';
    if (status === 404 || status === 405) {
      text =
        'No question writer answered at /api/generate. This page has to be opened from the deployed site, not from a file on disk.';
    } else if (status === 401) {
      text = text || 'That access code was not accepted.';
    } else if (status === 500) {
      text = text || 'The site is missing its GROQ_API_KEY setting.';
    }
    var err = new Error(text || 'The question writer answered with ' + status + '.');
    err.status = status;
    err.fatal = AGAIN[status] !== 1;
    return err;
  }

  /** One request for one batch. */
  async function ask(batch, difficulty, code) {
    var headers = { 'content-type': 'application/json' };
    if (code) headers['x-access-code'] = code;
    var res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          units: batch.units.map(function (unit) {
            return { file: unit.file, at: unit.at, text: unit.text };
          }),
          counts: batch.counts,
          difficulty: difficulty,
        }),
      });
    } catch (err) {
      var down = new Error('The question writer could not be reached. Check the connection, then try again.');
      down.fatal = false;
      throw down;
    }
    if (res.ok) return await body(res);
    var said = await body(res);
    var trouble = complain(res.status, said);
    if (res.status === 429) trouble.after = Number(res.headers.get('retry-after')) || 0;
    throw trouble;
  }

  /** Busy and broken get a few more chances; wrong stops at once. */
  async function askHard(batch, difficulty, code, note) {
    var last = null;
    for (var attempt = 1; attempt <= TRIES; attempt += 1) {
      try {
        return await ask(batch, difficulty, code);
      } catch (err) {
        last = err;
        if (err.fatal || attempt === TRIES) throw err;
        var wait = Math.min(err.after ? err.after * 1000 : 700 * attempt * attempt, 20000);
        note(batch.label + ' is queued, trying again in ' + Math.max(1, Math.round(wait / 1000)) + 's');
        await sleep(wait + Math.floor(Math.random() * 400));
      }
    }
    throw last;
  }

  /** Uses the grader's own normaliser when it is loaded, so keys agree. */
  function tight(value) {
    var grade = root.AR && root.AR.grade;
    if (grade && grade.tight) return grade.tight(value);
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  /**
   * The server hands back the correct choice first whenever it has had to trim
   * a long list, so the choices are shuffled here. The answer index travels
   * with the choice rather than being recomputed.
   */
  function shuffleChoices(item) {
    var choices = item.choices;
    if (!Array.isArray(choices) || choices.length < 2) return;
    var correct = choices[item.answer];
    for (var i = choices.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var held = choices[i];
      choices[i] = choices[j];
      choices[j] = held;
    }
    var found = choices.indexOf(correct);
    item.answer = found < 0 ? 0 : found;
  }

  function unitKey(src) {
    return (src && src.at ? src.at : '') + '|' + (src && src.file ? src.file : '');
  }

  /**
   * Merges the batches into one paper: duplicates dropped, choices shuffled,
   * then ordered by type the way an exam runs and by slide order inside a type.
   */
  function collect(replies, units) {
    var rank = {};
    units.forEach(function (unit, i) {
      var k = unitKey(unit);
      if (!(k in rank)) rank[k] = i;
    });
    var seen = {};
    var out = [];
    replies.forEach(function (reply) {
      var items = reply && Array.isArray(reply.items) ? reply.items : [];
      items.forEach(function (item) {
        if (!item || typeof item !== 'object' || TYPES.indexOf(item.type) < 0) return;
        var k = item.type + '|' + tight(item.q);
        if (!tight(item.q) || seen[k]) return;
        seen[k] = 1;
        if (item.type === 'mcq') shuffleChoices(item);
        var at = unitKey(item.src);
        item.rank = at in rank ? rank[at] : units.length;
        out.push(item);
      });
    });
    out.sort(function (a, b) {
      return TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.rank - b.rank;
    });
    out.forEach(function (item, i) {
      item.id = i + 1;
      delete item.rank;
    });
    return out;
  }

  /**
   * Writes one reviewer. Resolves with the questions and a note of anything
   * that went wrong along the way; a batch that fails is reported and skipped,
   * because most of a reviewer is worth more than none of it.
   */
  async function run(options) {
    var settings = options || {};
    var units = (settings.units || []).filter(function (unit) {
      return unit && unit.text;
    });
    var counts = {};
    var wanted = 0;
    TYPES.forEach(function (type) {
      var n = Math.floor(Number(settings.counts && settings.counts[type]) || 0);
      counts[type] = Math.max(0, n);
      wanted += counts[type];
    });
    if (!units.length) throw new Error('There is no readable material to work from yet.');
    if (!wanted) throw new Error('Ask for at least one question.');

    var difficulty = settings.difficulty || 'balanced';
    var code = settings.accessCode || '';
    var report = typeof settings.onProgress === 'function' ? settings.onProgress : function () {};
    var batches = allocate(plan(units, wanted), counts, wanted).filter(function (batch) {
      return batch.total > 0;
    });

    var replies = [];
    var models = [];
    var warnings = [];
    var stopped = null;
    var done = 0;
    var next = 0;

    function say(note) {
      report({ done: done, total: batches.length, note: note });
    }
    say('Reading ' + batches.length + (batches.length === 1 ? ' section' : ' sections') + ' of material');

    async function worker() {
      while (next < batches.length && !stopped) {
        var batch = batches[next];
        next += 1;
        try {
          var reply = await askHard(batch, difficulty, code, say);
          replies.push(reply);
          if (reply && reply.model && models.indexOf(reply.model) < 0) models.push(reply.model);
        } catch (err) {
          var said = err && err.message ? err.message : 'Something went wrong.';
          if (err && err.fatal) stopped = err;
          else warnings.push(batch.label + ': ' + said);
        }
        done += 1;
        say('Wrote questions from ' + batch.label);
      }
    }

    var crew = [];
    for (var n = 0; n < Math.min(CONCURRENCY, batches.length); n += 1) crew.push(worker());
    await Promise.all(crew);

    var items = collect(replies, units);
    if (!items.length) throw stopped || new Error(warnings[0] || 'No questions came back. Try again in a moment.');
    if (stopped) warnings.push(stopped.message);

    return {
      items: items,
      models: models,
      batches: batches.length,
      requested: wanted,
      kept: items.length,
      warnings: warnings,
      partial: items.length < wanted,
    };
  }

  root.AR = root.AR || {};
  root.AR.generate = {
    run: run,
    plan: plan,
    share: share,
    allocate: allocate,
    collect: collect,
    types: TYPES,
    limits: { batchChars: MAX_BATCH_CHARS, perBatch: MAX_PER_BATCH, batches: MAX_BATCHES },
  };
})(typeof window !== 'undefined' ? window : globalThis);
