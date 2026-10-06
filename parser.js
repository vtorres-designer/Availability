/* Schedule parser: turns pasted lines like "10/7 2300-0700 Site B" into calendar entries.
   Pure functions, no DOM, so it can be tested on its own.
   It prefers an error over a guess: a line it can't read for sure is reported, never half-applied. */
(function (root) {
  "use strict";

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const WEEKDAY = "(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";
  const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const RANGE_SEP = "(?:-|–|—|to\\b|thru\\b|through\\b|until\\b|till?\\b)";
  // A 4-digit number after a date is a year unless it starts a time range ("Oct 7 2030-0630").
  const YEAR = "(?:,?\\s*(20\\d{2})(?!\\d)(?!\\s*" + RANGE_SEP + "\\s*(?:\\d{3,4}(?![\\d/.])|\\d{1,2}:\\d{2}|\\d{1,2}\\s*[ap]\\.?m?\\b|\\d{1,2}(?![\\d/.:]))))?";
  const DAY_ONLY_GUARD = "(?![\\d:.h]|\\s*(?:[ap]\\.?m?\\b|h\\b|hrs?\\b|hours?\\b))";
  const SHIFT_WORDS = [
    [/\b(?:overnights?|nights?|graveyards?|graves?)\b/i, "overnight"],
    [/\b(?:swings?|evenings?)\b/i, "swing"],
    [/\b(?:mornings?|days?)\b/i, "morning"],
  ];
  const STATUS_WORDS = [
    ["clear", /^(?:clear|reset|unset|gr[ae]y|blank|remove)$/i],
    ["busy", /^(?:off|busy|blocked|block|unavailable|unavail|n\/a|pto|vacation)$/i],
    ["open", /^(?:open|available|avail|free)$/i],
    ["work", /^(?:work|working|scheduled|shift)$/i],
  ];
  const NEGATIONS = /^(?:not|no|never|except|cannot|can'?t|won'?t|don'?t|isn'?t|unable)$/i;
  const MAX_RANGE_DAYS = 120;
  const MAX_DAYS_AWAY = 400;

  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
  const parts = (k) => k.split("-").map(Number);
  const addDays = (k, n) => {
    const [y, m, d] = parts(k);
    const dt = new Date(y, m - 1, d + n);
    return keyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  };
  const dayNum = (k) => { const [y, m, d] = parts(k); return Date.UTC(y, m - 1, d) / 86400000; };
  const between = (a, b) => dayNum(b) - dayNum(a);
  const weekday = (k) => { const [y, m, d] = parts(k); return new Date(y, m - 1, d).getDay(); };
  const prettyDate = (k) => { const [y, m, d] = parts(k); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
  const monthNum = (s) => MONTHS[s.toLowerCase().slice(0, 3)];
  const dowIndex = (s) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(s.toLowerCase().slice(0, 3));
  const fullYear = (y) => (y < 100 ? 2000 + y : y);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const spanHours = (start, end) => { let m = toMin(end) - toMin(start); if (m <= 0) m += 1440; return m / 60; };
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

  // ---------- dates ----------
  // Reads one date at `pos`. Returns {y|null, m, d, end, dayOnly?} or null. `prev` allows a bare day ("Oct 7-10").
  function readDate(s, pos, prev) {
    let r;
    const at = (re) => { re.lastIndex = pos; return re.exec(s); };
    if ((r = at(/(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/y))) return { y: +r[1], m: +r[2], d: +r[3], end: pos + r[0].length };
    if ((r = at(/(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)/y))) return { y: +r[3], m: +r[1], d: +r[2], end: pos + r[0].length };
    if ((r = at(/(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?(?![\d/])/y))) {
      return { y: r[3] ? fullYear(+r[3]) : null, m: +r[1], d: +r[2], end: pos + r[0].length };
    }
    if ((r = at(new RegExp(MONTH + "\\s*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)" + YEAR, "iy")))) {
      return { y: r[3] ? +r[3] : null, m: monthNum(r[1]), d: +r[2], end: pos + r[0].length };
    }
    if ((r = at(new RegExp("(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONTH + YEAR, "iy")))) {
      return { y: r[3] ? +r[3] : null, m: monthNum(r[2]), d: +r[1], end: pos + r[0].length };
    }
    if (prev && (r = at(new RegExp("(\\d{1,2})(?:st|nd|rd|th)?" + DAY_ONLY_GUARD + YEAR, "iy")))) {
      let m = prev.m;
      if (+r[1] < prev.d) m = m === 12 ? 1 : m + 1;
      return { y: r[2] ? +r[2] : null, m, d: +r[1], end: pos + r[0].length, dayOnly: true };
    }
    return null;
  }

  // Picks the year (anchor's year -1, +0 or +1) that puts the date nearest the anchor, inside [anchor-back, anchor+fwd] if possible.
  function nearestYear(m, d, anchor, back, fwd) {
    const ay = parts(anchor)[0];
    let best = null;
    for (const y of [ay - 1, ay, ay + 1]) {
      if (!validDate(y, m, d)) continue;
      const diff = between(anchor, keyOf(y, m, d));
      const score = (diff >= -back && diff <= fwd ? 0 : 1e6) + Math.abs(diff);
      if (!best || score < best.score) best = { y, score };
    }
    return best ? best.y : null;
  }
  // Earliest year that puts the date on or after `after`.
  function yearOnOrAfter(m, d, after) {
    const ay = parts(after)[0];
    for (const y of [ay, ay + 1, ay + 2]) if (validDate(y, m, d) && keyOf(y, m, d) >= after) return y;
    return null;
  }
  // Latest year that puts the date on or before `before`.
  function yearOnOrBefore(m, d, before) {
    const by = parts(before)[0];
    for (const y of [by, by - 1, by - 2]) if (validDate(y, m, d) && keyOf(y, m, d) <= before) return y;
    return null;
  }
  const badDate = (dt) => `${dt.m}/${dt.d}${dt.y ? "/" + dt.y : ""} isn't a real date.`;

  // What may follow a bare day number in a list ("10/7, 8 2300-0700"), so "10/7, 12 Main St" isn't read as Oct 12.
  const LIST_DAY_FOLLOW = new RegExp("^\\s*(?:$|[,&+;]|and\\b|" + RANGE_SEP + "|\\d|" + WEEKDAY + "\\b|(?:off|busy|open|available|avail|free|work|working|clear|blocked|unavailable)\\b)", "i");

  // Parses the dates at the start of `s`: single dates, ranges and lists.
  function readDates(s, today) {
    const groups = [];
    let pos = 0, prev = null;
    for (;;) {
      const a = readDate(s, pos, groups.length ? prev : null);
      if (!a) {
        if (!groups.length) return { error: "Start the line with a date, like 10/7, Oct 7 or 2026-10-07." };
        break;
      }
      // Optional range end.
      const sep = new RegExp("\\s*" + RANGE_SEP + "\\s*", "iy");
      sep.lastIndex = a.end;
      const sm = sep.exec(s);
      let b = null;
      if (sm) {
        b = readDate(s, a.end + sm[0].length, a);
        // "Oct 7 - 11-7am": a bare number that starts a time range is not a range end.
        if (b && b.dayOnly && /^\s*(?:-|–|—)/.test(s.slice(b.end))) b = null;
      }
      // Resolve years. A range end with a year lends it to the start ("12/30 - 1/2/2027").
      let fy = a.y, ty = b ? b.y : null;
      if (b && fy == null && ty != null) {
        if (!validDate(ty, b.m, b.d)) return { error: badDate(b) };
        fy = yearOnOrBefore(a.m, a.d, keyOf(ty, b.m, b.d));
      }
      if (fy == null) fy = prev ? nearestYear(a.m, a.d, prev.key, 200, 200) : nearestYear(a.m, a.d, today, 60, 305);
      if (fy == null || !validDate(fy, a.m, a.d)) return { error: badDate(a) };
      const from = keyOf(fy, a.m, a.d);
      let to = from;
      if (b) {
        if (ty == null) ty = yearOnOrAfter(b.m, b.d, from);
        if (ty == null || !validDate(ty, b.m, b.d)) return { error: badDate(b) };
        to = keyOf(ty, b.m, b.d);
        if (to < from) return { error: "The range ends before it starts." };
        pos = b.end;
      } else {
        pos = a.end;
      }
      groups.push({ from, to });
      const [py, pm, pd] = parts(to);
      prev = { key: to, y: py, m: pm, d: pd };
      // Optional list continuation.
      const list = /\s*(?:,|&|\+|\band\b)\s*/iy;
      list.lastIndex = pos;
      const lm = list.exec(s);
      if (!lm) break;
      const peek = readDate(s, pos + lm[0].length, prev);
      if (!peek) break;
      if (peek.dayOnly && !LIST_DAY_FOLLOW.test(s.slice(peek.end))) break;
      pos += lm[0].length;
    }
    const keys = [];
    for (const g of groups) {
      let n = 0;
      for (let k = g.from; k <= g.to; k = addDays(k, 1)) {
        if (++n > MAX_RANGE_DAYS) return { error: `A range can cover at most ${MAX_RANGE_DAYS} days.` };
        if (!keys.includes(k)) keys.push(k);
      }
    }
    const far = keys.find((k) => Math.abs(between(today, k)) > MAX_DAYS_AWAY);
    if (far) return { error: `${prettyDate(far)} is more than a year from today. Check the year.` };
    return { keys, groups, rest: s.slice(pos) };
  }

  // ---------- times ----------
  const TIME = "(\\d{1,2}:\\d{2}|\\d{3,4}|\\d{1,2})(?:\\s*([ap])\\.?(?:m\\.?)?(?![a-z]))?";
  // The leading group stands in for a lookbehind, which older iPhones can't parse.
  const TIME_RANGE = new RegExp("(^|[^\\d.:/#])" + TIME + "\\s*" + RANGE_SEP + "\\s*" + TIME + "(?![\\d/:])", "i");
  const CHAINED = new RegExp("^\\s*" + RANGE_SEP + "\\s*\\d", "i");

  const looksLikeTime = (tok, ap) => !!ap || tok.includes(":") || tok.length >= 3 || +tok >= 13 || (tok.length === 2 && tok[0] === "0");

  // All candidate time ranges in `s`, overlapping ones included, best first.
  function timeCandidates(s) {
    const out = [];
    for (let from = 0; from < s.length;) {
      const r = TIME_RANGE.exec(s.slice(from));
      if (!r) break;
      const index = from + r.index + r[1].length;
      const length = r[0].length - r[1].length;
      const chained = CHAINED.test(s.slice(index + length)); // "Post 3 - 11pm-7am": "3 - 11pm" is not the shift
      const score = (looksLikeTime(r[2], r[3]) ? 1 : 0) + (looksLikeTime(r[4], r[5]) ? 1 : 0);
      if (!chained) out.push({ r, index, length, score });
      from = index + 1;
    }
    return out.sort((p, q) => q.score - p.score || p.index - q.index);
  }

  // One time token. Returns {min} for a definite time, {bare, bareMin} when it could be AM or PM, or {error}.
  function readTime(tok, ap) {
    let h, m;
    if (tok.includes(":")) [h, m] = tok.split(":").map(Number);
    else if (tok.length >= 3) { h = Math.floor(+tok / 100); m = +tok % 100; }
    else { h = +tok; m = 0; }
    if (m > 59) return { error: true };
    if (ap) {
      if (h < 1 || h > 12) return { error: true };
      return { min: ((h % 12) + (ap.toLowerCase() === "p" ? 12 : 0)) * 60 + m };
    }
    const leadingZero = tok.length >= 2 && tok[0] === "0";
    if (h >= 13 || h === 0 || leadingZero || (tok.length === 4 && !tok.includes(":"))) {
      if (h > 24 || (h === 24 && m > 0)) return { error: true };
      return { min: (h % 24) * 60 + m };
    }
    return { bare: h, bareMin: m };
  }

  function readTimes(s) {
    const cands = timeCandidates(s);
    if (!cands.length) return null;
    const { r, index, length } = cands[0];
    const others = cands.slice(1).filter((c) => c.score === 2 && (c.index >= index + length || c.index + c.length <= index));
    const span = { index, length, others };
    const text = r[0].slice(r[1].length).trim();
    const a = readTime(r[2], r[3]);
    const b = readTime(r[4], r[5]);
    if (a.error || b.error) return Object.assign(span, { error: `"${text}" isn't a time I can read. Write it like 2300-0700 or 11pm-7am.` });
    const ambiguous = () => Object.assign(span, { error: `"${text}" could be morning or night. Add am/pm (11pm-7am) or use 24-hour time (2300-0700).` });
    if (a.min == null && b.min == null) return ambiguous();
    // One side could be AM or PM ("11-7am"): pick the one that makes the shift closest to 8 hours.
    const pick = (t, other, isStart) => {
      const opts = [(t.bare % 12) * 60 + t.bareMin, ((t.bare % 12) + 12) * 60 + t.bareMin];
      const len = (x) => { const d = isStart ? other - x : x - other; return ((d % 1440) + 1440) % 1440 || 1440; };
      const dist = opts.map((x) => Math.abs(len(x) - 480));
      return dist[0] === dist[1] ? null : opts[dist[0] < dist[1] ? 0 : 1];
    };
    const start = a.min != null ? a.min : pick(a, b.min, true);
    const end = b.min != null ? b.min : pick(b, a.min, false);
    if (start == null || end == null) return ambiguous();
    if (start === end) return Object.assign(span, { error: "The start and end time are the same." });
    return Object.assign(span, { start: hhmm(start), end: hhmm(end) });
  }

  // ---------- one line ----------
  const statusOf = (w) => { for (const [name, re] of STATUS_WORDS) if (re.test(w)) return name; return null; };

  function tokens(s) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(s))) {
      const w = m[0].replace(/[’`]/g, "'").replace(/^[^\w']+|[^\w'/]+$/g, "").toLowerCase();
      out.push({ raw: m[0], w, index: m.index, length: m[0].length });
    }
    return out;
  }

  function parseLine(raw, today) {
    let s = String(raw).replace(/[\u2010\u2011\u2012\u2212]/g, "-").replace(/\s+/g, " ").trim();
    if (!s) return null;

    // A weekday before the date ("Tue 10/7", "Tuesday, October 7") is checked against the date.
    let leadDow = null;
    const lw = new RegExp("^" + WEEKDAY + "\\b\\.?,?\\s*", "i").exec(s);
    if (lw) { leadDow = dowIndex(lw[1]); s = s.slice(lw[0].length); }

    const dates = readDates(s, today);
    if (dates.error) return { error: dates.error };
    let keys = dates.keys;
    let rest = " " + dates.rest + " ";
    const cut = (index, length) => { rest = rest.slice(0, index) + " ".repeat(length) + rest.slice(index + length); };
    const fail = (msg) => ({ error: msg, keys });

    // Weekdays after the date filter a range ("Oct 12-25 Mon Wed Fri") or check a single date ("10/7 Tue").
    const dows = new Set();
    rest = rest.replace(new RegExp("\\b(?:" + WEEKDAY + "|(weekdays)|(weekends))\\b\\.?", "gi"), (m, w, wd, we) => {
      if (wd) [1, 2, 3, 4, 5].forEach((d) => dows.add(d));
      else if (we) [0, 6].forEach((d) => dows.add(d));
      else dows.add(dowIndex(w));
      return " ".repeat(m.length);
    });
    const mismatch = (k, d) => `${prettyDate(k)} is a ${DOW_NAMES[weekday(k)]}, not a ${DOW_NAMES[d]}. Check the date.`;
    if (leadDow != null && weekday(keys[0]) !== leadDow) return fail(mismatch(keys[0], leadDow));
    if (dows.size) {
      const kept = keys.filter((k) => dows.has(weekday(k)));
      if (!kept.length) return fail(keys.length === 1 ? mismatch(keys[0], [...dows][0]) : "None of those dates fall on the days you listed.");
      keys = kept;
    }

    const times = readTimes(rest);
    if (times && times.error) return fail(times.error);
    if (times) {
      if (times.others.length) return fail("Put each shift on its own line.");
      // A status word between the date and the times ("10/7 open 2300-0700") contradicts them.
      // After the times it's part of the site name ("2300-0700 Open Gate Plaza").
      for (const t of tokens(rest.slice(0, times.index))) {
        const st = statusOf(t.w);
        if (st && st !== "work") return fail(`Times mean you're working. To mark this day ${st === "busy" ? "off" : st}, leave out the times.`);
        if (st === "work") cut(t.index, t.length);
      }
      cut(times.index, times.length);
    }
    if (/(?:^|\s)\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?=\s|$|[,.;])/.test(rest) || new RegExp("\\b" + MONTH + "\\s*\\d{1,2}\\b", "i").test(rest)) {
      return fail("Put each date (or date range) at the start of its own line.");
    }

    // Paid hours: "8h", "7.5hrs", or "8 hours" at the end. Not "24 Hour Fitness".
    let hours = null;
    const hre = /(^|[^\d.:])(\d{1,2}(?:\.\d+)?)(\s*)(?:h|hr|hrs|hour|hours)\b\.?/gi;
    for (let m; (m = hre.exec(rest));) {
      const after = rest.slice(m.index + m[0].length);
      if (m[3] && !/^\s*(?:$|[).,;\]])/.test(after)) continue;
      hours = +m[2];
      if (!(hours > 0 && hours <= 24)) return fail("Paid hours must be between 0 and 24.");
      cut(m.index + m[1].length, m[0].length - m[1].length);
      break;
    }

    // Status: times mean working; otherwise one status word.
    const toks = tokens(rest);
    const negated = (i) => [toks[i - 1], toks[i - 2]].some((t) => t && NEGATIONS.test(t.w));
    let status = null;
    if (times) {
      status = "work";
    } else {
      let pick = toks[0] && statusOf(toks[0].w) ? 0 : -1;
      if (pick < 0) {
        const found = toks.map((t, i) => ({ i, st: statusOf(t.w) })).filter((x) => x.st);
        if (new Set(found.map((x) => x.st)).size > 1) return fail("Use just one of these words: open, off, work or clear.");
        if (found.length) pick = found[0].i;
      }
      if (pick >= 0) {
        if (negated(pick)) return fail(`"${toks[pick - 1].raw} ${toks[pick].raw}" is unclear. Use off for days you can't work.`);
        status = statusOf(toks[pick].w);
        cut(toks[pick].index, toks[pick].length);
      } else if (hours != null) {
        status = "work";
      }
      if (!status) {
        if (/\d{3,4}|\d:\d{2}|\d\s*[ap]\.?m\b/i.test(rest)) return fail("I couldn't read the times. Write them like 2300-0700 or 11pm-7am.");
        return fail("Add work times (2300-0700) or one word: open, off, work or clear.");
      }
      if (hours != null && status !== "work") return fail("Paid hours only go with working days.");
    }

    let willing = null;
    if (status === "open") {
      for (const [re, key] of SHIFT_WORDS) {
        const m = re.exec(rest);
        if (m) { willing = willing || []; if (!willing.includes(key)) willing.push(key); cut(m.index, m[0].length); }
      }
    }
    const note = rest
      .replace(/\(\s*\)|\[\s*\]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—,;:|•/&+]+|[\s\-–—,;:|•/&+]+$/g, "")
      .slice(0, 100);

    const rec = { s: status };
    let warn = "";
    if (status === "work") {
      if (times) { rec.start = times.start; rec.end = times.end; }
      const span = times ? spanHours(times.start, times.end) : null;
      rec.hours = hours != null ? hours : span; // null: use the usual shift length
      if (span != null && hours != null && Math.abs(span - hours) > 1.5) warn = `Paid hours (${hours}) are far from the shift length (${span}). Check them.`;
      if (note) rec.note = note;
    } else if (status === "busy") {
      if (note) rec.note = note;
    } else if (status === "open") {
      if (willing) rec.w = ["overnight", "swing", "morning"].filter((k) => willing.includes(k));
    }
    const ignored = (status === "open" || status === "clear") && note ? note : "";
    return { keys, groups: dates.groups, rec, ignored, warn, filtered: keys.length !== dates.keys.length };
  }

  /** Parse pasted schedule text. `today` is "YYYY-MM-DD". Later lines win over earlier ones. */
  function parse(text, today) {
    const items = [], errors = [];
    String(text || "").split(/\r\n|\r|\n/).forEach((line, i) => {
      for (const part of line.split(";")) {
        const r = parseLine(part, today);
        if (!r) continue;
        if (r.error) errors.push({ line: i + 1, text: part.trim(), msg: r.error, keys: r.keys || [] });
        else items.push(Object.assign({ line: i + 1, text: part.trim() }, r));
      }
    });
    return { items, errors };
  }

  const api = { parse, parseLine, spanHours };
  root.ScheduleParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
