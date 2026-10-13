// Shift Assistant: the Google side. Your iPhone Shortcut sends each Allied text here. This script reads it with
// Gemini, checks your calendar and runs the rules in Engine.gs. It logs everything in this sheet, sends the alert
// to your phone, and serves the review page where you approve replies.

var TZ = "America/Denver";
var LOG = "Log", SITES = "My Sites", PEOPLE = "People", SETTINGS = "Settings";
var LOG_HEAD = ["ID", "Received", "From", "Phone", "Allied", "Their text", "What Gemini read", "Decision", "Why", "Suggested reply", "Actual reply", "Action", "Action time", "Edited?", "Outcome", "Your notes", "Seconds", "Error", "Token", "Detail"];
var COL = {}; LOG_HEAD.forEach(function (h, i) { COL[h] = i + 1; });
var SITE_HEAD = ["Site", "Other names", "Address", "Supervisor", "Supervisor phone", "Notes"];
var PEOPLE_HEAD = ["Name", "Phone", "Role", "Notes"];
var AUTO_TYPES = [["ask", "Asking for missing details"], ["decline", "Declines"], ["question", "Answers to “are you available / working?”"], ["network", "Asking a guard for the supervisor"], ["accept", "Accepting training"]];
var DEFAULT_SITES = [
  ["Triangle Building", "Triangle", "1550 Wewatta St, Denver, CO", "", "", ""],
  ["Millennium Financial", "Millenium Financial", "1550 17th St, Denver, CO", "", "", ""],
  ["The Hub", "", "3601 Walnut St, Denver, CO", "", "", ""],
  ["KCNC", "", "", "", "", "Add the address"],
];

function props() { return PropertiesService.getScriptProperties(); }
function prop(k, d) { var v = props().getProperty(k); return v == null || v === "" ? d : v; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function digits(p) { var d = String(p || "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; }
function nowLocal() { var d = new Date(); return { date: Utilities.formatDate(d, TZ, "yyyy-MM-dd"), time: Utilities.formatDate(d, TZ, "HH:mm"), dow: Utilities.formatDate(d, TZ, "EEEE"), stamp: d }; }
function token() { return Utilities.getUuid().replace(/-/g, "").slice(0, 20); }

// ---------- the sheet ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Shift Assistant")
    .addItem("Set up / settings", "showSetup")
    .addItem("Test with sample texts", "runSamples")
    .addToUi();
}
function sheet(name, head) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (head) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight("bold"); }
  }
  return sh;
}
function ensureSheets() {
  SpreadsheetApp.getActive().setSpreadsheetTimeZone(TZ);
  var log = sheet(LOG, LOG_HEAD);
  log.hideColumns(COL.Token, 2);
  log.setColumnWidth(COL["Their text"], 320); log.setColumnWidth(COL["Why"], 320); log.setColumnWidth(COL["Suggested reply"], 260); log.setColumnWidth(COL["Actual reply"], 260);
  var sites = sheet(SITES, SITE_HEAD);
  if (sites.getLastRow() < 2) DEFAULT_SITES.forEach(function (r) { sites.appendRow(r); });
  sheet(PEOPLE, PEOPLE_HEAD);
  var st = sheet(SETTINGS, ["Setting", "On?", "What it does"]);
  if (st.getLastRow() < 2) {
    st.appendRow(["Alerts", true, "Show alerts on your phone, and ring an alarm for offers that need you."]);
    AUTO_TYPES.forEach(function (t) { st.appendRow(["Auto-send: " + t[1], false, "Leave off while testing. When on, this kind of reply sends without your tap."]); });
    st.getRange(2, 2, AUTO_TYPES.length + 1, 1).insertCheckboxes();
    st.setColumnWidth(1, 300); st.setColumnWidth(3, 460);
  }
  var first = SpreadsheetApp.getActive().getSheets()[0];
  if (first.getName() !== LOG && first.getLastRow() === 0 && first.getLastColumn() === 0) SpreadsheetApp.getActive().deleteSheet(first);
}
function setting(label) {
  var rows = sheet(SETTINGS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (rows[i][0] === label) return rows[i][1] === true;
  return false;
}
function autoSendOn(level) {
  var t = AUTO_TYPES.filter(function (x) { return x[0] === level; })[0];
  return t ? setting("Auto-send: " + t[1]) : false;
}

function readSites() {
  var rows = sheet(SITES, SITE_HEAD).getDataRange().getValues().slice(1);
  return rows.filter(function (r) { return r[0]; }).map(function (r, i) {
    return { row: i + 2, name: String(r[0]), aliases: String(r[1] || "").split(/\s*[,;]\s*/).filter(Boolean), address: String(r[2] || ""), supervisor: String(r[3] || ""), phone: String(r[4] || ""), notes: String(r[5] || "") };
  });
}
function person(phone) {
  var d = digits(phone);
  if (!d) return null;
  var rows = sheet(PEOPLE, PEOPLE_HEAD).getDataRange().getValues().slice(1);
  for (var i = 0; i < rows.length; i++) if (digits(rows[i][1]) === d) return { name: rows[i][0], role: String(rows[i][2] || "").toLowerCase() };
  return null;
}

// ---------- calendar ----------
// The website's public calendar, plus the private one (your shift times) when a GitHub key is set.
function calendar() {
  var cache = CacheService.getScriptCache(), hit = cache.get("cal");
  if (hit) return JSON.parse(hit);
  var base = prop("SITE_URL", "https://vtorres-designer.github.io/Availability/");
  var cal = { pub: null, priv: null };
  try { cal.pub = JSON.parse(UrlFetchApp.fetch(base.replace(/\/?$/, "/") + "data.json?t=" + Date.now()).getContentText()); } catch (e) { cal.pubError = String(e); }
  var tok = prop("GH_TOKEN", "");
  if (tok) {
    try {
      var r = UrlFetchApp.fetch("https://api.github.com/repos/" + prop("GH_REPO", "vtorres-designer/Availability") + "/actions/variables/AVAILABILITY_PRIVATE",
        { headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" }, muteHttpExceptions: true });
      if (r.getResponseCode() === 200) cal.priv = JSON.parse(JSON.parse(r.getContentText()).value);
      else cal.privError = "GitHub said " + r.getResponseCode();
    } catch (e) { cal.privError = String(e); }
  }
  try { cache.put("cal", JSON.stringify(cal), 300); } catch (e) {}
  return cal;
}
// Shifts you said yes to here (and haven't marked as lost), so the 12-hour check counts them before your calendar does.
function bookedShifts() {
  var sh = sheet(LOG, LOG_HEAD), n = sh.getLastRow();
  if (n < 2) return [];
  var start = Math.max(2, n - 300);
  var rows = sh.getRange(start, 1, n - start + 1, LOG_HEAD.length).getValues();
  var out = [];
  rows.forEach(function (r) {
    if (!/^(Sent|Auto-sent)/.test(r[COL.Action - 1]) || /Didn't get it|Withdrawn/.test(r[COL.Outcome - 1])) return;
    var d; try { d = JSON.parse(r[COL.Detail - 1] || "{}"); } catch (e) { return; }
    if (["top", "urgent", "special", "alert", "accept"].indexOf(d.level) < 0) return;
    (d.offers || []).forEach(function (j) { if (j.level !== "decline" && j.offer && j.offer.start && j.offer.end) out.push({ date: j.offer.date, start: j.offer.start, end: j.offer.end }); });
  });
  return out;
}
// The last few texts from this person in the past day, so Gemini can follow the conversation.
function history(phone) {
  var sh = sheet(LOG, LOG_HEAD), n = sh.getLastRow(), d = digits(phone);
  if (n < 2 || !d) return [];
  var start = Math.max(2, n - 80);
  var rows = sh.getRange(start, 1, n - start + 1, LOG_HEAD.length).getValues();
  var since = Date.now() - 24 * 3600e3;
  return rows.filter(function (r) { return digits(r[COL.Phone - 1]) === d && new Date(r[COL.Received - 1]).getTime() > since; }).slice(-5)
    .map(function (r) { return { at: Utilities.formatDate(new Date(r[COL.Received - 1]), TZ, "EEE HH:mm"), them: r[COL["Their text"] - 1], me: r[COL["Actual reply"] - 1] || "" }; });
}

// ---------- Gemini ----------
var FACTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["offer", "availability_question", "working_question", "withdrawal_only", "guard_cover_request", "guard_team_short", "other"] },
    withdrawsEarlier: { type: "BOOLEAN" },
    training: { type: "BOOLEAN" },
    overtimeMentioned: { type: "BOOLEAN" },
    usesTonightOrToday: { type: "BOOLEAN" },
    questionDate: { type: "STRING", nullable: true },
    offers: { type: "ARRAY", items: { type: "OBJECT", properties: {
      date: { type: "STRING", nullable: true }, start: { type: "STRING", nullable: true }, end: { type: "STRING", nullable: true },
      siteName: { type: "STRING", nullable: true }, address: { type: "STRING", nullable: true }, matchedSite: { type: "STRING", nullable: true }, shiftWords: { type: "STRING", nullable: true } } } },
    summary: { type: "STRING" },
  },
  required: ["kind", "withdrawsEarlier", "training", "overtimeMentioned", "usesTonightOrToday", "offers", "summary"],
};

function geminiPrompt(text, now, sender, sites, hist) {
  return [
    "You read text messages sent to Vincent, a security officer at Allied Universal in Denver who picks up extra shifts.",
    "Pull out the facts only. Don't decide anything and don't guess what isn't written.",
    "",
    "Right now it is " + now.dow + " " + now.date + ", " + now.time + " (Denver time).",
    "Sender: " + sender.name + (sender.role ? " (" + sender.role + ")" : "") + (sender.allied ? ", an Allied contact." : ", a number not in his Allied contacts."),
    "Sites Vincent knows: " + sites.map(function (s) { return s.name + (s.aliases.length ? " (also: " + s.aliases.join(", ") + ")" : "") + (s.address ? " at " + s.address : ""); }).join("; ") + ".",
    hist.length ? "Earlier messages in this conversation (past 24 hours):\n" + hist.map(function (h) { return "- " + h.at + " them: " + h.them + (h.me ? " | Vincent: " + h.me : ""); }).join("\n") : "",
    "",
    "Kinds:",
    "- offer: a shift (or training visit) offered to him, even if details are missing.",
    "- availability_question: asks if he's available or free, with no specific shift.",
    "- working_question: asks if he's already working.",
    "- withdrawal_only: only says an earlier offer is filled or cancelled.",
    "- guard_cover_request: a guard asking him to take their own shift.",
    "- guard_team_short: someone (usually a guard) says a site or team is short-staffed or had callouts, without offering him a shift.",
    "- other: anything else.",
    "",
    "Rules:",
    "- Dates are YYYY-MM-DD. 'tonight' and 'today' mean " + now.date + "; 'tomorrow' means the day after. A night shift belongs to the date it starts.",
    "- Times are 24-hour HH:MM ('11pm' -> 23:00, '2300' -> 23:00, '8pm-9am' -> 20:00 and 09:00). If a time isn't written (for example just 'overnight'), use null.",
    "- usesTonightOrToday is true when the text says tonight, today, this evening or similar.",
    "- questionDate is the date asked about in an availability, working or short-staffed text, else null.",
    "- training is true when he'd go somewhere to learn a site. Put each part (the training visit, a shift after it) in offers.",
    "- matchedSite is the name from his site list when the text clearly means one of them, else null. siteName is the name as written.",
    "- withdrawsEarlier is true when the text says an earlier offer is filled or cancelled (it may also offer something new).",
    "- summary: one short line describing the text.",
    "",
    "The text:",
    text,
  ].filter(function (x) { return x !== null; }).join("\n");
}

function gemini(body) {
  var key = prop("GEMINI_KEY", "");
  if (!key) throw new Error("No Gemini key yet. Open Shift Assistant > Set up.");
  var model = prop("GEMINI_MODEL", "gemini-flash-lite-latest");
  var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "post", contentType: "application/json", headers: { "x-goog-api-key": key }, payload: JSON.stringify(body), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error("Gemini said " + r.getResponseCode() + ": " + r.getContentText().slice(0, 300));
  var j = JSON.parse(r.getContentText());
  var c = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  if (!c || !c.length) throw new Error("Gemini returned nothing");
  return c.map(function (p) { return p.text || ""; }).join("");
}
function readText(text, now, sender, sites, hist) {
  var out = gemini({ contents: [{ role: "user", parts: [{ text: geminiPrompt(text, now, sender, sites, hist) }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: FACTS_SCHEMA } });
  return JSON.parse(out);
}
// Rule 1: a short question in Vincent's voice that fits the conversation. Falls back to the engine's wording.
function wordQuestion(text, needs, fallback, sender, hist) {
  try {
    var prompt = [
      "Write Vincent's reply to a text from " + sender.name + ", a coworker at Allied Universal (security).",
      "He wants the shift but needs to know: " + (needs.lateNight ? "which date they mean (they said 'tonight' after midnight)" : needs.missing.join(", ")) + ".",
      "Keep it to one short, friendly sentence or two, casual and polite, no emojis, no sign-off. Ask only for what's missing.",
      "Example of the right tone: \"" + fallback + "\"",
      hist.length ? "Earlier today: " + hist.map(function (h) { return "them: " + h.them + (h.me ? " / Vincent: " + h.me : ""); }).join(" | ") : "",
      "Their text: " + text,
      "Reply with the text message only.",
    ].join("\n");
    var t = gemini({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 120 } }).trim().replace(/^"|"$/g, "");
    return t && t.length < 300 ? t : fallback;
  } catch (e) { return fallback; }
}

// ---------- alerts ----------
function notify(title, body, priority, url) {
  var topic = prop("NTFY_TOPIC", "");
  if (!topic || !setting("Alerts")) return false;
  var headers = { Title: title, Priority: String(priority || 3), Tags: priority >= 5 ? "rotating_light" : priority >= 4 ? "bell" : "speech_balloon" };
  if (url) headers.Click = url;
  try { UrlFetchApp.fetch("https://ntfy.sh/" + encodeURIComponent(topic), { method: "post", payload: body, headers: headers, muteHttpExceptions: true }); return true; }
  catch (e) { return false; }
}
function pageUrl(id, tok) { var u = ScriptApp.getService().getUrl(); return u ? u + "?id=" + id + "&t=" + tok : ""; }

// ---------- incoming text (from the iPhone Shortcut) ----------
function doPost(e) {
  var t0 = Date.now(), body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: "bad request" }); }
  if (!body || body.key !== prop("SECRET", "-")) return json({ ok: false, error: "wrong key" });
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return json(handleText(body, t0, false)); }
  catch (err) { return json({ ok: false, error: String(err) }); }
  finally { lock.releaseLock(); }
}

// body: {text, from, phone, company}. dry = a test run: logs to Tests, no alert, no withdrawals.
function handleText(body, t0, dry, nowOverride) {
  var text = String(body.text || "").trim();
  var phone = digits(body.phone) || digits(body.from);
  var known = person(phone);
  var looksLikeNumber = !body.from || /^[\s+\d().-]+$/.test(String(body.from));
  var sender = { name: known ? known.name : looksLikeNumber ? (phone ? "(" + phone.slice(0, 3) + ") " + phone.slice(3, 6) + "-" + phone.slice(6) : "Unknown number") : String(body.from),
    allied: !!known || /allied/i.test(String(body.company || "")), role: known ? known.role : "" };
  // A saved contact who isn't Allied (family, friends): dropped here, never logged or sent to Gemini.
  if (!sender.allied && !looksLikeNumber) return { ok: true, level: "ignore", personal: true, send: false };
  var now = nowOverride || nowLocal();
  var sites = readSites(), hist = dry ? [] : history(phone);
  var id = dry ? "T" + Date.now() : nextId(), tok = token();
  var facts = null, r, error = "";
  try { facts = readText(text, now, sender, sites, hist); }
  catch (err) { error = String(err.message || err); }
  if (facts) {
    var cal = calendar();
    cal.booked = dry ? [] : bookedShifts();
    r = ENGINE.decide({ now: now, sender: sender, facts: facts, cal: cal, sites: sites });
    if (r.needs) r.reply = wordQuestion(text, r.needs, r.reply, sender, hist);
    if (!dry && facts.withdrawsEarlier) markWithdrawn(phone);
    if (cal.privError) r.path.push(["no", "Couldn't read your private calendar (" + cal.privError + "), so work days look busy"]);
  } else {
    r = { level: "alert", label: "Your call", priority: 4, path: [["no", "Couldn't read this text: " + error]], reply: null, info: {}, offers: [] };
  }
  var al = ENGINE.alertText(r, { sender: sender, now: now });
  var auto = !dry && r.reply && r.level !== "ignore" && sender.allied && autoSendOn(r.level);
  var row = [id, now.stamp, sender.name, phone, sender.allied ? "Yes" : "No", text, facts ? JSON.stringify(facts) : "", r.label || r.level,
    r.path.map(function (p) { return ({ ok: "✓", no: "✕", end: "→", skip: "–" }[p[0]] || "") + " " + p[1]; }).join("\n"),
    r.reply || "", auto ? r.reply : "", auto ? "Auto-sent" : r.level === "ignore" ? "Ignored" : "", auto ? new Date() : "", "", "", "",
    Math.round((Date.now() - t0) / 100) / 10, error, tok,
    JSON.stringify({ level: r.level, label: r.label, path: r.path, info: r.info, offers: r.offers, newSite: r.newSite || null, sender: sender, alert: al, priority: r.priority })];
  sheet(dry ? "Tests" : LOG, LOG_HEAD).appendRow(row);
  if (!dry && !known && sender.allied && !looksLikeNumber) sheet(PEOPLE, PEOPLE_HEAD).appendRow([sender.name, phone, "", "Added automatically. Set Role to supervisor, manager or guard."]);
  // The Shortcut shows the alert. "loud" = offers that need you: it also sets an alarm so the phone rings.
  var loud = !dry && ["top", "urgent", "special", "alert"].indexOf(r.level) >= 0;
  var show = !dry && r.level !== "ignore" && setting("Alerts");
  return { ok: true, id: id, level: r.level, title: al.title, body: al.body, show: show ? "yes" : "no", loud: loud && show ? "yes" : "no", send: !!auto, to: auto ? phone : "", reply: auto ? r.reply : "", url: dry ? "" : pageUrl(id, tok) };
}
function nextId() {
  var p = props(), n = Number(p.getProperty("NEXT_ID") || 1);
  p.setProperty("NEXT_ID", String(n + 1));
  return n;
}
function markWithdrawn(phone) {
  var sh = sheet(LOG, LOG_HEAD), n = sh.getLastRow();
  if (n < 2) return;
  var start = Math.max(2, n - 40), rows = sh.getRange(start, 1, n - start + 1, LOG_HEAD.length).getValues();
  var since = Date.now() - 24 * 3600e3;
  rows.forEach(function (r, i) {
    if (digits(r[COL.Phone - 1]) === phone && !r[COL.Outcome - 1] && new Date(r[COL.Received - 1]).getTime() > since && /offer|Top|Urgent|New site|Your call|Needs/.test(r[COL.Decision - 1] + " " + r[COL["What Gemini read"] - 1]))
      sh.getRange(start + i, COL.Outcome).setValue("Withdrawn");
  });
}

// ---------- review page ----------
function doGet(e) {
  var p = e.parameter || {};
  var t = HtmlService.createTemplateFromFile("Review");
  t.boot = JSON.stringify({ id: p.id ? Number(p.id) : null, t: p.t || "", k: p.k || "", page: p.page || "" });
  return t.evaluate().setTitle("Shift Assistant").addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}
function findRow(id) {
  var sh = sheet(LOG, LOG_HEAD), n = sh.getLastRow();
  if (n < 2) return null;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (Number(ids[i][0]) === Number(id)) return { sh: sh, row: i + 2, v: sh.getRange(i + 2, 1, 1, LOG_HEAD.length).getValues()[0] };
  return null;
}
function master(a) { return !!(a && a.k && a.k === prop("SECRET", "-")); }
function canSee(a, id) {
  if (master(a)) return true;
  var f = findRow(id);
  return !!(f && a && a.t && a.t === f.v[COL.Token - 1]);
}
function entryOf(v) {
  var d = {}; try { d = JSON.parse(v[COL.Detail - 1] || "{}"); } catch (e) {}
  var facts = null; try { facts = JSON.parse(v[COL["What Gemini read"] - 1] || "null"); } catch (e) {}
  return { id: v[0], received: Utilities.formatDate(new Date(v[COL.Received - 1]), TZ, "EEE M/d h:mm a"), from: v[COL.From - 1], phone: String(v[COL.Phone - 1]), allied: v[COL.Allied - 1] === "Yes",
    text: v[COL["Their text"] - 1], facts: facts, level: d.level || "", label: v[COL.Decision - 1], path: d.path || [], info: d.info || {}, newSite: d.newSite || null,
    suggested: v[COL["Suggested reply"] - 1], actual: v[COL["Actual reply"] - 1], action: v[COL.Action - 1], outcome: v[COL.Outcome - 1], error: v[COL.Error - 1] };
}
function apiEntry(a, id) {
  if (!canSee(a, id)) throw new Error("This link has expired or is wrong.");
  var f = findRow(id), e = entryOf(f.v);
  e.master = master(a);
  return e;
}
function apiList(a) {
  if (!master(a)) throw new Error("Open this page from your saved Shift Assistant link.");
  var sh = sheet(LOG, LOG_HEAD), n = sh.getLastRow();
  if (n < 2) return [];
  var start = Math.max(2, n - 60);
  return sh.getRange(start, 1, n - start + 1, LOG_HEAD.length).getValues().reverse().map(entryOf);
}
// What you did with a reply: sent it (maybe edited), or didn't reply.
function apiAct(a, id, action, text) {
  if (!canSee(a, id)) throw new Error("This link has expired or is wrong.");
  var f = findRow(id), suggested = String(f.v[COL["Suggested reply"] - 1] || "");
  var sh = f.sh, r = f.row;
  if (action === "sent") {
    sh.getRange(r, COL["Actual reply"]).setValue(text);
    sh.getRange(r, COL.Action).setValue("Sent");
    sh.getRange(r, COL["Edited?"]).setValue(String(text).trim() === suggested.trim() ? "No" : "Yes");
  } else sh.getRange(r, COL.Action).setValue("Didn't reply");
  sh.getRange(r, COL["Action time"]).setValue(new Date());
  return true;
}
function apiOutcome(a, id, outcome, note) {
  if (!canSee(a, id)) throw new Error("This link has expired or is wrong.");
  var f = findRow(id);
  f.sh.getRange(f.row, COL.Outcome).setValue(outcome);
  if (note != null) f.sh.getRange(f.row, COL["Your notes"]).setValue(note);
  return true;
}
function apiSites(a) {
  if (!master(a)) throw new Error("Open this page from your saved Shift Assistant link.");
  return readSites();
}
// Adds a site, or updates the one in that row. An entry link can add the site from its own text.
function apiSaveSite(a, site, fromEntry) {
  if (!master(a) && !(fromEntry && canSee(a, fromEntry))) throw new Error("Open this page from your saved Shift Assistant link.");
  var sh = sheet(SITES, SITE_HEAD);
  var row = [site.name, Array.isArray(site.aliases) ? site.aliases.join(", ") : String(site.aliases || ""), site.address || "", site.supervisor || "", site.phone || "", site.notes || ""];
  if (!row[0]) throw new Error("The site needs a name.");
  if (site.row && master(a)) sh.getRange(site.row, 1, 1, row.length).setValues([row]);
  else if (!readSites().some(function (s) { return s.name.toLowerCase() === String(site.name).toLowerCase(); })) sh.appendRow(row);
  return readSites();
}

// ---------- setup ----------
function showSetup() {
  ensureSheets();
  var t = HtmlService.createTemplateFromFile("Setup");
  t.state = JSON.stringify(setupState());
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(520).setHeight(640), "Shift Assistant setup");
}
function setupState() {
  var p = props();
  if (!p.getProperty("SECRET")) p.setProperty("SECRET", token() + token());
  var url = ScriptApp.getService().getUrl() || "";
  return { hasGemini: !!p.getProperty("GEMINI_KEY"), model: prop("GEMINI_MODEL", "gemini-flash-lite-latest"), hasGithub: !!p.getProperty("GH_TOKEN"),
    secret: p.getProperty("SECRET"), url: url, inbox: url ? url + "?k=" + p.getProperty("SECRET") : "",
    siteUrl: prop("SITE_URL", "https://vtorres-designer.github.io/Availability/") };
}
function saveSetup(f) {
  var p = props();
  if (f.gemini) p.setProperty("GEMINI_KEY", f.gemini.trim());
  if (f.github === "-") p.deleteProperty("GH_TOKEN"); else if (f.github) p.setProperty("GH_TOKEN", f.github.trim());
  if (f.model) p.setProperty("GEMINI_MODEL", f.model.trim());
  if (f.siteUrl) p.setProperty("SITE_URL", f.siteUrl.trim());
  CacheService.getScriptCache().remove("cal");
  return setupState();
}
function testAlert() {
  Logger.log("Alerts now come from your iPhone Shortcut. Test them by texting yourself (see Step 5).");
}

// Your real texts, run through Gemini and the rules without alerting anyone. Results land in the Tests tab.
var SAMPLES = [
  ["Adrian Martin", "Hi! I have a shift tonight at the triangle building 1550 Wewatta St Denver CO 2300-0700. Please let me know if you want it."],
  ["Adrian Martin", "Hi! Are you available to work tonight?"],
  ["Adrian Martin", "Hi! I have a shift available at Millenium financial tonight 2300-0700 1550 17th st Denver CO. Plz let me know. Thx"],
  ["Adrian Martin", "Hi! I have a shift available at The Hub 3601 Walnut St tonight 2300-0700."],
  ["Kelsey", "Are you working tonight already?"],
  ["Kelsey", "Hello sorry for reaching out so late. Could you cover triangle tonight 11pm-7am?"],
  ["Kelsey", "Are you available for an overnight at KCNC tonight? It would be a little overtime."],
  ["Kelsey", "Oh well I guess it just got filled. So don't worry about that one. My apologies. But if you're still looking for hours I have a special request for coverage at Louis Vuitton 8pm-9am tonight."],
  ["Kelsey", "Hello! Would you be willing to go to a site for a few hours today to learn it and then cover a morning shift tomorrow?"],
  ["Marcus", "Heads up, Cherry Creek is short tonight, two callouts."],
  ["Marcus", "Hey can you take my shift Saturday? I'll owe you one"],
];
function runSamples() {
  ensureSheets();
  var sh = sheet("Tests", LOG_HEAD);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEAD.length).clearContent();
  SAMPLES.forEach(function (s, i) {
    var now = i === 5 ? (function () { var n = nowLocal(); n.time = "00:40"; return n; })() : null;
    handleText({ text: s[1], from: s[0], company: "Allied Universal" }, Date.now(), true, now);
  });
  SpreadsheetApp.getActive().setActiveSheet(sh);
  SpreadsheetApp.getUi().alert("Done. Each sample is a row in the Tests tab: what Gemini read, the decision, why, and the reply. Sample 6 pretends it arrived at 12:40 AM.");
}
