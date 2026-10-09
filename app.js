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
    // The newest sheet sits on top with the dimming right under it, so a sheet underneath can't be tapped.
    const stack = () => {
      const o = openOnes().sort((a, b) => (a.openSeq || 0) - (b.openSeq || 0));
      o.forEach((d, i) => { d.style.zIndex = String(1000 + i * 2); });
      backdrop.hidden = !o.length;
      if (o.length) backdrop.style.zIndex = String(999 + (o.length - 1) * 2);
    };
    let seq = 0;
    const shim = (d) => {
      if (d.showModal) return;
      d.returnValue = "";
      Object.defineProperty(d, "open", { get() { return this.hasAttribute("open"); } });
      d.showModal = function () {
        if (!backdrop.parentNode) document.body.appendChild(backdrop);
        this.returnFocus = document.activeElement;
        this.openSeq = ++seq;
        this.setAttribute("open", "");
        stack();
        const f = Array.prototype.find.call(this.querySelectorAll("input, select, textarea, button"), (el) => !el.disabled && el.getClientRects().length > 0);
        if (f) try { f.focus(); } catch (e) { /* ignore */ }
      };
      d.close = function (value) {
        if (!this.hasAttribute("open")) return;
        if (value !== undefined) this.returnValue = value;
        this.removeAttribute("open");
        stack();
        const back = this.returnFocus;
        this.returnFocus = null;
        if (back && back.focus && document.body.contains(back)) try { back.focus(); } catch (e) { /* ignore */ }
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
    backdrop.addEventListener("click", () => {
      const o = openOnes();
      const top = o.sort((a, b) => (a.openSeq || 0) - (b.openSeq || 0))[o.length - 1];
      if (top && Date.now() - (top.openedAt || 0) >= 350) top.close("");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const o = openOnes().sort((a, b) => (a.openSeq || 0) - (b.openSeq || 0));
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
  const LS = { token: "sa.token", savedSignal: "sa.saved", draftPrefix: "sa.d3.", draft2: "sa.draft2", oldDraft: "sa.draft", who: "sa.who", site: "sa.site", addr: "sa.addr", brush: "sa.brush", importText: "sa.import", pay: "sa.pay", fbContact: "sa.fbContact", lastWeekly: "sa.weekly" };
  const PRIVATE_VAR = "AVAILABILITY_PRIVATE";
  const VAR_LIMIT = 47 * 1024; // GitHub allows 48 KB per variable
  const PUBLIC_TAG = { open: "Open", pot: "P-OT", ot: "OT", busy: "Busy", unset: "" };
  const OWNER_TAG = { open: "Open", pot: "P-OT", ot: "OT", work: "Work", busy: "Busy", unset: "" };

  // Public settings live in data.json, which anyone can read. Private ones (hours, notes, overtime rules)
  // live in a repository variable that only the owner's key can read.
  // potFrom/potTo/potMax: on P-OT days, the start times he takes ("19:00" to "03:00") and the longest shift (hours).
  // Empty or 0 means no limit. They're public, so the page can check a supervisor's times.
  // noteUntil: the last day the note shows ("" = no end). callHours: a shift starting sooner than this asks for a call.
  // licName/licNo/licIssued/licExpires: his license, shown at the top ("" hides it). Dates are "YYYY-MM-DD".
  // nightAuto: the night-shift line now lives in his note (added when Overnight is checked). Until edit mode has made
  // that move once, the page shows the line with the note by itself.
  const defaultPub = () => ({ name: "", empId: "", phone: "", note: "", noteUntil: "", willing: ["overnight"], weekStart: 0, feedback: "", potFrom: "", potTo: "", potMax: 0, callHours: 10,
    licName: "", licNo: "", licIssued: "", licExpires: "", nightAuto: false });
  const defaultPriv = () => ({ otAfter: 40, pickup: 8, weekly: [], days: {} });

  // ---------- small helpers ----------
  const $ = (s) => document.querySelector(s);
  let leaving = false; // Stop Editing: from then on nothing is written, so a save still running can't put his hours back
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { if (leaving) return; try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
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
  const isDay = (k) => isKey(k) && keyOf(dateOf(k)) === k; // a real calendar day, not "2027-02-30"
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

  // ---------- Back: the in-page button, the phone's back gesture, and the browser's Back ----------
  // Each open sheet, each step inside the day window, and the owner's preview of the supervisor view is one entry
  // in the browser's history. Back steps back one screen, then closes the window, and only then leaves the page.
  // Entries are only added right after a tap or click: browsers skip entries a page adds on its own.
  const nav = (() => {
    const stack = []; // {sheet, step, undo}, oldest first. undo() puts the screen back the way it was before it.
    const queued = []; // work waiting for the browser to finish the traversals the page started
    let pending = 0, timer = 0, ok = false;
    const depth = (st) => (st && typeof st.sa === "number" ? st.sa : 0);
    // A reload (or a phone restoring a tab) can land on one of the page's own screen entries. Nothing is open now,
    // so go back to the page's base entry: no dead entries are left for Back to stop on.
    try {
      const d0 = depth(history.state);
      history.replaceState({ sa: 0 }, "");
      ok = true;
      if (d0 > 0) go(-d0);
    } catch (e) { /* no history: only the in-page buttons go back */ }
    const tapped = () => !navigator.userActivation || navigator.userActivation.isActive;
    // The page moves the browser back itself after it closes or steps back on screen. Each move ends in a popstate;
    // until they're all in, new entries and in-page Backs wait, so the screens and the history stay in step.
    function go(n) {
      pending++;
      clearTimeout(timer);
      timer = setTimeout(() => { pending = 0; flush(); }, 1000); // a browser that never reports one
      history.go(n);
    }
    function flush() { while (!pending && queued.length) queued.shift()(); }
    function add(entry) {
      if (!ok || !tapped()) return;
      const run = () => {
        if (entry.sheet && !entry.sheet.open) return; // closed while it waited
        stack.push(entry);
        try { history.pushState({ sa: stack.length }, ""); } catch (e) { stack.pop(); }
      };
      if (pending) queued.push(run); else run();
    }
    // The page already closed or stepped back: forget the entries from i up and take the browser back as many.
    function drop(i) {
      const n = stack.length - i;
      if (n <= 0) return;
      stack.length = i;
      go(-n);
    }
    window.addEventListener("popstate", (e) => {
      const d = depth(e.state);
      if (pending) { pending--; if (pending) return; clearTimeout(timer); }
      // Now compare where the browser is with the screens open: a Back from the person undoes screens; landing past
      // them (Forward onto a screen that's gone) returns to where the page is.
      if (d > stack.length) { go(stack.length - d); return; }
      while (stack.length > d) stack.pop().undo();
      flush();
    });
    return {
      sheet(d) { add({ sheet: d, undo: () => d.close("") }); },
      step(d, undo) { add({ sheet: d, step: true, undo }); },
      page(undo) { add({ sheet: null, undo }); },
      // The in-page Back for the step (or page state) on top: the screen changes at once and the browser follows,
      // so the button and the gesture always agree. Otherwise (no history entry was added) straight to fallback.
      back(d, fallback) {
        if (pending) { queued.push(() => this.back(d, fallback)); return; }
        const top = stack[stack.length - 1];
        if (top && top.sheet === d && (d ? top.step : true)) { stack.pop(); go(-1); top.undo(); } else fallback();
      },
      // A sheet the page closed itself (×, Escape, the backdrop, a button): drop its entries and any above them.
      closed(d) { const i = stack.findIndex((x) => x.sheet === d); if (i >= 0) drop(i); },
      // Before the page reloads: back to its own entry first, so no dead entries are left behind it.
      leave(fn) {
        const n = stack.length;
        if (!ok || !n) { fn(); return; }
        stack.length = 0;
        queued.push(fn);
        go(-n);
      },
    };
  })();

  function showSheet(sel) {
    const d = $(sel);
    d.returnValue = "";
    if (!d.open) { d.showModal(); nav.sheet(d); }
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
  // Where feedback goes: an email address, or the random code FormSubmit emails after activation
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
    if (isTime(r.potFrom) && isTime(r.potTo)) { d.potFrom = r.potFrom; d.potTo = r.potTo; }
    if (isDay(r.noteUntil)) d.noteUntil = r.noteUntil;
    if (typeof r.callHours === "number" && r.callHours >= 0 && r.callHours <= 48) d.callHours = r.callHours;
    if (Number(r.potMax) > 0 && Number(r.potMax) <= 24) d.potMax = Number(r.potMax);
    if (typeof r.licName === "string") d.licName = r.licName.trim().slice(0, 60);
    if (typeof r.licNo === "string") d.licNo = r.licNo.trim().slice(0, 40);
    if (isDay(r.licIssued)) d.licIssued = r.licIssued;
    if (isDay(r.licExpires)) d.licExpires = r.licExpires;
    if (r.nightAuto === true) d.nightAuto = true;
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
      const x = v.s === "ot" ? cleanWilling(v.x) : null;
      if (x && x.length) out[k].x = x;
    }
    return out;
  }

  function readPublicFile(raw) {
    if (raw && raw.v === 2) return { pub: normalizePub(raw, true), days: normalizePublicDays(raw.days), weekly: cleanDows(raw.weekly), ot: cleanOt(raw.ot), updated: raw.updated || null };
    const m = migrateV1(raw);
    const days = derivePublic(m.pub, m.priv);
    return { pub: m.pub, days, weekly: [], ot: derivePublicOt(m.pub, m.priv, days), updated: (raw && raw.updated) || null, migrated: m };
  }

  const weekStartOf = (k, ws) => addDays(k, -((dateOf(k).getDay() - ws + 7) % 7));

  // Paid hours that fall inside one pay week. The week starts at midnight, so a shift that crosses the
  // cutoff (Thu 2300 - Fri 0700) counts 1 hour in one week and 7 in the next. Unpaid time (paid hours
  // shorter than the shift) is spread evenly. A shift without times counts on the day it's listed.
  const dayNumber = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const minutesOf = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  // forSupervisors: count the way the public numbers do. A shift that runs past midnight is counted as if it ended
  // at 7 AM (the default overnight end), so the hours left before overtime never depend on his real start and end times.
  // Otherwise a shift on the pay week's last day would give them away: the hours before midnight are midnight minus the start.
  function hoursInWeek(weekStartKey, v, forSupervisors) {
    const from = dayNumber(weekStartKey) * 1440, to = from + 7 * 1440;
    let total = 0;
    for (let i = -1; i < 7; i++) {
      const k = addDays(weekStartKey, i);
      const rec = dayRec(k, v);
      if (!rec || rec.s !== "work") continue;
      const paid = Number(rec.hours) || 0;
      if (paid <= 0) continue;
      if (rec.start && rec.end) {
        let start = dayNumber(k) * 1440 + minutesOf(rec.start);
        let len = minutesOf(rec.end) - minutesOf(rec.start);
        if (len <= 0) len += 1440;
        if (forSupervisors && minutesOf(rec.start) + len > 1440) {
          len = paid * 60;
          start = dayNumber(k) * 1440 + 1860 - len; // ends 7 AM the next morning
        }
        const inside = Math.max(0, Math.min(start + len, to) - Math.max(start, from));
        total += (paid * inside) / len;
      } else if (i >= 0) {
        total += paid;
      }
    }
    return Math.round(total * 100) / 100;
  }
  const weekHours = (k, v, ws) => hoursInWeek(weekStartOf(k, ws), v);

  // ---------- overtime in one more shift ----------
  // A shift is a span of minutes counted from midnight on the day it's listed under (an overnight runs into the next morning).
  // Without a typed time, one more shift is the usual length at default times: a morning starts at 7 AM, a swing ends at 11 PM,
  // and an overnight ends at 7 AM the next morning (8 hours: 11 PM to 7 AM).
  function defaultSpan(type, len) {
    const mins = Math.round(len * 60);
    if (type === "morning") return { start: 420, len: mins };
    if (type === "swing") return { start: Math.max(0, 1380 - mins), len: mins };
    return { start: 1860 - mins, len: mins };
  }
  // A time a supervisor typed ("2300-0700"). An overnight that starts before noon starts the next morning.
  function typedSpan(type, t) {
    let start = minutesOf(t.start), len = minutesOf(t.end) - start;
    if (len <= 0) len += 1440;
    if (type === "overnight" && start < 720) start += 1440;
    return { start, len };
  }
  const round2 = (n) => Math.round(n * 100) / 100;

  // How many of a shift's hours would be overtime: {hours, ot}. left(weekStartKey) is how many hours that pay week
  // has before overtime. Each pay week starts at midnight, so a shift that crosses into the next week is split
  // between the two (11 PM to 7 AM on the last day: 1 hour this week, 7 the next). null if a week isn't known.
  function otIn(k, span, weekStart, left) {
    const ws = weekStartOf(k, weekStart), next = addDays(ws, 7);
    const cut = (dayNumber(next) - dayNumber(k)) * 1440;
    const before = Math.max(0, Math.min(span.start + span.len, cut) - span.start);
    let ot = 0;
    for (const [w, mins] of [[ws, before], [next, span.len - before]]) {
      if (mins <= 0) continue;
      const l = left(w);
      if (l == null) return null;
      ot += Math.max(0, mins / 60 - Math.max(0, l));
    }
    return { hours: round2(span.len / 60), ot: round2(ot) };
  }
  // r: {hours, ot}, or true when an older calendar file only says the shift is overtime.
  // On a P-OT day, {part: true} is overtime of unknown size and {no: [...]} a shift he doesn't take.
  const otState = (r) => (r === true ? "ot" : r && r.part ? "pot" : !r || r.no || !(r.ot > 0) ? "open" : r.ot >= r.hours ? "ot" : "pot");
  // A day's color: green when one more usual shift has no overtime, yellow when all of it would be overtime,
  // and P-OT (half green, half yellow) when part of it would. With several shifts, the one with the most overtime decides.
  function otKind(k, types, len, weekStart, left) {
    let kind = "open";
    for (const t of types) {
      const r = otIn(k, defaultSpan(t, len), weekStart, left);
      if (!r) return null;
      if (otState(r) === "ot") return "ot";
      if (otState(r) === "pot") kind = "pot";
    }
    return kind;
  }
  // Hours left before overtime as supervisors' numbers count them (see hoursInWeek). His colors use the same count,
  // so what he sees is what they see.
  const privLeft = (v) => (w) => v.otAfter - hoursInWeek(w, v, true);
  const typesOf = (rec, p) => (rec && rec.w ? rec.w : p.willing);
  // Which of the day's shifts would have any overtime.
  const otShifts = (k, v, p, rec) => typesOf(rec, p).filter((t) => otIn(k, defaultSpan(t, v.pickup), p.weekStart, privLeft(v)).ot > 0);

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
      const types = typesOf(rec, p), ots = otShifts(k, v, p, rec);
      out[k] = rec.w ? { s: ots.length ? "ot" : "open", w: rec.w } : { s: ots.length ? "ot" : "open" };
      // Older copies of this page read "ot" as yellow and x as the shifts that would be overtime.
      if (ots.length && ots.length < types.length) out[k].x = ots;
    }
    return out;
  }

  // The pay weeks a supervisor's shift can touch: the week of each open day, and the next week too when the day
  // is one of the last two of its week (an overnight runs into the next morning, and on a P-OT day a start time
  // after midnight puts the shift on the next day).
  function otWeeks(p, days) {
    const out = {};
    for (const k of Object.keys(days)) {
      if (days[k].s === "busy") continue;
      const ws = weekStartOf(k, p.weekStart), next = addDays(ws, 7);
      out[ws] = true;
      if (addDays(k, 2) >= next) out[next] = true;
    }
    return Object.keys(out).sort();
  }
  // Hours left before overtime in those weeks, so the page can count the overtime in whatever shift time a
  // supervisor types. He's fine with supervisors working out his weekly total from it, but it should give away
  // as little else as it can: only weeks within one usual shift of overtime are listed. A week that's missing
  // has room for at least one usual shift, so a shift no longer than that has no overtime there.
  function derivePublicOt(p, v, days) {
    const left = {};
    for (const w of otWeeks(p, days)) {
      const l = Math.max(0, round2(privLeft(v)(w)));
      if (l < v.pickup) left[w] = l;
    }
    return { shift: v.pickup, left };
  }
  function cleanOt(raw) {
    if (!raw || typeof raw !== "object" || !raw.left || typeof raw.left !== "object") return null;
    const shift = Number(raw.shift);
    if (!(shift > 0 && shift <= 24)) return null;
    const left = {};
    for (const [w, n] of Object.entries(raw.left)) if (isKey(w) && typeof n === "number" && n >= 0) left[w] = n;
    return { shift, left };
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
  let pubOt = null; // {shift, left}: hours left before overtime in the weeks near it (null in an older calendar file)
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
  let dataIn = false; // the calendar file has been read (until then the header shows no status, Call Me or license)
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
    return Object.assign(base, { kind: otKind(k, typesOf(rec, pub), priv.pickup, pub.weekStart, privLeft(priv)) });
  }

  // A week the file doesn't list has room for at least one usual shift, if it's a week the file covers.
  // Any other week isn't known (a very long typed shift can reach one).
  const pubLeft = (w) => (!pubOt ? null : w in pubOt.left ? pubOt.left[w] : otWeeks(pub, pubDays).indexOf(w) >= 0 ? Infinity : null);
  function publicInfo(k) {
    const rec = pubDays[k];
    let kind = rec ? rec.s : pubWeekly.indexOf(dateOf(k).getDay()) >= 0 ? "busy" : "unset";
    // The file says how close each week is to overtime, so the page works out green, P-OT or yellow itself.
    // An older file only says open or ot.
    if (rec && rec.s !== "busy" && pubOt) kind = otKind(k, rec.w || pub.willing, pubOt.shift, pub.weekStart, pubLeft) || kind;
    return { past: k < todayKey(), kind, w: rec && rec.w ? rec.w : null, x: rec && rec.x ? rec.x : null };
  }
  // Overtime in one more shift of this type on day k: {hours, ot}, from the typed time if there is one,
  // or else a usual-length shift at the default times. null when the file doesn't have the numbers.
  function shiftOt(k, type, typed) {
    if (!pubOt) return null;
    return otIn(k, typed ? typedSpan(type, typed) : defaultSpan(type, pubOt.shift), pub.weekStart, pubLeft);
  }

  function publicStatusText(kind) {
    return { open: "Available", pot: "Available, but partly overtime", ot: "Available, but it would be overtime", busy: "Not Available", unset: "Not Set Yet" }[kind];
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

  // ---------- the header: badge, status line, Call Me and license ----------
  // "Accepting overnight requests", from the shifts he picks up in Settings (in Settings order).
  function acceptingText(list) {
    const w = SHIFT_KEYS.filter((x) => list.indexOf(x) >= 0).map((x) => SHIFT_LABEL[x].toLowerCase());
    if (!w.length) return "Not taking extra shifts right now";
    return `Accepting ${w.length < 3 ? w.join(" & ") : `${w.slice(0, -1).join(", ")} & ${w[w.length - 1]}`} requests`;
  }
  // The badge's letters: first and last initials ("VT").
  const initials = (name) => { const p = name.trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() : ""; };
  const dateText = (k) => fmt(k, { month: "short", day: "numeric", year: "numeric" });
  // "19:02 · Oct 8": the readout style the page uses for times (shown in capitals).
  const readout = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())} · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  // Active through the whole expiration day, by the viewer's own clock.
  const licExpired = () => !!pub.licExpires && todayKey() > pub.licExpires;
  function licRenews() {
    if (!pub.licIssued || !pub.licExpires) return "";
    const a = dateOf(pub.licIssued), b = dateOf(pub.licExpires);
    const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    return months === 12 ? "Renews yearly" : months > 12 && months % 12 === 0 ? `Renews every ${months / 12} years` : "";
  }
  // The Call Me box: a shift starting soon is worth a call; anything else starts with picking the day.
  function callBoxText() {
    const n = pub.callHours;
    return n > 0
      ? { lead: `Best for shifts starting within ${hoursText(n)}.`, rest: "Otherwise, a text is best. Pick the day below and I'll show you the best way to reach me." }
      : { lead: "Texting is the best way to reach me.", rest: "Pick the day below and I'll show you how." };
  }
  // His name, letter by letter (each word kept whole), so it can fall into place as the page opens. The heading's
  // label is the plain name for screen readers. Rebuilt only when the name changes.
  function renderTitle() {
    const t = $("#title"), name = pub.name || "Shift Availability";
    if (t.dataset.name === name) return;
    t.dataset.name = name;
    t.setAttribute("aria-label", name);
    let i = 0;
    const words = name.split(" ").map((w) => h("span", { class: "word", "aria-hidden": "true" },
      [...w].map((ch) => h("span", { class: "ch", style: `--c:${i++}`, text: ch }))));
    t.replaceChildren(...words.flatMap((w, j) => (j ? [" ", w] : [w])));
  }
  // The status line types itself out during the opening; screen readers get the whole line at once.
  let typer = null;
  function typeStatus(start, dur) {
    const el = $("#acceptingTyped"), line = $("#accepting");
    typer = { i: 0 };
    el.textContent = "";
    line.classList.add("typing");
    const step = () => {
      if (!typer) return;
      const text = $("#acceptingText").textContent; // the line as it is now (it can change mid-way)
      typer.i++;
      el.textContent = text.slice(0, typer.i);
      if (typer.i < text.length) setTimeout(step, dur / Math.max(text.length, 1));
      else { typer = null; setTimeout(() => line.classList.remove("typing"), 500); }
    };
    setTimeout(step, start);
  }
  function renderHero() {
    const ready = dataIn && (owner || !loadError);
    renderTitle();
    const letters = initials(pub.name);
    $("#shield").toggleAttribute("hidden", !letters); // an <svg> has no hidden property, only the attribute
    $("#shieldText").textContent = letters;
    $("#accepting").hidden = !ready;
    $("#accepting").classList.toggle("none", !pub.willing.length);
    $("#acceptingText").textContent = acceptingText(pub.willing);
    if (!typer) $("#acceptingTyped").textContent = acceptingText(pub.willing);
    const call = ready && !!smsNumber(), lic = ready && !!pub.licName;
    $("#heroChips").hidden = !(call || lic);
    $("#heroCallBtn").hidden = !call;
    $("#heroLicBtn").hidden = !lic;
    $("#heroLicText").textContent = pub.licName + (pub.licExpires ? ` · ${licExpired() ? "Expired" : "Active"}` : "");
    $("#heroLicBtn").classList.toggle("expired", licExpired());
    // With only a name there's nothing to open: the chip is then just a label.
    const licMore = !!(pub.licNo || pub.licIssued || pub.licExpires);
    if (licMore) { $("#heroLicBtn").setAttribute("aria-controls", "heroLic"); if (!$("#heroLicBtn").hasAttribute("aria-expanded")) $("#heroLicBtn").setAttribute("aria-expanded", "false"); }
    else { $("#heroLicBtn").removeAttribute("aria-controls"); $("#heroLicBtn").removeAttribute("aria-expanded"); }
    $("#heroLicBtn").classList.toggle("plain", !licMore);
    const t = callBoxText();
    $("#heroCallLead").textContent = t.lead;
    $("#heroCallRest").textContent = t.rest;
    $("#heroLicNo").textContent = pub.licNo ? `No. ${pub.licNo}` : "";
    $("#heroLicNo").hidden = !pub.licNo;
    $("#heroLicDates").textContent = [pub.licIssued ? `Issued ${dateText(pub.licIssued)}` : "", pub.licExpires ? `${licExpired() ? "Expired" : "Expires"} ${dateText(pub.licExpires)}` : "", licRenews()].filter(Boolean).join(" · ");
    $("#heroLicDates").hidden = !$("#heroLicDates").textContent;
    // A chip that went away (its setting was cleared) takes its open box with it.
    if (!call) openHeroBox(null, "#heroCall");
    if (!lic || !licMore) openHeroBox(null, "#heroLic");
  }
  // One box open at a time. which: "#heroCall", "#heroLic", or null to close both (only: just that one).
  function openHeroBox(which, only) {
    for (const [box, btn] of [["#heroCall", "#heroCallBtn"], ["#heroLic", "#heroLicBtn"]]) {
      if (only && box !== only) continue;
      const on = box === which;
      $(box).hidden = !on;
      if ($(btn).hasAttribute("aria-controls")) $(btn).setAttribute("aria-expanded", String(on));
    }
  }
  // Pick a Day: bring the days they can ask about into view (only if they aren't already), and make them glow.
  function pickADay() {
    openHeroBox(null);
    const tiles = [...document.querySelectorAll("#weeks .day.open, #weeks .day.ot, #weeks .day.pot")].filter((b) => !b.disabled && !b.classList.contains("past"));
    if (!tiles.length) { toast("No open days on the calendar right now."); $("#heroCallBtn").focus(); return; }
    // Really visible: not under the calendar's sticky weekday row (laptops) or a bar along the bottom (edit mode).
    const first = tiles[0], r = first.getBoundingClientRect(), cal = $(".cal").getBoundingClientRect();
    const dow = $(".cal .dow"), bars = ["#toolbar", "#previewBar"].map((s) => $(s)).filter((b) => !b.hidden);
    const top = Math.max(0, cal.top, getComputedStyle(dow).position === "sticky" ? dow.getBoundingClientRect().bottom : 0);
    const bottom = Math.min(window.innerHeight, cal.bottom, ...bars.map((b) => b.getBoundingClientRect().top));
    const inView = r.top >= top && r.bottom <= bottom;
    if (!inView) {
      const smooth = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
      try { first.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" }); } catch (e) { first.scrollIntoView(); }
    }
    const weeks = $("#weeks");
    weeks.classList.remove("beckon");
    void weeks.offsetWidth; // restart the glow when it's tapped again
    weeks.classList.add("beckon");
    clearTimeout(pickADay.timer);
    pickADay.timer = setTimeout(() => weeks.classList.remove("beckon"), 3000);
    try { first.focus({ preventScroll: true }); } catch (e) { /* old browser: no focus move */ }
  }

  // His note, unless its show-until date has passed.
  const activeNote = () => { const n = pub.note.trim(); return n && !(pub.noteUntil && todayKey() > pub.noteUntil) ? n : ""; };
  // How night shifts sit on the calendar: part of his note, added when he checks Overnight in Settings.
  const NIGHT_LINE = "A night shift is listed under the day it starts. Tue means Tue night into Wed morning.";
  const withNight = (n) => { const t = n.trim(); return t.indexOf(NIGHT_LINE) >= 0 ? t : t ? `${t} ${NIGHT_LINE}` : NIGHT_LINE; };
  const withoutNight = (n) => n.replace(NIGHT_LINE, "").replace(/\s{2,}/g, " ").trim();
  // The note as shown. Until edit mode has moved the line into his note once, it's shown with the note by itself.
  const shownNote = () => {
    const n = activeNote();
    const before = !pub.nightAuto && dataIn && (owner || !loadError) && pub.willing.includes("overnight");
    return before ? withNight(n) : n;
  };
  const noteBox = () => { const n = shownNote(); return n ? h("aside", { class: "note-box" }, h("b", { class: "note-tag", text: "Note" }), " ", n) : null; };

  function render() {
    const asOwner = ownerView();
    if (owner && preview) { pubDays = derivePublic(pub, priv); pubWeekly = weeklyPublic(priv); pubOt = derivePublicOt(pub, priv, pubDays); }
    document.title = pub.name ? `${possessive(pub.name)} Shift Availability` : "Shift Availability";
    $("#empId").hidden = !pub.empId;
    $("#empIdValue").textContent = pub.empId;
    // A failed load is said at the top, where it's seen. The last-updated time sits at the bottom, under the employee ID.
    $("#loadErr").hidden = !loadError;
    $("#updated").hidden = loadError || !updated;
    $("#updated").textContent = updated && !loadError ? `Updated ${readout(new Date(updated))}` : "";

    renderHero();
    // His note (with the night-shift line when he takes overnights) gets a box of its own, noticed every visit.
    const note = shownNote();
    $("#noteBox").hidden = !note;
    $("#noteText").textContent = note;

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
        const text = () => [
          h("span", { class: "mon", text: showMonth ? fmt(k, { month: "short" }) : "" }),
          h("span", { class: "num", text: d.getDate() }),
          h("span", { class: "tag", text: tag }),
        ];
        // A P-OT day is split corner to corner, yellow and green. Its text is drawn twice, in each half's own ink,
        // so it reads on both colors.
        const split = cls.indexOf("pot") >= 0 ? h("span", { class: "ink2", "aria-hidden": "true" }, text()) : null;
        // --w: the diagonal the tile sits on, so the opening's tiles fall top left to bottom right.
        days.append(h("button", { type: "button", class: cls.join(" "), "data-key": k, "aria-label": `${longDay(k)}: ${label}`, disabled: disabled || null, style: `--w:${Math.min(wi + i, 14)}` },
          text(), split,
          weekly ? h("span", { class: showMonth ? "rep alt" : "rep", "aria-hidden": "true", text: "↻" }) : null));
      }
      const head = h("div", { class: "week-head" }, h("b", { text: weekLabel(ws) }));
      if (asOwner) {
        const hrs = weekHours(ws, priv, pub.weekStart);
        if (hrs > 0) head.append(h("span", { class: hrs >= priv.otAfter ? "hrs over" : "hrs", text: `${num(hrs)} hrs scheduled${hrs >= priv.otAfter ? " · overtime" : ""}` }));
      }
      frag.append(h("div", { class: "week" }, head, days));
    });
    if (revealed) $("#weeks").classList.remove("drop"); // a redraw after the opening shows the tiles at once
    // Every day you can take breathes on one shared beat, even across redraws.
    $("#weeks").style.setProperty("--bd", `${-Math.round(performance.now() % 3000)}ms`);
    $("#weeks").replaceChildren(frag);

    document.body.classList.toggle("owner", asOwner);
    document.body.classList.toggle("previewing", owner && preview);
    $("#toolbar").hidden = !asOwner;
    $("#ownerBanner").hidden = !asOwner;
    $("#previewBar").hidden = !(owner && preview);
    renderFoot();
    if (asOwner) renderOwnerBits();
  }

  // Footer links. Supervisors see Credentials and Send Feedback only once they're set up.
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
      hints.append("Tap a tool below, then tap days. Red: working or busy. Green: available. Yellow (all overtime) and P-OT (part overtime) show up on their own.");
    }
    if (priv.weekly.length) hints.append(h("br"), "↻ marks your every-week days from Settings.");
    if (!pub.phone) hints.append(h("br"), "Add your cell number in Settings so supervisors can text you.");
    if (pub.licName && licExpired()) hints.append(h("br"), h("b", { text: "Your license shows Expired at the top. When you renew, enter the new dates in Settings." }));

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
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    // Big Android tablets ask for the desktop site, which reads as Linux: a touch screen without a mouse or trackpad.
    || (navigator.maxTouchPoints > 1 && /Linux/.test(navigator.userAgent) && !/CrOS/.test(navigator.userAgent)
      && !(window.matchMedia && matchMedia("(any-pointer: fine)").matches));
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
    return { svg: q.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt }), size: Math.max(200, (q.getModuleCount() + 8) * 3), cells: q.getModuleCount() + 8 };
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
  // "22", "$22", "22.50/hr" all read as $22/hr. Anything else (like "$25 flat") is used as typed.
  function payText(raw) {
    const m = raw.trim().match(/^\$?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:\/?\s*(?:hr|hour|h)\.?|an hour|per hour)?$/i);
    return m ? `$${m[1]}/hr` : raw.trim();
  }

  const hoursText = (n) => `${num(n)} hour${n === 1 ? "" : "s"}`;
  const PART_OF_DAY = { overnight: "night", morning: "day", swing: "evening" };
  function composeMessage(k, f) {
    const first = firstName();
    const out = [first ? `Hi ${first}.` : "Hi."];
    if (f.who) out.push(`This is ${f.who}.`);
    const label = f.type ? SHIFT_LABEL[f.type].toLowerCase() : "";
    const shift = f.type ? `${/^[aeiou]/.test(label) ? "an" : "a"} ${label} shift` : "a shift";
    const day = fmt(f.day || k, { weekday: "long", month: "short", day: "numeric" });
    // A shift from a P-OT day has no type: its start time picks the words (f.part).
    const part = f.type ? PART_OF_DAY[f.type] : f.part;
    const when = part ? `on the ${part} of ${day}` : `on ${day}`;
    const t = f.time ? window.ScheduleParser.readShift(f.time) : null;
    const twelve = (x) => { const [hh, mm] = x.split(":").map(Number); return `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? "AM" : "PM"}`; };
    const from = t ? (t.twelveHour ? `, from ${twelve(t.start)} to ${twelve(t.end)}` : `, from ${hhmm24(t.start)} to ${hhmm24(t.end)}`) : "";
    out.push(`Are you available to cover ${shift} ${when}${from}?`);
    if (f.time && !t) out.push(`The shift time is ${f.time}.`);
    if (f.site && f.addr) out.push(`It's at ${f.site}, ${f.addr}.`);
    else if (f.site) out.push(`It's at ${f.site}.`);
    else if (f.addr) out.push(`The address is ${f.addr}.`);
    if (f.pay) out.push(`The pay is ${payText(f.pay)}.`);
    out.push("Let me know. Thanks!");
    // f.ot: {hours, ot} counted from the shift time; true when the calendar only says the shift is overtime;
    // {part: true} on a P-OT day without a time it can read.
    if (f.ot === true) out.push("You'd get overtime pay for covering this shift.");
    else if (f.ot && f.ot.part) out.push("You'd get overtime pay for part of this shift.");
    else if (otState(f.ot) === "ot") out.push(`You'd get overtime pay for all ${hoursText(f.ot.hours)} of this shift.`);
    else if (otState(f.ot) === "pot") out.push(`You'd get overtime pay for ${num(f.ot.ot)} of the ${hoursText(f.ot.hours)} of this shift.`);
    return out.join(" ");
  }

  // ---------- P-OT days: which hours of a shift would be overtime ----------
  // A start or end time as typed: "11", "1130", "11:30", "11pm", "7 am". A typed am/pm sets AM or PM itself, and so
  // does a 24-hour time (13-23, 0, or a leading zero like 0700). {h, m, ap} with h on the 24-hour clock once ap is
  // known; null if it can't be read.
  function readClock(raw) {
    const m = String(raw || "").trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:([ap])\.?m?\.?)?$/i);
    if (!m) return null;
    const hr = Number(m[1]), min = m[2] ? Number(m[2]) : 0, suf = m[3] ? m[3].toLowerCase() : "";
    if (min > 59) return null;
    if (suf) return hr >= 1 && hr <= 12 ? { h: (hr % 12) + (suf === "p" ? 12 : 0), m: min, ap: `${suf}m` } : null;
    if (hr > 23) return null;
    const zero = m[1].length === 2 && m[1][0] === "0";
    return { h: hr, m: min, ap: hr === 0 || zero ? "am" : hr > 12 ? "pm" : null };
  }
  // Minutes from midnight, or null until the time and its AM or PM are both known.
  const clockMins = (c, ap) => (!c ? null : c.ap ? c.h * 60 + c.m : ap ? ((c.h % 12) + (ap === "pm" ? 12 : 0)) * 60 + c.m : null);
  // Where a start time falls. When his P-OT start times run past midnight (1900-0300), a start after midnight is
  // the next morning; otherwise it's on the day itself. ok: one of the start times he takes (any, if none are set).
  function potPlace(mins) {
    if (!pub.potFrom || !pub.potTo) return { start: mins, ok: true };
    const a = minutesOf(pub.potFrom), b = minutesOf(pub.potTo);
    if (a <= b) return { start: mins, ok: mins >= a && mins <= b };
    if (mins >= a) return { start: mins, ok: true };
    if (mins <= b) return { start: mins + 1440, ok: true };
    return { start: mins, ok: false };
  }
  // One shift on a P-OT day (it ends the next day when the end isn't after the start), checked against his P-OT
  // settings: {span, no: why he'd say no, r: {hours, ot}}.
  function potShift(k, startMins, endMins) {
    const p = potPlace(startMins);
    let len = endMins - startMins;
    if (len <= 0) len += 1440;
    const span = { start: p.start, len };
    const no = [];
    if (!p.ok) no.push(`Sorry, I can only start a shift between ${fmtTime(pub.potFrom)} and ${fmtTime(pub.potTo)} that day.`);
    if (pub.potMax > 0 && len > pub.potMax * 60 + 0.001) no.push(`Sorry, I can't take a shift longer than ${hoursText(pub.potMax)} that day.`);
    return { span, no, r: otIn(k, span, pub.weekStart, pubLeft) };
  }
  // The message's words for a start time: from 7 PM (or after midnight) "the night of", from 3 PM "the evening of",
  // from 5 AM "the day of".
  const partOfDay = (start) => (start >= 1140 ? "night" : start >= 900 ? "evening" : start >= 300 ? "day" : "");

  // The shift's regular and overtime stretches, in minutes from its start. The hours a pay week has left before
  // overtime are regular, the rest is overtime, and a shift that runs into the next pay week starts that count again.
  function otStretches(k, span, weekStart, left) {
    const ws = weekStartOf(k, weekStart), next = addDays(ws, 7);
    const cut = Math.max(0, Math.min(span.len, (dayNumber(next) - dayNumber(k)) * 1440 - span.start));
    const out = [];
    const week = (from, to, w) => {
      if (to <= from) return;
      const reg = Math.min(to - from, Math.max(0, left(w)) * 60);
      if (reg > 0) out.push({ from, to: from + reg, ot: false });
      if (from + reg < to) out.push({ from: from + reg, to, ot: true });
    };
    week(0, cut, ws);
    week(cut, span.len, next);
    return out;
  }
  const clockText = (mins) => { const t = Math.round(mins) % 1440, hr = Math.floor(t / 60); return { n: `${hr % 12 || 12}${t % 60 ? `:${pad(t % 60)}` : ""}`, ap: hr < 12 ? "AM" : "PM" }; };
  // The shift hour by hour: one block per hour, green (regular) or yellow (overtime), labeled with the hour it starts.
  // A block where overtime starts partway is split, and a last part-hour fills only part of its block.
  function otBar(span, stretches) {
    const blocks = [];
    for (let m = 0; m < span.len; m += 60) {
      const end = Math.min(m + 60, span.len), c = clockText(span.start + m);
      const label = () => h("span", { class: "hr-text" }, h("b", { text: c.n }), h("small", { text: c.ap }));
      const fill = h("div", { class: "hr-fill" });
      const parts = [];
      for (const s of stretches) {
        const a = Math.max(s.from, m), b = Math.min(s.to, end);
        if (b > a) parts.push({ left: ((a - m) / 60) * 100, right: ((m + 60 - b) / 60) * 100, ot: s.ot });
      }
      for (const p of parts) fill.append(h("span", { class: `hr-part ${p.ot ? "ot" : "reg"}`, style: `left:${p.left}%;right:${p.right}%` }));
      // The label in the page's ink (over an empty part-hour), then again in each color's own ink, cut to that color.
      fill.append(label());
      for (const p of parts) {
        const l = label();
        l.classList.add(p.ot ? "on-ot" : "on-reg");
        l.style.webkitClipPath = l.style.clipPath = `inset(0 ${p.right}% 0 ${p.left}%)`;
        fill.append(l);
      }
      blocks.push(h("div", { class: "hr" }, fill));
    }
    return h("div", { class: "otbar", "aria-hidden": "true" }, blocks);
  }
  // Once the bar is on screen: shrink its hour labels until the widest fits its block, whatever font loaded.
  // Again whenever its width changes (a phone turned sideways), starting over so labels can grow back too.
  function fitBar(bar) {
    const labels = Array.prototype.map.call(bar.querySelectorAll(".hr-fill"), (f) => [f, f.querySelector(".hr-text b")]);
    const tooWide = () => labels.some(([f, b]) => Math.max(b.scrollWidth, b.getBoundingClientRect().width) > f.clientWidth - 4);
    bar.style.removeProperty("--hr-size");
    for (let size = 17; size > 10 && tooWide(); size--) bar.style.setProperty("--hr-size", `${size - 1}px`);
  }
  // Runs fn when el's width changes (browsers without ResizeObserver, from before 2020, just skip it).
  function onWidth(el, fn) {
    if (typeof ResizeObserver !== "function") return null;
    let width = el.offsetWidth;
    const watch = new ResizeObserver(() => { if (el.offsetWidth !== width) { width = el.offsetWidth; fn(); } });
    watch.observe(el);
    return watch;
  }
  // "8 hours: 1 regular, 7 overtime." and, for screen readers, which hours are which.
  function otSummary(span, stretches, r) {
    const at = (mins) => { const c = clockText(span.start + mins); return `${c.n} ${c.ap}`; };
    return h("p", { class: "otsum" },
      h("b", { text: `${hoursText(r.hours)}:` }),
      h("span", null, h("i", { class: "sw open" }), `${num(round2(r.hours - r.ot))} regular,`),
      h("span", null, h("i", { class: "sw ot" }), `${num(r.ot)} overtime.`),
      h("span", { class: "sr", text: stretches.map((s) => `${s.ot ? "Overtime" : "Regular"} from ${at(s.from)} to ${at(s.to)}.`).join(" ") }));
  }

  // A step in the day window's lower area: back to the top, and a fast second tap can't land on what just appeared.
  // The message form is laid out side by side on a laptop.
  const showIn = (area) => (nodes, focus) => {
    area.replaceChildren(...nodes.filter((n) => n != null));
    const sheet = $("#daySheet");
    sheet.classList.toggle("split", !!area.querySelector(".tx-grid"));
    sheet.scrollTop = 0;
    sheet.openedAt = Date.now();
    const f = focus && area.querySelector(focus);
    if (f) f.focus();
  };

  // ---------- sending: the simple window, phones, laptops, and the short-notice check ----------
  const isMac = () => !isPhone() && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  // "11:00PM-7:00AM": how a time from the start/end boxes goes into the message and the form's Shift Time.
  const timeText = (s, e) => { const t = (m) => { const c = clockText(m); return `${c.n.indexOf(":") < 0 ? `${c.n}:00` : c.n}${c.ap}`; }; return `${t(s)}-${t(e)}`; };
  const spanKey = (sp) => (sp ? `${sp.start}/${sp.len}` : "none");
  // When a shift starts, from the day it's listed under and its start in minutes from that midnight.
  const startAt = (k, span) => { const d = dateOf(k); d.setMinutes(span.start); return d; };
  // A shift that starts sooner than his call-hours setting asks for a call first. Without a time, it's counted from
  // the earliest it could start, midnight as the day begins: today always asks, tomorrow once midnight is that
  // close, and later days only when the setting is over 24 hours.
  function shortNotice(k, span) {
    if (!(pub.callHours > 0)) return false;
    const start = span ? startAt(k, span) : dateOf(k);
    return start.getTime() - Date.now() < pub.callHours * 3600000;
  }
  // Without a time, overtime is told without numbers: "part of this shift" or "covering this shift".
  const untimed = (ot) => (ot && typeof ot === "object" && ot.ot > 0 ? (ot.ot >= ot.hours ? true : { part: true }) : ot);

  // The short-notice warning. go(): what to do on Text Anyway. url: the texting app link it was about to open.
  let callGo = null;
  function warnCall(k, span, go, url) {
    const hrs = hoursText(pub.callHours);
    $("#callText").textContent = !span
      ? `Heads up: if this shift starts in less than ${hrs}, I may be asleep and not see a text in time. Please call me instead.`
      : startAt(k, span).getTime() <= Date.now()
        ? "Heads up: this shift has already started. I may be asleep and not see a text in time. Please call me instead."
        : `Heads up: this shift starts in less than ${hrs}. I may be asleep and not see a text in time. Please call me instead.`;
    const phone = isPhone();
    // A phone dials. A computer can't, so it shows the number to call from a phone.
    $("#callMe").hidden = !phone;
    $("#callMe").href = `tel:${smsNumber()}`;
    $("#callShow").hidden = phone;
    $("#callNumber").hidden = true;
    $("#callNumberValue").textContent = prettyPhone();
    $("#textAnywayLink").hidden = !url;
    if (url) $("#textAnywayLink").href = url;
    $("#textAnyway").hidden = !!url;
    callGo = go;
    showSheet("#callSheet");
    $("#callSheet").openedAt = Date.now();
    try { $(phone ? "#callMe" : "#callShow").focus(); } catch (e) { /* ignore */ }
  }

  // Laptops: the text goes out by QR code. Scanning it opens the text on their phone. A Mac linked to an iPhone can
  // also send it from Messages on the Mac.
  function qrPanel() {
    const code = h("div", { class: "qr-code", "aria-hidden": "true" });
    const tooLong = h("p", { class: "muted small", hidden: true, text: "This text is too long for a QR code. Shorten it, or text the number from your phone." });
    const mac = isMac() ? h("a", { class: "linkish", text: "Open in Messages on this Mac" }) : null;
    const el = h("div", { class: "qr qr-send", hidden: true }, code, tooLong,
      h("p", { class: "qr-cap", text: "Scan with your phone's camera to text me." }),
      h("p", { class: "muted small", text: `Or text ${prettyPhone()} from your phone.` }),
      mac);
    let timer = 0, last = null, fresh = false;
    const draw = (text, done) => {
      if (mac) mac.href = smsHref(text);
      if (text === last && code.firstChild) { if (done) done(); return; }
      last = text;
      clearTimeout(timer);
      // Just shown again: draw at once. While typing: wait for a pause.
      const wait = fresh ? 0 : 150;
      fresh = false;
      timer = setTimeout(() => {
        loadQr().then((lib) => {
          try {
            const qr = qrSvg(lib, text);
            code.innerHTML = qr.svg;
            // About 240 px, in whole screen pixels per square (at least 2) so the squares stay sharp and a phone
            // reads it off a monitor. A long text makes a denser code, which gets bigger, as far as the window allows.
            const room = Math.max(240, (el.clientWidth || 304) - 24);
            let per = Math.max(2, Math.round(Math.max(240, Math.min(qr.size, 280)) / qr.cells));
            if (per * qr.cells < 240) per++;
            while (per > 2 && per * qr.cells > room) per--;
            code.firstChild.style.width = code.firstChild.style.height = `${per * qr.cells}px`;
            code.hidden = false;
            tooLong.hidden = true;
          } catch (e) { code.hidden = true; tooLong.hidden = false; }
          if (done) done();
        }).catch(() => { code.hidden = true; if (done) done(); });
      }, wait);
    };
    // Hidden and shown again: the old code goes first, so a code for earlier text never shows.
    const show = (on) => {
      if (on && el.hidden) { code.replaceChildren(); last = null; fresh = true; }
      el.hidden = !on;
    };
    return { el, draw, show };
  }

  // Phones: "Use a different app, like TextNow?" Copy the message and the number to paste them there.
  function copyLinks(getText, gate) {
    const msgLink = h("button", { type: "button", class: "linkish", text: "Copy Message" });
    const numLink = h("button", { type: "button", class: "linkish", text: "Copy Number" });
    msgLink.addEventListener("click", () => gate(async () => {
      toast((await copyText(getText())) ? "Message copied. Paste it into your texting app." : "Couldn't copy here. Press and hold the message to copy it.");
    }));
    numLink.addEventListener("click", async () => {
      toast((await copyText(prettyPhone())) ? `Copied ${prettyPhone()}.` : `Couldn't copy here. The number is ${prettyPhone()}.`);
    });
    return h("p", { class: "muted small other-app" }, "Use a different app, like TextNow? ", msgLink, " · ", numLink);
  }

  // A start or end time box with AM and PM buttons.
  function clockField(id, question, update, out) {
    const input = h("input", { type: "text", id, inputmode: "numeric", maxlength: "8", autocomplete: "off", placeholder: "e.g. 11:00" });
    const am = h("button", { type: "button", class: "ap", "aria-pressed": "false", text: "AM" });
    const pm = h("button", { type: "button", class: "ap", "aria-pressed": "false", text: "PM" });
    let picked = null;
    const sync = () => {
      const c = readClock(input.value), cur = c && c.ap ? c.ap : picked;
      am.setAttribute("aria-pressed", String(cur === "am"));
      pm.setAttribute("aria-pressed", String(cur === "pm"));
    };
    // When a press makes something appear (the bar, the buttons turning on), the window can grow under the finger:
    // a fast second tap mustn't land on what moved there.
    const press = (ap) => {
      picked = ap;
      sync();
      const was = out.offsetHeight;
      update();
      if (out.offsetHeight !== was) $("#daySheet").openedAt = Date.now();
    };
    am.addEventListener("click", () => press("am"));
    pm.addEventListener("click", () => press("pm"));
    input.addEventListener("input", () => { sync(); update(); });
    return {
      el: h("div", { class: "field" }, h("label", { class: "label", for: id, text: question }),
        h("div", { class: "clock" }, input, h("div", { class: "ap-pick", role: "group", "aria-label": `${question} AM or PM` }, am, pm))),
      mins: () => clockMins(readClock(input.value), picked),
      unreadable: () => !!input.value.trim() && !readClock(input.value),
      state: () => ({ v: input.value, ap: picked }),
      restore(x) { input.value = x.v; picked = x.ap; sync(); },
    };
  }

  // The simple send window, after a shift is picked (type) or straight away on a P-OT day (type null):
  // when the shift starts and ends, the text as it will go out, a few tips, and two choices: Send Text Now, or
  // Customize Text First (the full form, with the times filled in). On a P-OT day it also shows hour by hour which
  // hours would be overtime, and his P-OT settings can turn a time down. back(): to the shift choice.
  function sendWindow(k, info, type, area, dayStatus, shiftStatus, tr) {
    const show = showIn(area);
    // Kept per shift for as long as the day window is open: the times typed, the full form (with any edits to the
    // message), and the shift a Text Anyway was given for (shared with the form).
    const m = tr.memo[type || "pot"] || (tr.memo[type || "pot"] = { ctx: { ack: "" }, form: null, formTime: "" });
    const ctx = m.ctx;
    const phone = isPhone(), texting = !!smsNumber();
    const out = h("div", { class: "stack", "aria-live": "polite" }); // hints, his P-OT no, the overtime bar
    let barWatch = null;
    const startF = clockField("qkStart", "When does the shift start?", () => update(), out);
    const endF = clockField("qkEnd", "When does the shift end?", () => update(), out);
    const preview = h("p", { class: "msg-preview", id: "qkMsg" });
    const sendNow = iconLabel(phone ? h("a", { class: "btn go", id: "sendNow" }) : h("button", { type: "button", class: "btn go", id: "sendNow" }), "message", "Send Text Now");
    const custom = h("button", { type: "button", class: "btn ghost", id: "customize", text: "Customize Text First" });
    const qr = phone ? null : qrPanel();
    let st = null;
    const other = phone ? copyLinks(() => preview.textContent, (go) => gated(go)) : null;
    const msgBlock = h("div", { class: "stack" },
      h("div", { class: "field" }, h("span", { class: "label", text: "Your Text" }), preview),
      h("div", { class: "tips muted small" },
        h("p", { text: "You can add these in your text before sending, or tap Customize Text First:" }),
        h("ul", null, h("li", { text: "Your name" }), h("li", { text: "The site name and address" }), h("li", { text: "The pay rate" }))),
      h("div", { class: "pot-btns" }, sendNow, custom),
      other,
      qr ? qr.el : null);
    // Texting isn't set up: the times (and on a P-OT day the bar) still work, with no way to send.
    const noText = h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." });
    // A P-OT day keeps a quiet way back to the calendar (a declined time gets a full button instead).
    const another = !type ? h("button", { type: "button", class: "linkish quiet", text: "Pick Another Day", onclick: () => $("#daySheet").close() }) : null;

    // Where things stand: the times read, the shift's span, its overtime, and whether he'd turn it down.
    const compute = () => {
      const s = startF.mins(), e = endF.mins();
      const r = { s, e, span: null, ot: null, no: [], hint: "", ready: false, part: "", day: null, time: "" };
      if (startF.unreadable() || endF.unreadable()) r.hint = "Enter a time like 11, 1130 or 11:30, then pick AM or PM.";
      else if (s != null && e != null && s === e) r.hint = "The start and end can't be the same time.";
      else if (s != null && e != null) {
        r.time = timeText(s, e);
        if (type) {
          r.span = typedSpan(type, { start: hhmm(s), end: hhmm(e) });
          r.ot = shiftOt(k, type, { start: hhmm(s), end: hhmm(e) }) || ((info.kind === "ot") && (!info.x || info.x.indexOf(type) >= 0) ? true : null);
        } else {
          const c = potShift(k, s, e);
          r.span = c.span;
          r.no = c.no;
          r.ot = c.r || { part: true };
          // A start the next morning (from 5 AM, when his start times run that late) is that day's shift.
          if (c.span.start >= 1440 + 300) { r.part = partOfDay(c.span.start - 1440); r.day = addDays(k, 1); } else r.part = partOfDay(c.span.start);
        }
        r.ready = !r.no.length;
      }
      if (!r.span) {
        r.raw = type ? shiftOt(k, type, null) || (info.kind === "ot" && (!info.x || info.x.indexOf(type) >= 0) ? true : null) : null;
        r.ot = type ? untimed(r.raw) : { part: true };
      }
      return r;
    };
    const message = (r) => composeMessage(k, { who: store.get(LS.who) || "", type, time: r.time, ot: r.ot, part: r.part, day: r.day });
    // On a phone: open the texting app, after the short-notice check. On a computer: show the QR code.
    const gated = (go, url) => {
      if (!st || !st.ready) return false;
      const key = spanKey(st.span);
      if (shortNotice(k, st.span) && ctx.ack !== key) { warnCall(k, st.span, () => { ctx.ack = key; if (!url) go(); }, url); return false; }
      if (!url) go();
      return true;
    };
    sendNow.addEventListener("click", (e) => {
      if (phone) { if (!gated(null, sendNow.getAttribute("href"))) e.preventDefault(); return; }
      gated(() => {
        qr.show(true);
        update();
        // Once the code is in, bring all of it (and the lines under it) into view.
        qr.draw(preview.textContent, () => {
          if (qr.el.hidden) return;
          try { qr.el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { qr.el.scrollIntoView(false); }
        });
      });
    });
    const update = () => {
      st = compute();
      m.times = { start: startF.state(), end: endF.state() };
      const nodes = [];
      if (st.hint) nodes.push(h("p", { class: "muted", text: st.hint }));
      if (st.no.length) {
        nodes.push(...st.no.map((t) => h("p", { class: "decline", text: t })));
        nodes.push(h("button", { type: "button", class: "btn ghost", text: "Pick Another Day", onclick: () => $("#daySheet").close() }));
      }
      let bar = null;
      if (!type && st.span && !st.no.length) {
        if (st.ot && !st.ot.part) {
          const stretches = otStretches(k, st.span, pub.weekStart, pubLeft);
          bar = otBar(st.span, stretches);
          nodes.push(bar, otSummary(st.span, stretches, st.ot));
        } else nodes.push(h("p", { class: "muted", text: "Couldn't work out the overtime for those times." }));
      }
      out.replaceChildren(...nodes);
      if (barWatch) { barWatch.disconnect(); barWatch = null; }
      if (bar) { fitBar(bar); barWatch = onWidth(bar, () => fitBar(bar)); }
      // The top line: the day's answer until there's a shift to talk about, then that shift's overtime
      // (for a picked shift without times, counted for his usual shift, with "some" for a part).
      if (st.no.length) dayStatus(); // the reason is right under the times
      else if (st.span) shiftStatus(st.ot, true);
      else if (type) shiftStatus(st.raw, false);
      else dayStatus();
      msgBlock.hidden = !!st.no.length || !texting;
      noText.hidden = texting;
      if (another) another.hidden = !!st.no.length;
      const text = message(st);
      preview.textContent = text;
      const on = st.ready;
      sendNow.classList.toggle("ot", otState(st.ot) !== "open");
      sendNow.classList.toggle("off", !on);
      sendNow.setAttribute("aria-disabled", String(!on));
      if (phone) { if (on) sendNow.href = smsHref(text); else sendNow.removeAttribute("href"); } else sendNow.disabled = !on;
      if (other) other.hidden = !on;
      // A QR code already showing follows the text, or hides again if the shift changed to one that needs the check.
      if (qr && !qr.el.hidden) {
        if (!on || (shortNotice(k, st.span) && ctx.ack !== spanKey(st.span))) qr.show(false);
        else qr.draw(text);
      }
    };
    const steps = [
      type
        ? h("div", { class: "field-head shift-chosen" }, h("span", { class: "label", text: `Shift: ${SHIFT_LABEL[type]}` }),
          h("button", { type: "button", class: "linkish", text: "Change Shift", onclick: tr.back }))
        : h("p", { class: "pot-intro", text: "Let's work out how many hours of the shift you need covered would be overtime." }),
      startF.el,
      endF.el,
      out,
      msgBlock,
      noText,
      another,
    ];
    const again = () => { show(steps, "#qkStart"); update(); };
    custom.addEventListener("click", () => {
      // The same form comes back each time, with any edits to the message. New times from here replace its Shift Time.
      const time = st && st.ready ? st.time : "";
      if (!m.form) m.form = textForm(k, info, type, tr.back, shiftStatus, { time, ctx });
      else {
        m.form.recall();
        if (time !== m.formTime) m.form.setTime(time); else m.form.refresh();
      }
      m.formTime = time;
      show(m.form.nodes, ".shift-chosen .linkish");
      tr.forward(again);
    });
    if (m.times) { startF.restore(m.times.start); endF.restore(m.times.end); }
    update();
    show(steps, type ? ".shift-chosen .linkish" : null);
  }

  // The full message form. back() returns to the simple window; status(ot, timed) updates the line at the top as the
  // overtime changes with the shift time. opts: {time} to fill Shift Time with, ctx shared with the simple window.
  // type null: a P-OT day, where his P-OT settings can turn a time down.
  function textForm(k, info, type, back, status, opts) {
    const pot = !type, ctx = (opts && opts.ctx) || { ack: "" };
    const remembered = (key) => store.get(key) || "";
    const field = (id, label, attrs, value) => {
      const input = h("input", Object.assign({ type: "text", id }, attrs));
      input.value = value || "";
      return { input, el: h("label", { class: "field" }, h("span", { class: "label", text: label }), input) };
    };
    const who = field("txWho", "Your Name (optional)", { maxlength: "40", autocomplete: "name" }, remembered(LS.who));
    const time = field("txTime", "Shift Time (optional)", { maxlength: "40", placeholder: '"2300-0700" or "11:00PM-7:00AM"', autocomplete: "off" }, opts && opts.time);
    const site = field("txSite", "Site Name (optional)", { maxlength: "60", autocomplete: "organization" }, remembered(LS.site));
    const addr = field("txAddr", "Site Address (optional)", { maxlength: "100", autocomplete: "street-address" }, remembered(LS.addr));
    const pay = field("txPay", "Pay Rate (optional)", { maxlength: "30", placeholder: "e.g. $22/hr", autocomplete: "off" }, remembered(LS.pay));
    // How much of the shift would be overtime, counted from the typed time. Without one it's told without numbers.
    // On a P-OT day a time he doesn't take is a no. An older calendar file only says whether the day is overtime
    // (and, on a pay week's last day, for which shifts).
    const rawOt = (t) => shiftOt(k, type, t) || ((info.kind === "ot" || info.kind === "pot") && (!info.x || info.x.indexOf(type) >= 0) ? true : null);
    const otFor = (t) => {
      if (pot) {
        if (!t) return { part: true };
        const c = potShift(k, minutesOf(t.start), minutesOf(t.end));
        return c.no.length ? { no: c.no } : c.r || { part: true };
      }
      return t ? rawOt(t) : untimed(rawOt(null));
    };
    const spanOf = (t) => (!t ? null : pot ? potShift(k, minutesOf(t.start), minutesOf(t.end)).span : typedSpan(type, t));
    const msg = h("textarea", { id: "txMsg", rows: "5", maxlength: "600" });
    const reset = h("button", { type: "button", class: "linkish undo", text: "Undo My Edits", hidden: true });
    const phone = isPhone();
    let blocked = false; // a P-OT shift time he doesn't take: nothing to send
    let cur = null; // {span, key} of the time in the box
    const needsCheck = () => shortNotice(k, cur.span) && ctx.ack !== cur.key;
    // Phones and tablets: three buttons that open their texting app or copy the text and number. Computers: the QR code.
    let send = null, copyMsg = null, qr = null, showQr = null, sendBox;
    if (phone) {
      send = iconLabel(h("a", { class: "btn go" }), "message", "Open Texting App");
      copyMsg = iconLabel(h("button", { type: "button", class: "btn ghost" }), "copy", "Copy Message");
      const copyNum = iconLabel(h("button", { type: "button", class: "btn ghost" }), "phone", "Copy Number");
      send.addEventListener("click", (e) => {
        if (blocked) { e.preventDefault(); return; }
        if (needsCheck()) { e.preventDefault(); const key = cur.key; warnCall(k, cur.span, () => { ctx.ack = key; }, send.getAttribute("href")); }
      });
      const doCopy = async () => {
        if (!(await copyWithFeedback(copyMsg, "copy", "Copy Message", msg.value, "Couldn't copy here. The message is selected: use your device's Copy."))) {
          msg.focus();
          msg.select();
        }
      };
      copyMsg.addEventListener("click", () => {
        if (needsCheck()) { const key = cur.key; warnCall(k, cur.span, () => { ctx.ack = key; doCopy(); }); } else doCopy();
      });
      copyNum.addEventListener("click", () => copyWithFeedback(copyNum, "phone", "Copy Number", prettyPhone(), `Couldn't copy here. The number is ${prettyPhone()}.`));
      sendBox = h("div", { class: "send" }, h("span", { class: "label", text: `Send to ${prettyPhone()}` }),
        h("div", { class: "send-opts" }, send, copyMsg, copyNum),
        h("p", { class: "muted small other-app", text: "Use a different app, like TextNow? Copy the message and number, then paste them there." }));
    } else {
      qr = qrPanel();
      // A shift starting soon shows the code only after the short-notice check.
      showQr = h("button", { type: "button", class: "btn go", text: "Show QR Code", hidden: true });
      showQr.addEventListener("click", () => { const key = cur.key; warnCall(k, cur.span, () => { ctx.ack = key; refresh(); }); });
      sendBox = h("div", { class: "send" }, showQr, qr.el);
    }
    const shiftLabel = h("span", { class: "label" });
    let edited = false;
    const values = () => {
      const v = { who: who.input.value.trim(), time: time.input.value.trim(), site: site.input.value.trim(), addr: addr.input.value.trim(), pay: pay.input.value.trim(), type };
      v.read = v.time ? window.ScheduleParser.readShift(v.time) : null;
      v.ot = otFor(v.read);
      if (pot) {
        // A start the next morning (from 5 AM, when his start times run that late) is that day's shift: "the day of" the next date.
        const st = v.read ? potPlace(minutesOf(v.read.start)).start : null;
        if (st != null && st >= 1440 + 300) { v.part = partOfDay(st - 1440); v.day = addDays(k, 1); }
        else v.part = st == null ? "" : partOfDay(st);
      }
      return v;
    };
    const sendState = () => {
      if (phone) {
        send.classList.toggle("off", blocked);
        send.setAttribute("aria-disabled", String(blocked));
        if (blocked) send.removeAttribute("href");
        else send.href = smsHref(msg.value);
        copyMsg.disabled = blocked;
        return;
      }
      const gate = !blocked && needsCheck();
      showQr.hidden = !gate;
      qr.show(!blocked && !gate);
      if (!blocked && !gate) qr.draw(msg.value);
    };
    const refresh = () => {
      const v = values(), t = v.read;
      const sp = spanOf(t);
      cur = { span: sp, key: spanKey(sp) };
      shiftLabel.textContent = !pot ? `Shift: ${SHIFT_LABEL[type]}` : t ? `Shift: ${fmtTime(t.start)} to ${fmtTime(t.end)}` : `Shift: ${v.time || "Not Set"}`;
      blocked = !!(v.ot && v.ot.no);
      if (!edited) msg.value = composeMessage(k, v);
      if (send) send.classList.toggle("ot", otState(v.ot) !== "open");
      if (showQr) showQr.classList.toggle("ot", otState(v.ot) !== "open");
      sendState();
      // Without a time, a picked shift's line counts his usual shift ("some of the 8 hours").
      status(t || pot ? v.ot : rawOt(null), !!t);
    };
    for (const [f, key] of [[who, LS.who], [site, LS.site], [addr, LS.addr], [pay, LS.pay], [time, null]]) {
      f.input.addEventListener("input", () => { if (key) store.set(key, f.input.value.trim()); refresh(); });
    }
    msg.addEventListener("input", () => { edited = true; reset.hidden = false; sendState(); });
    reset.addEventListener("click", () => { edited = false; reset.hidden = true; refresh(); });
    refresh();
    // Two columns on a laptop: the boxes on the left, the message and the way to send it on the right.
    const nodes = [h("div", { class: "tx-grid" },
      h("div", { class: "tx-col" },
        h("div", { class: "field-head shift-chosen" }, shiftLabel,
          h("button", { type: "button", class: "linkish", text: "Change Times", onclick: back })),
        h("p", { class: "muted small", text: "What you fill in is added to the message." }),
        who.el,
        time.el,
        site.el,
        addr.el,
        pay.el),
      h("div", { class: "tx-col" },
        h("div", { class: "field" },
          h("div", { class: "field-head" }, h("label", { class: "label", for: "txMsg", text: "Message (you can edit it)" }), reset),
          msg),
        sendBox))];
    return {
      nodes,
      // New times from the simple window. An edited message keeps its edits (Undo My Edits brings the new text).
      setTime(t) { time.input.value = t; refresh(); },
      refresh,
      // Name, site, address and pay typed since this form was made (in another shift's form). Blocked storage
      // returns null and leaves what's in the boxes.
      recall() {
        for (const [f, key] of [[who, LS.who], [site, LS.site], [addr, LS.addr], [pay, LS.pay]]) { const v = store.get(key); if (v != null) f.input.value = v; }
      },
    };
  }

  function openDay(k) {
    const info = publicInfo(k);
    $("#dayKicker").textContent = fmt(k, { weekday: "long" });
    $("#dayTitle").textContent = fmt(k, { month: "long", day: "numeric" });
    $("#daySheet").classList.remove("split");
    const sw = { open: "open", pot: "pot", ot: "ot", busy: "busy", unset: "none" }[info.kind];
    const headline = {
      open: "I'm available",
      pot: "I'm available, but part of the shift would be overtime",
      ot: "I'm available, but it would be overtime",
      busy: "I'm not available this day",
      unset: "Not set yet",
    }[info.kind];
    const swatch = h("span", { class: `sw ${sw}` }), statusText = h("span", { text: headline });
    // The line changes as a supervisor types the shift time, so screen readers hear the new overtime hours.
    // His note sits right under the answer, where it's read at the moment of asking.
    const wrap = h("div", { class: "stack" }, h("p", { class: "status-line", "aria-live": "polite" }, swatch, statusText), noteBox());
    const say = (text) => { if (statusText.textContent !== text) statusText.textContent = text; };
    // When his shifts differ (only an overnight runs into the next pay week), say which would be overtime.
    // Once a shift is picked, the line matches that shift. A P-OT day is about times, not shift names.
    const dayStatus = () => {
      swatch.className = `sw ${sw}`;
      say(info.kind === "pot" ? headline : mixedOt(k, info) || headline);
    };
    // timed: the count comes from a shift time the supervisor typed. Without one, part-overtime says "some".
    const shiftStatus = (ot, timed) => {
      if (ot && ot.no) { swatch.className = "sw busy"; say(ot.no.join(" ")); return; }
      const st = otState(ot);
      swatch.className = `sw ${st}`;
      say(st === "open" ? "I'm available"
        : ot === true ? "I'm available, but it would be overtime"
        : ot.part ? "I'm available, but part of the shift would be overtime"
        : st === "ot" ? `I'm available, but all ${hoursText(ot.hours)} would be overtime`
        : `I'm available, but ${timed ? num(ot.ot) : "some"} of the ${hoursText(ot.hours)} would be overtime`);
    };
    dayStatus();
    // The steps taken in this window, newest last, so Back (the button or the phone's gesture) undoes them in order.
    // memo keeps what was typed, by shift, so going back and forth never loses it.
    const sheet = $("#daySheet"), trail = [];
    const syncBack = () => { $("#dayBack").hidden = !trail.length; };
    const tr = {
      forward(undo) {
        const entry = () => { if (trail[trail.length - 1] === entry) trail.pop(); undo(); syncBack(); };
        trail.push(entry);
        nav.step(sheet, entry);
        syncBack();
      },
      back() { if (trail.length) nav.back(sheet, trail[trail.length - 1]); },
      memo: {},
    };
    sheet.goBack = tr.back;
    syncBack();
    if (info.kind === "unset") {
      wrap.append(h("p", { class: "muted", text: "I haven't filled in this day yet." }));
    } else if (info.kind === "pot") {
      const area = h("div", { class: "stack" });
      wrap.append(area);
      sendWindow(k, info, null, area, dayStatus, shiftStatus, tr);
    } else if (info.kind === "open" || info.kind === "ot") {
      if (!smsNumber()) wrap.append(h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." }));
      else { const area = h("div", { class: "stack" }); wrap.append(area); shiftChoice(k, info, area, dayStatus, shiftStatus, tr); }
    }
    $("#dayBody").replaceChildren(wrap);
    $("#daySheet").openedAt = Date.now();
    $("#daySheet").openerKey = k;
    showSheet("#daySheet");
  }

  // "I'm available. Morning and Swing would be overtime." when the shifts he takes differ; null when they don't.
  function mixedOt(k, info) {
    const types = info.w || pub.willing;
    const full = [], part = [];
    for (const t of types) {
      const r = shiftOt(k, t, null);
      if (!r) {
        // An older calendar file only lists the overtime shifts.
        return info.kind === "ot" && info.x ? `I'm available. ${info.x.map((x) => SHIFT_LABEL[x]).join(" and ")} would be overtime.` : null;
      }
      if (otState(r) === "ot") full.push(t);
      else if (otState(r) === "pot") part.push(t);
    }
    if (full.length === types.length || part.length === types.length || !(full.length + part.length)) return null;
    const names = (list) => list.map((t) => SHIFT_LABEL[t]).join(" and ");
    return ["I'm available.", full.length ? `${names(full)} would be overtime.` : "", part.length ? `${names(part)} would be partly overtime.` : ""].filter(Boolean).join(" ");
  }

  // First the supervisor picks the shift. One he doesn't take gets a short no; one he takes opens the message.
  const SHIFT_ORDER = ["morning", "swing", "overnight"];
  function shiftChoice(k, info, area, dayStatus, shiftStatus, tr) {
    const accepts = info.w || pub.willing;
    const show = showIn(area);
    const choose = (focusFirst) => {
      dayStatus();
      show([
        h("p", { class: "label", id: "shiftQ", text: "Which shift do you need covered?" }),
        h("div", { class: "shift-choice", role: "group", "aria-labelledby": "shiftQ" }, SHIFT_ORDER.map((t) =>
          h("button", { type: "button", class: "btn ghost", "data-type": t, text: SHIFT_LABEL[t], onclick: () => pick(t) }))),
      ], focusFirst === true ? ".shift-choice button" : null);
    };
    const pick = (t) => {
      if (accepts.indexOf(t) < 0) {
        // The answer itself takes focus, so a screen reader reads it out.
        show([
          h("p", { class: "decline", tabindex: "-1", text: `Sorry, I'm not accepting ${SHIFT_LABEL[t]} shifts right now.` }),
          h("button", { type: "button", class: "btn ghost", text: "Pick a Different Shift", onclick: tr.back }),
        ], ".decline");
        tr.forward(() => choose(true));
        return;
      }
      sendWindow(k, info, t, area, dayStatus, shiftStatus, tr);
      tr.forward(() => choose(true));
    };
    choose(false);
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

  // ---------- feedback: bugs, confusing spots and ideas ----------
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

  // The three quick choices: what goes in the email, and what the message box asks.
  const FB_KIND = {
    broken: { tag: "Something's broken", ask: "What happened?" },
    confusing: { tag: "Something's confusing", ask: "What was confusing?" },
    idea: { tag: "Idea", ask: "What's your idea?" },
  };
  const fbKind = () => { const c = document.querySelector('#fbKind input:checked'); return c ? c.value : ""; };
  const syncFbKind = () => { $("#fbMsgLabel").textContent = fbKind() ? FB_KIND[fbKind()].ask : "Your message"; };

  function openFeedback() {
    if (!pub.feedback) { toast("Add your email for feedback in Settings first."); return; }
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
      err.textContent = "Write your message first.";
      err.hidden = false;
      $("#fbMsg").focus();
      return;
    }
    const name = $("#fbName").value.trim(), contact = $("#fbContact").value.trim();
    if (name) store.set(LS.who, name);
    if (contact) store.set(LS.fbContact, contact); else store.del(LS.fbContact);
    const kind = fbKind();
    const fields = Object.assign({ About: kind ? FB_KIND[kind].tag : "(not picked)", Message: text, Name: name || "(not given)", "Reply to": contact || "(not given)" }, deviceInfo(), { _honey: $("#fbHoney").value });
    if (isEmail(contact)) fields.email = contact; // FormSubmit makes this the email's Reply-To
    const btn = $("#fbSend");
    fbSending = true;
    btn.disabled = true;
    btn.textContent = "Sending…";
    err.hidden = true;
    try {
      const r = await sendFeedback(pub.feedback, fields, `${kind ? FB_KIND[kind].tag : "Feedback"}: ${pub.name ? `${possessive(pub.name)} availability` : "availability calendar"}${name ? ` (from ${name})` : ""}`);
      // Before activation FormSubmit holds reports and delivers them once it's activated, so that counts as sent.
      // The owner is told to activate instead.
      if (r.activate && owner) {
        err.textContent = "FormSubmit is waiting for you to activate it. Check your email for a message from FormSubmit and tap Activate Form.";
        err.hidden = false;
      } else if (r.ok || r.activate) {
        $("#fbMsg").value = "";
        for (const i of document.querySelectorAll("#fbKind input")) i.checked = false;
        syncFbKind();
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
      btn.textContent = "Send Feedback";
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
      const r = await sendFeedback(to, Object.assign({ About: "(test)", Message: "This is a test from Settings. Feedback from supervisors will look like this." }, deviceInfo()),
        "Test: feedback from your availability calendar");
      out.textContent = r.ok
        ? `Sent. Check ${isEmail(to) ? to : "your inbox"} (and the spam folder). If it's there, feedback works.`
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
    $("#editSheet").openerKey = k;
    showSheet("#editSheet");
  }

  function weekLine(k) {
    const info = ownerInfo(k);
    const ws = weekStartOf(k, pub.weekStart);
    let line = `${weekLabel(ws)}: ${num(info.booked)} hrs scheduled.`;
    // A shift that runs past midnight at a pay-week edge counts as ending at 7 AM for supervisors' numbers.
    const theirs = hoursInWeek(ws, priv, true);
    if (theirs !== info.booked) line += ` For supervisors it counts as ${num(theirs)}, since a shift past midnight is counted as ending at 7 AM to keep your times private.`;
    const shift = `One more ${num(priv.pickup)}-hr shift`;
    if (info.kind === "ot") line += ` ${shift} would be all overtime, so supervisors see yellow.`;
    else if (info.kind === "pot") line += ` Part of ${shift.toLowerCase()} would be overtime, so supervisors see P-OT (half green, half yellow).`;
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
    showSheet("#importSheet");
  }

  // ---------- owner: settings ----------
  function otExplain() {
    const end = DOW_LONG[(pub.weekStart + 6) % 7];
    return `Each pay week ends ${end} at midnight. Hours worked after that count toward the next week, and a shift that crosses midnight is split between the two weeks (an overnight you'd pick up on the last day is counted the same way). A day is green when one more ${num(priv.pickup)}-hour shift would keep its pay week at ${num(priv.otAfter)} hours or less, P-OT (half green, half yellow) when only part of that shift would be overtime, and yellow when all of it would. Supervisors' texts say how many hours would be overtime. To count them, the public calendar file has how many hours you have left before overtime in weeks within one ${num(priv.pickup)}-hour shift of it. It never has your times: in that count, a shift that runs past midnight is taken to end at 7 AM, whatever its real times.`;
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
    const today = todayKey(), ws = weekStartOf(today, pub.weekStart);
    // The day before the pay week only counts toward it when its shift runs past midnight.
    const crosses = (r) => r.s === "work" && !!r.start && !!r.end && minutesOf(r.end) <= minutesOf(r.start);
    for (let k = addDays(ws, -1); k <= today; k = addDays(k, 1)) {
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
      if (priv.days[k] || (k < ws && !crosses(was))) continue;
      priv.days[k] = copy;
      autoCopies[k] = copy;
    }
  }
  const forgetAutoCopies = () => { for (const k of Object.keys(autoCopies)) delete autoCopies[k]; };

  // Settings: say so when the note's show-until date has passed (supervisors don't see it then).
  const showNoteExpired = () => { $("#noteExpired").hidden = !(pub.note.trim() && pub.noteUntil && todayKey() > pub.noteUntil); };
  let fbAtOpen = "";
  let potAtOpen = { from: "", to: "" };
  function openSettings() {
    $("#setNote").value = pub.note;
    $("#noteFull").hidden = true;
    $("#setNoteUntil").value = pub.noteUntil;
    showNoteExpired();
    $("#setCallHours").value = num(pub.callHours);
    $("#setName").value = pub.name;
    $("#setEmpId").value = pub.empId;
    $("#setPhone").value = pub.phone;
    $("#setLicName").value = pub.licName;
    $("#setLicNo").value = pub.licNo;
    $("#setLicIssued").value = pub.licIssued;
    $("#setLicExpires").value = pub.licExpires;
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
    $("#setPotStart").value = pub.potFrom ? `${hhmm24(pub.potFrom)}-${hhmm24(pub.potTo)}` : "";
    $("#setPotMax").value = pub.potMax ? num(pub.potMax) : "";
    $("#setPotError").hidden = true;
    potAtOpen = { from: pub.potFrom, to: pub.potTo };
    $("#setWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`sw-${x}`, x, pub.willing.includes(x))));
    renderWeekly();
    $("#repoLine").textContent = `Saves to github.com/${REPO.owner}/${REPO.name}`;
    showSheet("#settingsSheet");
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.id === "setNote") { pub.note = t.value.slice(0, 140); showNoteExpired(); }
    else if (t.id === "setNoteUntil") { pub.noteUntil = isDay(t.value) ? t.value : ""; showNoteExpired(); }
    else if (t.id === "setCallHours") { const n = Number(t.value); if (t.value.trim() !== "" && n >= 0 && n <= 48) pub.callHours = n; }
    else if (t.id === "setName") pub.name = t.value.trim().slice(0, 40);
    else if (t.id === "setEmpId") pub.empId = t.value.trim().slice(0, 20);
    else if (t.id === "setPhone") pub.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setLicName") pub.licName = t.value.trim().slice(0, 60);
    else if (t.id === "setLicNo") pub.licNo = t.value.trim().slice(0, 40);
    else if (t.id === "setLicIssued") pub.licIssued = isDay(t.value) ? t.value : "";
    else if (t.id === "setLicExpires") pub.licExpires = isDay(t.value) ? t.value : "";
    else if (t.id === "setFeedback") {
      const typed = t.value.trim(), id = feedbackId(typed);
      $("#setFeedbackError").textContent = "That doesn't look like an email address. Until it's fixed, the address you had stays.";
      $("#setFeedbackError").hidden = !typed || !!id;
      // While the box doesn't hold a whole address, keep the one from when Settings opened, never a half-typed one.
      pub.feedback = !typed ? "" : id || fbAtOpen;
    }
    else if (t.id === "setPotStart") {
      const typed = t.value.trim(), r = typed ? window.ScheduleParser.readShift(typed) : null;
      $("#setPotError").textContent = "Couldn't read that as a range of start times, like 1900-0300. Until it's fixed, the range you had stays.";
      $("#setPotError").hidden = !typed || !!r;
      // Like the email box: a half-typed range never replaces the one from when Settings opened.
      const use = !typed ? { from: "", to: "" } : r ? { from: r.start, to: r.end } : potAtOpen;
      pub.potFrom = use.from;
      pub.potTo = use.to;
    }
    else if (t.id === "setPotMax") {
      const n = Number(t.value);
      if (!t.value.trim()) pub.potMax = 0;
      else if (n > 0 && n <= 24) pub.potMax = n;
    }
    else if (t.id === "setWeekEnd") { pub.weekStart = ((parseInt(t.value, 10) || 0) + 1) % 7; renderWeekly(); }
    else if (t.closest && t.closest("#setWeekly")) readWeekly(t);
    else if (t.id === "setOt") { if (Number(t.value) > 0) priv.otAfter = Number(t.value); }
    else if (t.id === "setPickup") { if (Number(t.value) > 0 && Number(t.value) <= 24) priv.pickup = Number(t.value); }
    else if (t.closest("#setWilling")) {
      const had = pub.willing.includes("overnight");
      pub.willing = [...document.querySelectorAll("#setWilling input:checked")].map((i) => i.value);
      const has = pub.willing.includes("overnight");
      // Overnight on: the night-shift line goes into his note (if it fits). Off: it comes out.
      if (has !== had) {
        const next = has ? withNight(pub.note) : withoutNight(pub.note);
        $("#noteFull").hidden = !(has && next.length > 140);
        if (next.length <= 140) pub.note = next;
        $("#setNote").value = pub.note;
        showNoteExpired();
      }
    }
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
    const derived = derivePublic(p, v), weeks = otWeeks(p, derived);
    // Hours left before overtime, compared only for the weeks that matter from today on. A schedule rebuilt from
    // the public file has no hours to compare.
    const nearOt = (o) => (o ? JSON.stringify([o.shift, weeks.map((w) => (w in o.left ? o.left[w] : null))]) : "");
    const otBehind = privRes.status === 200 && nearOt(file.ot) !== nearOt(derivePublicOt(p, v, derived));
    const behind = !!file.migrated || upcoming(file.days) !== upcoming(derived) || !same(file.weekly, weeklyPublic(v)) || otBehind;
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
      dataIn = true;
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
      // Once: the night-shift line moves into his note (it used to sit under the header). Tap Save to publish it.
      // After his unsaved changes are back, so a note he was editing isn't skipped, and it isn't one of them.
      if (!pub.nightAuto) {
        pub.nightAuto = true;
        if (pub.willing.includes("overnight") && withNight(pub.note).length <= 140) pub.note = withNight(pub.note);
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
    showSheet("#unlockSheet");
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
    const pubDaysOut = derivePublic(snapPub, payload.priv);
    const pubOut = Object.assign({ v: 2 }, snapPub, { days: pubDaysOut, weekly: weeklyPublic(payload.priv), ot: derivePublicOt(snapPub, payload.priv, pubDaysOut), updated: stamp, rev });
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
    for (const x of document.querySelectorAll(".sheet .x")) {
      x.type = "button";
      x.addEventListener("click", () => x.closest("dialog").close(""));
    }
    // close("") clears returnValue, so dismissing a sheet never repeats the last button's action.
    // A double tap on a day would otherwise land its second tap on a shift button or the backdrop.
    for (const id of ["#daySheet", "#callSheet"]) {
      $(id).addEventListener("click", (e) => {
        if (Date.now() - ($(id).openedAt || 0) < 350) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }
    // The short-notice warning: Text Anyway does what they were about to do; a computer shows the number to call.
    $("#textAnyway").addEventListener("click", () => { const go = callGo; callGo = null; $("#callSheet").close(); if (go) go(); });
    $("#textAnywayLink").addEventListener("click", () => { const go = callGo; callGo = null; if (go) go(); setTimeout(() => $("#callSheet").close(), 0); });
    $("#callShow").addEventListener("click", () => { $("#callNumber").hidden = false; $("#callNumber").focus(); });
    for (const d of document.querySelectorAll("dialog.sheet")) {
      d.addEventListener("click", (e) => { if (e.target === d) d.close(""); });
      d.addEventListener("cancel", () => { d.returnValue = ""; });
      d.addEventListener("close", () => {
        // The day window closed by a back gesture the page couldn't stop: open it again one step back, with
        // everything typed still there.
        if (d.reopenBack) {
          d.reopenBack = false;
          if (d.isConnected && d.goBack) { d.showModal(); d.openedAt = Date.now(); d.goBack(); return; }
        }
        nav.closed(d);
        // A redraw while it was open replaced the day it came from: focus that day again.
        const a = document.activeElement;
        if (d.openerKey && (!a || a === document.body || d.contains(a) || !a.isConnected)) {
          const t = document.querySelector(`#weeks .day[data-key="${d.openerKey}"]`);
          if (t) try { t.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
        }
      });
    }
    // Back in the day window: the button, and Android's back gesture, which Chrome delivers to an open window as a
    // request to close it. Escape still closes the window.
    let escAt = 0;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") escAt = Date.now(); }, true);
    $("#daySheet").addEventListener("cancel", (e) => {
      // Browsers let a page stop only one close request per tap; one it can't stop is a close.
      if (Date.now() - escAt > 500 && !$("#dayBack").hidden) {
        if (e.cancelable) { e.preventDefault(); $("#daySheet").goBack(); }
        else $("#daySheet").reopenBack = true; // it closes anyway: reopened one step back, below
      }
    });
    $("#dayBack").addEventListener("click", () => { if ($("#daySheet").goBack) $("#daySheet").goBack(); });
    // The header's buttons: Call Me and the license each open a small box (one at a time).
    $("#heroCallBtn").addEventListener("click", () => openHeroBox($("#heroCall").hidden ? "#heroCall" : null));
    $("#heroLicBtn").addEventListener("click", () => { if ($("#heroLicBtn").hasAttribute("aria-controls")) openHeroBox($("#heroLic").hidden ? "#heroLic" : null); });
    $("#pickDay").addEventListener("click", pickADay);
    $("#fbKind").addEventListener("change", syncFbKind);
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
      if (!$("#setFeedbackError").hidden) toast("Your feedback email didn't change, because the new one wasn't a full email address.", 5000);
      else if (!$("#setPotError").hidden) toast("Your P-OT start times didn't change, because the new ones couldn't be read.", 5000);
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
      leaving = true;
      for (const k of [LS.token, ...store.keys(LS.draftPrefix), LS.draft2, LS.oldDraft, LS.importText, LS.brush, LS.lastWeekly]) store.del(k);
      nav.leave(() => location.reload());
    });
    $("#settingsBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openSettings()));
    $("#importBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openImport()));
    $("#unlockDiscard").addEventListener("click", () => {
      for (const k of [...store.keys(LS.draftPrefix), LS.draft2, LS.oldDraft, LS.importText, LS.lastWeekly]) store.del(k);
      $("#unlockDraft").hidden = true;
      toast("Discarded");
    });
    // Two tabs editing at once would overwrite each other's unsaved changes.
    window.addEventListener("storage", (e) => {
      if (owner && e.key === LS.savedSignal) rebase();
      // Stop Editing in another tab: this one stops too (even mid-load), so it doesn't keep his hours on screen or write new drafts.
      if (e.key === LS.token && !e.newValue && token) { leaving = true; token = null; nav.leave(() => location.reload()); }
    });
    let importTimer = 0;
    $("#importText").addEventListener("input", () => { clearTimeout(importTimer); importTimer = setTimeout(renderImport, 200); });
    $("#gapBox").addEventListener("change", renderImport);
    $("#importApply").addEventListener("click", applyImport);
    $("#saveBtn").addEventListener("click", () => (busy ? null : save(false)));
    $("#conflictSheet").addEventListener("close", onConflict);
    $("#keySheet").addEventListener("close", onKeyRetry);
    // The preview is a screen of its own: Back (the button or the gesture) returns to editing.
    const endPreview = () => { if (!preview) return; preview = false; render(); };
    $("#previewBtn").addEventListener("click", () => { preview = true; render(); window.scrollTo(0, 0); nav.page(endPreview); });
    $("#previewExit").addEventListener("click", () => nav.back(null, endPreview));
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

  // ---------- the opening ----------
  // The page stays out of sight (class "intro", set in the page's head) until the calendar is in. Then, from that
  // moment (class "opening" for one-time steps, "lit" for what keeps going):
  //   0 s     the page breathes in; his name falls into place letter by letter
  //   0.25 s  the days fall into place, top left to bottom right
  //   0.45 s  the status light switches on, then the status line types itself out (to 1.7 s)
  //   1.8 s   a sparkle in the middle of the strip; 2.1 s the strip opens both ways, then its colors flow
  //   2 s     a ring of light runs out along the grid from the badge; 2.05 s the badge shines and sparkles
  //   2.35 s  a shine crosses Call Me, then the license (2.55 s)
  // and then for good: the status light and his name glow together, the days he can take breathe together, the
  // grid drifts, the arrow nudges, and the button icons glitch now and then. All timings live in app.css.
  // A slow connection shows the page as it is after 1.5 s, with only the lasting effects. Reduced motion: none of it.
  let revealed = false;
  function reveal(animate) {
    if (revealed) return;
    revealed = true;
    const root = document.documentElement, page = $(".page"), weeks = $("#weeks");
    if (!root.classList.contains("intro")) return;
    root.classList.remove("intro");
    try { if (window.CSS && CSS.registerProperty) { CSS.registerProperty({ name: "--r", syntax: "<length>", inherits: false, initialValue: "0px" }); root.classList.add("ripple-ok"); } } catch (e) { /* already registered */ }
    root.classList.add("lit");
    if (!animate) return;
    root.classList.add("opening");
    weeks.classList.add("drop");
    page.classList.add("inhale");
    page.addEventListener("animationend", function done(e) {
      if (e.target !== page) return;
      page.classList.remove("inhale"); // a lasting transform would change how the sticky calendar behaves
      page.removeEventListener("animationend", done);
    });
    if (!$("#accepting").hidden) typeStatus(600, 1100);
    setTimeout(() => { root.classList.remove("opening"); weeks.classList.remove("drop"); }, 4000);
  }

  async function boot() {
    wire();
    checkCred();
    const slow = setTimeout(() => reveal(false), 1500);
    try {
      const r = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const file = readPublicFile(await r.json());
      pub = file.pub;
      pubDays = file.days;
      pubWeekly = file.weekly;
      pubOt = file.ot;
      updated = file.updated;
      dataIn = true;
    } catch {
      loadError = true;
    }
    render();
    clearTimeout(slow);
    reveal(true);
    if (token) await enterOwner();
  }

  boot();
})();
