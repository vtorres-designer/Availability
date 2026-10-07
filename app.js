"use strict";
(() => {
  // ---------- older browsers ----------
  // replaceChildren arrived in Safari 14 / Chrome 86 / Firefox 78.
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.append.apply(this, arguments);
    };
  }
  // <dialog> arrived in Safari 15.4 / Firefox 98. Older browsers get a small stand-in with the same
  // calls (showModal, close, returnValue) and events (close, cancel), so every sheet still works.
  if (typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) {
    document.documentElement.classList.add("no-dialog");
    const backdrop = document.createElement("div");
    backdrop.className = "shim-backdrop";
    backdrop.hidden = true;
    const openOnes = () => Array.prototype.filter.call(document.querySelectorAll("dialog"), (d) => d.hasAttribute("open"));
    const shim = (d) => {
      if (d.showModal) return;
      d.returnValue = "";
      Object.defineProperty(d, "open", { get() { return this.hasAttribute("open"); } });
      d.showModal = function () {
        if (!backdrop.parentNode) document.body.appendChild(backdrop);
        this.setAttribute("open", "");
        backdrop.hidden = false;
        const f = this.querySelector("input, select, textarea, button");
        if (f) try { f.focus(); } catch (e) { /* ignore */ }
      };
      d.close = function (value) {
        if (!this.hasAttribute("open")) return;
        if (value !== undefined) this.returnValue = value;
        this.removeAttribute("open");
        if (!openOnes().length) backdrop.hidden = true;
        this.dispatchEvent(new Event("close"));
      };
    };
    const shimAll = () => Array.prototype.forEach.call(document.querySelectorAll("dialog"), shim);
    shimAll();
    document.addEventListener("DOMContentLoaded", shimAll);
    // A button press inside a method="dialog" form closes its sheet with the button's value.
    let lastButton = null;
    document.addEventListener("click", (e) => { lastButton = e.target.closest ? e.target.closest("button") : null; }, true);
    // This runs after the page's own submit handlers, so a handler that cancels the submit keeps the sheet open,
    // the same as with a real <dialog>.
    document.addEventListener("submit", (e) => {
      const form = e.target;
      const d = form.closest && form.closest("dialog");
      if (!d || (form.getAttribute("method") || "").toLowerCase() !== "dialog") return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (!handled) d.close(lastButton && form.contains(lastButton) ? lastButton.value || "" : "");
    });
    backdrop.addEventListener("click", () => { const o = openOnes(); if (o.length) o[o.length - 1].close(""); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const o = openOnes();
      if (!o.length) return;
      const d = o[o.length - 1];
      d.dispatchEvent(new Event("cancel"));
      d.close("");
    });
  }

  const SHIFT_KEYS = ["overnight", "swing", "morning"];
  const SHIFT_LABEL = { overnight: "Overnight", swing: "Swing", morning: "Morning" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const LS = { token: "sa.token", savedSignal: "sa.saved", draftPrefix: "sa.d3.", draft2: "sa.draft2", oldDraft: "sa.draft", who: "sa.who", site: "sa.site", addr: "sa.addr", brush: "sa.brush", importText: "sa.import", fbContact: "sa.fbContact", lastWeekly: "sa.weekly" };
  const PRIVATE_VAR = "AVAILABILITY_PRIVATE";
  const VAR_LIMIT = 47 * 1024; // GitHub allows 48 KB per variable
  const PUBLIC_TAG = { open: "Open", ot: "OT", busy: "Busy", unset: "" };
  const OWNER_TAG = { open: "Open", ot: "OT", work: "Work", busy: "Busy", unset: "" };

  // Public settings live in data.json, which anyone can read. Private ones (hours, notes, overtime rules)
  // live in a repository variable that only the owner's key can read.
  const defaultPub = () => ({ name: "", empId: "", phone: "", note: "", willing: ["overnight"], weekStart: 0, feedback: "" });
  const defaultPriv = () => ({ otAfter: 40, pickup: 8, weekly: [], days: {} });

  // ---------- small helpers ----------
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
    keys(prefix) { try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)); } catch { return []; } },
  };
  // Each page load keeps its unsaved changes under its own key, so two tabs never overwrite each other's.
  const OWN_DRAFT = LS.draftPrefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = () => keyOf(new Date());
  const isKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
  const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const fmt = (k, o) => dateOf(k).toLocaleDateString("en-US", o);
  const shortDay = (k) => fmt(k, { weekday: "short", month: "short", day: "numeric" });
  const longDay = (k) => fmt(k, { weekday: "long", month: "long", day: "numeric" });
  const num = (n) => String(+Number(n).toFixed(2));
  const possessive = (name) => (name ? (/s$/i.test(name) ? `${name}'` : `${name}'s`) : "My");
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const spanHours = (start, end) => window.ScheduleParser.spanHours(start, end);
  function fmtTime(t) {
    const [h, m] = t.split(":").map(Number);
    const h12 = h % 12 || 12, ap = h < 12 ? "AM" : "PM";
    return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    const add = (c) => {
      if (Array.isArray(c)) c.forEach(add);
      else if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    };
    kids.forEach(add);
    return el;
  }

  function showSheet(sel) {
    const d = $(sel);
    d.returnValue = "";
    if (!d.open) d.showModal();
  }

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
    const host = document.querySelector("dialog[open]") || document.body; // sheets sit above the page
    if (t.parentNode !== host) host.append(t);
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    const ta = h("textarea", { readonly: true, style: "position:fixed;opacity:0;top:0;left:0" });
    ta.value = text;
    (document.querySelector("dialog[open]") || document.body).append(ta); // outside an open sheet, the page is inert
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy") && ta.selectionEnd - ta.selectionStart === text.length; } catch { /* ignore */ }
    ta.remove();
    return ok;
  }

  // ---------- data model ----------
  const isEmail = (s) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s);
  // Where bug reports go: an email address, or the random code FormSubmit emails after activation
  // (it keeps the address out of the public file). A pasted FormSubmit link works too. Anything else is "".
  function feedbackId(raw) {
    let s = String(raw || "").trim();
    const m = s.match(/^(?:https?:\/\/)?(?:www\.)?formsubmit\.co\/(?:ajax\/)?([^/?#\s]+)\/?$/i);
    if (m) s = m[1];
    if (s.length > 120) return "";
    return isEmail(s) || /^(?=.*\d)[A-Za-z0-9]{20,64}$/.test(s) ? s : "";
  }
  const cleanWilling = (w) => (Array.isArray(w) ? SHIFT_KEYS.filter((k) => w.includes(k)) : null);
  const cleanNote = (n) => (typeof n === "string" ? n.trim().slice(0, 100) : "");

  // keepExtra: carry over simple fields a newer version of the site added, so saving from here doesn't erase them.
  function normalizePub(raw, keepExtra) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPub();
    if (typeof r.name === "string") d.name = r.name.trim().slice(0, 40);
    if (typeof r.empId === "string") d.empId = r.empId.trim().slice(0, 20);
    if (typeof r.phone === "string") d.phone = r.phone.trim().slice(0, 20);
    if (typeof r.note === "string") d.note = r.note.slice(0, 140);
    if (Array.isArray(r.willing)) d.willing = cleanWilling(r.willing);
    const ws = parseInt(r.weekStart, 10);
    if (ws >= 0 && ws <= 6) d.weekStart = ws;
    if (typeof r.feedback === "string") d.feedback = feedbackId(r.feedback);
    if (keepExtra) {
      for (const k of Object.keys(r)) {
        const v = r[k];
        if (k in d || ["v", "days", "updated", "rev"].includes(k) || k.length > 40) continue;
        if ((typeof v === "string" && v.length <= 500) || typeof v === "number" || typeof v === "boolean") d[k] = v;
      }
    }
    return d;
  }

  function cleanPrivRec(rec, pickup) {
    if (!rec || typeof rec !== "object") return null;
    if (rec.s === "work") {
      const out = { s: "work" };
      if (isTime(rec.start) && isTime(rec.end) && rec.start !== rec.end) { out.start = rec.start; out.end = rec.end; }
      const hrs = Number(rec.hours);
      out.hours = hrs > 0 && hrs <= 24 ? hrs : out.start ? spanHours(out.start, out.end) : pickup;
      const note = cleanNote(rec.note);
      if (note) out.note = note;
      return out;
    }
    if (rec.s === "busy") {
      const note = cleanNote(rec.note);
      return note ? { s: "busy", note } : { s: "busy" };
    }
    if (rec.s === "open") {
      const w = cleanWilling(rec.w);
      return w ? { s: "open", w } : { s: "open" };
    }
    return null;
  }

  // "Every week" days: a shift he works (or a day he keeps busy) on the same weekday every week, until he turns it off.
  // A day marked on the calendar or pasted from a schedule wins over the weekly setting for that date.
  function cleanRule(r, pickup) {
    if (!r || typeof r !== "object") return null;
    const d = parseInt(r.d, 10);
    if (!(d >= 0 && d <= 6)) return null;
    const rec = cleanPrivRec({ s: r.s, start: r.start, end: r.end, hours: r.hours }, pickup);
    if (!rec || (rec.s !== "work" && rec.s !== "busy")) return null;
    const out = Object.assign({ d }, rec);
    if (isKey(r.from)) out.from = r.from; // added or changed on this date; earlier days don't follow it
    return out;
  }
  function cleanWeekly(list, pickup) {
    const out = [];
    if (Array.isArray(list)) {
      for (const r of list) {
        const c = cleanRule(r, pickup);
        if (c && !out.some((x) => x.d === c.d)) out.push(c);
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }
  const ruleFor = (list, d) => (list || []).filter((r) => r.d === d)[0] || null;
  const ruleOn = (k, v) => { const r = ruleFor(v.weekly, dateOf(k).getDay()); return r && !(r.from && k < r.from) ? r : null; };
  const ruleCore = (r) => (r ? JSON.stringify(Object.assign({}, r, { from: null })) : "");
  // The record that counts for a day: what's marked on it, or else its every-week setting.
  function dayRec(k, v) {
    if (v.days[k]) return v.days[k];
    const r = ruleOn(k, v);
    if (!r) return null;
    const out = Object.assign({}, r, { weekly: true });
    delete out.d;
    delete out.from;
    return out;
  }
  // Supervisors only learn which weekdays are red every week, never the times.
  const weeklyPublic = (v) => (v.weekly || []).map((r) => r.d);
  const cleanDows = (list) => (Array.isArray(list) ? [0, 1, 2, 3, 4, 5, 6].filter((d) => list.indexOf(d) >= 0) : []);

  function normalizePriv(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPriv();
    if (typeof r.rev === "string") d.rev = r.rev;
    if (Number(r.otAfter) > 0) d.otAfter = Number(r.otAfter);
    if (Number(r.pickup) > 0 && Number(r.pickup) <= 24) d.pickup = Number(r.pickup);
    d.weekly = cleanWeekly(r.weekly, d.pickup);
    if (r.days && typeof r.days === "object") {
      for (const [k, v] of Object.entries(r.days)) {
        const rec = isKey(k) ? cleanPrivRec(v, d.pickup) : null;
        if (rec) d.days[k] = rec;
      }
    }
    // Settings a newer version of the site added are kept, so saving from here doesn't erase them.
    for (const k of Object.keys(r)) if (!(k in d) && k !== "v" && k !== "rev") d[k] = r[k];
    return d;
  }

  // The first version of data.json kept everything public and treated days up to "through" as open.
  function migrateV1(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const pub = normalizePub(r);
    const priv = defaultPriv();
    if (Number(r.otAfter) > 0) priv.otAfter = Number(r.otAfter);
    const shiftHours = (k) => Number(r.shifts && r.shifts[k] && r.shifts[k].hours) || 8;
    const days = r.days && typeof r.days === "object" ? r.days : {};
    for (const [k, v] of Object.entries(days)) {
      if (!isKey(k) || !v) continue;
      if (v.s === "work") priv.days[k] = { s: "work", hours: Number(v.hours) > 0 ? Number(v.hours) : shiftHours(v.shift) };
      else if (v.s === "off") priv.days[k] = { s: "busy" };
      else if (v.s === "open") priv.days[k] = cleanPrivRec({ s: "open", w: v.willing }, priv.pickup);
    }
    if (isKey(r.through)) {
      for (let k = todayKey(); k <= r.through; k = addDays(k, 1)) if (!priv.days[k]) priv.days[k] = { s: "open" };
    }
    return { pub, priv };
  }

  // Rebuilds what the owner can from the public file alone (used if the private variable is missing).
  function privFromPublicDays(days, weekly) {
    const priv = defaultPriv();
    priv.weekly = cleanWeekly((weekly || []).map((d) => ({ d, s: "busy" })), priv.pickup);
    for (const [k, v] of Object.entries(days)) {
      if (v.s === "busy") priv.days[k] = { s: "busy" };
      else priv.days[k] = cleanPrivRec({ s: "open", w: v.w }, priv.pickup);
    }
    return priv;
  }

  function normalizePublicDays(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [k, v] of Object.entries(raw)) {
      if (!isKey(k) || !v || !["open", "ot", "busy"].includes(v.s)) continue;
      const w = v.s !== "busy" ? cleanWilling(v.w) : null;
      out[k] = w ? { s: v.s, w } : { s: v.s };
    }
    return out;
  }

  function readPublicFile(raw) {
    if (raw && raw.v === 2) return { pub: normalizePub(raw, true), days: normalizePublicDays(raw.days), weekly: cleanDows(raw.weekly), updated: raw.updated || null };
    const m = migrateV1(raw);
    return { pub: m.pub, days: derivePublic(m.pub, m.priv), weekly: [], updated: (raw && raw.updated) || null, migrated: m };
  }

  const weekStartOf = (k, ws) => addDays(k, -((dateOf(k).getDay() - ws + 7) % 7));

  // Paid hours that fall inside one pay week. The week starts at midnight, so a shift that crosses the
  // cutoff (Thu 2300 - Fri 0700) counts 1 hour in one week and 7 in the next. Unpaid time (paid hours
  // shorter than the shift) is spread evenly. A shift without times counts on the day it's listed.
  const dayNumber = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const minutesOf = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  function hoursInWeek(weekStartKey, v) {
    const from = dayNumber(weekStartKey) * 1440, to = from + 7 * 1440;
    let total = 0;
    for (let i = -1; i < 7; i++) {
      const k = addDays(weekStartKey, i);
      const rec = dayRec(k, v);
      if (!rec || rec.s !== "work") continue;
      const paid = Number(rec.hours) || 0;
      if (rec.start && rec.end) {
        const start = dayNumber(k) * 1440 + minutesOf(rec.start);
        let len = minutesOf(rec.end) - minutesOf(rec.start);
        if (len <= 0) len += 1440;
        const inside = Math.max(0, Math.min(start + len, to) - Math.max(start, from));
        total += (paid * inside) / len;
      } else if (i >= 0) {
        total += paid;
      }
    }
    return Math.round(total * 100) / 100;
  }
  const weekHours = (k, v, ws) => hoursInWeek(weekStartOf(k, ws), v);

  // Would picking up one more usual-length shift on day k go past the overtime line?
  // An overnight shift picked up on the last day of a pay week is paid mostly in the next week, so that week counts too.
  function wouldBeOT(k, v, p, rec) {
    const ws = weekStartOf(k, p.weekStart);
    if (hoursInWeek(ws, v) + v.pickup > v.otAfter) return true;
    const shifts = rec && rec.w ? rec.w : p.willing;
    const next = addDays(ws, 7);
    return addDays(k, 1) === next && shifts.includes("overnight") && hoursInWeek(next, v) + v.pickup > v.otAfter;
  }

  // What supervisors may see: open / ot / busy per day from today on. No times, hours, notes,
  // and no difference between working and busy.
  function derivePublic(p, v) {
    const out = {};
    const today = todayKey();
    for (const k of Object.keys(v.days).sort()) {
      if (k < today) continue;
      const rec = v.days[k];
      if (rec.s === "work" || rec.s === "busy") { out[k] = { s: "busy" }; continue; }
      if (rec.w && rec.w.length === 0) { out[k] = { s: "busy" }; continue; }
      const ot = wouldBeOT(k, v, p, rec);
      out[k] = rec.w ? { s: ot ? "ot" : "open", w: rec.w } : { s: ot ? "ot" : "open" };
    }
    return out;
  }

  // ---------- state ----------
  const REPO = (() => {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const first = location.pathname.split("/").filter(Boolean)[0];
      return { owner: host.split(".")[0], name: first && !first.includes(".") ? first : host };
    }
    return { owner: "vtorres-designer", name: "Availability" };
  })();
  const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;

  let pub = defaultPub();
  let priv = defaultPriv();
  let pubDays = {}; // what the public page shows
  let pubWeekly = []; // weekdays that are red every week
  let updated = null;
  let saved = null; // owner: {pub, priv} as last saved
  let pubSha = null;
  let privAt = null; // private variable's updated_at when loaded
  let privExists = false;
  let privAccess = true;
  let token = store.get(LS.token);
  let owner = false;
  let preview = false;
  let brush = "edit";
  let saving = false;
  let loadError = false;
  let needsPublish = false; // the public file is behind the saved private schedule (or still in the old format)
  let lastPrivText = null; // what this device last sent to the private variable
  let lastPubSent = null; // what this device last sent as data.json (without the timestamp)
  let standIn = false; // the private schedule couldn't be read (key lacks Variables), so priv is rebuilt from the public file
  let busy = false; // reloading or merging: edits wait until it's done

  const ownerView = () => owner && !preview;

  // ---------- GitHub ----------
  const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function gh(method, path, body, tok = token) {
    const res = await fetch(API + path, {
      method,
      cache: "no-store",
      headers: Object.assign(
        { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" },
        body ? { "Content-Type": "application/json" } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = res.status === 204 ? "" : await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function getPublicRemote(tok) {
    const j = await gh("GET", "/contents/data.json", null, tok);
    return { raw: JSON.parse(b64decode(j.content)), sha: j.sha };
  }

  // Returns {status, value, updatedAt}. 404 = not created yet, 403 = key lacks the Variables permission.
  async function getPrivateRemote(tok) {
    try {
      const j = await gh("GET", `/actions/variables/${PRIVATE_VAR}`, null, tok);
      return { status: 200, value: j.value, updatedAt: j.updated_at };
    } catch (e) {
      if (e.status === 404 || e.status === 403) return { status: e.status };
      throw e;
    }
  }

  // ---------- owner changes ----------
  function changes() {
    if (!saved) return { days: new Set(), settings: false, publish: false };
    const keys = new Set([...Object.keys(priv.days), ...Object.keys(saved.priv.days)]);
    const orNull = (x) => (x === undefined ? null : x);
    const days = new Set([...keys].filter((k) => JSON.stringify(orNull(priv.days[k])) !== JSON.stringify(orNull(saved.priv.days[k]))));
    const strip = (v) => JSON.stringify(Object.assign({}, v, { days: null, rev: null }));
    return { days, settings: JSON.stringify(pub) !== JSON.stringify(saved.pub) || strip(priv) !== strip(saved.priv), publish: needsPublish };
  }

  // Unsaved changes, stored as only what this device changed. Each entry keeps the value it replaced ("from"),
  // so a restored change is applied only if nobody saved something else on that day since.
  function diffOf() {
    const c = changes();
    const d = { days: {}, pub: {}, priv: {} };
    if (!saved) return d;
    for (const k of c.days) d.days[k] = { to: priv.days[k] || null, from: saved.priv.days[k] || null };
    for (const f of Object.keys(pub)) if (JSON.stringify(pub[f]) !== JSON.stringify(saved.pub[f])) d.pub[f] = { to: pub[f], from: saved.pub[f] };
    for (const f of ["otAfter", "pickup"]) if (!same(priv[f], saved.priv[f])) d.priv[f] = { to: priv[f], from: saved.priv[f] };
    // Every-week days are kept per weekday, so changes from two devices or tabs to different weekdays both survive.
    d.wk = {};
    for (let w = 0; w < 7; w++) {
      const to = ruleFor(priv.weekly, w), from = ruleFor(saved.priv.weekly, w);
      if (!same(to, from)) d.wk[w] = { to, from };
    }
    return d;
  }
  const diffSize = (d) => Object.keys(d.days).length + Object.keys(d.pub).length + Object.keys(d.priv).length + Object.keys(d.wk || {}).length;
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

  // Applies a diff. With checkBase, an entry is skipped when the current value is no longer the one it replaced.
  function applyDiff(d, checkBase) {
    let applied = 0, skipped = 0;
    const take = (e, current) => {
      if (!e || typeof e !== "object" || !("to" in e)) return false;
      if (same(current, e.to)) return false;
      if (checkBase && !same(current, e.from)) { skipped++; return false; }
      applied++;
      return true;
    };
    for (const [k, e] of Object.entries(d.days || {})) {
      if (!isKey(k) || !take(e, priv.days[k])) continue;
      const clean = e.to ? cleanPrivRec(e.to, priv.pickup) : null;
      if (clean) priv.days[k] = clean;
      else delete priv.days[k];
    }
    const next = Object.assign({}, pub);
    for (const [f, e] of Object.entries(d.pub || {})) if (f in next && take(e, pub[f])) next[f] = e.to;
    pub = normalizePub(next, true);
    for (const f of ["otAfter", "pickup"]) {
      const e = d.priv && d.priv[f];
      if (e && take(e, priv[f]) && Number(e.to) > 0) priv[f] = Number(e.to);
    }
    for (const [w, e] of Object.entries(d.wk || {})) {
      const dow = Number(w);
      if (!(dow >= 0 && dow <= 6) || !take(e, ruleFor(priv.weekly, dow))) continue;
      priv.weekly = cleanWeekly(priv.weekly.filter((r) => r.d !== dow).concat(e.to ? [Object.assign({}, e.to, { d: dow })] : []), priv.pickup);
    }
    return { applied, skipped };
  }

  // After a save, copies of the changes it included are done. Removing them keeps an old copy from
  // coming back later if that day is changed again.
  function pruneOtherDrafts() {
    for (const key of store.keys(LS.draftPrefix)) {
      if (key === OWN_DRAFT) continue;
      let d;
      try { d = JSON.parse(store.get(key)); } catch { continue; }
      if (!d || typeof d !== "object") continue;
      let changed = false;
      for (const [k, e] of Object.entries(d.days || {})) if (!e || same(saved.priv.days[k], e.to)) { delete d.days[k]; changed = true; }
      for (const [f, e] of Object.entries(d.pub || {})) if (!e || same(saved.pub[f], e.to)) { delete d.pub[f]; changed = true; }
      for (const [f, e] of Object.entries(d.priv || {})) if (!e || same(saved.priv[f], e.to)) { delete d.priv[f]; changed = true; }
      for (const [w, e] of Object.entries(d.wk || {})) if (!e || same(ruleFor(saved.priv.weekly, Number(w)), e.to)) { delete d.wk[w]; changed = true; }
      if (!changed) continue;
      if (diffSize({ days: d.days || {}, pub: d.pub || {}, priv: d.priv || {}, wk: d.wk || {} })) store.set(key, JSON.stringify(d));
      else store.del(key);
    }
  }

  // Another tab on this device saved: start from that save and keep this tab's own unsaved changes on top.
  async function rebase() {
    if (!owner || busy || saving || standIn) return;
    busy = true;
    try {
      const st = await loadOwnerState(token);
      const mine = diffOf();
      saved = { pub: clone(st.pub), priv: clone(st.priv) };
      pub = clone(st.pub);
      priv = clone(st.priv);
      forgetAutoCopies();
      applyDiff(mine, false);
      pubSha = st.pubSha;
      privAt = st.privAt;
      privExists = st.privExists;
      needsPublish = st.behind;
      updated = st.updated;
      if ($("#settingsSheet").open) renderWeekly();
    } catch { /* offline: Save will notice a newer version */ }
    busy = false;
    persistDraft();
    render();
  }

  function persistDraft() {
    if (standIn || busy) return; // never store edits made on a stand-in or a half-loaded calendar
    const d = diffOf();
    if (diffSize(d)) store.set(OWN_DRAFT, JSON.stringify(Object.assign({ ts: Date.now() }, d)));
    else store.del(OWN_DRAFT);
  }

  function afterChange() {
    persistDraft();
    render();
  }

  function setDay(k, rec) {
    if (rec) priv.days[k] = rec;
    else delete priv.days[k];
  }
  const workRec = (start, end, hours, note) => cleanPrivRec({ s: "work", start, end, hours, note }, priv.pickup);

  function applyBrush(k) {
    if (busy) return;
    const cur = priv.days[k];
    const rule = cur ? null : ruleOn(k, priv);
    if (rule && rule.s === brush) {
      toast(`Every ${DOW_LONG[rule.d]} is already marked ${rule.s === "work" ? "Working" : "Busy"} in Settings. To change only this date, pick Tap to Edit.`, 5000);
      return;
    }
    if (brush === "work") setDay(k, cur && cur.s === "work" ? null : workRec(null, null, priv.pickup));
    else if (brush === "busy") setDay(k, cur && cur.s === "busy" ? null : { s: "busy" });
    else if (brush === "open") setDay(k, cur && cur.s === "open" ? null : { s: "open" });
    afterChange();
  }

  // ---------- day info ----------
  function ownerInfo(k) {
    const rec = dayRec(k, priv);
    const booked = weekHours(k, priv, pub.weekStart);
    const base = { past: k < todayKey(), booked, rec, weekly: !!(rec && rec.weekly) };
    if (!rec) return Object.assign(base, { kind: "unset" });
    if (rec.s === "work" || rec.s === "busy") return Object.assign(base, { kind: rec.s });
    if (rec.w && rec.w.length === 0) return Object.assign(base, { kind: "busy" });
    return Object.assign(base, { kind: wouldBeOT(k, priv, pub, rec) ? "ot" : "open" });
  }

  function publicInfo(k) {
    const rec = pubDays[k];
    const kind = rec ? rec.s : pubWeekly.indexOf(dateOf(k).getDay()) >= 0 ? "busy" : "unset";
    return { past: k < todayKey(), kind, w: rec && rec.w ? rec.w : null };
  }

  function publicStatusText(kind) {
    return { open: "Available", ot: "Available, but it would be overtime", busy: "Not Available", unset: "Not Set Yet" }[kind];
  }

  // ---------- render ----------
  function weekRange() {
    const ws = pub.weekStart;
    const start = weekStartOf(todayKey(), ws);
    const days = ownerView() ? priv.days : pubDays;
    const last = Object.keys(days).filter((k) => k >= start).sort().pop();
    let end = addDays(start, 7);
    if (last && weekStartOf(last, ws) > end) end = weekStartOf(last, ws);
    if (ownerView()) {
      const more = addDays(end, 7 * 4);
      end = more > addDays(start, 7 * 7) ? more : addDays(start, 7 * 7);
    }
    const cap = addDays(start, 7 * 40);
    if (end > cap) end = cap;
    const weeks = [];
    for (let w = start; w <= end; w = addDays(w, 7)) weeks.push(w);
    return weeks;
  }

  function weekLabel(ws) {
    const we = addDays(ws, 6);
    const a = dateOf(ws), b = dateOf(we);
    const m1 = fmt(ws, { month: "short" });
    return a.getMonth() === b.getMonth() ? `${m1} ${a.getDate()} – ${b.getDate()}` : `${m1} ${a.getDate()} – ${fmt(we, { month: "short" })} ${b.getDate()}`;
  }

  function render() {
    const asOwner = ownerView();
    if (owner && preview) { pubDays = derivePublic(pub, priv); pubWeekly = weeklyPublic(priv); }
    $("#title").textContent = pub.name ? `${possessive(pub.name)} Availability` : "Shift Availability";
    document.title = pub.name ? `${possessive(pub.name)} Shift Availability` : "Shift Availability";
    $("#empId").hidden = !pub.empId;
    $("#empIdValue").textContent = pub.empId;
    $("#note").hidden = !pub.note;
    $("#note").textContent = pub.note;
    $("#updated").textContent = loadError
      ? "Couldn't load the latest calendar. Check your connection and refresh."
      : updated
        ? `Updated ${new Date(updated).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "";

    $("#willing").hidden = !pub.willing.length;
    $("#willingValue").textContent = pub.willing.map((k) => SHIFT_LABEL[k]).join(" · ");
    // How night shifts sit on the calendar only matters when he takes overnights.
    $("#nightNote").hidden = !pub.willing.includes("overnight");

    $("#dow").replaceChildren(...Array.from({ length: 7 }, (_, i) => h("span", { text: DOW[(pub.weekStart + i) % 7] })));

    const today = todayKey();
    const pending = asOwner ? changes().days : new Set();
    const frag = document.createDocumentFragment();
    weekRange().forEach((ws, wi) => {
      const days = h("div", { class: "days" });
      for (let i = 0; i < 7; i++) {
        const k = addDays(ws, i);
        const d = dateOf(k);
        const showMonth = d.getDate() === 1 || (wi === 0 && i === 0);
        let cls, tag, label, disabled = false, weekly = false;
        if (asOwner) {
          const info = ownerInfo(k);
          cls = ["day", info.kind];
          if (info.kind === "busy") cls.push("hatch");
          if (info.past) cls.push("past");
          tag = OWNER_TAG[info.kind];
          label = info.kind === "work" ? "Working" : info.kind === "busy" ? "Busy" : publicStatusText(info.kind);
          weekly = info.weekly;
          if (weekly) label += `, every ${DOW_LONG[d.getDay()]}`;
        } else {
          const info = publicInfo(k);
          disabled = info.past;
          cls = ["day", info.past ? "past" : info.kind];
          tag = info.past ? "" : PUBLIC_TAG[info.kind];
          label = info.past ? "past" : publicStatusText(info.kind);
        }
        if (k === today) cls.push("today");
        if (pending.has(k)) cls.push("pending");
        days.append(h("button", { type: "button", class: cls.join(" "), "data-key": k, "aria-label": `${longDay(k)}: ${label}`, disabled: disabled || null },
          h("span", { class: "mon", text: showMonth ? fmt(k, { month: "short" }) : "" }),
          h("span", { class: "num", text: d.getDate() }),
          h("span", { class: "tag", text: tag }),
          weekly ? h("span", { class: showMonth ? "rep alt" : "rep", "aria-hidden": "true", text: "↻" }) : null));
      }
      const head = h("div", { class: "week-head" }, h("b", { text: weekLabel(ws) }));
      if (asOwner) {
        const hrs = weekHours(ws, priv, pub.weekStart);
        if (hrs > 0) head.append(h("span", { class: hrs >= priv.otAfter ? "hrs over" : "hrs", text: `${num(hrs)} hrs scheduled${hrs >= priv.otAfter ? " · overtime" : ""}` }));
      }
      frag.append(h("div", { class: "week" }, head, days));
    });
    $("#weeks").replaceChildren(frag);

    document.body.classList.toggle("owner", asOwner);
    document.body.classList.toggle("previewing", owner && preview);
    $("#toolbar").hidden = !asOwner;
    $("#ownerBanner").hidden = !asOwner;
    $("#previewBar").hidden = !(owner && preview);
    renderFoot();
    if (asOwner) renderOwnerBits();
  }

  // Footer links. Supervisors see Credentials and Report Bugs only once they're set up.
  // The owner always sees them, and gets a pointer to Settings if one isn't set up yet.
  function renderFoot() {
    const asOwner = ownerView();
    const cl = $("#credLink");
    cl.hidden = !(credUrl || asOwner);
    cl.href = credUrl || CRED_FILE;
    $("#feedbackLink").hidden = !(pub.feedback || asOwner);
    $("#ownerLink").hidden = owner;
  }

  function renderOwnerBits() {
    const hints = $("#ownerHints");
    hints.replaceChildren();
    if (!privAccess) {
      hints.append(h("b", { text: standIn ? "Fix your GitHub key to see and edit your hours. " : "Fix your GitHub key to save. " }),
        h("button", { type: "button", class: "linkish", text: "Show Me How", onclick: () => showSheet("#keySheet") }));
    } else if (!Object.keys(priv.days).length) {
      hints.append("Every day is gray until you mark it. Tap ", h("b", { text: "Add Schedule" }), " to paste your work schedule, or pick a tool below and tap days.");
    } else {
      hints.append("Tap a tool below, then tap days. Red: working or busy. Green: available. Yellow shows up on its own when a shift would be overtime.");
    }
    if (priv.weekly.length) hints.append(h("br"), "↻ marks your every-week days from Settings.");
    if (!pub.phone) hints.append(h("br"), "Add your cell number in Settings so supervisors can text you.");

    const c = changes();
    const n = c.days.size + (c.settings ? 1 : 0) + (c.publish ? 1 : 0);
    if (c.publish && !c.days.size && !c.settings) hints.append(h("br"), h("b", { text: "Tap Save to update what supervisors see." }));
    const btn = $("#saveBtn");
    btn.disabled = saving || n === 0;
    btn.textContent = saving ? "Saving…" : n ? `Save ${n} Change${n === 1 ? "" : "s"}` : "Saved";
    for (const b of document.querySelectorAll(".brushes button")) b.setAttribute("aria-checked", String(b.dataset.brush === brush));
  }

  // ---------- supervisor sheet ----------
  function smsNumber() {
    const raw = pub.phone.trim();
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    if (raw.startsWith("+")) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
    return digits;
  }
  function prettyPhone() {
    const d = pub.phone.replace(/\D/g, "");
    const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
    return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : pub.phone.trim();
  }
  const apple = () => /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(navigator.userAgent);

  const firstName = () => (pub.name.split(/\s+/)[0] || "");

  // Phones and tablets can open a texting app from the page. On a computer that often does nothing,
  // so a QR code lets the supervisor send the same text from their phone.
  const isPhone = () => /Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini|Silk|Kindle/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let qrLoading = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = "vendor/qrcode.js?v=1";
        tag.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("no qrcode")));
        tag.onerror = () => { qrLoading = null; reject(new Error("load failed")); };
        document.head.appendChild(tag);
      });
    }
    return qrLoading;
  }
  // "SMSTO:number:message" is the QR format iPhone and Android cameras open as a ready-to-send text.
  function qrSvg(lib, text) {
    return qrFor(lib, `SMSTO:${smsNumber()}:${text}`, "QR code that opens this text on a phone");
  }
  function qrFor(lib, data, alt) {
    lib.stringToBytes = lib.stringToBytesFuncs["UTF-8"];
    const q = lib(0, "M");
    q.addData(data, "Byte");
    q.make();
    // At least 3 screen pixels per square so a phone camera can read a long message from a monitor.
    return { svg: q.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt }), size: Math.max(200, (q.getModuleCount() + 8) * 3) };
  }

  // ---------- share the calendar ----------
  // The page's own address, without anything after it (a test query, a #), so everyone gets the same clean link.
  const shareUrl = () => location.origin + location.pathname.replace(/index\.html$/i, "");
  function openShare() {
    const url = shareUrl();
    $("#shareUrl").value = url;
    $("#shareCopy").textContent = "Copy Link";
    $("#shareNative").hidden = typeof navigator.share !== "function";
    const box = $("#shareQr");
    loadQr().then((lib) => {
      const qr = qrFor(lib, url, "QR code with the link to this calendar");
      const code = box.querySelector(".qr-code");
      code.innerHTML = qr.svg;
      code.firstChild.style.width = code.firstChild.style.height = "200px";
      box.hidden = false;
    }).catch(() => { box.hidden = true; });
    showSheet("#shareSheet");
  }
  async function onShareCopy() {
    const b = $("#shareCopy");
    const ok = await copyText($("#shareUrl").value);
    if (!ok) { const i = $("#shareUrl"); i.focus(); i.select(); }
    b.textContent = ok ? "Copied!" : "Press and hold the link to copy it";
    setTimeout(() => { b.textContent = "Copy Link"; }, 2500);
  }
  async function onShareNative() {
    try {
      await navigator.share({ title: document.title, text: pub.name ? `${possessive(pub.name)} Shift Availability` : "Shift Availability", url: shareUrl() });
    } catch (e) {
      if (!e || e.name !== "AbortError") onShareCopy(); // couldn't open the share menu: copy instead
    }
  }
  // Line icons from Feather (feathericons.com, MIT license), drawn in the button's own text color.
  const ICONS = {
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
  };
  function iconLabel(el, icon, text) {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[icon]}</svg><span></span>`;
    el.lastChild.textContent = text;
    return el;
  }
  // A copy button says "Copied!" for a moment. If the browser won't copy, a short note says what to do instead.
  async function copyWithFeedback(btn, icon, label, text, fallback) {
    const ok = await copyText(text);
    if (!ok) { toast(fallback, 4500); return false; }
    iconLabel(btn, "check", "Copied!");
    clearTimeout(btn.copiedTimer);
    btn.copiedTimer = setTimeout(() => iconLabel(btn, icon, label), 2500);
    return true;
  }
  const smsHref = (body) => `sms:${smsNumber()}${apple() ? "&" : "?"}body=${encodeURIComponent(body)}`;
  const hhmm24 = (t) => t.replace(":", "");

  // The text a supervisor sends. Some sentences are always there; the rest appear only when that box is filled.
  function composeMessage(k, f) {
    const first = firstName();
    const out = [first ? `Hi ${first}.` : "Hi."];
    if (f.who) out.push(`This is ${f.who}.`);
    const label = f.type ? SHIFT_LABEL[f.type].toLowerCase() : "";
    const shift = f.type ? `${/^[aeiou]/.test(label) ? "an" : "a"} ${label} shift` : "a shift";
    const day = fmt(k, { weekday: "long", month: "short", day: "numeric" });
    const when = f.type === "overnight" ? `on the night of ${day}` : `on ${day}`;
    const t = f.time ? window.ScheduleParser.readShift(f.time) : null;
    const twelve = (x) => { const [hh, mm] = x.split(":").map(Number); return `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? "AM" : "PM"}`; };
    const from = t ? (t.twelveHour ? `, from ${twelve(t.start)} to ${twelve(t.end)}` : `, from ${hhmm24(t.start)} to ${hhmm24(t.end)}`) : "";
    out.push(`Are you available to cover ${shift} ${when}${from}?`);
    if (f.time && !t) out.push(`The shift time is ${f.time}.`);
    if (f.site && f.addr) out.push(`It's at ${f.site}, ${f.addr}.`);
    else if (f.site) out.push(`It's at ${f.site}.`);
    else if (f.addr) out.push(`The address is ${f.addr}.`);
    out.push("Let me know. Thanks!");
    return out.join(" ");
  }

  function textForm(k, info) {
    const shifts = info.w || pub.willing;
    const remembered = (key) => store.get(key) || "";
    const field = (id, label, attrs, value) => {
      const input = h("input", Object.assign({ type: "text", id }, attrs));
      input.value = value || "";
      return { input, el: h("label", { class: "field" }, h("span", { class: "label", text: label }), input) };
    };
    const who = field("txWho", "Your name", { maxlength: "40", autocomplete: "name" }, remembered(LS.who));
    const time = field("txTime", "Shift time", { maxlength: "40", placeholder: "2300-0700 or 11:00PM to 7:00AM", autocomplete: "off" });
    const site = field("txSite", "Site name", { maxlength: "60", autocomplete: "organization" }, remembered(LS.site));
    const addr = field("txAddr", "Site address", { maxlength: "100", autocomplete: "street-address" }, remembered(LS.addr));
    const timeHint = h("span", { class: "muted small", id: "txTimeHint" });
    // Shift type: preset when he takes only one kind; otherwise the supervisor may pick one.
    let type = shifts.length === 1 ? shifts[0] : null;
    const typeButtons = shifts.length > 1 ? shifts.map((sk) => h("button", { type: "button", class: "pick", "aria-pressed": "false", "data-type": sk, text: SHIFT_LABEL[sk] })) : [];
    const msg = h("textarea", { id: "txMsg", rows: "5", maxlength: "600" });
    const reset = h("button", { type: "button", class: "linkish", text: "Undo My Edits", hidden: true });
    // Send options: three matching buttons. On a computer, a QR code sits beside them.
    const send = iconLabel(h("a", { class: `btn go${info.kind === "ot" ? " ot" : ""}` }), "message", "Open in Messages");
    const copyMsg = iconLabel(h("button", { type: "button", class: "btn ghost" }), "copy", "Copy Message");
    const copyNum = iconLabel(h("button", { type: "button", class: "btn ghost" }), "phone", "Copy Number");
    const qrBox = isPhone() ? null : h("div", { class: "qr send-qr" },
      h("div", { class: "qr-code", "aria-hidden": "true" }),
      h("p", { class: "label", text: "Scan with your phone's camera to text from it" }));
    const sendBody = h("div", { class: "send-body" }, h("div", { class: "send-opts" }, send, copyMsg, copyNum), qrBox);
    const sendBox = h("div", { class: `send${qrBox ? " has-qr" : ""}` }, h("span", { class: "label", text: `Send to ${prettyPhone()}` }), sendBody);
    let qrTimer = 0;
    const drawQr = () => {
      if (!qrBox) return;
      clearTimeout(qrTimer);
      qrTimer = setTimeout(() => {
        loadQr().then((lib) => {
          // A very long message can be too big for a QR code. Hide it until the text fits again.
          try {
            const qr = qrSvg(lib, msg.value), box = qrBox.querySelector(".qr-code");
            box.innerHTML = qr.svg;
            // Beside the buttons the code is at most 240 px. A long message needs a bigger code to scan well,
            // so then it moves under the buttons, where it can use the sheet's full width.
            sendBox.classList.toggle("wide-qr", qr.size > 240);
            const room = qr.size > 240 ? sendBody.clientWidth - 24 : 240; // 24: the card's padding
            box.firstChild.style.width = box.firstChild.style.height = `${room > 0 ? Math.min(qr.size, room) : qr.size}px`;
            qrBox.hidden = false;
          } catch (e) { qrBox.hidden = true; }
        }).catch(() => { qrBox.hidden = true; });
      }, 250);
    };
    let edited = false;
    const values = () => ({ who: who.input.value.trim(), time: time.input.value.trim(), site: site.input.value.trim(), addr: addr.input.value.trim(), type });
    const refresh = () => {
      const v = values();
      if (!edited) msg.value = composeMessage(k, v);
      send.href = smsHref(msg.value);
      drawQr();
      const t = v.time ? window.ScheduleParser.readShift(v.time) : null;
      timeHint.textContent = !v.time ? "Optional. Either format works." : t ? `Reads as ${hhmm24(t.start)} to ${hhmm24(t.end)}.` : "Couldn't read that as a time. It will be sent as you typed it.";
    };
    for (const [f, key] of [[who, LS.who], [site, LS.site], [addr, LS.addr], [time, null]]) {
      f.input.addEventListener("input", () => { if (key) store.set(key, f.input.value.trim()); refresh(); });
    }
    for (const b of typeButtons) {
      b.addEventListener("click", () => {
        type = type === b.dataset.type ? null : b.dataset.type;
        for (const o of typeButtons) o.setAttribute("aria-pressed", String(o.dataset.type === type));
        refresh();
      });
    }
    msg.addEventListener("input", () => { edited = true; reset.hidden = false; send.href = smsHref(msg.value); drawQr(); });
    reset.addEventListener("click", () => { edited = false; reset.hidden = true; refresh(); });
    copyMsg.addEventListener("click", async () => {
      if (!(await copyWithFeedback(copyMsg, "copy", "Copy Message", msg.value, "Couldn't copy here. The message is selected: use your device's Copy."))) {
        msg.focus();
        msg.select();
      }
    });
    copyNum.addEventListener("click", () => copyWithFeedback(copyNum, "phone", "Copy Number", prettyPhone(), `Couldn't copy here. The number is ${prettyPhone()}.`));
    refresh();
    return [
      h("p", { class: "muted small", text: "Every box is optional. What you fill in is added to the message." }),
      who.el,
      typeButtons.length ? h("div", { class: "field" }, h("span", { class: "label", text: "Shift" }), h("div", { class: "picks" }, typeButtons)) : null,
      h("div", { class: "field" }, time.el, timeHint),
      site.el,
      addr.el,
      h("div", { class: "field" },
        h("div", { class: "field-head" }, h("label", { class: "label", for: "txMsg", text: "Message (you can edit it)" }), reset),
        msg),
      sendBox,
    ];
  }

  function openDay(k) {
    const info = publicInfo(k);
    $("#dayKicker").textContent = fmt(k, { weekday: "long" });
    $("#dayTitle").textContent = fmt(k, { month: "long", day: "numeric" });
    const sw = { open: "open", ot: "ot", busy: "busy", unset: "none" }[info.kind];
    const headline = {
      open: "I'm available",
      ot: "I'm available, but it would be overtime",
      busy: "I'm not available this day",
      unset: "Not set yet",
    }[info.kind];
    const wrap = h("div", { class: "stack" }, h("p", { class: "status-line" }, h("span", { class: `sw ${sw}` }), headline));
    if (info.kind === "unset") {
      wrap.append(h("p", { class: "muted", text: "I haven't filled in this day yet." }));
    } else if (info.kind === "open" || info.kind === "ot") {
      if (!smsNumber()) wrap.append(h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." }));
      else wrap.append(...textForm(k, info).filter(Boolean));
    }
    $("#dayBody").replaceChildren(wrap);
    $("#daySheet").showModal();
  }

  // ---------- credentials PDF ----------
  // One PDF at the site's root. Anyone can open it; only the owner's key can replace or remove it.
  const CRED_FILE = "credentials.pdf";
  const CRED_MAX = 20 * 1024 * 1024;
  let credUrl = null; // link to the PDF when there is one
  let credInfo; // owner: {sha, size} from GitHub, null when there's no file, undefined until checked
  let credFromApi = false; // credUrl came from GitHub, which beats the public check
  let credBusy = false;
  let credError = false;
  const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const credLinkFor = (tag) => `${CRED_FILE}?v=${encodeURIComponent(tag)}`;

  // Anyone: is there a PDF on the site? Asked fresh each visit, so a replaced or removed file shows up right away.
  async function checkCred() {
    let url = null;
    try {
      const r = await fetch(CRED_FILE, { method: "HEAD", cache: "no-store" });
      const type = r.headers.get("content-type") || "";
      if (r.ok && !/html/i.test(type)) {
        const tag = (r.headers.get("etag") || r.headers.get("last-modified") || String(Date.now())).replace(/[^A-Za-z0-9]/g, "").slice(-16);
        url = credLinkFor(tag);
      }
    } catch { /* offline: no link */ }
    if (credFromApi) return;
    credUrl = url;
    renderFoot();
  }

  // Owner: what GitHub has right now (the public site can be a minute behind).
  async function loadCredInfo() {
    try {
      const list = await gh("GET", "/contents/");
      const f = Array.isArray(list) ? list.filter((x) => x && x.name === CRED_FILE && x.type === "file")[0] : null;
      credInfo = f ? { sha: f.sha, size: f.size } : null;
      credUrl = f ? credLinkFor(f.sha.slice(0, 12)) : null;
      credFromApi = true;
      credError = false;
    } catch {
      credError = credInfo === undefined;
    }
    renderFoot();
    renderCred();
  }

  function renderCred(status) {
    const st = $("#credStatus");
    st.replaceChildren();
    if (status) st.textContent = status;
    else if (credInfo) {
      st.append(`A PDF is uploaded (${sizeText(credInfo.size)}). `,
        h("a", { href: `https://github.com/${REPO.owner}/${REPO.name}/blob/HEAD/${CRED_FILE}`, target: "_blank", rel: "noopener", text: "Open It" }));
    } else if (credInfo === null) st.textContent = "No PDF uploaded yet. Until you add one, supervisors don't see the link.";
    else st.textContent = credError ? "Couldn't check for a PDF. Close Settings and open it again to retry." : "Checking…";
    $("#credPickText").textContent = credInfo ? "Replace PDF" : "Upload PDF";
    $("#credPick").classList.toggle("disabled", credBusy || credInfo === undefined);
    $("#credFile").disabled = credBusy || credInfo === undefined;
    $("#credRemove").hidden = !credInfo;
    $("#credRemove").disabled = credBusy;
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || ""); // data:application/pdf;base64,...
      r.onerror = () => reject(r.error || new Error("read"));
      r.readAsDataURL(file);
    });
  }

  async function uploadCred(file) {
    if (!file || credBusy) return;
    if (!file.size) { renderCred("That file is empty. Pick the PDF again."); return; }
    if (file.size > CRED_MAX) { renderCred(`That file is ${sizeText(file.size)}. The limit is 20 MB, so save a smaller copy of the PDF and try again.`); return; }
    credBusy = true;
    renderCred("Uploading…");
    let msg = null;
    try {
      const content = await readBase64(file);
      // A PDF starts with "%PDF-" (a few programs put it a little later). Checked here, not by the file's name.
      if (!atob(content.slice(0, 1368)).includes("%PDF-")) throw Object.assign(new Error("not a pdf"), { notPdf: true });
      const put = () => gh("PUT", `/contents/${CRED_FILE}`, Object.assign(
        { message: "Update credentials PDF", content }, credInfo ? { sha: credInfo.sha } : {}));
      let res;
      try {
        res = await put();
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await loadCredInfo(); // changed somewhere else since Settings opened: replace that one
        res = await put();
      }
      credInfo = { sha: res.content.sha, size: res.content.size || file.size };
      credUrl = credLinkFor(res.content.sha.slice(0, 12));
      credFromApi = true;
      toast("PDF uploaded. The See My Credentials link shows it in a minute or two, for you too. To check it now, tap Open It in Settings.", 6000);
    } catch (e) {
      msg = e.notPdf ? "That file isn't a PDF. Pick a .pdf file."
        : e.status === 401 ? "GitHub no longer accepts your key. Tap Stop Editing on This Device below, then connect again."
        : e.status === 403 || e.status === 404 ? "Your GitHub key can't save files. Set its Contents permission to Read and write."
        : e.status === 413 || e.status === 422 ? "GitHub didn't accept the file. Try a smaller copy of the PDF."
        : "Couldn't upload. Check your connection and try again.";
    } finally {
      credBusy = false;
      $("#credFile").value = "";
      renderCred(msg);
      renderFoot();
    }
  }

  async function removeCred() {
    if (!credInfo || credBusy) return;
    if (!window.confirm("Remove your credentials PDF? Supervisors won't see the link until you upload a new one.")) return;
    credBusy = true;
    renderCred("Removing…");
    let msg = null;
    try {
      const del = () => gh("DELETE", `/contents/${CRED_FILE}`, { message: "Remove credentials PDF", sha: credInfo.sha });
      try {
        await del();
      } catch (e) {
        if (e.status === 404) { /* already gone */ } else if (e.status === 409 || e.status === 422) {
          await loadCredInfo();
          if (credInfo) await del();
        } else throw e;
      }
      credInfo = null;
      credUrl = null;
      credFromApi = true;
      toast("PDF removed. The link disappears for supervisors in a minute or two.", 4200);
    } catch (e) {
      msg = e.status === 401 ? "GitHub no longer accepts your key. Tap Stop Editing on This Device below, then connect again."
        : e.status === 403 ? "Your GitHub key can't change files. Set its Contents permission to Read and write."
        : "Couldn't remove it. Check your connection and try again.";
    } finally {
      credBusy = false;
      renderCred(msg);
      renderFoot();
    }
  }

  // ---------- bug reports ----------
  // Sent with FormSubmit (formsubmit.co), a free service that emails a form to an address. Nothing to sign up for:
  // the first report to a new address sends that address an "Activate Form" email, and reports arrive after that.
  const FEEDBACK_URL = "https://formsubmit.co/ajax/";
  const pageUrl = () => location.origin + location.pathname;

  async function sendFeedback(to, fields, subject) {
    const body = Object.assign({ _subject: subject, _template: "table", _captcha: "false", _url: pageUrl() }, fields);
    const res = await fetch(FEEDBACK_URL + to, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    const msg = j && typeof j.message === "string" ? j.message : "";
    if (res.ok && j && String(j.success) === "true") return { ok: true, msg };
    if (/activat/i.test(msg)) return { ok: false, activate: true, msg };
    return { ok: false, msg };
  }

  const deviceInfo = () => ({
    Device: navigator.userAgent,
    Screen: `${window.screen ? `${screen.width}x${screen.height}` : "?"}, window ${window.innerWidth}x${window.innerHeight}`,
    Page: location.href,
    Sent: new Date().toString(),
  });

  function openFeedback() {
    if (!pub.feedback) { toast("Add your email for bug reports in Settings first."); return; }
    $("#fbFields").hidden = false;
    $("#fbDone").hidden = true;
    $("#fbError").hidden = true;
    if (!$("#fbName").value) $("#fbName").value = store.get(LS.who) || "";
    if (!$("#fbContact").value) $("#fbContact").value = store.get(LS.fbContact) || "";
    showSheet("#feedbackSheet");
  }

  let fbSending = false;
  async function onFeedback(e) {
    e.preventDefault();
    if (fbSending) return;
    const text = $("#fbMsg").value.trim();
    const err = $("#fbError");
    if (!text) {
      err.textContent = "Write what went wrong or what should change first.";
      err.hidden = false;
      $("#fbMsg").focus();
      return;
    }
    const name = $("#fbName").value.trim(), contact = $("#fbContact").value.trim();
    if (name) store.set(LS.who, name);
    if (contact) store.set(LS.fbContact, contact); else store.del(LS.fbContact);
    const fields = Object.assign({ Message: text, Name: name || "(not given)", "Reply to": contact || "(not given)" }, deviceInfo(), { _honey: $("#fbHoney").value });
    if (isEmail(contact)) fields.email = contact; // FormSubmit makes this the email's Reply-To
    const btn = $("#fbSend");
    fbSending = true;
    btn.disabled = true;
    btn.textContent = "Sending…";
    err.hidden = true;
    try {
      const r = await sendFeedback(pub.feedback, fields, `Bug report: ${pub.name ? `${possessive(pub.name)} availability` : "availability calendar"}${name ? ` (from ${name})` : ""}`);
      // Before activation FormSubmit holds reports and delivers them once it's activated, so that counts as sent.
      // The owner is told to activate instead.
      if (r.activate && owner) {
        err.textContent = "FormSubmit is waiting for you to activate it. Check your email for a message from FormSubmit and tap Activate Form.";
        err.hidden = false;
      } else if (r.ok || r.activate) {
        $("#fbMsg").value = "";
        $("#fbFields").hidden = true;
        $("#fbDone").hidden = false;
        $("#fbClose").focus();
      } else {
        throw new Error(r.msg || "rejected");
      }
    } catch {
      err.textContent = `Couldn't send it right now. Try again in a little while${pub.phone ? `, or text me at ${prettyPhone()}` : ""}.`;
      err.hidden = false;
    } finally {
      fbSending = false;
      btn.disabled = false;
      btn.textContent = "Submit Feedback";
      if (!err.hidden) btn.focus(); // disabling it dropped the focus; put it back for keyboards and screen readers
    }
  }

  async function onFeedbackTest() {
    const to = feedbackId($("#setFeedback").value);
    const out = $("#fbTestResult");
    const btn = $("#fbTest");
    out.hidden = false;
    if (!to) { out.textContent = "Enter your email address above first."; return; }
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const r = await sendFeedback(to, Object.assign({ Message: "This is a test from Settings. Bug reports from supervisors will look like this." }, deviceInfo()),
        "Test: bug reports from your availability calendar");
      out.textContent = r.ok
        ? `Sent. Check ${isEmail(to) ? to : "your inbox"} (and the spam folder). If it's there, bug reports work.`
          + (isEmail(to) ? " To keep your email out of the public file, paste the random code from FormSubmit's activation email here instead." : "")
          + (!saved || saved.pub.feedback !== to ? " Then tap Save so supervisors can use it." : "")
        : r.activate
          ? `Almost done. FormSubmit emailed ${isEmail(to) ? to : "you"} an Activate Form link. Open it and tap Activate Form, then send another test.`
          : `FormSubmit didn't accept it${r.msg ? `: ${r.msg}` : "."}`;
    } catch {
      out.textContent = "Couldn't reach FormSubmit. Check your connection and try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Send a Test";
    }
  }

  // ---------- owner: edit sheet ----------
  let editKey = null;

  function checkRow(id, x, checked) {
    return h("label", { class: "check", for: id },
      h("input", { type: "checkbox", id, value: x, checked: checked ? true : null }),
      h("span", null, h("b", { text: SHIFT_LABEL[x] })));
  }

  function openEdit(k) {
    editKey = k;
    $("#editTitle").textContent = shortDay(k);
    fillEdit(true);
    $("#editSheet").showModal();
  }

  function weekLine(k) {
    const info = ownerInfo(k);
    const ws = weekStartOf(k, pub.weekStart);
    let line = `${weekLabel(ws)}: ${num(info.booked)} hrs scheduled.`;
    if (info.kind === "ot") line += ` One more ${num(priv.pickup)}-hr shift would go past ${num(priv.otAfter)}, so supervisors see yellow.`;
    else if (info.kind === "open") line += " Supervisors see green.";
    return line;
  }

  function ruleText(r) {
    const when = r.s === "work" && r.start ? `, ${fmtTime(r.start)} – ${fmtTime(r.end)}` : "";
    return `${r.s === "work" ? "Working" : "Busy"} every ${DOW_LONG[r.d]}${when}`;
  }

  function fillEdit(fillInputs) {
    const k = editKey;
    const rec = priv.days[k];
    const rule = ruleOn(k, priv);
    const st = rec ? rec.s : "unset";
    $(`#st${st[0].toUpperCase()}${st.slice(1)}`).checked = true;
    for (const [id, s] of [["#editWork", "work"], ["#editBusy", "busy"], ["#editOpen", "open"], ["#editUnset", "unset"]]) $(id).hidden = st !== s;
    // On an every-week day, "Not set" means "follow the weekly setting".
    $("#stUnsetText").textContent = rule ? "Every Week" : "Not Set";
    $("#stUnsetDot").className = rule ? `dot busy${rule.s === "busy" ? " hatch" : ""}` : "dot none";
    $("#editUnsetText").textContent = rule
      ? `${ruleText(rule)} (from Settings). Supervisors see red. Pick another option to change only this date.`
      : "Shows gray to supervisors.";
    $("#editRuleNote").hidden = !(rule && rec);
    $("#editRuleNote").textContent = rule ? `Changed for this date only. Pick Every Week to go back to: ${ruleText(rule)}.` : "";
    if (fillInputs) {
      const src = rec && rec.s === "work" ? rec : !rec && rule && rule.s === "work" ? rule : null;
      $("#workStart").value = src && src.start ? src.start : "";
      $("#workEnd").value = src && src.end ? src.end : "";
      $("#workHours").value = src ? num(src.hours) : num(priv.pickup);
      $("#workNote").value = rec && rec.s === "work" && rec.note ? rec.note : "";
      $("#busyNote").value = rec && rec.s === "busy" && rec.note ? rec.note : "";
    }
    const willing = rec && rec.s === "open" && rec.w ? rec.w : pub.willing;
    $("#editWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`ew-${x}`, x, willing.includes(x))));
    $("#useUsual").hidden = !(rec && rec.s === "open" && rec.w);
    $("#editWeek").textContent = weekLine(k);
  }

  function onEditChange(e) {
    const k = editKey;
    if (!k) return;
    const t = e.target;
    const st = document.querySelector('input[name="st"]:checked').value;
    if (st === "unset") setDay(k, null);
    else if (st === "busy") setDay(k, cleanPrivRec({ s: "busy", note: $("#busyNote").value }, priv.pickup));
    else if (st === "open") {
      const cur = priv.days[k];
      const fromBoxes = t.closest && t.closest("#editWilling");
      let w = fromBoxes ? [...document.querySelectorAll("#editWilling input:checked")].map((i) => i.value) : cur && cur.s === "open" ? cur.w : null;
      if (w && sameSet(w, pub.willing)) w = null;
      setDay(k, cleanPrivRec({ s: "open", w }, priv.pickup));
    } else {
      const start = $("#workStart").value, end = $("#workEnd").value;
      if ((t.id === "workStart" || t.id === "workEnd") && isTime(start) && isTime(end) && start !== end) {
        $("#workHours").value = num(spanHours(start, end));
      }
      setDay(k, workRec(start, end, $("#workHours").value, $("#workNote").value));
    }
    fillEdit(t.name === "st");
    afterChange();
  }

  // ---------- owner: import ----------
  let importResult = null;

  function describeKeys(item) {
    if (item.filtered) return item.keys.map(shortDay).join(", ");
    const withYear = (k) => (k.slice(0, 4) === todayKey().slice(0, 4) ? shortDay(k) : `${shortDay(k)}, ${k.slice(0, 4)}`);
    return item.groups.map((g) => (g.from === g.to ? withYear(g.from) : `${withYear(g.from)} – ${withYear(g.to)}`)).join(", ");
  }
  function describeRec(rec) {
    if (rec.s === "work") {
      const t = rec.start ? `${fmtTime(rec.start)} – ${fmtTime(rec.end)}, ` : "";
      const hrs = rec.hours != null ? rec.hours : priv.pickup;
      return `Working ${t}${num(hrs)} hrs${rec.note ? ` · ${rec.note}` : ""}`;
    }
    if (rec.s === "busy") return `Busy${rec.note ? ` · ${rec.note}` : ""}`;
    if (rec.s === "open") return `Available${rec.w ? ` (${rec.w.map((x) => SHIFT_LABEL[x]).join(", ")})` : ""}`;
    return "Clear (back to gray)";
  }
  const dotFor = (s) => ({ work: "busy", busy: "busy hatch", open: "open", clear: "none" }[s]);

  // Final per-day result of the pasted text (later lines win), plus gray days inside the pasted span.
  function planImport(result) {
    const final = new Map();
    for (const it of result.items) for (const k of it.keys) final.set(k, it.rec);
    const skipped = new Set(result.errors.flatMap((er) => er.keys || []));
    let gaps = [];
    const keys = [...final.keys()].sort();
    if (keys.length > 1) {
      for (let k = keys[0]; k <= keys[keys.length - 1]; k = addDays(k, 1)) {
        if (!final.has(k) && !dayRec(k, priv) && !skipped.has(k)) gaps.push(k);
      }
    }
    if (gaps.length > 200) gaps = [];
    const replaced = [...final.entries()].filter(([k, rec]) => { const cur = dayRec(k, priv); return cur && rec.s !== "clear" && cur.s !== rec.s; }).length;
    // Every-week days the paste would turn green: worth a second look, since they're usually worked.
    const freed = [...final.entries()].filter(([k, rec]) => rec.s === "open" && !priv.days[k] && ruleOn(k, priv)).map(([k]) => k).sort();
    const workLines = new Map();
    for (const it of result.items) if (it.rec.s === "work") for (const k of it.keys) workLines.set(k, (workLines.get(k) || 0) + 1);
    const doubled = [...workLines.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
    return { final, gaps, replaced, doubled, freed };
  }

  function renderImport() {
    const text = $("#importText").value;
    store.set(LS.importText, text);
    const box = $("#importPreview");
    box.replaceChildren();
    importResult = window.ScheduleParser.parse(text, todayKey());
    const { items, errors } = importResult;
    const plan = planImport(importResult);
    if (!items.length && !errors.length) {
      $("#gapBox").hidden = true;
      $("#importApply").disabled = true;
      $("#importApply").textContent = "Add to Calendar";
      return;
    }
    const rows = [];
    for (const it of items) {
      rows.push({ line: it.line, el: h("li", { class: "pv-item" },
        h("span", { class: `dot ${dotFor(it.rec.s)}` }),
        h("span", { class: "pv-text" },
          h("b", { text: describeKeys(it) }),
          h("span", { text: it.rec.s === "clear" && it.keys.some((k) => ruleOn(k, priv)) ? "Clear (back to your every-week setting where you have one, gray elsewhere)" : describeRec(it.rec) }),
          it.warn ? h("span", { class: "pv-warn strong", text: it.warn }) : null,
          it.ignored ? h("span", { class: "pv-warn", text: `Ignored: "${it.ignored}"` }) : null)) });
    }
    for (const er of errors) {
      rows.push({ line: er.line, el: h("li", { class: "pv-item pv-err" },
        h("span", { class: "pv-x", text: "!" }),
        h("span", { class: "pv-text" }, h("b", { text: `Line ${er.line}: ${er.text}` }), h("span", { text: er.msg }))) });
    }
    rows.sort((a, b) => a.line - b.line);
    const n = plan.final.size;
    const summary = [`${n} day${n === 1 ? "" : "s"} ready`];
    if (plan.replaced) summary.push(`${plan.replaced} already marked will change`);
    if (errors.length) summary.push(`${errors.length} line${errors.length === 1 ? "" : "s"} skipped (fix or delete ${errors.length === 1 ? "it" : "them"})`);
    box.append(h("p", { class: errors.length ? "pv-sum warn" : "pv-sum", text: summary.join(" · ") }));
    if (plan.doubled.length) {
      box.append(h("p", { class: "pv-sum warn", text: `${plan.doubled.map(shortDay).join(", ")} ${plan.doubled.length === 1 ? "is" : "are"} on more than one work line. Only the last line counts. For a double shift, write one line with the total hours, like 10/7 work 16h.` }));
    }
    if (plan.freed.length) {
      box.append(h("p", { class: "pv-sum warn", text: `${plan.freed.map(shortDay).join(", ")} ${plan.freed.length === 1 ? "is an every-week day" : "are every-week days"} in Settings. Adding ${plan.freed.length === 1 ? "it" : "them"} as available changes only ${plan.freed.length === 1 ? "that date" : "those dates"}; the weekly setting stays on.` }));
    }
    box.append(h("ul", { class: "pv-list" }, rows.map((r) => r.el)));

    // Filling gaps waits until every line reads cleanly, so a skipped line's days are never turned green.
    const gapBox = $("#gapBox");
    gapBox.hidden = !plan.gaps.length || errors.length > 0;
    if (plan.gaps.length && errors.length) box.append(h("p", { class: "muted small", text: "Fix the skipped lines to fill in the gray days between your dates." }));
    if (plan.gaps.length) {
      $("#gapLegend").textContent = `${plan.gaps.length} gray day${plan.gaps.length === 1 ? "" : "s"} between ${shortDay(plan.final.size ? [...plan.final.keys()].sort()[0] : plan.gaps[0])} and ${shortDay([...plan.final.keys()].sort().pop())} aren't in your list.`;
    }
    const gapOpen = !gapBox.hidden && $("#gapOpen").checked;
    const total = n + (gapOpen ? plan.gaps.length : 0);
    $("#importApply").disabled = total === 0;
    $("#importApply").textContent = total ? `Add ${total} Day${total === 1 ? "" : "s"} to Calendar` : "Add to Calendar";
  }

  function applyImport() {
    if (!importResult) return;
    const plan = planImport(importResult);
    for (const [k, rec] of plan.final) {
      if (rec.s === "clear") setDay(k, null);
      else setDay(k, cleanPrivRec(Object.assign({}, rec, rec.s === "work" && rec.hours == null ? { hours: priv.pickup } : {}), priv.pickup));
    }
    const gapOpen = !$("#gapBox").hidden && $("#gapOpen").checked;
    if (gapOpen) for (const k of plan.gaps) setDay(k, { s: "open" });
    const total = plan.final.size + (gapOpen ? plan.gaps.length : 0);
    // Lines that couldn't be read stay in the box so they can be fixed.
    const lines = $("#importText").value.split(/\r\n|\r|\n/);
    const leftover = [...new Set(importResult.errors.map((er) => er.line))].map((n) => lines[n - 1]).join("\n");
    $("#importText").value = leftover;
    if (leftover) store.set(LS.importText, leftover); else store.del(LS.importText);
    $("#importSheet").close();
    afterChange();
    toast(`Added ${total} day${total === 1 ? "" : "s"}.${leftover ? " Lines that couldn't be read are still in Add Schedule." : ""} Check them, then tap Save.`, 5000);
  }

  function openImport() {
    $("#importText").value = store.get(LS.importText) || "";
    $("#gapGray").checked = true;
    renderImport();
    $("#importSheet").showModal();
  }

  // ---------- owner: settings ----------
  function otExplain() {
    const end = DOW_LONG[(pub.weekStart + 6) % 7];
    return `Each pay week ends ${end} at midnight. Hours worked after that count toward the next week, and a shift that crosses midnight is split between the two weeks. A green day turns yellow when one more ${num(priv.pickup)}-hour shift would push its pay week past ${num(priv.otAfter)} hours.`;
  }

  // ---------- owner: every-week days ----------
  function renderWeekly() {
    const box = $("#setWeekly");
    box.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = (pub.weekStart + i) % 7;
      const on = ruleFor(priv.weekly, d);
      // An unchecked day shows its saved setting, so checking it again brings back the same times and hours.
      const r = on || ruleFor(saved ? saved.priv.weekly : [], d);
      const cb = h("input", { type: "checkbox", id: `wk-${d}`, "data-f": "on" });
      cb.checked = !!on;
      const sel = h("select", { "data-f": "s" }, h("option", { value: "work", text: "Working" }), h("option", { value: "busy", text: "Busy (Not Working)" }));
      sel.value = r ? r.s : "work";
      const input = (f, attrs, value) => { const el = h("input", Object.assign({ "data-f": f }, attrs)); el.value = value; return el; };
      const work = h("div", { class: "wk-work" },
        h("label", { class: "field" }, h("span", { class: "label", text: "Starts (optional)" }), input("start", { type: "time" }, r && r.start ? r.start : "")),
        h("label", { class: "field" }, h("span", { class: "label", text: "Ends (optional)" }), input("end", { type: "time" }, r && r.end ? r.end : "")),
        h("label", { class: "field" }, h("span", { class: "label", text: "Paid hours" }),
          input("hours", { type: "number", min: "0.25", max: "24", step: "any", inputmode: "decimal" }, num(r && r.s === "work" ? r.hours : priv.pickup))));
      const fields = h("div", { class: "wk-fields" }, h("label", { class: "field" }, h("span", { class: "label", text: `Every ${DOW_LONG[d]} I'm` }), sel), work);
      fields.hidden = !on;
      work.hidden = !on || on.s !== "work";
      box.append(h("div", { class: "wk-row", "data-d": String(d) }, h("label", { class: "check", for: `wk-${d}` }, cb, h("span", { text: DOW_LONG[d] })), fields));
    }
  }

  // Only the row that changed is read, so a rule saved meanwhile from another tab isn't overwritten.
  function readWeekly(t) {
    const row = t.closest(".wk-row");
    if (!row) return;
    const val = (f) => row.querySelector(`[data-f="${f}"]`).value;
    if (t.dataset.f === "start" || t.dataset.f === "end") {
      const s = val("start"), e = val("end");
      if (isTime(s) && isTime(e) && s !== e) row.querySelector('[data-f="hours"]').value = num(spanHours(s, e));
    }
    const dow = Number(row.dataset.d), on = row.querySelector('[data-f="on"]').checked, s = val("s");
    row.querySelector(".wk-fields").hidden = !on;
    row.querySelector(".wk-work").hidden = !on || s !== "work";
    const was = ruleFor(saved ? saved.priv.weekly : [], dow);
    const rule = on ? cleanRule({ d: dow, s, start: val("start"), end: val("end"), hours: val("hours") }, priv.pickup) : null;
    // A new or changed rule counts from today. One that's back to its saved form keeps its saved start.
    if (rule) { if (was && ruleCore(was) === ruleCore(rule)) { if (was.from) rule.from = was.from; } else rule.from = todayKey(); }
    priv.weekly = cleanWeekly(priv.weekly.filter((r) => r.d !== dow).concat(rule ? [rule] : []), priv.pickup);
    keepPastWeek();
  }

  // Changes to every-week days count from today. Days already past in this pay week (and the night before it starts,
  // whose shift can run into it) keep the saved rule as their own record, so this week's hours and yellow days stay right.
  // A day turned off also keeps today. Recomputed on every change, so undoing a change removes the copies it made.
  const autoCopies = {};
  function keepPastWeek() {
    for (const k of Object.keys(autoCopies)) {
      if (same(priv.days[k], autoCopies[k])) delete priv.days[k];
      delete autoCopies[k];
    }
    if (!saved) return;
    const today = todayKey();
    for (let k = addDays(weekStartOf(today, pub.weekStart), -1); k <= today; k = addDays(k, 1)) {
      const dow = dateOf(k).getDay();
      const was = ruleFor(saved.priv.weekly, dow), now = ruleFor(priv.weekly, dow);
      if (!was || (was.from && k < was.from)) continue;
      const copy = Object.assign({}, was);
      delete copy.d;
      delete copy.from;
      if (now && (ruleCore(now) === ruleCore(was) || k === today)) {
        // The rule is back to its saved form: an unsaved copy of it (one restored after a reload) isn't needed.
        if (ruleCore(now) === ruleCore(was) && priv.days[k] && !saved.priv.days[k] && same(priv.days[k], copy)) delete priv.days[k];
        continue;
      }
      if (priv.days[k]) continue;
      priv.days[k] = copy;
      autoCopies[k] = copy;
    }
  }
  const forgetAutoCopies = () => { for (const k of Object.keys(autoCopies)) delete autoCopies[k]; };

  let fbAtOpen = "";
  function openSettings() {
    $("#setNote").value = pub.note;
    $("#setName").value = pub.name;
    $("#setEmpId").value = pub.empId;
    $("#setPhone").value = pub.phone;
    $("#setFeedback").value = pub.feedback;
    fbAtOpen = pub.feedback;
    $("#setFeedbackError").hidden = true;
    $("#fbTestResult").hidden = true;
    renderCred();
    if (!credBusy && (credInfo === undefined || credError)) loadCredInfo();
    $("#setWeekEnd").value = String((pub.weekStart + 6) % 7);
    $("#setOt").value = num(priv.otAfter);
    $("#setPickup").value = num(priv.pickup);
    $("#otExplain").textContent = otExplain();
    $("#setWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`sw-${x}`, x, pub.willing.includes(x))));
    renderWeekly();
    $("#repoLine").textContent = `Saves to github.com/${REPO.owner}/${REPO.name}`;
    $("#settingsSheet").showModal();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.id === "setNote") pub.note = t.value.slice(0, 140);
    else if (t.id === "setName") pub.name = t.value.trim().slice(0, 40);
    else if (t.id === "setEmpId") pub.empId = t.value.trim().slice(0, 20);
    else if (t.id === "setPhone") pub.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setFeedback") {
      const typed = t.value.trim(), id = feedbackId(typed);
      $("#setFeedbackError").textContent = "That doesn't look like an email address. Until it's fixed, the address you had stays.";
      $("#setFeedbackError").hidden = !typed || !!id;
      // While the box doesn't hold a whole address, keep the one from when Settings opened, never a half-typed one.
      pub.feedback = !typed ? "" : id || fbAtOpen;
    }
    else if (t.id === "setWeekEnd") { pub.weekStart = ((parseInt(t.value, 10) || 0) + 1) % 7; renderWeekly(); }
    else if (t.closest && t.closest("#setWeekly")) readWeekly(t);
    else if (t.id === "setOt") { if (Number(t.value) > 0) priv.otAfter = Number(t.value); }
    else if (t.id === "setPickup") { if (Number(t.value) > 0 && Number(t.value) <= 24) priv.pickup = Number(t.value); }
    else if (t.closest("#setWilling")) pub.willing = [...document.querySelectorAll("#setWilling input:checked")].map((i) => i.value);
    else return;
    $("#otExplain").textContent = otExplain();
    afterChange();
  }

  // ---------- owner: connect / load / save ----------
  async function loadOwnerState(tok) {
    const [pubRes, privRes] = await Promise.all([getPublicRemote(tok), getPrivateRemote(tok)]);
    const file = readPublicFile(pubRes.raw);
    let p = file.pub, v;
    if (privRes.status === 200) {
      let parsed = null;
      try { parsed = JSON.parse(privRes.value); } catch { /* unreadable: rebuild below */ }
      v = parsed ? normalizePriv(parsed) : file.migrated ? file.migrated.priv : privFromPublicDays(file.days, file.weekly);
    } else {
      v = file.migrated ? file.migrated.priv : privFromPublicDays(file.days, file.weekly);
    }
    const today = todayKey();
    const upcoming = (days) => JSON.stringify(Object.keys(days).filter((k) => k >= today).sort().map((k) => [k, days[k]]));
    // The private schedule is the source of truth and the public file is built from it. If they differ
    // (a save stopped after storing the hours), the public file just needs publishing again.
    const behind = !!file.migrated || upcoming(file.days) !== upcoming(derivePublic(p, v)) || !same(file.weekly, weeklyPublic(v));
    // Older copies of this page don't know every-week days and save without them. The new version always writes the key.
    const weeklyLost = privRes.status === 200 && !/"weekly"\s*:/.test(privRes.value || "");
    return { weeklyLost, pub: p, priv: v, pubSha: pubRes.sha, privAt: privRes.updatedAt || null, privExists: privRes.status === 200, privAccess: privRes.status !== 403, updated: file.updated, behind };
  }

  async function enterOwner() {
    busy = true;
    try {
      const st = await loadOwnerState(token);
      owner = true;
      brush = ["edit", "work", "busy", "open"].includes(store.get(LS.brush)) ? store.get(LS.brush) : "edit";
      saved = { pub: clone(st.pub), priv: clone(st.priv) };
      pubSha = st.pubSha;
      privAt = st.privAt;
      privExists = st.privExists;
      privAccess = st.privAccess;
      standIn = !st.privAccess;
      needsPublish = st.behind;
      updated = st.updated;
      pub = clone(st.pub);
      priv = clone(st.priv);
      store.del(LS.draft2); // from a test build; never stored real data
      forgetAutoCopies();
      let lostWeekly = false;
      try {
        const last = cleanWeekly(JSON.parse(store.get(LS.lastWeekly) || "[]"), priv.pickup);
        if (st.weeklyLost && last.length && !priv.weekly.length) { priv.weekly = last; lostWeekly = true; }
        else if (!st.weeklyLost) store.set(LS.lastWeekly, JSON.stringify(st.priv.weekly));
      } catch { /* unreadable */ }
      if (lostWeekly) setTimeout(() => toast("An older open copy of this page removed your every-week days when it saved. They're back here. Tap Save to keep them.", 8000), 600);
      let restored = 0;
      if (!standIn) {
        // The first version of the site stored a full copy; only its marked days that are still unset here come back.
        try {
          const old = JSON.parse(store.get(LS.oldDraft) || "null");
          if (old && old.data && old.data.days) {
            const m = migrateV1(Object.assign({}, old.data, { through: "" }));
            for (const [k, rec] of Object.entries(m.priv.days)) if (!priv.days[k]) priv.days[k] = rec;
          }
        } catch { /* unreadable old draft */ }
        store.del(LS.oldDraft);
        // Unsaved changes from earlier visits and other tabs, oldest first, applied to the newest calendar.
        // They're folded into this page's record and the old keys removed, so each change lives in one place.
        // A tab that is still open writes its own key again on its next edit.
        const drafts = [];
        for (const key of store.keys(LS.draftPrefix)) {
          if (key === OWN_DRAFT) continue;
          try {
            const d = JSON.parse(store.get(key));
            if (d && typeof d === "object" && Date.now() - (d.ts || 0) < 30 * 86400000) drafts.push(d);
          } catch { /* unreadable */ }
          store.del(key);
        }
        drafts.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        let skipped = 0;
        for (const d of drafts) skipped += applyDiff(d, true).skipped;
        restored = changes().days.size + (changes().settings ? 1 : 0);
        if (skipped) setTimeout(() => toast(`${skipped} unsaved change${skipped === 1 ? " was" : "s were"} skipped because that day was saved from somewhere else since.`, 6000), 3500);
      }
      loadError = false;
      busy = false;
      persistDraft();
      render();
      if (restored) toast("Restored changes you hadn't saved yet");
      loadCredInfo();
      if (privAccess && !standIn) {
        // Reading isn't enough: check now that the key can save hours, so a save never stops halfway.
        try {
          if (!(await canWriteVariables())) { privAccess = false; render(); showSheet("#keySheet"); toast("Your key can read your hours but not save them. Set Variables to Read and write.", 6000); }
        } catch { /* offline: the save will report it */ }
      }
      if (!privAccess && !$("#keySheet").open) showSheet("#keySheet");
      return { restored: restored > 0 };
    } catch (e) {
      busy = false;
      owner = false;
      if (e.status === 401) {
        store.del(LS.token);
        token = null;
        render();
        openUnlock("Your saved token stopped working. Enter a new one.");
      } else {
        render();
        toast("Couldn't reach GitHub, so editing is off for now. Refresh to try again.", 5000);
      }
      return { restored: false };
    }
  }

  function openUnlock(msg) {
    for (const el of document.querySelectorAll(".repo-name")) el.textContent = REPO.name;
    $("#unlockError").hidden = !msg;
    $("#unlockError").textContent = msg || "";
    $("#unlockDraft").hidden = !(store.keys(LS.draftPrefix).length || store.get(LS.oldDraft) || store.get(LS.importText));
    $("#unlockSheet").showModal();
  }

  async function onUnlock(e) {
    e.preventDefault();
    if (e.submitter && e.submitter.value === "close") { $("#unlockSheet").close(); return; }
    const tok = $("#tokenInput").value.trim();
    const err = $("#unlockError");
    if (!tok) { err.textContent = "Enter a token."; err.hidden = false; return; }
    const btn = $("#unlockBtn");
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      await getPublicRemote(tok);
      token = tok;
      store.set(LS.token, tok);
      $("#tokenInput").value = "";
      $("#unlockSheet").close();
      await enterOwner();
      if (owner && privAccess) toast("Connected. You can edit now.");
    } catch (x) {
      err.hidden = false;
      err.textContent = x.status === 401
        ? "That token didn't work."
        : x.status === 404 || x.status === 403
          ? "That token doesn't have access."
          : "Couldn't reach GitHub. Check your connection and try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  }

  const byteLength = (text) => new TextEncoder().encode(text).length;

  // The private variable's contents, trimmed of old days if it would be too big for GitHub.
  function privatePayload(v, ws) {
    const today = todayKey();
    for (const cutoff of [addDays(today, -60), addDays(today, -14), weekStartOf(today, ws)]) {
      const out = Object.assign({}, v, { v: 2, rev: "", days: {} });
      for (const k of Object.keys(v.days).sort()) if (k >= cutoff) out.days[k] = v.days[k];
      const text = JSON.stringify(out);
      if (byteLength(text) <= VAR_LIMIT) return { text, priv: normalizePriv(out), cutoff };
    }
    return null;
  }

  const conflictError = () => Object.assign(new Error("conflict"), { conflict: true });

  async function writePrivate(text, force) {
    const patch = () => gh("PATCH", `/actions/variables/${PRIVATE_VAR}`, { name: PRIVATE_VAR, value: text });
    const post = () => gh("POST", "/actions/variables", { name: PRIVATE_VAR, value: text });
    lastPrivText = text;
    if (privExists) {
      try { await patch(); } catch (e) { if (e.status !== 404) throw e; await post(); } // deleted on GitHub: create it again
    } else {
      try { await post(); } catch (e) {
        if (e.status !== 409) throw e;
        if (!force) throw conflictError(); // another device created it first
        await patch();
      }
    }
    privExists = true;
    lastPrivText = text;
    try {
      const after = await getPrivateRemote(token);
      if (after.status === 200) privAt = after.updatedAt;
    } catch { /* the next save matches on lastPrivText instead */ }
  }

  const publicCore = (o) => o && JSON.stringify(Object.assign({}, o, { updated: null, rev: null }));

  async function save(force) {
    if (saving) return;
    if (!privAccess) { showSheet("#keySheet"); return; }
    // Work from a snapshot, so edits made while saving stay as unsaved changes.
    const snapPub = clone(pub);
    const payload = privatePayload(clone(priv), snapPub.weekStart);
    if (!payload) { toast("Your calendar has too many days to save. Clear some far-off days and try again.", 6000); return; }
    saving = true;
    renderOwnerBits();
    const stamp = new Date().toISOString();
    const rev = `${stamp}~${Math.random().toString(36).slice(2, 6)}`;
    const pubOut = Object.assign({ v: 2 }, snapPub, { days: derivePublic(snapPub, payload.priv), weekly: weeklyPublic(payload.priv), updated: stamp, rev });
    const privText = JSON.stringify(Object.assign(JSON.parse(payload.text), { rev }));
    let stage = "check";
    try {
      // Check both files before writing either, so a newer save from another device is never overwritten.
      const remotePub = await getPublicRemote(token);
      const remotePriv = await getPrivateRemote(token);
      if (remotePriv.status === 403) { privAccess = false; throw Object.assign(new Error("key"), { key: true }); }
      if (!force) {
        // A version that only differs because this device's own earlier write went through is not a conflict.
        const ownPub = publicCore(remotePub.raw) === lastPubSent || publicCore(remotePub.raw) === publicCore(pubOut);
        const sameData = (t) => { try { return JSON.stringify(Object.assign(JSON.parse(t), { rev: null })) === JSON.stringify(Object.assign(JSON.parse(privText), { rev: null })); } catch { return false; } };
        const ownPriv = remotePriv.status === 200 && (remotePriv.value === lastPrivText || sameData(remotePriv.value));
        if (remotePub.sha !== pubSha && !ownPub) throw conflictError();
        if (remotePriv.status === 200 && remotePriv.updatedAt !== privAt && !ownPriv) throw conflictError();
        if (remotePriv.status === 404 && privExists) throw conflictError(); // deleted elsewhere: let him choose
      }
      pubSha = remotePub.sha;
      privExists = remotePriv.status === 200;
      if (privExists) privAt = remotePriv.updatedAt;
      // Hours first: they're the source of truth. If the public file then fails, the next load republishes it.
      stage = "private";
      lastPrivText = privText;
      await writePrivate(privText, force);
      for (const k of Object.keys(priv.days)) if (k < payload.cutoff) delete priv.days[k];
      saved = { pub: snapPub, priv: payload.priv };
      needsPublish = true;
      persistDraft();
      stage = "public";
      lastPubSent = publicCore(pubOut);
      const put = (sha) => gh("PUT", "/contents/data.json", {
        message: `Update availability (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
        content: b64encode(JSON.stringify(pubOut, null, 2) + "\n"),
        sha,
      });
      let res;
      try {
        res = await put(pubSha);
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        // The public file changed in the last moment. It's rebuilt from the hours just saved, so write it again.
        res = await put((await getPublicRemote(token)).sha);
      }
      pubSha = res.content.sha;
      updated = stamp;
      needsPublish = false;
      pruneOtherDrafts();
      forgetAutoCopies();
      store.set(LS.lastWeekly, JSON.stringify(saved.priv.weekly));
      store.set(LS.savedSignal, rev); // other open tabs rebase on this save
      toast("Saved. Supervisors will see it within a minute or two.", 4200);
    } catch (e) {
      if (e.conflict || (stage === "private" && e.status === 409)) showSheet("#conflictSheet");
      else if (e.key || (stage === "private" && e.status === 403)) { privAccess = false; showSheet("#keySheet"); }
      else if (e.status === 401) toast("GitHub no longer accepts your key. Open Settings, tap Stop Editing on This Device, then connect again.", 6000);
      else if (stage === "private" && e.status === 422) toast("GitHub wouldn't store your hours. Clear some far-off days and tap Save again.", 7000);
      else if (stage === "public" && (e.status === 403 || e.status === 404)) toast("Your hours are saved, but your key can't update the calendar file. On GitHub, set the token's Contents permission to Read and write.", 7000);
      else if (stage === "public") toast("Your hours are saved, but the public calendar didn't update. Tap Save again.", 6000);
      else toast("Couldn't save. Check your connection and tap Save again.", 5000);
    } finally {
      saving = false;
      persistDraft();
      render();
    }
  }

  // Re-applies this device's unsaved changes on top of the newest saved calendar, then saves.
  async function mergeAndSave() {
    busy = true;
    render();
    let st;
    try { st = await loadOwnerState(token); } catch { busy = false; render(); toast("Couldn't reach GitHub. Try Save again in a moment."); return; }
    const mine = diffOf(); // editing was paused, so this is everything changed here
    forgetAutoCopies();
    saved = { pub: clone(st.pub), priv: clone(st.priv) };
    pub = clone(st.pub);
    priv = clone(st.priv);
    applyDiff(mine, false);
    pubSha = st.pubSha;
    privAt = st.privAt;
    privExists = st.privExists;
    needsPublish = st.behind;
    busy = false;
    persistDraft();
    render();
    await save(false);
  }

  async function onConflict() {
    const v = $("#conflictSheet").returnValue;
    if (v === "merge") return mergeAndSave();
    if (v === "reload") {
      store.del(OWN_DRAFT);
      busy = true;
      render();
      await enterOwner();
      if (owner) toast("Loaded the newer calendar");
    }
  }

  // Checks that the key can write repository variables, using a throwaway variable.
  async function canWriteVariables() {
    const name = "AVAILABILITY_KEY_CHECK";
    try {
      await gh("POST", "/actions/variables", { name, value: "ok" });
    } catch (e) {
      if (e.status === 403 || e.status === 404) return false;
      if (e.status !== 409) throw e; // 409: left over from an earlier check, delete it below
    }
    try { await gh("DELETE", `/actions/variables/${name}`); } catch (e) { if (e.status === 403) return false; }
    return true;
  }

  async function onKeyRetry() {
    if ($("#keySheet").returnValue !== "retry") return;
    let r, writable;
    try {
      r = await getPrivateRemote(token);
      writable = r.status === 403 ? false : await canWriteVariables();
    } catch { toast("Couldn't reach GitHub. Try again in a moment."); return; }
    if (r.status === 403) { toast("Your key still can't open Variables. Check both settings in the steps.", 5000); showSheet("#keySheet"); return; }
    if (!writable) { toast("Variables is set to read-only. Set it to Read and write, then try again.", 5000); showSheet("#keySheet"); return; }
    const res = await enterOwner(); // loads the real schedule and any draft saved before
    if (owner && !res.restored) toast("Your key is set.");
  }

  // ---------- wiring ----------
  function wire() {
    for (const el of document.querySelectorAll(".repo-name")) el.textContent = REPO.name;
    $("#empIdCopy").addEventListener("click", async () => {
      const b = $("#empIdCopy");
      const ok = await copyText(pub.empId);
      b.textContent = ok ? "Copied" : "Press and hold to copy";
      setTimeout(() => { b.textContent = "Copy"; }, 2500);
    });
    for (const x of document.querySelectorAll(".sheet .x")) {
      x.type = "button";
      x.addEventListener("click", () => x.closest("dialog").close(""));
    }
    // close("") clears returnValue, so dismissing a sheet never repeats the last button's action.
    for (const d of document.querySelectorAll("dialog.sheet")) {
      d.addEventListener("click", (e) => { if (e.target === d) d.close(""); });
      d.addEventListener("cancel", () => { d.returnValue = ""; });
    }
    $("#weeks").addEventListener("click", (e) => {
      const b = e.target.closest(".day");
      if (!b || b.disabled) return;
      const k = b.dataset.key;
      if (!ownerView()) return openDay(k);
      if (busy) return toast("One moment, loading your calendar…");
      if (standIn) return showSheet("#keySheet");
      if (brush === "edit") openEdit(k);
      else applyBrush(k);
    });
    $("#ownerLink").addEventListener("click", () => (token ? enterOwner() : openUnlock()));
    $("#credLink").addEventListener("click", (e) => {
      if (!credUrl) {
        e.preventDefault();
        toast("No PDF yet. Upload one in Settings.");
        return;
      }
      // The owner's link follows GitHub, which can be a minute ahead of the public site, so skip any cached copy.
      if (credFromApi) e.currentTarget.href = `${credUrl}&t=${Date.now()}`;
    });
    $("#feedbackLink").addEventListener("click", openFeedback);
    $("#shareBtn").addEventListener("click", openShare);
    $("#shareCopy").addEventListener("click", onShareCopy);
    $("#shareNative").addEventListener("click", onShareNative);
    $("#feedbackForm").addEventListener("submit", onFeedback);
    $("#fbClose").addEventListener("click", () => $("#feedbackSheet").close(""));
    $("#credFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // so picking the same file again (after fixing it) still counts as a new pick
      uploadCred(file);
    });
    $("#settingsSheet").addEventListener("close", () => {
      if (!$("#setFeedbackError").hidden) toast("Your bug-report email didn't change, because the new one wasn't a full email address.", 5000);
    });
    $("#credRemove").addEventListener("click", removeCred);
    $("#fbTest").addEventListener("click", onFeedbackTest);
    $("#unlockForm").addEventListener("submit", onUnlock);
    $("#editForm").addEventListener("change", onEditChange);
    for (const id of ["#workHours", "#workNote", "#busyNote"]) $(id).addEventListener("input", onEditChange);
    $("#useUsual").addEventListener("click", () => { setDay(editKey, { s: "open" }); fillEdit(false); afterChange(); });
    $("#settingsForm").addEventListener("input", onSettingsChange);
    $("#settingsForm").addEventListener("change", onSettingsChange);
    $("#signOut").addEventListener("click", () => {
      for (const k of [LS.token, ...store.keys(LS.draftPrefix), LS.draft2, LS.oldDraft, LS.importText, LS.brush]) store.del(k);
      location.reload();
    });
    $("#settingsBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openSettings()));
    $("#importBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openImport()));
    $("#unlockDiscard").addEventListener("click", () => {
      for (const k of [...store.keys(LS.draftPrefix), LS.draft2, LS.oldDraft, LS.importText]) store.del(k);
      $("#unlockDraft").hidden = true;
      toast("Discarded");
    });
    // Two tabs editing at once would overwrite each other's unsaved changes.
    window.addEventListener("storage", (e) => {
      if (owner && e.key === LS.savedSignal) rebase();
    });
    let importTimer = 0;
    $("#importText").addEventListener("input", () => { clearTimeout(importTimer); importTimer = setTimeout(renderImport, 200); });
    $("#gapBox").addEventListener("change", renderImport);
    $("#importApply").addEventListener("click", applyImport);
    $("#saveBtn").addEventListener("click", () => (busy ? null : save(false)));
    $("#conflictSheet").addEventListener("close", onConflict);
    $("#keySheet").addEventListener("close", onKeyRetry);
    $("#previewBtn").addEventListener("click", () => { preview = true; render(); window.scrollTo(0, 0); });
    $("#previewExit").addEventListener("click", () => { preview = false; render(); });
    for (const b of document.querySelectorAll(".brushes button")) {
      b.addEventListener("click", () => {
        brush = b.dataset.brush;
        store.set(LS.brush, brush);
        renderOwnerBits();
      });
    }
    // Keep "today" right if the page stays open past midnight.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
  }

  async function boot() {
    wire();
    checkCred();
    try {
      const r = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const file = readPublicFile(await r.json());
      pub = file.pub;
      pubDays = file.days;
      pubWeekly = file.weekly;
      updated = file.updated;
    } catch {
      loadError = true;
    }
    render();
    if (token) await enterOwner();
  }

  boot();
})();
