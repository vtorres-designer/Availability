/* Schedule parser: turns pasted lines like "10/7 2300-0700 Site B" into calendar entries.
   Pure functions, no DOM, so it can be tested on its own.
   Rule of thumb: when a line could mean two things, report it instead of guessing. */
(function (root) {
  "use strict";

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  // Day names, incl. plurals and short forms: Mon, Mondays, Tu, Tues, Weds, Th, Thurs, Sat...
  const DOW = "(sun(?:day)?s?|mon(?:day)?s?|tu(?:e(?:s(?:day)?)?)?s?|wed(?:s|nesday)?s?|th(?:u(?:r(?:s(?:day)?)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?)";
  const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const RANGE_SEP = "(?:-|–|—|to\\b|thru\\b|through\\b|until\\b|till?\\b)";
  // A 4-digit number after a date is a year unless it starts a time range ("Oct 7 2030-0630").
  const YEAR = "(?:,?\\s*(20\\d{2})(?!\\d)(?!\\s*" + RANGE_SEP + "\\s*(?:\\d{3,4}(?![\\d/.])|\\d{1,2}[:.]\\d{2}|\\d{1,2}\\s*[ap]\\.?m?\\b|\\d{1,2}(?![\\d/.:]))))?";
  const HOURS_WORD = "(?:h|hr|hrs|hour|hours)\\b";
  // A bare day may be followed by ':' or '.' only as punctuation ("Oct 12-16: off").
  const DAY_ONLY_GUARD = "(?![\\d]|[:.](?!\\s|$)|h\\b|\\s*(?:[ap]\\.?m?\\b|" + HOURS_WORD + "))";
  const STATUS_WORDS = [
    ["clear", /^(?:clear|reset|unset|gr[ae]y|blank|remove)$/i],
    ["busy", /^(?:off|busy|blocked|block|unavailable|unavail|n\/a|pto|vacation)$/i],
    ["open", /^(?:open|available|avail|free)$/i],
    ["work", /^(?:work|working|scheduled|shift)$/i],
  ];
  const SHIFT_WORDS = [
    [/\b(?:overnights?|nights?|graveyards?|graves?)\b/i, "overnight"],
    [/\b(?:swings?|evenings?)\b/i, "swing"],
    [/\b(?:mornings?)\b/i, "morning"],
  ];
  const NEGATION = /\b(?:not|no|never|except|but|without|excluding|minus|cannot|can'?t|won'?t|don'?t|isn'?t|unable)\b/i;
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
  function dowIndex(s) {
    const w = s.toLowerCase();
    if (w.startsWith("tu")) return 2;
    if (w.startsWith("th")) return 4;
    return ["sun", "mon", "", "wed", "", "fri", "sat"].indexOf(w.slice(0, 3));
  }
  const fullYear = (y) => (y < 100 ? 2000 + y : y);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const spanHours = (start, end) => { let m = toMin(end) - toMin(start); if (m <= 0) m += 1440; return m / 60; };
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const statusOf = (w) => { for (const [name, re] of STATUS_WORDS) if (re.test(w)) return name; return null; };
  const STATUS_FOLLOW = "(?:off|busy|blocked|unavailable|unavail|open|available|avail|free|work|working|scheduled|shift|clear|reset)\\b";

  // ---------- dates ----------
  // One date at `pos`: {y|null, m, d, end, dayOnly?} or null. `prev` allows a bare day number ("Oct 7-10").
  function readDate(s, pos, prev, allowDot) {
    let r;
    const at = (re) => { re.lastIndex = pos; return re.exec(s); };
    if ((r = at(/(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/y))) return { y: +r[1], m: +r[2], d: +r[3], end: pos + r[0].length };
    if ((r = at(/(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)/y))) return { y: +r[3], m: +r[1], d: +r[2], end: pos + r[0].length };
    if ((r = at(new RegExp("(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])", "y")))) {
      return { y: r[3] ? fullYear(+r[3]) : null, m: +r[1], d: +r[2], end: pos + r[0].length };
    }
    // 10.7 or 10.7.26, but never "7.5h" (paid hours).
    if ((r = at(new RegExp("(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?(?![\\d.])(?!\\s*" + HOURS_WORD + ")", "y"))) && (allowDot || r[3])) {
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

  // The year (anchor's year -1, +0 or +1) that puts the date nearest the anchor, inside [anchor-back, anchor+fwd] if possible.
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
  function yearOnOrAfter(m, d, after) {
    const ay = parts(after)[0];
    for (const y of [ay, ay + 1, ay + 2]) if (validDate(y, m, d) && keyOf(y, m, d) >= after) return y;
    return null;
  }
  function yearOnOrBefore(m, d, before) {
    const by = parts(before)[0];
    for (const y of [by, by - 1, by - 2]) if (validDate(y, m, d) && keyOf(y, m, d) <= before) return y;
    return null;
  }
  const badDate = (dt) => `${dt.m}/${dt.d}${dt.y ? "/" + dt.y : ""} isn't a real date.`;
  const dowMismatch = (k, d) => `${prettyDate(k)} is a ${DOW_NAMES[weekday(k)]}, not a ${DOW_NAMES[d]}. Check the date.`;

  // What may follow a bare day number for it to count as a date: end, punctuation, a separator,
  // a time, a status word or a day name. Anything else ("12 Oaks Mall") means it isn't a date.
  const BARE_FOLLOW = new RegExp("^(?:\\s*$|[:.](?:\\s|$)|\\s*(?:[,&+;]|and\\b|" + RANGE_SEP + "|\\d|" + DOW + "\\b|" + STATUS_FOLLOW + "))", "i");
  const BARE_FOLLOW_LIST = new RegExp("^(?:\\s*$|[:.](?:\\s|$)|\\s*(?:[,&+;]|and\\b|\\d|" + DOW + "\\b|" + STATUS_FOLLOW + "))", "i");

  // Dates at the start of `s`: single dates, ranges ("10/12-10/14", "Oct 12-16") and lists ("10/9, 10/10").
  function readDates(s, today) {
    const groups = [];
    let pos = 0, prev = null;
    for (;;) {
      const a = readDate(s, pos, groups.length ? prev : null, groups.length === 0);
      if (!a) {
        if (!groups.length) return { error: "Start the line with a date, like 10/7, Oct 7 or 2026-10-07." };
        break;
      }
      if (a.dayOnly && !BARE_FOLLOW_LIST.test(s.slice(a.end))) {
        return { error: `After a comma, write the next date in full (like ${prev.m}/${a.d}), or put the site after the times.` };
      }
      // Optional range end, which may carry its own day name ("Fri 10/9 - Sun 10/11").
      let b = null, bDow = null;
      const sep = new RegExp("(\\s*)" + RANGE_SEP + "(\\s*)", "iy");
      sep.lastIndex = a.end;
      const sm = sep.exec(s);
      if (sm) {
        let bpos = a.end + sm[0].length;
        const dm = new RegExp(DOW + "\\b\\.?,?\\s*", "iy");
        dm.lastIndex = bpos;
        const dmm = dm.exec(s);
        if (dmm && readDate(s, bpos + dmm[0].length, null, false)) { bDow = dowIndex(dmm[1]); bpos += dmm[0].length; }
        b = readDate(s, bpos, a, false);
        if (b && b.dayOnly) {
          const tight = !sm[1] && !sm[2] && /^[-–]$/.test(sm[0]);
          const after = s.slice(b.end);
          // "Oct 7 - 11-7am": the number starts a time range, not a date.
          const t = readTimes(s.slice(bpos));
          if (t && !t.error && t.index === 0) b = null;
          // "10/7 - 12 Oaks Mall": with spaces around the dash, a number followed by a word isn't a date.
          else if (!tight && !BARE_FOLLOW.test(after)) b = null;
        }
      }
      // Years. A range end with a year lends it to the start ("12/30 - 1/2/2027").
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
        if (ty == null) {
          // "10/9-10/8" is a typo, not a year-long range; "12/26-1/8" really does cross into the next year.
          if (!b.dayOnly && validDate(fy, b.m, b.d) && keyOf(fy, b.m, b.d) < from && between(keyOf(fy, b.m, b.d), from) <= 60) {
            return { error: "The range ends before it starts." };
          }
          ty = yearOnOrAfter(b.m, b.d, from);
        }
        if (ty == null || !validDate(ty, b.m, b.d)) return { error: badDate(b) };
        to = keyOf(ty, b.m, b.d);
        if (to < from) return { error: "The range ends before it starts." };
        if (bDow != null && weekday(to) !== bDow) return { error: dowMismatch(to, bDow) };
        pos = b.end;
      } else {
        pos = a.end;
      }
      groups.push({ from, to });
      const [py, pm, pd] = parts(to);
      prev = { key: to, y: py, m: pm, d: pd };
      const list = /\s*(?:,|&|\+|\band\b)\s*/iy;
      list.lastIndex = pos;
      const lm = list.exec(s);
      if (!lm) break;
      const peek = readDate(s, pos + lm[0].length, prev, false);
      if (!peek) break;
      // "10/8, 6-2pm": a number that starts a time range isn't the next date.
      const t = readTimes(s.slice(pos + lm[0].length));
      if (peek.dayOnly && t && !t.error && t.index === 0) break;
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
  // Captures: whole token, number part, a/p.
  const TIME = "((\\d{1,2}[:.]\\d{2}|\\d{3,4}|\\d{1,2})(?:\\s*([ap])\\.?(?:m\\.?)?(?![a-z]))?)";
  // The leading group stands in for a lookbehind, which older iPhones can't parse.
  const TIME_RANGE = new RegExp("(^|[^\\d.:/#])" + TIME + "(\\s*" + RANGE_SEP + "\\s*)" + TIME + "(?![\\d/:]|\\.\\d)", "i");
  const looksLikeTime = (tok, ap) => !!ap || /[:.]/.test(tok) || tok.length >= 3 || +tok >= 13 || (tok.length === 2 && tok[0] === "0");

  // Every candidate time range in `s` (overlapping ones too), best first. A candidate whose end is the
  // start of an equally good one ("Bldg 100 - 2300-0700") gives way to it.
  function timeCandidates(s) {
    const all = [];
    for (let from = 0; from < s.length;) {
      const r = TIME_RANGE.exec(s.slice(from));
      if (!r) break;
      const index = from + r.index + r[1].length;
      const length = r[0].length - r[1].length;
      const secondStart = index + r[2].length + r[5].length;
      const score = (looksLikeTime(r[3], r[4]) ? 1 : 0) + (looksLikeTime(r[7], r[8]) ? 1 : 0);
      all.push({ r, index, length, secondStart, score, tight: !/\s/.test(r[5]) });
      from = index + 1;
    }
    // Three numbers in a chain ("Bldg 100 - 2300-0700", "2300-0700 - 24 Hour Fitness"): the shift is the better
    // pair, or with equal scores the one written without spaces around the dash. Otherwise it's unclear.
    const drop = new Set();
    let unclear = false;
    for (const c of all) {
      const o = all.find((x) => x.index === c.secondStart);
      if (!o) continue;
      if (c.score !== o.score) drop.add(c.score < o.score ? c : o);
      else if (c.tight !== o.tight) drop.add(c.tight ? o : c);
      else unclear = true;
    }
    const keep = all.filter((c) => !drop.has(c)).sort((p, q) => q.score - p.score || p.index - q.index);
    keep.unclear = unclear;
    return keep;
  }

  // One time token: {min} if definite, {bare, bareMin} if it could be AM or PM, or {error}.
  function readTime(tok, ap) {
    let h, m;
    if (/[:.]/.test(tok)) [h, m] = tok.split(/[:.]/).map(Number);
    else if (tok.length >= 3) { h = Math.floor(+tok / 100); m = +tok % 100; }
    else { h = +tok; m = 0; }
    if (m > 59) return { error: true };
    if (ap) {
      if (h < 1 || h > 12) return { error: true };
      return { min: ((h % 12) + (ap.toLowerCase() === "p" ? 12 : 0)) * 60 + m };
    }
    const leadingZero = tok.length >= 2 && tok[0] === "0";
    if (h >= 13 || h === 0 || leadingZero || (tok.length === 4 && /^\d{4}$/.test(tok))) {
      if (h > 24 || (h === 24 && m > 0)) return { error: true };
      return { min: (h % 24) * 60 + m };
    }
    return { bare: h, bareMin: m };
  }

  function readTimes(s) {
    const cands = timeCandidates(s);
    if (!cands.length) return null;
    const { r, index, length } = cands[0];
    if (cands.unclear) return { index, length, others: [], error: "I can't tell which numbers are the shift times. Write the times like 2300-0700, then the site." };
    const others = cands.slice(1).filter((c) => c.index >= index + length || c.index + c.length <= index);
    const span = { index, length, others };
    const text = r[0].slice(r[1].length).trim();
    const a = readTime(r[3], r[4]);
    const b = readTime(r[7], r[8]);
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

  // ---------- day-name filter right after the dates: "Mon Wed Fri", "Mon-Fri", "weekdays" ----------
  function readDowFilter(rest) {
    const set = new Set();
    const item = new RegExp("\\s*(?:" + DOW + "(?:\\s*" + RANGE_SEP + "\\s*" + DOW + ")?|(weekdays?)|(weekends?)|(daily|every\\s*day|all\\s*week))\\b\\.?", "iy");
    const joiner = /\s*(?:,|&|\+|\/|\band\b)?/iy;
    let pos = 0, found = false;
    for (;;) {
      item.lastIndex = pos;
      const m = item.exec(rest);
      if (!m) break;
      found = true;
      if (m[3]) [1, 2, 3, 4, 5].forEach((d) => set.add(d));
      else if (m[4]) [0, 6].forEach((d) => set.add(d));
      else if (m[5]) [0, 1, 2, 3, 4, 5, 6].forEach((d) => set.add(d));
      else if (m[2]) { // a span wraps across the week: Fri-Mon = Fri Sat Sun Mon
        for (let d = dowIndex(m[1]), n = 0; n < 7; d = (d + 1) % 7, n++) { set.add(d); if (d === dowIndex(m[2])) break; }
      } else set.add(dowIndex(m[1]));
      pos = m.index + m[0].length;
      joiner.lastIndex = pos;
      const j = joiner.exec(rest);
      pos = j ? j.index + j[0].length : pos;
    }
    if (!found) return null;
    // "Sun Valley Mall" is a site, not a day filter: a filter is followed by times, a status word or nothing.
    const follow = new RegExp("^\\s*(?:$|[,.;:)]|\\d|" + STATUS_FOLLOW + "|(?:overnights?|nights?|swings?|evenings?|mornings?|graveyards?)\\b)", "i");
    return follow.test(rest.slice(pos)) ? { set, length: pos } : null;
  }

  function tokens(s) {
    const out = [];
    const re = /\S+/g;
    for (let m; (m = re.exec(s));) {
      const w = m[0].replace(/[’`]/g, "'").replace(/^[^\w']+|[^\w'/]+$/g, "").toLowerCase();
      out.push({ raw: m[0], w, index: m.index, length: m[0].length });
    }
    return out;
  }

  // ---------- one line ----------
  function parseLine(raw, today) {
    let s = String(raw).replace(/[‐‑‒−]/g, "-").replace(/\s+/g, " ").trim();
    if (!s) return null;

    // A day name before the date ("Tue 10/7", "Tuesday, October 7") is checked against it.
    let leadDow = null;
    const lw = new RegExp("^" + DOW + "\\b\\.?,?\\s*", "i").exec(s);
    if (lw && readDate(s, lw[0].length, null, true)) { leadDow = dowIndex(lw[1]); s = s.slice(lw[0].length); }

    const dates = readDates(s, today);
    if (dates.error) return { error: dates.error };
    let keys = dates.keys;
    let rest = " " + dates.rest + " ";
    const cut = (index, length) => { rest = rest.slice(0, index) + " ".repeat(length) + rest.slice(index + length); };
    const fail = (msg) => ({ error: msg, keys });
    const warnings = [];

    if (leadDow != null && weekday(keys[0]) !== leadDow) return fail(dowMismatch(keys[0], leadDow));
    if (/^\s*(?:[MTWRFSU]|TH|TU|SA|SU){2,5}\b(?!['’])/.test(rest)) {
      return fail("Write day names like Mon Wed Fri, not letters.");
    }
    // Day names straight after the dates pick days from them, or confirm a single date.
    const filter = readDowFilter(rest);
    if (filter) {
      const kept = keys.filter((k) => filter.set.has(weekday(k)));
      if (!kept.length) return fail(keys.length === 1 ? dowMismatch(keys[0], [...filter.set][0]) : "None of those dates fall on the days you listed.");
      keys = kept;
      cut(0, filter.length);
    }
    if (new RegExp(NEGATION.source + "\\W+(?:the\\s+)?" + DOW + "\\b", "i").test(rest)) {
      return fail("I can't read exceptions like \"except Sat\". List the days you mean instead, like Mon-Fri.");
    }

    const times = readTimes(rest);
    if (times && times.error) return fail(times.error);
    if (times) {
      if (times.others.length) return fail("This line has two shifts. Put each date's shift on its own line, or write one shift with its total hours (like 10/7 work 16h).");
      // A status word between the date and the times ("10/7 open 2300-0700") contradicts them.
      for (const t of tokens(rest.slice(0, times.index))) {
        const st = statusOf(t.w);
        if (st && st !== "work") return fail(`"${t.raw}" before the times reads as ${st === "busy" ? "off" : st}, but times mean working. If it's part of the site name, put the site after the times.`);
        if (st === "work") cut(t.index, t.length);
      }
      cut(times.index, times.length);
    }
    if (/(?:^|\s)\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?=\s|$|[,.;:])/.test(rest) || new RegExp("\\b" + MONTH + "\\s*\\d{1,2}\\b", "i").test(rest)) {
      return fail("Put each date (or date range) at the start of its own line.");
    }

    // Paid hours: "8h", "7.5 hrs", "(8.00 hrs)" at the end of the line or before punctuation. Not "24 Hour Fitness".
    let hours = null, rejectedHours = "";
    // A lone "h" counts only in lowercase, so "Unit 4H" stays a site name.
    const hre = /(^|[^\d.:\w])(\d{1,2}(?:\.\d+)?)(\s*)(?:h(?![a-zA-Z])|[Hh][Rr][Ss]?\b|[Hh]ours?\b)\.?/g;
    for (let m; (m = hre.exec(rest));) {
      const after = rest.slice(m.index + m[0].length);
      if (!/^\s*(?:$|[).,;\]]|(?:work|working|shift|scheduled)\b)/i.test(after)) {
        if (!m[3]) { rejectedHours = m[0].slice(m[1].length).trim(); warnings.push(`"${rejectedHours}" wasn't used as paid hours. Put the hours at the end of the line.`); }
        continue;
      }
      hours = +m[2];
      if (!(hours > 0 && hours <= 24)) return fail("Paid hours must be between 0 and 24.");
      cut(m.index + m[1].length, m[0].length - m[1].length);
      break;
    }

    // Status: times mean working. Otherwise every status word on the line has to agree.
    let status = null;
    if (times) {
      status = "work";
    } else {
      if (NEGATION.test(rest)) return fail("I can't read \"not\", \"no\" or \"except\". Say what the day is (open, off, work or clear), and list only the shifts you'd take.");
      const toks = tokens(rest);
      const found = toks.map((t) => ({ t, st: statusOf(t.w) })).filter((x) => x.st);
      if (new Set(found.map((x) => x.st)).size > 1) return fail(`"${found.map((x) => x.t.raw).join(" ")}" disagree. Use just one of: open, off, work or clear.`);
      if (found.length) { status = found[0].st; for (const x of found) cut(x.t.index, x.t.length); }
      else if (hours != null) status = "work";
      if (!status) {
        if (/\d{3,4}|\d[:.]\d{2}|\d\s*[ap]\.?m\b/i.test(rest)) return fail("I couldn't read the times. Write them like 2300-0700 or 11pm-7am.");
        return fail("Add work times (2300-0700) or one word: open, off, work or clear.");
      }
      if ((hours != null || rejectedHours) && status !== "work") return fail("Paid hours only go with working days.");
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
    if (dates.keys.length > 1 && new RegExp("\\b" + DOW + "\\b", "i").test(note)) {
      warnings.push("Day names later in the line don't pick days. To pick days, put them right after the dates.");
    }

    const rec = { s: status };
    if (status === "work") {
      if (times) { rec.start = times.start; rec.end = times.end; }
      const span = times ? spanHours(times.start, times.end) : null;
      rec.hours = hours != null ? hours : span; // null: use the usual shift length
      if (span != null && hours != null && Math.abs(span - hours) > 1.5) warnings.push(`Paid hours (${hours}) are far from the shift length (${span}). Check them.`);
      if (span == null && hours != null && (hours < 3 || hours > 16)) warnings.push(`${hours} paid hours looks unusual. Check it.`);
      if (note) rec.note = note;
    } else if (status === "busy") {
      if (note) rec.note = note;
    } else if (status === "open") {
      if (willing) rec.w = ["overnight", "swing", "morning"].filter((k) => willing.includes(k));
    }
    const ignored = (status === "open" || status === "clear") && note ? note : "";
    return { keys, groups: dates.groups, rec, ignored, warn: warnings.join(" "), filtered: keys.length !== dates.keys.length };
  }

  // ';' separates entries only when a date follows it, so "Site B; gate code 4471" stays one note.
  function splitEntries(line) {
    const out = [];
    for (const part of line.split(";")) {
      const t = part.trim();
      const startsWithDate = t && (readDate(t, 0, null, true) || new RegExp("^" + DOW + "\\b\\.?,?\\s*\\d", "i").test(t) || new RegExp("^" + DOW + "\\b\\.?,?\\s*" + MONTH, "i").test(t));
      if (out.length && !startsWithDate) out[out.length - 1] += ";" + part;
      else out.push(part);
    }
    return out;
  }

  /** Parse pasted schedule text. `today` is "YYYY-MM-DD". Later lines win over earlier ones. */
  function parse(text, today) {
    const items = [], errors = [];
    String(text || "").split(/\r\n|\r|\n/).forEach((line, i) => {
      for (const part of splitEntries(line)) {
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
