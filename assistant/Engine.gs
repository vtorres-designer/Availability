// Shift Assistant: the decision rules. Plain JavaScript with no Google services, so it can be tested on its own.
// decide() takes what Gemini read from a text plus the calendar, and returns what to do: ignore it,
// alert Vincent, or draft a reply for him to approve.

var ENGINE = (function () {
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_MIN = 1440;
  var TWELVE = 12 * 60;
  var PAIR_GAP = 30; // minutes allowed between a weekend swing and the overnight it pairs with
  var LATE_NIGHT_END = "05:00"; // "tonight" sent from midnight until this time is unclear

  // ---------- dates and times ----------
  function dayNum(k) { var p = k.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function keyOf(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function addDays(k, n) { return keyOf(dayNum(k) + n); }
  function dowOf(k) { return new Date(dayNum(k) * 864e5).getUTCDay(); }
  function isKey(k) { return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k); }
  function isTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function mins(t) { var p = t.split(":"); return +p[0] * 60 + +p[1]; }
  function mil(t) { return t.replace(":", ""); } // 23:00 -> 2300, the way he and his supervisors write times

  // A shift as absolute minutes. A shift that ends at or before its start runs past midnight.
  function span(date, start, end) {
    var s = dayNum(date) * DAY_MIN + mins(start);
    var e = dayNum(date) * DAY_MIN + mins(end);
    if (e <= s) e += DAY_MIN;
    return { s: s, e: e };
  }
  function crossesMidnight(start, end) { return mins(end) <= mins(start); }
  function hours(sp) { return Math.round((sp.e - sp.s) / 6) / 10; }

  // How a date reads in a reply, seen from when the text arrived.
  function whenWords(date, now, night) {
    var diff = dayNum(date) - dayNum(now.date);
    if (diff === 0) return night ? "tonight" : "today";
    if (diff === 1) return night ? "tomorrow night" : "tomorrow";
    var p = date.split("-");
    return DOW[dowOf(date)] + " " + +p[1] + "/" + +p[2] + (night ? " night" : "");
  }

  // ---------- calendar ----------
  // cal: {pub: data.json, priv: the private calendar or null, booked: [{date, start, end}] shifts he accepted here}
  // A day's record the way the website reads it: what's marked on that day, or else its every-week setting.
  function privRec(cal, k) {
    var v = cal.priv;
    if (!v) return null;
    if (v.days && v.days[k]) return v.days[k];
    var d = dowOf(k);
    var list = v.weekly || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.d === d && !(r.from && k < r.from)) return r;
    }
    return null;
  }
  // "busy", "work", "open", "gray", plus the public color for overtime.
  function dayState(cal, k) {
    var pub = cal.pub && cal.pub.days ? cal.pub.days[k] : null;
    var ot = pub && (pub.s === "ot" || pub.s === "pot") ? pub.s : null;
    var rec = privRec(cal, k);
    if (rec) {
      if (rec.s === "work") return { s: "work", rec: rec, ot: ot };
      if (rec.s === "busy" || (rec.w && rec.w.length === 0)) return { s: "busy", ot: ot };
      return { s: "open", ot: ot };
    }
    if (cal.priv) return { s: "gray", ot: ot };
    if (!pub) return { s: "gray", ot: null };
    return { s: pub.s === "busy" ? "busy" : "open", ot: ot };
  }
  // His shifts near a date, as spans. Unknown times are reported so the rules can hand the call to him.
  function shiftsNear(cal, date) {
    var out = [], unknown = [];
    for (var i = -1; i <= 1; i++) {
      var k = addDays(date, i);
      var rec = privRec(cal, k);
      if (rec && rec.s === "work") {
        if (isTime(rec.start) && isTime(rec.end)) out.push({ date: k, start: rec.start, end: rec.end, sp: span(k, rec.start, rec.end), from: "work" });
        else unknown.push(k);
      }
    }
    (cal.booked || []).forEach(function (b) {
      if (isKey(b.date) && isTime(b.start) && isTime(b.end) && Math.abs(dayNum(b.date) - dayNum(date)) <= 1)
        out.push({ date: b.date, start: b.start, end: b.end, sp: span(b.date, b.start, b.end), from: "booked" });
    });
    return { list: out, unknown: unknown };
  }
  // Minutes worked on each calendar day (0000-2359) that the spans touch.
  function perDay(spans) {
    var days = {};
    spans.forEach(function (sp) {
      for (var d = Math.floor(sp.s / DAY_MIN); d * DAY_MIN < sp.e; d++) {
        var a = Math.max(sp.s, d * DAY_MIN), b = Math.min(sp.e, (d + 1) * DAY_MIN);
        if (b > a) days[d] = (days[d] || 0) + (b - a);
      }
    });
    return days;
  }
  function dayHoursText(days) {
    return Object.keys(days).sort().map(function (d) { return DOW[dowOf(keyOf(+d))] + " " + Math.round(days[d] / 6) / 10; }).join(" · ");
  }

  // ---------- sites ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|building|bldg|tower|st|street|ave|avenue|denver|co)\b/g, " ").replace(/\s+/g, " ").trim(); }
  function streetOf(s) { var m = String(s || "").toLowerCase().match(/\b(\d{2,6})\s+([a-z0-9]+)/); return m ? m[1] + " " + m[2] : ""; }
  // The site in his list that this offer is for, or null.
  function findSite(sites, offer) {
    var names = [offer.matchedSite, offer.siteName].filter(Boolean).map(norm).filter(Boolean);
    var street = streetOf(offer.address) || streetOf(offer.siteName);
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      var keys = [s.name].concat(s.aliases || []).map(norm).filter(Boolean);
      if (names.some(function (n) { return keys.indexOf(n) >= 0; })) return s;
      if (street && streetOf(s.address) === street) return s;
    }
    return null;
  }

  // ---------- replies ----------
  function siteLabel(o, site) { return site ? site.name : o.siteName || "that shift"; }
  function yesReply(o, site, now) {
    var night = crossesMidnight(o.start, o.end);
    return "Yes, I can take " + siteLabel(o, site) + " " + whenWords(o.date, now, night) + " " + mil(o.start) + "-" + mil(o.end) + ". Thanks!";
  }
  function noReply(when) { return "Thanks for thinking of me, but I'm not available " + when + "."; }

  var RANK = { top: 9, urgent: 8, special: 7, alert: 6, accept: 5, ask: 4, network: 3, question: 3, decline: 2, ignore: 0 };
  var PRIORITY = { top: 5, urgent: 5, special: 4, alert: 4, accept: 4, ask: 3, network: 3, question: 3, decline: 3 };
  var LEVEL_NAME = { top: "Top priority", urgent: "Urgent", special: "New site", alert: "Your call", accept: "Training", ask: "Needs details", network: "Network", question: "Question", decline: "Decline", ignore: "Ignored" };

  // ---------- one offer ----------
  // Runs the numbered rules on one shift. Returns {level, path, reply, facts, offer}.
  function judgeOffer(o, ctx, training, overtimeSaid) {
    var path = [], cal = ctx.cal, now = ctx.now;
    var site = findSite(ctx.sites, o);
    if (training && !(isTime(o.start) && isTime(o.end))) return judgeTrainingDay(o, ctx, site);
    var night = crossesMidnight(o.start, o.end);
    var sp = span(o.date, o.start, o.end);
    var when = whenWords(o.date, now, night);
    var st = dayState(cal, o.date);
    var near = shiftsNear(cal, o.date);
    var info = { site: site ? site.name + " (known)" : (o.siteName || "Not named") + (o.siteName ? " (new)" : ""), date: DOW[dowOf(o.date)] + " " + o.date, time: mil(o.start) + "-" + mil(o.end) + " (" + hours(sp) + " hrs" + (night ? ", night" : "") + ")" };
    var out = function (level, reply) { return { level: level, path: path, reply: reply, info: info, offer: o, site: site, newSite: !site && o.siteName ? o.siteName : null }; };

    path.push(["ok", "Date and time clear"]);

    // 2 and 3 share the busy check; training only needs the day free and the hours legal.
    if (st.s === "busy") { path.push(["no", DOW[dowOf(o.date)] + " is busy"]); return out("decline", noReply(when)); }
    path.push(["ok", DOW[dowOf(o.date)] + (st.s === "work" ? " is a work day (checking hours)" : st.s === "gray" ? " is not set" : " is free")]);

    // 4: overlap, and 12 hours per calendar day.
    if (near.unknown.length) {
      path.push(["no", "Your shift on " + near.unknown.join(", ") + " has no times, so I can't check overlap or the 12-hour rule"]);
      return out("alert", yesReply(o, site, now));
    }
    var clash = near.list.filter(function (x) { return x.sp.s < sp.e && sp.s < x.sp.e; })[0];
    if (clash) { path.push(["no", "Overlaps your " + mil(clash.start) + "-" + mil(clash.end) + " shift on " + DOW[dowOf(clash.date)]]); return out("decline", noReply(when)); }
    var days = perDay(near.list.map(function (x) { return x.sp; }).concat([sp]));
    info.hoursByDay = dayHoursText(days);
    var over = Object.keys(days).filter(function (d) { return days[d] > TWELVE && Math.floor(sp.s / DAY_MIN) <= +d && +d * DAY_MIN < sp.e; })[0];
    if (over) { path.push(["no", DOW[dowOf(keyOf(+over))] + " would be " + Math.round(days[over] / 6) / 10 + " hrs (max 12)"]); return out("decline", noReply(when)); }
    path.push(["ok", "No overlap; no day over 12 hrs"]);

    if (training) { path.push(["end", "Training request → accept"]); return out("accept", null); }

    // 5: a site he doesn't know yet is a chance to meet a new supervisor, whatever the shift.
    if (!site) { path.push(["end", (o.siteName ? o.siteName + " is" : "Site is") + " not in My Sites → special request"]); return out("special", yesReply(o, site, now)); }
    path.push(["ok", "Known site"]);

    // 6: a Fri-Sun swing that meets an overnight (his, or one offered in the same text).
    var pair = pairFor(o, sp, night, near.list.concat(ctx.otherOffers || []));
    if (pair) { path.push(["end", "Fri–Sun swing paired with " + pair + " → top priority"]); return out("top", yesReply(o, site, now)); }

    // 7: day not set.
    if (st.s === "gray") { path.push(["end", "Day not set on your calendar → your call"]); return out("alert", yesReply(o, site, now)); }

    // 8: overtime, whatever the shift type.
    if (st.ot || overtimeSaid) {
      path.push(["end", (overtimeSaid ? "They say it's overtime" : "Your calendar shows " + (st.ot === "pot" ? "partial overtime" : "overtime")) + " → your call"]);
      return out("alert", yesReply(o, site, now));
    }
    path.push(["ok", "Not overtime"]);

    // 9 and 10.
    if (!night) { path.push(["no", "Not a night shift (doesn't run through midnight)"]); return out("decline", noReply(when)); }
    path.push(["ok", "Night shift"]);
    path.push(["end", "Open night shift → urgent"]);
    return out("urgent", yesReply(o, site, now));
  }

  // A training visit with no hours yet: only the day itself can be checked.
  function judgeTrainingDay(o, ctx, site) {
    var path = [], st = dayState(ctx.cal, o.date), name = DOW[dowOf(o.date)];
    var info = { site: site ? site.name + " (known)" : o.siteName || "Not named", date: name + " " + o.date, time: "Not given" };
    var res = function (level) { return { level: level, path: path, reply: null, info: info, offer: o, site: site, newSite: null }; };
    if (st.s === "busy") { path.push(["no", name + " is busy"]); return res("decline"); }
    path.push(["ok", name + (st.s === "work" ? " is a work day; no hours given, so check them when they reply" : " is free")]);
    return res("accept");
  }

  // Describes the overnight a weekend swing pairs with, or null.
  function pairFor(o, sp, night, others) {
    for (var i = 0; i < others.length; i++) {
      var x = others[i];
      if (!x || !isTime(x.start) || !isTime(x.end) || !isKey(x.date)) continue;
      var xsp = x.sp || span(x.date, x.start, x.end);
      var xNight = crossesMidnight(x.start, x.end);
      var swing = null, ov = null;
      if (!night && xNight && xsp.s >= sp.e && xsp.s - sp.e <= PAIR_GAP) { swing = o; ov = x; }
      else if (night && !xNight && sp.s >= xsp.e && sp.s - xsp.e <= PAIR_GAP) { swing = x; ov = o; }
      if (!swing) continue;
      var d = dowOf(ov.date);
      if (d === 5 || d === 6 || d === 0)
        return (x.from === "work" ? "your " : x.from === "booked" ? "the shift you took, " : "the ") + (ov === x ? "overnight " + mil(x.start) + "-" + mil(x.end) : "swing " + mil(x.start) + "-" + mil(x.end));
    }
    return null;
  }

  // ---------- the whole text ----------
  // ctx: {now:{date,time}, sender:{name, allied, role}, facts (from Gemini), cal, sites}
  function decide(ctx) {
    var f = ctx.facts || {}, now = ctx.now, s = ctx.sender || {};
    var path = [];
    var res = function (level, extra) {
      var r = { level: level, label: LEVEL_NAME[level], priority: PRIORITY[level] || 0, path: path, reply: null, needs: null, info: {}, offers: [] };
      for (var k in extra) r[k] = extra[k];
      return r;
    };

    // 0: who sent it.
    if (!s.allied) {
      if (f.kind === "offer" || f.kind === "availability_question" || f.kind === "working_question") path.push(["no", "Not in your Allied contacts, but it looks like a shift text"]);
      else { path.push(["no", "Not in your Allied contacts"]); return res("ignore"); }
    } else path.push(["ok", "Allied contact"]);

    if (f.kind === "guard_cover_request") { path.push(["end", "A guard asking you to cover their shift → ignore (has to go through management)"]); return res("ignore"); }
    if (f.kind === "withdrawal_only") { path.push(["end", "They withdrew an earlier offer → nothing to reply"]); return res("ignore", { withdraws: true }); }
    if (f.kind === "other" || !f.kind) { path.push(["end", "Not about a shift → ignore"]); return res("ignore"); }

    var lateNight = now.time < LATE_NIGHT_END && !!f.usesTonightOrToday;

    // Questions without a shift: "Are you available tonight?" / "Are you working tonight already?"
    if (f.kind === "availability_question" || f.kind === "working_question" || f.kind === "guard_team_short") {
      var qd = f.questionDate;
      if (lateNight || !isKey(qd)) {
        path.push(["no", lateNight ? "“Tonight” sent after midnight" : "No date given"]);
        path.push(["end", "Ask which night"]);
        return unknownSender(res("ask", { needs: { missing: ["date"], lateNight: lateNight }, reply: lateNight ? "Just to confirm, do you mean tonight, " + DOW[dowOf(now.date)] + " " + +now.date.split("-")[1] + "/" + +now.date.split("-")[2] + "?" : "Which night do you mean?" }), s);
      }
      var st = dayState(ctx.cal, qd), when = whenWords(qd, now, true);
      var info = { date: DOW[dowOf(qd)] + " " + qd, calendar: st.s === "work" ? "Working" : st.s === "busy" ? "Busy" : st.s === "gray" ? "Not set" : "Free" + (st.ot ? " (overtime)" : "") };
      if (f.kind === "guard_team_short") {
        // Callouts don't outrank his calendar: only ask around when he'd actually take the night.
        path[0] = ["ok", "Allied contact (guard)"];
        if (st.s !== "open" && st.s !== "gray") { path.push(["no", "You're not free " + when]); path.push(["end", "Team short, but you're not available → ignore"]); return res("ignore", { info: info }); }
        path.push(["ok", "You're free " + when]);
        path.push(["end", "Team short → ask who the supervisor is"]);
        var where = f.offers && f.offers[0] && f.offers[0].siteName ? " over " + f.offers[0].siteName : "";
        return res("network", { info: info, reply: "Thanks for the heads up! Who's the supervisor" + where + "? I might be able to help." });
      }
      if (f.kind === "working_question" && st.s === "work") { path.push(["end", "You're working " + when]); return unknownSender(res("question", { info: info, reply: "Yes, I'm working " + when + "." }), s); }
      if (st.s === "busy") { path.push(["no", "You're busy " + when]); path.push(["end", "Decline"]); return unknownSender(res("decline", { info: info, reply: noReply(when) }), s); }
      if (st.s === "work") { path.push(["no", "You're working " + when]); path.push(["end", "Decline"]); return unknownSender(res("decline", { info: info, reply: noReply(when) }), s); }
      path.push(["ok", st.s === "gray" ? "Day not set (treated as free)" : "You're free " + when]);
      path.push(["end", "Ask for the site and time"]);
      var lead = f.kind === "working_question" ? "No, I'm free " : "I'm free ";
      return unknownSender(res(st.s === "gray" ? "alert" : "question", { info: info, reply: lead + when + ". What's the site and time?" }), s);
    }

    // Shift offers (one text can hold several, or a training visit plus a shift).
    var offers = (f.offers || []).filter(Boolean);
    if (!offers.length) { path.push(["end", "Couldn't find a shift in it → your call"]); return res("alert"); }
    path[0] = [path[0][0], path[0][1] + (s.allied ? ", shift offer" : "")];

    // 1: anything missing, or "tonight" after midnight, gets a question instead of a guess.
    var missing = [];
    offers.forEach(function (o) {
      if (!isKey(o.date) && missing.indexOf("date") < 0) missing.push("date");
      if (!f.training) {
        if (!isTime(o.start) && missing.indexOf("start time") < 0) missing.push("start time");
        if (!isTime(o.end) && missing.indexOf("end time") < 0) missing.push("end time");
      }
    });
    // A known busy day doesn't need details first: the answer is no either way.
    var busyDay = offers.filter(function (o) { return isKey(o.date) && dayState(ctx.cal, o.date).s === "busy"; })[0];
    if ((missing.length || lateNight) && busyDay && !lateNight) {
      path.push(["no", DOW[dowOf(busyDay.date)] + " is busy"]);
      path.push(["end", "Decline (no need to ask for details)"]);
      return unknownSender(res("decline", { reply: noReply(whenWords(busyDay.date, now, true)) }), s);
    }
    if (lateNight || missing.length) {
      path.push(["no", lateNight ? "“Tonight” sent after midnight" : "Missing: " + missing.join(", ")]);
      path.push(["end", lateNight ? "Ask for the date" : "Ask for the " + missing.join(" and ")]);
      var o0 = offers[0];
      var fallback = lateNight
        ? "No problem! Just to confirm, do you mean tonight, " + DOW[dowOf(now.date)] + " " + +now.date.split("-")[1] + "/" + +now.date.split("-")[2] + "?"
        : "Possibly! What " + (missing.length === 1 && missing[0] === "date" ? "day is it" : "are the " + (missing.indexOf("date") >= 0 ? "date and hours" : "hours")) + (o0.siteName ? " for " + o0.siteName : "") + "?";
      return unknownSender(res("ask", { needs: { missing: missing, lateNight: lateNight }, reply: fallback }), s);
    }

    // Each shift through rules 2-10; a training visit counts as one request.
    var judged = offers.map(function (o, i) {
      var others = offers.filter(function (x, j) { return j !== i; });
      return judgeOffer(o, { cal: ctx.cal, now: now, sites: ctx.sites || [], otherOffers: others }, !!f.training, !!f.overtimeMentioned);
    });
    if (f.training) {
      var bad = judged.filter(function (j) { return j.level === "decline"; })[0];
      if (bad) { path = path.concat(bad.path); path.push(["end", "Training, but the hours don't work → decline"]); return unknownSender(res("decline", { reply: "Thanks for asking! Unfortunately I can't make those hours work.", info: bad.info, offers: judged }), s); }
      var unclear = judged.filter(function (j) { return j.level !== "accept"; })[0];
      if (unclear) { path = path.concat(unclear.path); return unknownSender(res(unclear.level, { reply: unclear.reply, info: unclear.info, offers: judged }), s); }
      path.push(["ok", "Training request"]);
      path = path.concat(judged[0].path.filter(function (p) { return p[1] !== "Date and time clear"; }));
      var noSite = offers.some(function (o) { return !o.siteName; });
      return unknownSender(res("accept", { info: judged[0].info, offers: judged, reply: "Yes, I'd be glad to!" + (noSite ? " Which site, and what time should I be there?" : "") }), s);
    }
    var best = judged.slice().sort(function (a, b) { return RANK[b.level] - RANK[a.level]; })[0];
    path = path.concat(best.path);
    var r = res(best.level, { reply: best.reply, info: best.info, offers: judged, newSite: best.newSite });
    if (judged.length > 1) {
      r.info.offers = judged.length + " shifts in this text";
      // Several shifts: one reply that takes the good ones and turns down the rest.
      var yes = judged.filter(function (j) { return j.level !== "decline"; }), no = judged.filter(function (j) { return j.level === "decline"; });
      var list = function (js) { return js.map(function (j) { return siteLabel(j.offer, j.site) + " " + whenWords(j.offer.date, now, crossesMidnight(j.offer.start, j.offer.end)) + " " + mil(j.offer.start) + "-" + mil(j.offer.end); }).join(" and "); };
      if (yes.length && no.length) r.reply = "I can take " + list(yes) + ", but I'm not available for " + list(no) + ". Thanks!";
      else if (yes.length > 1) r.reply = "Yes, I can take both: " + list(yes) + ". Thanks!";
    }
    return unknownSender(r, s);
  }

  // A shift text from a number that isn't in his Allied contacts always comes to him first.
  function unknownSender(r, s) {
    if (s.allied || r.level === "ignore") return r;
    r.path.push(["end", "Unknown number → your call"]);
    r.level = "alert"; r.label = LEVEL_NAME.alert; r.priority = PRIORITY.alert;
    return r;
  }

  // The lock-screen alert for a decision.
  function alertText(r, ctx) {
    var name = (ctx.sender && ctx.sender.name) || "Unknown number";
    var o = r.offers && r.offers.length ? r.offers.slice().sort(function (a, b) { return RANK[b.level] - RANK[a.level]; })[0] : null;
    var where = o ? siteLabel(o.offer, o.site) + ", " + whenWords(o.offer.date, ctx.now, crossesMidnight(o.offer.start, o.offer.end)) + " " + mil(o.offer.start) + "-" + mil(o.offer.end) : "";
    var t = {
      top: "TOP PRIORITY: " + where,
      urgent: "Open night shift: " + where,
      special: "New site: " + where,
      alert: (name === "Unknown number" ? "Unknown number: " : name + ": ") + (where || "your call"),
      accept: "Training request from " + name + ": accept ready",
      ask: "Reply ready: " + name + " (asks for details)",
      network: "Lead from " + name + ": ask for the supervisor",
      question: "Reply ready: " + name,
      decline: "Decline ready: " + name,
    }[r.level] || "Shift Assistant";
    var last = r.path.length ? r.path[r.path.length - 1][1] : "";
    return { title: t, body: last + (r.reply ? "\nReply: " + r.reply : "") };
  }

  return { decide: decide, alertText: alertText, dayState: dayState, findSite: findSite, whenWords: whenWords, addDays: addDays, dowOf: dowOf, crossesMidnight: crossesMidnight, LEVEL_NAME: LEVEL_NAME };
})();

if (typeof module !== "undefined") module.exports = ENGINE;
