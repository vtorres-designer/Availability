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
  const LS = { token: "sa.token", savedSignal: "sa.saved", draftPrefix: "sa.d3.", draft2: "sa.draft2", oldDraft: "sa.draft", who: "sa.who", site: "sa.site", addr: "sa.addr", brush: "sa.brush", importText: "sa.import", pay: "sa.pay", fbContact: "sa.fbContact", lastWeekly: "sa.weekly", uploads: "sa.uploads" };
  const PRIVATE_VAR = "AVAILABILITY_PRIVATE";
  const VAR_LIMIT = 47 * 1024; // GitHub allows 48 KB per variable
  const PUBLIC_TAG = { open: "Open", pot: "P-OT", ot: "OT", busy: "Busy", unset: "" };
  const OWNER_TAG = { open: "Open", pot: "P-OT", ot: "OT", work: "Work", busy: "Busy", unset: "" };

  // Public settings live in data.json, which anyone can read. Private ones (hours, notes, overtime rules)
  // live in a repository variable that only the owner's key can read.
  // potFrom/potTo/potMax: on P-OT days, the start times he takes ("19:00" to "03:00") and the longest shift (hours).
  // Empty or 0 means no limit. They're public, so the page can check a supervisor's times.
  // notes: his notes to supervisors, in tab order (see "notes" below). callHours: a shift starting sooner than this asks for a call.
  // licName/licNo/licIssued/licExpires: his license, shown at the top ("" hides it). Dates are "YYYY-MM-DD".
  // uniform: My Uniform's clothes and the code's hash (see "My Uniform: the data"); the code itself is private (uniformCode).
  const defaultPub = () => ({ name: "", empId: "", phone: "", notes: [nightNote("n1", NIGHT_LINE)], willing: ["overnight"], weekStart: 0, feedback: "", potFrom: "", potTo: "", potMax: 0, callHours: 10,
    licName: "", licNo: "", licIssued: "", licExpires: "", uniform: { hash: "", items: [] } });
  const defaultPriv = () => ({ otAfter: 40, pickup: 8, weekly: [], days: {}, uniformCode: "" });

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

  let sheetSeq = 0;
  function showSheet(sel) {
    const d = $(sel);
    d.returnValue = "";
    if (!d.open) { d.showModal(); d.sheetSeq = ++sheetSeq; nav.sheet(d); }
  }
  // The sheet on top (the last one opened, like an item's over Settings): the only one that can be seen and reached.
  const topSheet = () => Array.prototype.slice.call(document.querySelectorAll("dialog[open]")).sort((a, b) => (a.sheetSeq || 0) - (b.sheetSeq || 0)).pop() || null;

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
    const host = topSheet() || document.body; // sheets sit above the page
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
    (topSheet() || document.body).append(ta); // outside the open sheet on top, the page is inert
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

  // ---------- notes ----------
  // Each note has its own text (140 characters), an optional last day to show ("" = no end), and where it shows: the
  // front page, the day window, the Customize Text form. One note is always the night-shift line (auto: "night"): it
  // shows only while he takes overnights, and it can be edited or emptied but not deleted.
  const NIGHT_LINE = "A night shift is listed under the day it starts. Tue means Tue night into Wed morning.";
  const NOTES_MAX = 10;
  const nightNote = (id, text) => ({ id, text, until: "", front: true, day: false, form: false, auto: "night" });
  const noteNum = (n) => (/^n\d{1,4}$/.test(n.id) ? Number(n.id.slice(1)) : 0);
  function cleanNotes(list) {
    const out = [];
    let night = null;
    for (const n of list) {
      if (!n || typeof n !== "object" || out.length >= NOTES_MAX) continue;
      const c = { id: typeof n.id === "string" ? n.id : "", text: typeof n.text === "string" ? n.text.slice(0, 140) : "", until: isDay(n.until) ? n.until : "",
        front: n.front === true, day: n.day === true, form: n.form === true };
      if (n.auto === "night") {
        if (night) continue; // only one
        c.auto = "night";
        night = c;
      } else if (!night && out.length >= NOTES_MAX - 1) continue; // room for the night note
      out.push(c);
    }
    // Ids are "n1", "n2"... and unique; a missing or repeated one gets the next free number.
    const seen = {};
    let next = Math.max(0, ...out.map(noteNum)) + 1;
    for (const c of out) { if (!noteNum(c) || seen[c.id]) c.id = `n${next++}`; seen[c.id] = true; }
    if (!night) out.push(nightNote(`n${next}`, NIGHT_LINE));
    return out;
  }
  // The previous version kept one note, with the night-shift line inside it (nightAuto: the line had been moved in,
  // so a note without it means he took it out). Always gives the same notes for the same file, so a file and the copy
  // saved from it never differ.
  function notesFromOld(r) {
    const note = typeof r.note === "string" ? r.note.slice(0, 140) : "";
    const text = note.split(NIGHT_LINE).join("").replace(/\s{2,}/g, " ").trim();
    const out = text ? [{ id: "n1", text, until: isDay(r.noteUntil) ? r.noteUntil : "", front: true, day: false, form: false }] : [];
    out.push(nightNote(`n${out.length + 1}`, r.nightAuto === true && note.indexOf(NIGHT_LINE) < 0 ? "" : NIGHT_LINE));
    return out;
  }

  // ---------- My Uniform: the data ----------
  // Supervisors who booked a shift with him pick what he wears, from drawings of his own clothes: pub.uniform =
  // {hash, items}, in the public file. It opens with a code from his text, and the file only has the code's hash
  // (SHA-256 of "vt-uniform:" + the code): a "knock first", not a lock. The code itself is private (priv.uniformCode).
  // An item: {id, name, cat, img, img2, tie, blazer, fit, box}.
  //   id: letters and digits, so its file names stay inside uniform/. A replaced drawing gets a new id, so no browser
  //       shows an old copy it kept.
  //   cat: "top", "pants", "tie" or "blazer". name: up to 60 characters (the text to him uses it, so it's needed).
  //   img: its drawing, "uniform/<id>.png" (or .webp, .jpg). img2 (tops only): the same top buttoned up, worn with a
  //       tie ("uniform/<id>-b.png"), or "". tie, blazer (tops only): it can be worn with one.
  //   fit: where the drawing sits on the mannequin: moved by x and y (% of the frame's width and height), scaled by s.
  //   box: the drawing's visible part [x, y, w, h], as fractions of the image, so thumbnails show just the clothes.
  // Every item comes out with all its fields, in this order, so an item read back from the file is never "changed".
  const UNIFORM_MAX = 40;
  const UNIFORM_CATS = ["top", "pants", "tie", "blazer"];
  const roundTo = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  const numIn = (v, lo, hi, dflt) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  // 4 to 8 letters and numbers, in capitals ("" if it isn't one).
  const cleanCode = (s) => { const c = typeof s === "string" ? s.trim().toUpperCase() : ""; return /^[A-Z0-9]{4,8}$/.test(c) ? c : ""; };
  function cleanUniformItem(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    if (typeof r.id !== "string" || !/^[a-z0-9]{1,32}$/.test(r.id) || UNIFORM_CATS.indexOf(r.cat) < 0) return null;
    const file = (p, tail) => (typeof p === "string" && new RegExp(`^uniform/${r.id}${tail}\\.(png|webp|jpe?g)$`).test(p) ? p : "");
    const top = r.cat === "top";
    const out = { id: r.id, name: typeof r.name === "string" ? r.name.trim().slice(0, 60) : "", cat: r.cat, img: file(r.img, ""),
      img2: top ? file(r.img2, "-b") : "", tie: top && r.tie === true, blazer: top && r.blazer === true };
    if (!out.name || !out.img) return null; // nothing to show, or to name in the text
    const f = r.fit && typeof r.fit === "object" ? r.fit : {};
    out.fit = { x: roundTo(numIn(f.x, -50, 50, 0), 2), y: roundTo(numIn(f.y, -50, 50, 0), 2), s: roundTo(numIn(f.s, 0.2, 3, 1), 3) };
    const b = Array.isArray(r.box) && r.box.length === 4 && r.box.every((n) => typeof n === "number" && n >= 0 && n <= 1) ? r.box.map((n) => roundTo(n, 4)) : null;
    out.box = b && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1.0001 && b[1] + b[3] <= 1.0001 ? b : [0, 0, 1, 1];
    return out;
  }
  function cleanUniform(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const hash = typeof r.hash === "string" && /^[0-9a-f]{64}$/i.test(r.hash) ? r.hash.toLowerCase() : "";
    const items = [], seen = {};
    for (const x of Array.isArray(r.items) ? r.items : []) {
      const c = items.length < UNIFORM_MAX ? cleanUniformItem(x) : null;
      if (!c || seen[c.id]) continue;
      seen[c.id] = true;
      items.push(c);
    }
    return { hash, items };
  }
  // SHA-256 for browsers without crypto.subtle (older ones, and any page not on https). Bytes in, hex out.
  const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex(bytes) {
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    const n = bytes.length, size = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(size);
    m.set(bytes);
    m[n] = 0x80;
    const hi = Math.floor(n / 0x20000000), lo = (n * 8) >>> 0; // the length in bits, in the last 8 bytes
    for (let i = 0; i < 4; i++) { m[size - 8 + i] = (hi >>> (24 - 8 * i)) & 255; m[size - 4 + i] = (lo >>> (24 - 8 * i)) & 255; }
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    for (let at = 0; at < size; at += 64) {
      for (let t = 0; t < 64; t++) {
        if (t < 16) w[t] = (m[at + 4 * t] << 24) | (m[at + 4 * t + 1] << 16) | (m[at + 4 * t + 2] << 8) | m[at + 4 * t + 3];
        else {
          const a = w[t - 15], b = w[t - 2];
          w[t] = (w[t - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[t - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) | 0;
        }
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[t] + w[t]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = (H[i] + x) | 0; });
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  // The hash the public file keeps for a code (the code in capitals).
  async function uniformHash(code) {
    const bytes = new TextEncoder().encode(`vt-uniform:${code}`);
    try {
      if (window.crypto && crypto.subtle) return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
    } catch (e) { /* not allowed here: the same sum below */ }
    return sha256Hex(bytes);
  }
  // The same hash, worked out at once: edit mode changes the code and its hash together.
  const codeHash = (code) => sha256Hex(new TextEncoder().encode(`vt-uniform:${code}`));

  // keepExtra: carry over simple fields a newer version of the site added, so saving from here doesn't erase them.
  function normalizePub(raw, keepExtra) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPub();
    if (typeof r.name === "string") d.name = r.name.trim().slice(0, 40);
    if (typeof r.empId === "string") d.empId = r.empId.trim().slice(0, 20);
    if (typeof r.phone === "string") d.phone = r.phone.trim().slice(0, 20);
    d.notes = Array.isArray(r.notes) ? cleanNotes(r.notes) : notesFromOld(r);
    if (Array.isArray(r.willing)) d.willing = cleanWilling(r.willing);
    const ws = parseInt(r.weekStart, 10);
    if (ws >= 0 && ws <= 6) d.weekStart = ws;
    if (typeof r.feedback === "string") d.feedback = feedbackId(r.feedback);
    if (isTime(r.potFrom) && isTime(r.potTo)) { d.potFrom = r.potFrom; d.potTo = r.potTo; }
    if (typeof r.callHours === "number" && r.callHours >= 0 && r.callHours <= 48) d.callHours = r.callHours;
    if (Number(r.potMax) > 0 && Number(r.potMax) <= 24) d.potMax = Number(r.potMax);
    if (typeof r.licName === "string") d.licName = r.licName.trim().slice(0, 60);
    if (typeof r.licNo === "string") d.licNo = r.licNo.trim().slice(0, 40);
    if (isDay(r.licIssued)) d.licIssued = r.licIssued;
    if (isDay(r.licExpires)) d.licExpires = r.licExpires;
    d.uniform = cleanUniform(r.uniform);
    if (keepExtra) {
      for (const k of Object.keys(r)) {
        const v = r[k];
        // note, noteUntil and nightAuto: the previous version's single note, now in notes. A My Uniform code never goes
        // into the public file, even if one got there.
        if (k in d || ["v", "days", "updated", "rev", "note", "noteUntil", "nightAuto", "uniformCode"].includes(k) || k.length > 40) continue;
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
    d.uniformCode = cleanCode(r.uniformCode);
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
    for (const f of Object.keys(pub)) if (f !== "uniform" && JSON.stringify(pub[f]) !== JSON.stringify(saved.pub[f])) d.pub[f] = { to: pub[f], from: saved.pub[f] };
    for (const f of ["otAfter", "pickup"]) if (!same(priv[f], saved.priv[f])) d.priv[f] = { to: priv[f], from: saved.priv[f] };
    // My Uniform: the code goes with its hash, and each item on its own (by id), so changes from two devices or tabs to
    // different items both survive. order: the items' order here, so a new item goes back in where it was.
    d.uni = { items: {}, order: pub.uniform.items.map((x) => x.id) };
    const code = (p, v) => ({ code: v.uniformCode, hash: p.uniform.hash });
    if (!same(code(pub, priv), code(saved.pub, saved.priv))) d.uni.code = { to: code(pub, priv), from: code(saved.pub, saved.priv) };
    for (const id of new Set([...pub.uniform.items, ...saved.pub.uniform.items].map((x) => x.id))) {
      const to = uniformItemIn(pub, id), from = uniformItemIn(saved.pub, id);
      if (!same(to, from)) d.uni.items[id] = { to, from };
    }
    // Every-week days are kept per weekday, so changes from two devices or tabs to different weekdays both survive.
    d.wk = {};
    for (let w = 0; w < 7; w++) {
      const to = ruleFor(priv.weekly, w), from = ruleFor(saved.priv.weekly, w);
      if (!same(to, from)) d.wk[w] = { to, from };
    }
    return d;
  }
  const uniformItemIn = (p, id) => p.uniform.items.filter((x) => x.id === id)[0] || null;
  const uniSize = (u) => (u && typeof u === "object" ? Object.keys(u.items || {}).length + (u.code ? 1 : 0) : 0);
  const diffSize = (d) => Object.keys(d.days).length + Object.keys(d.pub).length + Object.keys(d.priv).length + Object.keys(d.wk || {}).length + uniSize(d.uni);
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

  // Unsaved note changes from the previous version (one note, the night-shift line inside it) become changes to the
  // notes they stand for, worked out the same way as a loaded file's note. Fields the change left alone come from the
  // notes as they are now.
  function oldNoteDraft(dp) {
    if (!dp || typeof dp !== "object" || dp.notes || !(dp.note || dp.noteUntil || dp.nightAuto)) return dp;
    const user = pub.notes.filter((n) => !n.auto)[0], night = pub.notes.filter((n) => n.auto)[0];
    const now = { note: [user ? user.text : "", night.text].filter(Boolean).join(" "), noteUntil: user ? user.until : "", nightAuto: true };
    const side = (k) => { const r = Object.assign({}, now); for (const f of Object.keys(now)) if (dp[f] && typeof dp[f] === "object" && k in dp[f]) r[f] = dp[f][k]; return notesFromOld(r); };
    const out = Object.assign({}, dp, { notes: { to: side("to"), from: side("from") } });
    delete out.note; delete out.noteUntil; delete out.nightAuto;
    return out;
  }

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
    for (const [f, e] of Object.entries(oldNoteDraft(d.pub) || {})) {
      if (f === "notes" && !(e && Array.isArray(e.to))) continue; // never lose his notes to a damaged draft
      if (f !== "uniform" && f in next && take(e, pub[f])) next[f] = e.to;
    }
    pub = normalizePub(next, true);
    for (const f of ["otAfter", "pickup"]) {
      const e = d.priv && d.priv[f];
      if (e && take(e, priv[f]) && Number(e.to) > 0) priv[f] = Number(e.to);
    }
    applyUniform(d.uni, take);
    for (const [w, e] of Object.entries(d.wk || {})) {
      const dow = Number(w);
      if (!(dow >= 0 && dow <= 6) || !take(e, ruleFor(priv.weekly, dow))) continue;
      priv.weekly = cleanWeekly(priv.weekly.filter((r) => r.d !== dow).concat(e.to ? [Object.assign({}, e.to, { d: dow })] : []), priv.pickup);
    }
    return { applied, skipped };
  }
  // My Uniform's part of a diff (see diffOf). take(entry, current) says whether an entry applies. The hash is worked out
  // again from the code, so the two always go together.
  function applyUniform(u, take) {
    if (!u || typeof u !== "object") return;
    let hash = pub.uniform.hash;
    const items = pub.uniform.items.slice();
    const c = u.code;
    if (c && c.to && typeof c.to === "object" && (c.to.code === "" || cleanCode(c.to.code)) && take(c, { code: priv.uniformCode, hash })) {
      priv.uniformCode = cleanCode(c.to.code);
      hash = priv.uniformCode ? codeHash(priv.uniformCode) : /^[0-9a-f]{64}$/.test(c.to.hash) ? c.to.hash : "";
    }
    const order = Array.isArray(u.order) ? u.order : [];
    const rank = (id) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id));
    const list = Object.entries(u.items && typeof u.items === "object" ? u.items : {}).sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [id, e] of list) {
      const to = e && e.to ? cleanUniformItem(e.to) : null;
      if (!e || (e.to && !(to && to.id === id))) continue; // a damaged entry
      const i = items.findIndex((x) => x.id === id);
      // A change to an item deleted elsewhere since doesn't bring it back: its drawings went with it.
      if (i < 0 && e.from) { if (e.to) take(e, null); continue; }
      if (!take(e, i >= 0 ? items[i] : null)) continue;
      if (i >= 0) { if (to) items[i] = to; else items.splice(i, 1); continue; }
      // New here: right after the item it followed on the device that added it (first, if it led the list).
      let at = order.indexOf(id) < 0 ? items.length : 0;
      for (let j = order.indexOf(id) - 1; j >= 0; j--) {
        const p = items.findIndex((x) => x.id === order[j]);
        if (p >= 0) { at = p + 1; break; }
      }
      items.splice(at, 0, to);
    }
    pub.uniform = cleanUniform({ hash, items });
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
      const u = d.uni && typeof d.uni === "object" ? d.uni : {};
      if (u.code && same({ code: saved.priv.uniformCode, hash: saved.pub.uniform.hash }, u.code.to)) { delete u.code; changed = true; }
      for (const [id, e] of Object.entries(u.items || {})) if (!e || same(uniformItemIn(saved.pub, id), e.to)) { delete u.items[id]; changed = true; }
      if (!changed) continue;
      if (diffSize({ days: d.days || {}, pub: d.pub || {}, priv: d.priv || {}, wk: d.wk || {}, uni: d.uni })) store.set(key, JSON.stringify(d));
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
      if ($("#settingsSheet").open) { renderWeekly(); renderNotes(); renderUniSettings(); }
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
    const word = (w) => h("span", { class: "word", "aria-hidden": "true" }, letters(w).map((ch) => h("span", { class: "ch", style: `--c:${i++}`, text: ch })));
    // A line can break between words and after a hyphen; a word wider than the line breaks between letters.
    const words = name.split(" ").map((w) => w.split("-").map((s, k, a) => (k < a.length - 1 ? `${s}-` : s)).filter(Boolean).map(word));
    t.replaceChildren(...words.flatMap((w, j) => (j ? [" ", ...w] : w)));
  }
  // Letters as people see them (an accent or an emoji made of several code points stays one letter).
  const graphemes = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const letters = (w) => (graphemes ? Array.from(graphemes.segment(w), (x) => x.segment) : [...w]);
  // The status line types itself out during the opening; screen readers get the whole line at once. The part not yet
  // typed is there but unseen, so the line has its full size from the start and nothing below it moves.
  let typer = null;
  function typeStatus(start, dur) {
    const line = $("#accepting");
    typer = { i: 0 };
    const show = () => {
      const text = $("#acceptingText").textContent; // the line as it is now (it can change mid-way)
      $("#acceptingTyped").textContent = text.slice(0, typer.i);
      $("#acceptingRest").textContent = text.slice(typer.i);
      return text;
    };
    show();
    line.classList.add("typing");
    const step = () => {
      if (!typer) return;
      typer.i++;
      const text = show();
      if (typer.i < text.length) setTimeout(step, dur / Math.max(text.length, 1));
      else { typer = null; setTimeout(() => line.classList.remove("typing"), 500); }
    };
    setTimeout(step, start);
  }
  // The status light pulses on his name's beat, even when it shows up later (a slow load, edit mode after a load error,
  // or once he takes a shift again).
  function syncBeat() {
    const t = $("#title"), dot = $("#accepting .live-dot");
    if (!revealed || !t.getAnimations || $("#accepting").hidden) return;
    try {
      const glow = t.getAnimations().find((a) => a.animationName === "name-glow");
      if (glow && glow.startTime != null) for (const a of dot.getAnimations()) if (a.startTime !== glow.startTime) a.startTime = glow.startTime;
    } catch (e) { /* an older browser: they just run on their own */ }
  }
  function renderHero() {
    const ready = dataIn && (owner || !loadError);
    renderTitle();
    const letters = initials(pub.name);
    $("#shield").toggleAttribute("hidden", !letters); // an <svg> has no hidden property, only the attribute
    $("#badge").hidden = !letters; // and the frame it sits in, with its sparkle
    $("#shieldText").textContent = letters;
    $("#accepting").hidden = !ready;
    $("#accepting").classList.toggle("none", !pub.willing.length);
    $("#acceptingText").textContent = acceptingText(pub.willing);
    if (!typer) { $("#acceptingTyped").textContent = acceptingText(pub.willing); $("#acceptingRest").textContent = ""; }
    syncBeat();
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
    weeks.classList.remove("beckon", "drop"); // once the glow ended, the opening's drop would play again
    void weeks.offsetWidth; // restart the glow when it's tapped again
    weeks.classList.add("beckon");
    clearTimeout(pickADay.timer);
    pickADay.timer = setTimeout(() => weeks.classList.remove("beckon"), 3000);
    try { first.focus({ preventScroll: true }); } catch (e) { /* old browser: no focus move */ }
  }

  // A note shows while it has text, its show-until date hasn't passed (the viewer's clock), and, for the night-shift
  // line, while he takes overnights. Nothing shows before the calendar file is in, or when it couldn't be read.
  const nightOn = () => pub.willing.includes("overnight");
  const noteLive = (n) => !!n.text.trim() && !(n.until && todayKey() > n.until) && (n.auto !== "night" || nightOn());
  const notesOn = (place) => (dataIn && (owner || !loadError) ? pub.notes.filter((n) => n[place] && noteLive(n)) : []);
  // A note box: the notes for one place (front, day or form), one under the other, each with its own tag.
  // With none for that place the box is hidden, so it leaves no gap.
  function fillNotes(box, place) {
    const list = notesOn(place);
    box.replaceChildren(...list.map((n) => h("p", null, h("b", { class: "note-tag", text: "Note" }), " ", n.text.trim())));
    box.hidden = !list.length;
  }

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
    // His front-page notes get a box of their own, noticed every visit.
    fillNotes($("#noteBox"), "front");

    $("#dow").replaceChildren(...Array.from({ length: 7 }, (_, i) => h("span", { text: DOW[(pub.weekStart + i) % 7] })));

    const today = todayKey();
    const pending = asOwner ? changes().days : new Set();
    const frag = document.createDocumentFragment();
    const range = weekRange();
    range.forEach((ws, wi) => {
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
    // On a laptop the day tiles share the window's height between the weeks shown.
    $("#weeks").style.setProperty("--weeks", String(range.length));
    $("#weeks").replaceChildren(frag);

    document.body.classList.toggle("owner", asOwner);
    document.body.classList.toggle("previewing", owner && preview);
    $("#toolbar").hidden = !asOwner;
    $("#ownerBanner").hidden = !asOwner;
    $("#previewBar").hidden = !(owner && preview);
    renderUniform();
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
  // The message form is laid out side by side on a laptop, and its notes are the Customize Text form's.
  const showIn = (area) => (nodes, focus) => {
    area.replaceChildren(...nodes.filter((n) => n != null));
    const sheet = $("#daySheet"), form = !!area.querySelector(".tx-grid");
    sheet.classList.toggle("split", form);
    if (sheet.showNotes) sheet.showNotes(form ? "form" : "day");
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

  // A start or end time box, with a two-part AM/PM bar under it.
  function clockField(id, label, update, out) {
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
      el: h("div", { class: "field clock" }, h("label", { class: "label", for: id, text: label }), input,
        h("div", { class: "ap-pick", role: "group", "aria-label": `${label}: AM or PM` }, am, pm)),
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
    const startF = clockField("qkStart", "Starts", () => update(), out);
    const endF = clockField("qkEnd", "Ends", () => update(), out);
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
      h("div", { class: "clocks" }, startF.el, endF.el), // side by side, so the two choices below fit on a phone's screen
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
    // His notes sit right under the answer, where they're read at the moment of asking: the day window's notes on
    // every step, the Customize Text form's on the form, so a note never shows twice.
    // With none for a step, there's no box at all.
    const line = h("p", { class: "status-line", "aria-live": "polite" }, swatch, statusText), notes = h("aside", { class: "note-box" });
    const wrap = h("div", { class: "stack" }, line);
    $("#daySheet").showNotes = (place) => {
      fillNotes(notes, place);
      if (notes.hidden) { if (notes.parentNode) notes.parentNode.removeChild(notes); } else if (!notes.parentNode) wrap.insertBefore(notes, line.nextSibling);
    };
    $("#daySheet").showNotes("day");
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

  // ---------- My Uniform: what supervisors see ----------
  // A button in the corner opens a full-screen view over the page in three steps: the code from his text, the clothes,
  // then the mannequin wearing them with the text to send him. Each step is a screen of its own for Back (the button
  // or the phone's gesture), like the day window's steps. "#uniform" in a link opens it, "#uniform-<CODE>" unlocked.
  // Only when there's a code and at least one top and one pair of pants to pick.
  const uniformLive = () => dataIn && !loadError && !!pub.uniform.hash && ["top", "pants"].every((c) => pub.uniform.items.some((x) => x.cat === c));
  const UNI_KEY = "sa.uniform"; // this tab's session: the code that opened it, so Back and a new visit don't ask again
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };
  // Drawings he uploaded on this visit, by path: shown from here until GitHub Pages serves them (a minute or two).
  const uniformMem = {};
  const uniformSrc = (path) => uniformMem[path] || path;
  const uni = { code: "", codeHash: "", step: "", scroll: {}, pageY: 0, rows: "", send: null, picks: { top: null, pants: null, tie: null, blazer: null } };
  const unlocked = () => !!uni.code && uni.codeHash === pub.uniform.hash;
  const uniItem = (id) => pub.uniform.items.filter((x) => x.id === id)[0] || null;
  const uniPicked = () => { const p = {}; for (const c of UNIFORM_CATS) p[c] = uniItem(uni.picks[c]); return p; };

  // A code typed or from a link: spaces don't count, nor do small letters. A match is kept for the rest of the visit.
  async function tryUniformCode(raw) {
    const code = cleanCode(String(raw || "").replace(/\s+/g, ""));
    if (!code || !pub.uniform.hash) return false;
    const hash = await uniformHash(code);
    if (hash !== pub.uniform.hash) return false;
    uni.code = code;
    uni.codeHash = hash;
    session.set(UNI_KEY, code);
    return true;
  }

  // The mannequin: a flat navy figure from the front with the header's grid on it. full: in the 1:2 frame the drawings
  // are made for (the top of the head at the top edge, the soles at the bottom); otherwise the plain outline the code
  // screen shows faintly. Fixed markup, nothing from the file.
  let manSeq = 0;
  function mannequinSvg(full) {
    const body = '<circle cx="100" cy="40" r="24"/><rect x="90" y="60" width="20" height="20"/><path d="M60 80 Q100 70 140 80 L146 200 L54 200 Z"/><path d="M62 82 L40 90 L28 200 L42 204 L58 120 Z"/><path d="M138 82 L160 90 L172 200 L158 204 L142 120 Z"/><path d="M56 198 H98 L94 390 H64 Z"/><path d="M102 198 H144 L136 390 H106 Z"/>';
    const wrap = document.createElement("div");
    if (!full) wrap.innerHTML = `<svg viewBox="0 0 200 410" aria-hidden="true" focusable="false"><g>${body}</g></svg>`;
    else {
      const id = `uGrid${++manSeq}`, shapes = `${body}<circle cx="35" cy="210" r="8"/><circle cx="165" cy="210" r="8"/><ellipse cx="78" cy="396" rx="18" ry="7"/><ellipse cx="122" cy="396" rx="18" ry="7"/>`;
      wrap.innerHTML = `<svg class="u-man" viewBox="0 6 200 400" aria-hidden="true" focusable="false"><defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="rgba(140,190,255,.22)" stroke-width="1"/></pattern></defs><g fill="#173a6a">${shapes}</g><g fill="url(#${id})">${shapes}</g></svg>`;
    }
    return wrap.firstChild;
  }
  // A drawing on the mannequin: the drawing's canvas is the 1:2 frame, moved by fit.x and fit.y (% of the frame's width
  // and height) and scaled by fit.s around the middle of what's drawn, so resizing never moves it.
  function placeLayer(img, item) {
    const b = item.box, f = item.fit;
    img.style.transformOrigin = `${roundTo((b[0] + b[2] / 2) * 100, 2)}% ${roundTo((b[1] + b[3] / 2) * 100, 2)}%`;
    img.style.transform = `translate(${f.x}%, ${f.y}%) scale(${f.s})`;
  }
  // The outfit on the mannequin, bottom layer first: pants, the top (buttoned up when a tie is picked and it has that
  // drawing), the tie, the blazer.
  function outfitOn(frame, p) {
    const layer = (item, src) => { const img = h("img", { class: "u-layer", alt: "", src: uniformSrc(src), draggable: "false" }); placeLayer(img, item); return img; };
    frame.replaceChildren(mannequinSvg(true), ...[
      p.pants && layer(p.pants, p.pants.img),
      p.top && layer(p.top, p.tie && p.top.img2 ? p.top.img2 : p.top.img),
      p.tie && layer(p.tie, p.tie.img),
      p.blazer && layer(p.blazer, p.blazer.img),
    ].filter(Boolean));
  }
  // A thumbnail: only the drawing's visible part (its box), as big as fits a w x h space, in the middle. Sized in % once
  // the image is in, so the same thumbnail works at any size of that shape.
  function uniThumb(item, w, ht, src) {
    const img = h("img", { alt: "", src: uniformSrc(src || item.img), draggable: "false" });
    const el = h("span", { class: "u-th", "aria-hidden": "true" }, img);
    const place = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight, b = item.box;
      if (!iw || !ih) return;
      const bw = b[2] * iw, bh = b[3] * ih, s = Math.min(w / bw, ht / bh) * 0.92;
      img.style.width = `${((iw * s) / w) * 100}%`;
      img.style.height = `${((ih * s) / ht) * 100}%`;
      img.style.left = `${(((w - bw * s) / 2 - b[0] * iw * s) / w) * 100}%`;
      img.style.top = `${(((ht - bh * s) / 2 - b[1] * ih * s) / ht) * 100}%`;
      img.classList.add("in");
    };
    img.addEventListener("load", place);
    if (img.complete) place();
    return el;
  }
  // "navy polo" for "Navy polo, short sleeve", but "NYPD" stays as it is.
  const lowWord = (w) => (/^[A-Z0-9]{2,}$/.test(w) && /[A-Z]/.test(w) ? w : w.toLowerCase());
  const lowFirst = (s) => (/^[A-Z0-9]{2,}\b/.test(s) && /^[0-9]*[A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  // "Hi Vincent, for the shift please wear: White uniform shirt, long sleeve; navy tie; black blazer; black dress pants. Thanks!"
  function uniformText(p) {
    const parts = [p.top, p.tie, p.blazer, p.pants].filter(Boolean).map((x, i) => (i ? lowFirst(x.name) : x.name));
    return `Hi${firstName() ? ` ${firstName()}` : ""}, for the shift please wear: ${parts.join("; ")}. Thanks!`;
  }

  // Step 2: a row of cards for each kind of clothes (the rows only change when his list does). Tie and Blazer start on
  // None. One pick per row: tapping another card replaces it.
  const UNI_ROWS = [["top", "Tops"], ["pants", "Pants"], ["tie", "Tie"], ["blazer", "Blazer"]];
  function buildPicker() {
    const key = JSON.stringify(pub.uniform.items);
    if (uni.rows === key) return;
    uni.rows = key;
    for (const c of UNIFORM_CATS) { const x = uniItem(uni.picks[c]); if (!x || x.cat !== c) uni.picks[c] = null; }
    $("#uRows").replaceChildren(...UNI_ROWS.map(([cat, label]) => {
      const list = pub.uniform.items.filter((x) => x.cat === cat);
      if (!list.length) return null;
      const extra = cat === "tie" || cat === "blazer";
      const cards = list.map((x) => h("button", { type: "button", class: "u-item", "data-cat": cat, "data-id": x.id, "aria-pressed": "false" },
        uniThumb(x, 76, 66), h("span", { class: "u-name", text: x.name })));
      if (extra) cards.unshift(h("button", { type: "button", class: "u-item none", "data-cat": cat, "data-id": "", "aria-pressed": "true", text: "None" }));
      return h("div", { class: "u-row", "data-cat": cat },
        h("p", { class: "u-lbl", id: `uRow-${cat}` }, label, " ", h("span", { text: `· ${list.length}` })),
        h("div", { class: "u-strip", role: "group", "aria-labelledby": `uRow-${cat}` }, cards),
        extra ? h("p", { class: "u-hint", id: `uWhy-${cat}`, hidden: true }) : null);
    }).filter(Boolean));
  }
  // The picks as they are now: which cards are on, the Tie and Blazer rows (off when the top can't take one, and the
  // pick dropped), the "Your picks" bubbles, and the button to the mannequin.
  function syncPicker() {
    const p = uniPicked();
    for (const cat of ["tie", "blazer"]) {
      const ok = !p.top || p.top[cat], row = document.querySelector(`#uRows .u-row[data-cat="${cat}"]`);
      if (!ok) { uni.picks[cat] = null; p[cat] = null; }
      if (!row) continue;
      for (const b of row.querySelectorAll(".u-item")) { b.disabled = !ok; b.classList.toggle("off", !ok && !!b.dataset.id); }
      const why = row.querySelector(".u-hint");
      why.hidden = ok;
      why.textContent = ok ? "" : `No ${cat} with the ${p.top.name.split(",")[0].trim().split(/\s+/).map(lowWord).join(" ")}.`;
      if (ok) row.querySelector(".u-strip").removeAttribute("aria-describedby"); else row.querySelector(".u-strip").setAttribute("aria-describedby", why.id);
    }
    for (const b of document.querySelectorAll("#uRows .u-item")) b.setAttribute("aria-pressed", String((uni.picks[b.dataset.cat] || "") === b.dataset.id));
    const box = $("#uPicks"), hadFocus = box.contains(document.activeElement);
    const bubble = (cat, x, src) => h("span", { class: "u-bubble" }, uniThumb(x, 24, 24, src), h("span", { class: "u-name", text: x.name }),
      h("button", { type: "button", class: "u-off", "data-cat": cat, "aria-label": `Take off ${x.name}`, text: "×" }));
    const list = [["top", p.top, p.top && p.tie && p.top.img2], ["pants", p.pants], ["tie", p.tie], ["blazer", p.blazer]].filter((x) => x[1]);
    box.replaceChildren(...list.map((x) => bubble(...x)), ...(!p.top && !p.pants ? [h("span", { class: "u-empty", text: "Nothing picked yet." })] : []));
    // Taking one off with the keyboard: on to the next one (or the first row).
    if (hadFocus && !box.contains(document.activeElement)) { const next = box.querySelector(".u-off") || $("#uRows .u-item"); if (next) next.focus(); }
    $("#uSeeBtn").disabled = !(p.top && p.pants);
  }

  // Step 3: the mannequin wearing the picks, the text, and Send As Text: on a phone it opens their texting app with the
  // text to his number; on a computer, a QR code to scan and a copy button. No short-notice check: this isn't a shift.
  function uniformSend() {
    if (uni.send) return uni.send;
    const text = () => $("#uText").textContent;
    if (isPhone()) {
      const send = iconLabel(h("a", { class: "btn go wide", id: "uSendBtn" }), "message", "Send As Text");
      uni.send = { el: h("div", { class: "stack" }, send, copyLinks(text, (go) => go())), update(t) { send.href = smsHref(t); } };
    } else {
      const send = iconLabel(h("button", { type: "button", class: "btn go wide", id: "uSendBtn" }), "message", "Send As Text");
      const qr = qrPanel();
      const copy = iconLabel(h("button", { type: "button", class: "btn ghost", hidden: true }), "copy", "Copy Message");
      send.addEventListener("click", () => {
        qr.show(true);
        copy.hidden = false;
        qr.draw(text(), () => {
          if (qr.el.hidden) return;
          try { copy.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { copy.scrollIntoView(false); }
        });
      });
      copy.addEventListener("click", () => copyWithFeedback(copy, "copy", "Copy Message", text(), "Couldn't copy here. Select the text above and use your device's Copy."));
      uni.send = { el: h("div", { class: "stack" }, send, qr.el, copy), update() { qr.show(false); copy.hidden = true; } };
    }
    return uni.send;
  }
  function drawOutfit() {
    const p = uniPicked(), names = [p.top, p.tie, p.blazer, p.pants].filter(Boolean).map((x) => x.name);
    outfitOn($("#uFrame"), p);
    $("#uFrame").setAttribute("aria-label", `The mannequin wearing ${names.join(", ")}`);
    const text = uniformText(p);
    $("#uText").textContent = text;
    if (!smsNumber()) { $("#uSend").replaceChildren(h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." })); return; }
    const s = uniformSend();
    if (s.el.parentNode !== $("#uSend")) $("#uSend").replaceChildren(s.el);
    s.update(text);
  }

  // Step 1: the code. A code that already opened it this visit is filled in.
  function fillCode() {
    if (unlocked()) { $("#uCodeIn").value = uni.code; codeWrong(false); }
  }
  function codeWrong(on) {
    $("#uCodeIn").classList.toggle("bad", on);
    $("#uCodeIn").setAttribute("aria-invalid", String(on));
    $("#uCodeErr").textContent = on ? "That code doesn't match. Check my text and try again." : "";
  }
  let codeBusy = false;
  async function onUniformCode(e) {
    e.preventDefault();
    const input = $("#uCodeIn");
    if (codeBusy) return;
    if (!input.value.trim()) { input.focus(); return; }
    codeBusy = true;
    let ok = false;
    try { ok = await tryUniformCode(input.value); } catch (x) { /* counts as no match */ }
    codeBusy = false;
    if ($("#uniform").hidden || uni.step !== "code") return; // left it meanwhile
    codeWrong(!ok);
    if (ok) uniTo("pick"); else input.focus();
  }

  // The screens. Opening and each step forward add a history entry; Back undoes one; "‹ Calendar" closes them all.
  const UNI_STEPS = { code: "#uCode", pick: "#uPick", see: "#uSee" };
  function showUni(step, back) {
    const el = $("#uniform");
    uni.step = step;
    for (const [s, sel] of Object.entries(UNI_STEPS)) $(sel).hidden = s !== step;
    if (step === "code") fillCode();
    if (step === "pick") { buildPicker(); syncPicker(); }
    if (step === "see") drawOutfit();
    el.scrollTop = back ? uni.scroll[step] || 0 : 0;
    // Forward: the screen's title (on a computer, the code box). Back: the button that went forward.
    const target = back ? (step === "code" ? "#uOpen" : step === "pick" ? "#uSeeBtn" : null)
      : step === "code" && !isPhone() ? (unlocked() ? "#uOpen" : "#uCodeIn") : `${UNI_STEPS[step]} h2`;
    const f = target && $(target);
    if (f) try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
  }
  function openUniform(step) {
    const el = $("#uniform");
    if (!uniformLive()) return;
    if (!el.hidden) { showUni(step); return; }
    el.hidden = false;
    // The page underneath stays put and out of reach until it closes (and where it was: a phone's keyboard or a box
    // brought into view can move it meanwhile).
    uni.pageY = window.pageYOffset;
    document.documentElement.classList.add("uni-open");
    for (const s of [".page", "#toolbar", "#previewBar"]) $(s).setAttribute("inert", "");
    $(".page").setAttribute("aria-hidden", "true");
    uni.scroll = {};
    showUni(step);
    nav.step(el, hideUniform);
  }
  function uniTo(step) {
    const el = $("#uniform"), was = uni.step;
    uni.scroll[was] = el.scrollTop;
    showUni(step);
    nav.step(el, () => showUni(was, true));
  }
  function hideUniform() {
    const el = $("#uniform");
    if (el.hidden) return;
    el.hidden = true;
    document.documentElement.classList.remove("uni-open");
    for (const s of [".page", "#toolbar", "#previewBar"]) $(s).removeAttribute("inert");
    $(".page").removeAttribute("aria-hidden");
    if (window.pageYOffset !== uni.pageY) window.scrollTo(0, uni.pageY);
    const fab = $("#uniformBtn");
    if (!fab.hidden) try { fab.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  }
  function closeUniform() {
    hideUniform();
    nav.closed($("#uniform"));
  }
  // "#uniform" and "#uniform-<CODE>" (a wrong or old code shows the code screen, with it filled in). The address bar
  // is cleared at once, so the code isn't left in it, in a copied link, or for a reload to open again.
  async function routeUniform() {
    const m = location.hash.match(/^#uniform(?:-([^/?#]*))?$/i);
    if (!m || !uniformLive()) return;
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) { /* ignore */ }
    let raw = m[1] || "";
    try { raw = decodeURIComponent(raw); } catch (e) { /* as it is */ }
    const code = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
    if (code && (await tryUniformCode(code))) { openUniform("pick"); return; }
    openUniform(unlocked() ? "pick" : "code");
    if (code && uni.step === "code") { $("#uCodeIn").value = code; codeWrong(true); }
  }
  // The code that opened it earlier this visit, if it still matches the page's.
  async function restoreUniformCode() {
    const c = session.get(UNI_KEY);
    if (c && pub.uniform.hash && !unlocked()) { try { await tryUniformCode(c); } catch (e) { /* ask again */ } }
  }
  // The corner button: supervisors' view and his preview of it, never while he edits. On a phone, the page gets room at
  // its bottom so the button never covers the links. In the preview it sits above the preview's bar.
  function renderUniform() {
    const on = uniformLive() && !ownerView();
    $("#uniformBtn").hidden = !on;
    document.body.classList.toggle("u-fab", on);
    for (const el of document.querySelectorAll("#uniform .u-who")) { el.textContent = pub.name; el.hidden = !pub.name; }
    if (owner && preview) document.body.style.setProperty("--bar-h", `${$("#previewBar").offsetHeight}px`);
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

  // ---------- owner: notes ----------
  // One tab per note, in order (the night-shift line's tab only while Overnight is checked), and the open note's
  // text, show-until date and switches under them. Every change is an ordinary unsaved change.
  let noteSel = ""; // the open note's id
  const PLACES = ["front", "day", "form"];
  const placeBox = (p) => $(`#note${p[0].toUpperCase()}${p.slice(1)}`);
  const noteTabs = () => pub.notes.filter((n) => n.auto !== "night" || nightOn());
  const noteTitle = (n) => (n.auto ? "Night shifts" : `Note ${pub.notes.filter((x) => !x.auto).indexOf(n) + 1}`);
  const openNote = () => pub.notes.filter((n) => n.id === noteSel)[0] || null;
  function renderNotes() {
    const list = noteTabs();
    if (!list.some((n) => n.id === noteSel)) noteSel = list.length ? list[0].id : "";
    const n = openNote();
    renderNoteTabs(list);
    $("#noteAdd").hidden = pub.notes.length >= NOTES_MAX;
    $("#noteNone").hidden = !!n;
    $("#noteEdit").hidden = !n;
    if (!n) return;
    $("#noteEdit").setAttribute("aria-labelledby", `noteTab-${n.id}`);
    $("#noteAuto").hidden = !n.auto;
    $("#noteTextLabel").textContent = `${noteTitle(n)} text`;
    $("#setNoteText").value = n.text;
    $("#setNoteUntil").value = n.until;
    for (const p of PLACES) placeBox(p).checked = n[p];
    $("#noteDelete").hidden = !!n.auto;
    $("#noteDelete").textContent = `Delete ${noteTitle(n)}`;
    noteBits(n);
  }
  // A tab's light is on while its note shows somewhere: it has text and a place, and its date hasn't passed.
  function renderNoteTabs(list) {
    const tabs = $("#noteTabs"), focused = tabs.contains(document.activeElement);
    tabs.replaceChildren(...list.map((x) => h("button", { type: "button", role: "tab", class: "note-tab", id: `noteTab-${x.id}`, "data-id": x.id,
      "aria-selected": String(x.id === noteSel), "aria-controls": "noteEdit", tabindex: x.id === noteSel ? "0" : "-1" },
    h("span", { class: PLACES.some((p) => x[p]) && noteLive(x) ? "pip" : "pip off", "aria-hidden": "true" }), noteTitle(x))));
    if (focused && noteSel) $(`#noteTab-${noteSel}`).focus();
  }
  // The counter, and a line when the show-until date has passed (supervisors don't see the note then).
  function noteBits(n) {
    $("#noteCount").textContent = `${n.text.length} / 140`;
    $("#noteExpired").hidden = !(n.text.trim() && n.until && todayKey() > n.until);
    fitNoteText();
  }
  // The text box grows with the note, so all of it is in view (once Settings is on screen).
  function fitNoteText() {
    const t = $("#setNoteText");
    if (!t.offsetHeight) return;
    t.style.height = "";
    t.style.height = `${Math.max(t.offsetHeight, t.scrollHeight + t.offsetHeight - t.clientHeight)}px`;
  }
  // A change in the open note's fields. Its text stays on one line, as it shows on the page. The field being typed
  // in is never written back (a half-typed date would be wiped).
  function editNote(t) {
    const n = openNote();
    if (!n) return false;
    if (t.id === "setNoteText") {
      if (/[\r\n]/.test(t.value)) t.value = t.value.replace(/\s*[\r\n]+\s*/g, " ");
      n.text = t.value.slice(0, 140);
    } else if (t.id === "setNoteUntil") n.until = isDay(t.value) ? t.value : "";
    else if (PLACES.indexOf(t.dataset.place) >= 0) n[t.dataset.place] = t.checked;
    else return false;
    renderNoteTabs(noteTabs());
    noteBits(n);
    return true;
  }
  function addNote() {
    if (pub.notes.length >= NOTES_MAX) return;
    const n = { id: `n${Math.max(0, ...pub.notes.map(noteNum)) + 1}`, text: "", until: "", front: true, day: false, form: false };
    // Right after his last note, so the night-shift line keeps its place.
    let at = 0;
    pub.notes.forEach((x, i) => { if (!x.auto) at = i + 1; });
    pub.notes.splice(at, 0, n);
    noteSel = n.id;
    afterChange();
    renderNotes();
    $("#setNoteText").focus();
  }
  function deleteNote() {
    const n = openNote();
    if (!n || n.auto) return;
    const before = noteTabs(), i = before.indexOf(n);
    pub.notes.splice(pub.notes.indexOf(n), 1);
    // The tab before it opens (or the first one).
    const left = noteTabs();
    noteSel = left.length ? left[Math.max(0, i - 1)].id : "";
    afterChange();
    renderNotes();
    try { (noteSel ? $(`#noteTab-${noteSel}`) : $("#noteAdd")).focus(); } catch (e) { /* ignore */ }
  }
  // The tabs from the keyboard: arrows, Home and End move between them.
  function onNoteKey(e) {
    const tab = e.target.closest("[role=tab]"), list = noteTabs();
    const i = list.findIndex((n) => n.id === (tab ? tab.dataset.id : noteSel));
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to == null || !list.length) return;
    e.preventDefault();
    noteSel = list[(to + list.length) % list.length].id;
    renderNotes();
    $(`#noteTab-${noteSel}`).focus();
  }

  // ---------- owner: My Uniform ----------
  // Settings → My Uniform: the code (kept private; the public file only gets its hash), a link with the code built in,
  // and his clothes. Each item opens in a sheet of its own. A drawing is made ready in the browser and uploaded to
  // uniform/ the moment he taps Save Item; the item itself is then an unsaved change, like any other setting.
  const CAT_NAME = { top: "Top", pants: "Pants", tie: "Tie", blazer: "Blazer" };
  const uniReady = (p) => !!p.uniform.hash && ["top", "pants"].every((c) => p.uniform.items.some((x) => x.cat === c));
  const uniLocked = () => standIn || !privAccess; // the code is private, so changing it needs the private settings
  let uniAtOpen = { code: "", hash: "" };
  // The code and its hash change together, so the file never has the hash of a code he doesn't have. "" turns it off.
  function setUniformCode(code) {
    priv.uniformCode = code;
    pub.uniform = { hash: code ? codeHash(code) : "", items: pub.uniform.items };
  }
  // Typed in Settings: capitals, letters and numbers only. Like the email box, a half-typed code never replaces the one
  // from when Settings opened.
  function readUniCode(t) {
    const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (v !== t.value) { const at = Math.min(t.selectionStart || v.length, v.length); t.value = v; try { t.setSelectionRange(at, at); } catch (e) { /* ignore */ } }
    const code = cleanCode(v);
    $("#uniCodeError").hidden = !v || !!code;
    if (!v || code) setUniformCode(code);
    else { priv.uniformCode = uniAtOpen.code; pub.uniform = { hash: uniAtOpen.hash, items: pub.uniform.items }; }
    renderUniCode();
  }
  // Six of these: no I, L, O, 0 or 1, which are easy to mix up in a text.
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function randomCode() {
    const n = new Uint32Array(6);
    try { crypto.getRandomValues(n); } catch (e) { for (let i = 0; i < 6; i++) n[i] = Math.floor(Math.random() * 4294967296); }
    return Array.from(n, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
  }
  function newUniCode() {
    if (uniLocked()) return;
    const input = $("#setUniCode");
    input.value = randomCode();
    readUniCode(input);
    afterChange();
  }
  const uniLink = () => (priv.uniformCode ? `${shareUrl()}#uniform-${priv.uniformCode}` : "");
  function selectText(el) {
    try { const r = document.createRange(), s = window.getSelection(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
  }
  async function copyUniLink() {
    const b = $("#uniCopyLink"), link = uniLink();
    if (!link) return;
    const ok = await copyText(link);
    if (!ok) selectText($("#uniLink"));
    b.textContent = ok ? "Copied!" : "Press and hold the link to copy it";
    clearTimeout(b.copiedTimer);
    b.copiedTimer = setTimeout(() => { b.textContent = "Copy Link With Code"; }, 2500);
  }

  function renderUniSettings() {
    const input = $("#setUniCode"), locked = uniLocked();
    if (document.activeElement !== input) input.value = priv.uniformCode;
    input.disabled = locked;
    $("#uniNewCode").disabled = locked;
    $("#uniLocked").hidden = !locked;
    renderUniCode();
    renderUniItems();
  }
  function renderUniCode() {
    const link = uniLink();
    $("#uniLinkRow").hidden = !link;
    $("#uniLink").textContent = link.replace(/^https?:\/\//, "");
    $("#uniLost").hidden = uniLocked() || !!priv.uniformCode || !pub.uniform.hash;
    $("#uniState").textContent = !pub.uniform.hash ? "My Uniform is off until you set a code."
      : !uniReady(pub) ? "Add at least one top and one pair of pants. Until then, supervisors don't see the My Uniform button."
      : saved && uniReady(saved.pub) ? "Supervisors see the My Uniform button." : "Once you tap Save, supervisors see the My Uniform button.";
  }
  // His clothes, a card each (tops, then pants, ties and blazers, as the picker shows them), and Add Item.
  function renderUniItems(focusId) {
    const items = pub.uniform.items, box = $("#uniItems");
    const was = box.contains(document.activeElement) ? document.activeElement.dataset.id : null, back = focusId != null ? focusId : was;
    $("#uniCount").textContent = `· ${items.length} item${items.length === 1 ? "" : "s"}`;
    const cards = UNIFORM_CATS.flatMap((c) => items.filter((x) => x.cat === c)).map((x) =>
      h("button", { type: "button", class: "uni-item", "data-id": x.id, "aria-label": `Edit ${x.name} (${CAT_NAME[x.cat]})` }, uniThumb(x, 80, 56), h("span", { class: "u-name", text: x.name })));
    box.replaceChildren(...cards, items.length < UNIFORM_MAX
      ? h("button", { type: "button", class: "uni-item add", "data-id": "", text: "+ Add Item" })
      : h("p", { class: "muted small uni-full", text: `That's as many as My Uniform holds (${UNIFORM_MAX}). Delete one to add another.` }));
    if (back != null) {
      const el = box.querySelector(`.uni-item[data-id="${back}"]`) || box.querySelector(".uni-item.add") || box.querySelector(".uni-item");
      if (el) try { el.focus({ preventScroll: focusId == null }); } catch (e) { el.focus(); }
    }
  }

  // ---------- owner: one item of My Uniform ----------
  // The prompts for the drawing AI (approved word for word): one per category, and one more for a shirt worn with a tie,
  // so its collar can be shown buttoned up.
  const PROMPT_WHERE = {
    top: "- It's a top. The collar sits about 13% down from the top edge, the shoulders span about 40% of the width, and the hem sits about 50% down. Sleeves hang straight down at the sides; long sleeves end at the wrists, about 50% down.\n- If it has a collar and buttons, draw the top button undone with the collar slightly open.",
    pants: "- They're pants. The waistband sits about 48% down from the top edge and the hems about 96% down, legs straight and slightly apart, about 40% of the width across the hips.",
    tie: "- It's a tie, hanging straight down the middle. The knot sits about 16% down from the top edge and the tip about 42% down. The tie is about 7% of the width across at its widest.",
    blazer: "- It's a blazer, worn open. The shoulders span about 42% of the width at about 13% down, sleeves hang straight down to the wrists (about 50% down), and the hem sits about 54% down. Leave a V-shaped gap down the front, from the collar to the hem, where a shirt and tie would show.",
  };
  function drawingPrompt(cat) {
    return "Please draw a clothing illustration for the uniform picker on my website. I've attached a photo of the real item.\n\n" +
      "WHAT TO DRAW\n- Only the item in the photo, exactly as it is: same color, collar, pockets, buttons, stitching, patches and badges.\n\n" +
      "STYLE\n- A clean, flat illustration, like a fashion flat sketch: solid colors that match the real fabric, a thin outline a little darker than the fabric, and soft shading only for folds.\n" +
      "- Straight-on front view, symmetrical, as if worn by an invisible person standing straight with arms relaxed at their sides.\n" +
      "- No person, mannequin, hanger, shadow, floor, text or watermark.\n\n" +
      "CANVAS (so it lines up on a mannequin on my website)\n- Portrait, exactly 1:2, for example 800 x 1600 pixels.\n- Transparent background (PNG). If you can't make it transparent, use plain solid white with nothing else on it.\n" +
      "- Picture a person filling the canvas from the top of the head at the top edge to the soles at the bottom edge, centered left to right. Draw the item only, where it would sit on that person:\n" + PROMPT_WHERE[cat] + "\n\n" +
      "If I send more items in this chat, keep the same style, canvas and scale for all of them so they match.\n\nGive me just the image.";
  }
  const PROMPT_BUTTONED = "Now make a second version of the shirt you just drew.\n\nKeep everything identical: the same canvas size, position, scale, colors, outline, shading and transparent background.\n\nThe only change: button the collar all the way to the top, closed snugly around the neck, the way it's worn with a tie. Don't draw a tie.\n\nGive me just the image.";

  // The item open in its sheet: was (the item in the list, null for a new one), item (the copy being changed), files
  // (drawings picked for img and img2, made ready but not uploaded; img2 false: take it off), up (an upload under way:
  // the new id and the files already sent, so trying again picks up where it stopped).
  let ed = null;
  let itemFocus = null; // the card to go back to once the sheet closes
  const blankItem = () => ({ id: "", name: "", cat: "top", img: "", img2: "", tie: true, blazer: false, fit: { x: 0, y: 0, s: 1 }, box: [0, 0, 1, 1] });
  function openItem(id) {
    const was = id ? uniformItemIn(pub, id) : null;
    if (!was && pub.uniform.items.length >= UNIFORM_MAX) return;
    ed = { was, item: Object.assign(blankItem(), was ? clone(was) : {}), files: { img: null, img2: null }, up: null, busy: false };
    itemFocus = id || "";
    $("#itemTitle").textContent = was ? "Edit Item" : "Add Item";
    for (const r of document.querySelectorAll("#itemCat input")) r.checked = r.value === ed.item.cat;
    $("#itemTie").checked = ed.item.tie;
    $("#itemBlazer").checked = ed.item.blazer;
    $("#itemName").value = ed.item.name;
    $("#itemDelete").hidden = !was;
    for (const s of ["#itemError", "#itemFileError", "#itemPromptText"]) $(s).hidden = true;
    $("#itemCopied").textContent = "";
    syncItemBusy();
    syncItem();
    showSheet("#itemSheet");
    drawFit(); // once the sheet is open, so the frame has its size
  }
  // What shows for the category: the switches and the buttoned-up drawing are for tops (the drawing, with a tie).
  function syncItem() {
    const it = ed.item, top = it.cat === "top", tie = top && it.tie, f = ed.files;
    $("#itemWith").hidden = !top;
    $("#itemPrompt2").hidden = !tie;
    $("#itemPrompt2Hint").hidden = !tie;
    $("#itemB").hidden = !tie;
    $("#itemPickText").textContent = f.img || it.img ? "Replace Drawing" : "Choose Drawing";
    $("#itemFileName").textContent = f.img ? f.img.name : "";
    const has2 = f.img2 === false ? false : !!(f.img2 || it.img2);
    $("#itemPick2Text").textContent = has2 ? "Replace Drawing" : "Choose Drawing";
    $("#itemFile2Name").textContent = f.img2 ? f.img2.name : has2 ? "Added" : "";
    $("#itemDrop2").hidden = !has2;
    $("#itemOpaque").hidden = !(f.img && f.img.opaque);
    $("#itemName").placeholder = `e.g. ${{ top: "White uniform shirt, long sleeve", pants: "Black tactical pants", tie: "Navy tie", blazer: "Black blazer" }[it.cat]}`;
  }
  function syncItemBusy() {
    $("#itemSave").disabled = !!(ed && ed.busy);
    $("#itemSave").textContent = ed && ed.busy ? "Uploading…" : "Save Item";
    $("#itemDelete").disabled = !!(ed && ed.busy);
  }
  function onItemChange(e) {
    const t = e.target;
    if (!ed) return;
    if (t.name === "itemCat") { ed.item.cat = t.value; $("#itemCopied").textContent = ""; $("#itemPromptText").hidden = true; }
    else if (t.id === "itemTie") ed.item.tie = t.checked;
    else if (t.id === "itemBlazer") ed.item.blazer = t.checked;
    else if (t.id === "itemName") { ed.item.name = t.value; return; }
    else if (t.id === "itemSize") { ed.item.fit.s = roundTo(Math.min(3, Math.max(0.2, Number(t.value) / 100)), 3); placeFit(); return; }
    else return;
    syncItem();
    drawFit(); // the other item shown for scale goes with the category
  }

  // Copies a prompt. If the browser won't, the prompt shows, selected, to copy by hand.
  async function copyPrompt(buttoned) {
    if (!ed) return;
    const text = buttoned ? PROMPT_BUTTONED : drawingPrompt(ed.item.cat), box = $("#itemPromptText"), line = $("#itemCopied");
    box.hidden = true;
    const ok = await copyText(text);
    line.classList.toggle("todo", !ok);
    if (ok) { line.textContent = `${buttoned ? "Buttoned-up prompt" : "Drawing prompt"} copied. Paste it into the drawing AI with a photo of the item.`; return; }
    box.textContent = text;
    box.hidden = false;
    try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
    selectText(box);
    line.textContent = "Press Ctrl+C (or Copy) to copy the selected prompt.";
  }

  // A picked drawing, made ready here: at most 600 x 1200 (never enlarged), WebP where the browser really makes it
  // (smaller), PNG otherwise, and the box around what's drawn, from its transparency. A drawing with no see-through
  // background (plain white, say) still works: its box is the whole picture.
  const UNI_FILE_MAX = 10 * 1024 * 1024;
  const sayErr = (text) => Object.assign(new Error(text), { say: text });
  function decodeImage(file) {
    const viaImg = () => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
    if (typeof createImageBitmap !== "function") return viaImg();
    return createImageBitmap(file).then((b) => ({ src: b, w: b.width, h: b.height, done: () => { if (b.close) b.close(); } }), viaImg);
  }
  const canvasOf = (w, ht) => { const c = document.createElement("canvas"); c.width = w; c.height = ht; return c; };
  // Halving first keeps thin outlines smooth: one big step down drops most of their pixels.
  function shrink(src, w0, h0, w, ht) {
    let cur = src, cw = w0, ch = h0;
    while (cw / 2 >= w && ch / 2 >= ht) {
      const c = canvasOf(Math.round(cw / 2), Math.round(ch / 2)), g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; cw = c.width; ch = c.height;
    }
    const out = canvasOf(w, ht), g = out.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, w, ht);
    return out;
  }
  async function prepareDrawing(file) {
    if (file.size > UNI_FILE_MAX) throw sayErr(`That file is ${sizeText(file.size)}. The limit is 10 MB, so pick a smaller copy.`);
    // A file of no known type gets the benefit of the doubt: opening it decides.
    if (file.type && !/^image\//i.test(file.type) && file.type !== "application/octet-stream") throw sayErr("That file isn't a picture. Pick the drawing (a PNG or WebP file).");
    let pic;
    try { pic = await decodeImage(file); } catch (e) { throw sayErr("Couldn't open that picture. Save it as a PNG or WebP and pick it again."); }
    if (!pic.w || !pic.h) { pic.done(); throw sayErr("Couldn't open that picture. Save it as a PNG or WebP and pick it again."); }
    const s = Math.min(1, 600 / pic.w, 1200 / pic.h), w = Math.max(1, Math.round(pic.w * s)), ht = Math.max(1, Math.round(pic.h * s));
    const c = shrink(pic.src, pic.w, pic.h, w, ht);
    pic.done();
    const a = c.getContext("2d").getImageData(0, 0, w, ht).data;
    let x0 = w, y0 = ht, x1 = -1, y1 = -1, clear = 0;
    for (let y = 0; y < ht; y++) {
      for (let x = 0; x < w; x++) {
        const al = a[(y * w + x) * 4 + 3];
        if (al < 128) clear++;
        if (al > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) throw sayErr("That picture is empty: everything in it is see-through.");
    let url = c.toDataURL("image/webp", 0.9), ext = "webp";
    if (url.indexOf("data:image/webp") !== 0) { url = c.toDataURL("image/png"); ext = "png"; }
    const box = [x0 / w, y0 / ht, (x1 - x0 + 1) / w, (y1 - y0 + 1) / ht].map((n) => roundTo(n, 4));
    return { url, content: url.split(",")[1], ext, box, w, h: ht, opaque: clear < w * ht * 0.005, name: file.name || "Drawing" };
  }
  async function pickDrawing(which, file) {
    if (!ed || !file) return;
    const mine = ed, err = $("#itemFileError");
    err.hidden = true;
    let d;
    try { d = await prepareDrawing(file); } catch (e) {
      if (ed !== mine) return;
      err.textContent = e.say || "Couldn't open that picture. Save it as a PNG or WebP and pick it again.";
      err.hidden = false;
      return;
    }
    if (ed !== mine) return;
    ed.files[which] = d;
    ed.up = null; // a new drawing: a new upload
    if (which === "img") ed.item.box = d.box;
    syncItem();
    drawFit();
  }

  // The fit: the mannequin, faintly one other item for scale (pants under a top, a top over pants, a top under a tie or a
  // blazer), and this item's drawing where its fit puts it. Drag it, or use the arrow keys; the slider sizes it.
  function fitContext(it) {
    const others = pub.uniform.items.filter((x) => !ed.was || x.id !== ed.was.id);
    const first = (cat, ok) => others.filter((x) => x.cat === cat && (!ok || ok(x)))[0] || null;
    const o = it.cat === "top" ? first("pants") : it.cat === "pants" ? first("top") : first("top", (x) => x[it.cat]) || first("top");
    return o ? { item: o, src: it.cat === "tie" && o.img2 ? o.img2 : o.img, over: it.cat === "pants" } : null;
  }
  function drawFit() {
    if (!ed) return;
    const it = ed.item, frame = $("#itemFrame"), ctx = fitContext(it);
    const src = ed.files.img ? ed.files.img.url : it.img ? uniformSrc(it.img) : "";
    const layer = (item, s, cls) => { const img = h("img", { class: `u-layer ${cls}`, alt: "", src: s, draggable: "false" }); placeLayer(img, item); return img; };
    const other = ctx ? layer(ctx.item, uniformSrc(ctx.src), "u-other") : null;
    ed.layer = src ? layer(it, src, "u-mine") : null;
    frame.replaceChildren(mannequinSvg(true), ...[ctx && !ctx.over ? other : null, ed.layer, ctx && ctx.over ? other : null,
      src ? null : h("p", { class: "fit-empty", text: "Pick a drawing to see it here." })].filter(Boolean));
    frame.classList.toggle("empty", !src);
    $("#itemSize").value = String(Math.round(it.fit.s * 100));
    $("#itemSize").disabled = !src;
    $("#itemReset").disabled = !src;
    fitOut();
  }
  function placeFit() {
    if (ed.layer) placeLayer(ed.layer, ed.item);
    fitOut();
  }
  function fitOut() {
    const f = ed.item.fit, way = (n, less, more) => (Math.abs(n) < 0.05 ? "" : `${num(roundTo(Math.abs(n), 1))}% ${n < 0 ? less : more}`);
    const moved = [way(f.x, "left", "right"), way(f.y, "up", "down")].filter(Boolean);
    $("#itemSizeOut").textContent = `${Math.round(f.s * 100)}%`;
    $("#itemFitOut").textContent = !ed.layer ? "" : moved.length ? `Moved ${moved.join(" and ")}.` : "Not moved.";
  }
  const fitClamp = (n) => roundTo(Math.min(50, Math.max(-50, n)), 2);
  let drag = null, dragEnd = 0;
  function dragStart(x, y) {
    if (!ed || !ed.layer) return false;
    const r = $("#itemFrame").getBoundingClientRect();
    drag = { x, y, w: r.width || 1, h: r.height || 1, fx: ed.item.fit.x, fy: ed.item.fit.y };
    return true;
  }
  function dragMove(x, y) {
    if (!drag || !ed) return;
    ed.item.fit.x = fitClamp(drag.fx + ((x - drag.x) / drag.w) * 100);
    ed.item.fit.y = fitClamp(drag.fy + ((y - drag.y) / drag.h) * 100);
    placeFit();
  }
  function dragStop() { if (drag) { drag = null; dragEnd = Date.now(); } }
  // The arrow keys move it half a percent of the frame (with Shift, five).
  function onFitKey(e) {
    if (!ed || !ed.layer) return;
    const n = e.shiftKey ? 5 : 0.5, d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
    if (!d) return;
    e.preventDefault();
    ed.item.fit.x = fitClamp(ed.item.fit.x + d[0]);
    ed.item.fit.y = fitClamp(ed.item.fit.y + d[1]);
    placeFit();
  }
  function wireFit() {
    const frame = $("#itemFrame");
    frame.addEventListener("keydown", onFitKey);
    if (window.PointerEvent) {
      frame.addEventListener("pointerdown", (e) => {
        if (e.button > 0 || !dragStart(e.clientX, e.clientY)) return;
        e.preventDefault();
        try { frame.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        try { frame.focus({ preventScroll: true }); } catch (x) { frame.focus(); }
      });
      frame.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY));
      frame.addEventListener("pointerup", dragStop);
      frame.addEventListener("pointercancel", dragStop);
      return;
    }
    // Browsers from before pointer events (Safari 12): the mouse, and a finger.
    frame.addEventListener("mousedown", (e) => {
      if (e.button > 0 || !dragStart(e.clientX, e.clientY)) return;
      e.preventDefault();
      frame.focus();
      const move = (m) => dragMove(m.clientX, m.clientY);
      const up = () => { dragStop(); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    frame.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (e.touches.length === 1 && dragStart(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
    frame.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (drag && t) { e.preventDefault(); dragMove(t.clientX, t.clientY); } }, { passive: false });
    frame.addEventListener("touchend", dragStop);
    frame.addEventListener("touchcancel", dragStop);
  }

  // ---------- owner: uploading the drawings ----------
  // Like the credentials PDF: straight to GitHub with his key. A file that turns out to be there already (a try that
  // went through without an answer) is replaced; two saves in the same moment just try again.
  const mimeOf = (path) => (/\.webp$/i.test(path) ? "image/webp" : /\.png$/i.test(path) ? "image/png" : "image/jpeg");
  async function putUniformFile(path, content) {
    const put = (sha) => gh("PUT", `/contents/${path}`, Object.assign({ message: "Add uniform image", content }, sha ? { sha } : {}));
    try { return await put(); } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      let sha = null;
      try { const j = await gh("GET", `/contents/${path}`); sha = j && j.sha; } catch (x) { if (x.status !== 404) throw x; }
      if (!sha && e.status === 422) throw e; // not about a file already there (too big, say)
      return put(sha);
    }
  }
  // A drawing straight from GitHub (the site can be a minute or two behind).
  async function apiDrawing(path) {
    const r = await fetch(`${API}/contents/${path}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" } });
    if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { status: r.status });
    return new Blob([await r.blob()], { type: mimeOf(path) });
  }
  const dataUrlOf = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("read"));
    r.readAsDataURL(blob);
  });
  // A drawing already in uniform/, read back to store under the item's new id (from this visit's memory, the site, or
  // GitHub when the site doesn't have it yet).
  async function existingDrawing(path) {
    let url = uniformMem[path] || "";
    try {
      if (url.indexOf("data:") !== 0) {
        let blob = null;
        try { const r = await fetch(url || path, { cache: "no-store" }); if (r.ok && /^image\//.test(r.headers.get("content-type") || "")) blob = await r.blob(); } catch (e) { /* from GitHub below */ }
        url = await dataUrlOf(blob || (await apiDrawing(path)));
      }
    } catch (e) { throw sayErr("Couldn't load this item's other drawing to store it again. Check your connection, or pick that drawing again too."); }
    return { url, content: url.split(",")[1], ext: /\.(\w+)$/.exec(path)[1] };
  }
  const uploadError = (e) => (e.say ? e.say
    : e.status === 401 ? "GitHub no longer accepts your key. In Settings, tap Stop Editing on This Device, then connect again."
    : e.status === 403 || e.status === 404 ? "Your GitHub key can't save files. Set its Contents permission to Read and write."
    : e.status === 413 || e.status === 422 ? "GitHub didn't accept the drawing. Try a smaller copy of it."
    : "Couldn't upload the drawing. Check your connection and try again.");
  // Drawings this browser uploaded, so the cleanup after a save knows it may remove them once nothing uses them.
  function readUploads() { try { const m = JSON.parse(store.get(LS.uploads) || "{}"); return m && typeof m === "object" ? m : {}; } catch { return {}; } }
  function noteUpload(path) { const m = readUploads(); m[path] = Date.now(); store.set(LS.uploads, JSON.stringify(m)); }
  const newUniformId = () => Date.now().toString(36) + Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  const whenFree = () => new Promise((resolve) => { const wait = () => (busy ? setTimeout(wait, 150) : resolve()); wait(); });

  // Save Item: new drawings go up first (under a new id, the item's other drawing with them); then the item takes its
  // place in the list, as an unsaved change.
  async function saveItem() {
    if (!ed || ed.busy) return;
    const mine = ed, it = ed.item, f = ed.files, err = $("#itemError");
    it.name = $("#itemName").value.trim().slice(0, 60);
    err.hidden = true;
    const fail = (text, focus) => { err.textContent = text; err.hidden = false; if (focus) $(focus).focus(); };
    if (!f.img && !it.img) return fail("Pick a drawing for this item first.", "#itemFile");
    if (!it.name) return fail("Give it a name. Supervisors see it, and it's in the text they send you.", "#itemName");
    const tie = it.cat === "top" && it.tie;
    const keep2 = tie && f.img2 !== false ? f.img2 || it.img2 || null : null; // its buttoned-up drawing (new, or the one it had)
    let id = it.id, img = it.img, img2 = typeof keep2 === "string" ? keep2 : "";
    if (!id || f.img || (tie && f.img2)) {
      ed.busy = true;
      syncItemBusy();
      try {
        mine.up = mine.up || { id: newUniformId(), done: {} };
        id = mine.up.id;
        const send = async (d, path) => {
          if (!mine.up.done[path]) { await putUniformFile(path, d.content); mine.up.done[path] = true; noteUpload(path); }
          uniformMem[path] = d.url; // shown from here until the site has it
        };
        const one = f.img || (await existingDrawing(it.img));
        img = `uniform/${id}.${one.ext}`;
        await send(one, img);
        if (keep2) {
          const two = typeof keep2 === "string" ? await existingDrawing(keep2) : keep2;
          img2 = `uniform/${id}-b.${two.ext}`;
          await send(two, img2);
        }
      } catch (e) {
        mine.busy = false;
        if (ed === mine) { syncItemBusy(); fail(uploadError(e)); }
        return;
      }
    }
    await whenFree(); // a reload or merge under way finishes first, so it doesn't drop this
    if (ed !== mine) return; // closed meanwhile: its files go unused, and the next save removes them
    mine.busy = false;
    const item = cleanUniformItem(Object.assign({}, it, { id, img, img2 }));
    if (!item) { syncItemBusy(); return fail("Couldn't save this item. Check its drawing and name, then try again."); }
    const list = pub.uniform.items.slice(), at = mine.was ? list.findIndex((x) => x.id === mine.was.id) : -1;
    if (at >= 0) list[at] = item; else list.push(item);
    pub.uniform = { hash: pub.uniform.hash, items: list };
    itemFocus = item.id;
    ed = null;
    $("#itemSheet").close("");
    afterChange();
    renderUniSettings();
    toast(`Item ${mine.was ? "updated" : "added"}. Tap Save to show supervisors.`, 4200);
  }
  function deleteItem() {
    if (!ed || !ed.was || ed.busy) return;
    if (!window.confirm(`Delete "${ed.was.name}"? Supervisors stop seeing it once you tap Save.`)) return;
    const id = ed.was.id;
    pub.uniform = { hash: pub.uniform.hash, items: pub.uniform.items.filter((x) => x.id !== id) };
    itemFocus = "";
    ed = null;
    $("#itemSheet").close("");
    afterChange();
    renderUniSettings();
    toast("Deleted. Tap Save to update what supervisors see.", 4200);
  }

  // After a save: drawings nothing uses any more are removed from uniform/ (best effort; one that fails stays until the
  // next time). A drawing another device uploaded for an item it hasn't saved yet looks unused from here, so a file is
  // only removed when this save stopped using it, this browser uploaded it, or it's older than unsaved changes are kept
  // (30 days; the file name starts with when it was made).
  async function cleanUniformFiles(before) {
    const used = {}, was = {}, mine = readUploads();
    const refs = (list, into) => { for (const x of list || []) { if (x && x.img) into[x.img] = true; if (x && x.img2) into[x.img2] = true; } };
    refs(saved.pub.uniform.items, used);
    refs(pub.uniform.items, used);
    // Items in unsaved changes of this browser's other tabs.
    for (const key of store.keys(LS.draftPrefix)) {
      try { const d = JSON.parse(store.get(key)); refs(Object.values((d.uni && d.uni.items) || {}).map((e) => e && e.to), used); } catch { /* unreadable */ }
    }
    if (before) refs(before.pub.uniform.items, was);
    const savedNow = {};
    refs(saved.pub.uniform.items, savedNow);
    const forget = (paths) => { const m = readUploads(); for (const p of paths) delete m[p]; store.set(LS.uploads, JSON.stringify(m)); };
    forget(Object.keys(mine).filter((p) => savedNow[p])); // saved now: from here on, a later save removes it once it's unused
    if (!Object.keys(was).concat(Object.keys(mine)).some((p) => !used[p])) return; // nothing this device knows went unused
    let list;
    try { list = await gh("GET", "/contents/uniform"); } catch (e) { return; }
    const gone = [];
    for (const file of Array.isArray(list) ? list : []) {
      const path = `uniform/${file && file.name}`;
      if (!file || file.type !== "file" || used[path]) continue;
      const m = /^([a-z0-9]{12})(?:-b)?\./.exec(file.name), made = m ? parseInt(m[1].slice(0, 8), 36) : 0;
      if (!(was[path] || mine[path] || !(Date.now() - made < 30 * 86400000))) continue; // maybe another device's unsaved item
      try { await gh("DELETE", `/contents/${path}`, { message: "Remove unused uniform image", sha: file.sha }); gone.push(path); } catch (e) { /* next time */ }
    }
    forget(gone);
  }
  // Edit mode: a drawing the site doesn't have yet (uploaded a moment ago, here or on another device) comes from GitHub.
  const fromApi = {};
  function onImgError(e) {
    const img = e.target;
    if (!owner || !token || !img || img.tagName !== "IMG") return;
    const path = img.getAttribute("src") || "";
    if (!/^uniform\/[A-Za-z0-9-]+\.(png|webp|jpe?g)$/.test(path) || uniformMem[path] || fromApi[path]) return;
    fromApi[path] = apiDrawing(path).then((blob) => {
      uniformMem[path] = URL.createObjectURL(blob);
      for (const x of document.querySelectorAll(`img[src="${path}"]`)) x.src = uniformMem[path];
    }).catch(() => { /* stays empty */ });
  }

  let fbAtOpen = "";
  let potAtOpen = { from: "", to: "" };
  function openSettings() {
    noteSel = "";
    renderNotes();
    $("#setCallHours").value = num(pub.callHours);
    $("#setName").value = pub.name;
    $("#setEmpId").value = pub.empId;
    $("#setPhone").value = pub.phone;
    $("#setLicName").value = pub.licName;
    $("#setLicNo").value = pub.licNo;
    $("#setLicIssued").value = pub.licIssued;
    $("#setLicExpires").value = pub.licExpires;
    uniAtOpen = { code: priv.uniformCode, hash: pub.uniform.hash };
    $("#uniCodeError").hidden = true;
    $("#setUniCode").value = priv.uniformCode;
    renderUniSettings();
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
    fitNoteText();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.closest && t.closest("#noteEdit")) { if (!editNote(t)) return; }
    else if (t.id === "setCallHours") { const n = Number(t.value); if (t.value.trim() !== "" && n >= 0 && n <= 48) pub.callHours = n; }
    else if (t.id === "setName") pub.name = t.value.trim().slice(0, 40);
    else if (t.id === "setEmpId") pub.empId = t.value.trim().slice(0, 20);
    else if (t.id === "setPhone") pub.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setLicName") pub.licName = t.value.trim().slice(0, 60);
    else if (t.id === "setLicNo") pub.licNo = t.value.trim().slice(0, 40);
    else if (t.id === "setLicIssued") pub.licIssued = isDay(t.value) ? t.value : "";
    else if (t.id === "setLicExpires") pub.licExpires = isDay(t.value) ? t.value : "";
    else if (t.id === "setUniCode") { if (uniLocked()) return; readUniCode(t); }
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
      pub.willing = [...document.querySelectorAll("#setWilling input:checked")].map((i) => i.value);
      renderNotes(); // the night-shift note (and its tab) goes and comes back with Overnight, just as it was
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
        if (skipped) setTimeout(() => toast(`${skipped} unsaved change${skipped === 1 ? " was skipped because it was" : "s were skipped because they were"} saved differently from somewhere else since.`, 6000), 3500);
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
    const before = saved; // what this save replaces (for drawings it stops using)
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
      cleanUniformFiles(before).catch(() => { /* best effort */ });
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
    // A drag in the fit editor that ends outside the item's sheet isn't a tap on the backdrop.
    $("#itemSheet").addEventListener("click", (e) => { if (e.target === e.currentTarget && Date.now() - dragEnd < 400) e.stopImmediatePropagation(); }, true);
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
      else if (!$("#uniCodeError").hidden) toast("Your My Uniform code didn't change, because the new one wasn't 4 to 8 letters or numbers.", 5000);
    });
    $("#credRemove").addEventListener("click", removeCred);
    $("#fbTest").addEventListener("click", onFeedbackTest);
    $("#unlockForm").addEventListener("submit", onUnlock);
    $("#editForm").addEventListener("change", onEditChange);
    for (const id of ["#workHours", "#workNote", "#busyNote"]) $(id).addEventListener("input", onEditChange);
    $("#useUsual").addEventListener("click", () => { setDay(editKey, { s: "open" }); fillEdit(false); afterChange(); });
    $("#settingsForm").addEventListener("input", onSettingsChange);
    $("#settingsForm").addEventListener("change", onSettingsChange);
    $("#noteTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[role=tab]");
      if (!b) return;
      noteSel = b.dataset.id;
      renderNotes();
      $(`#noteTab-${noteSel}`).focus();
    });
    $("#noteTabs").addEventListener("keydown", onNoteKey);
    $("#noteAdd").addEventListener("click", addNote);
    $("#noteDelete").addEventListener("click", deleteNote);
    // Settings → My Uniform, and the sheet for one item.
    $("#uniNewCode").addEventListener("click", newUniCode);
    $("#uniKeyHow").addEventListener("click", () => showSheet("#keySheet"));
    $("#uniCopyLink").addEventListener("click", copyUniLink);
    $("#uniItems").addEventListener("click", (e) => { const b = e.target.closest(".uni-item"); if (b) openItem(b.dataset.id); });
    $("#itemForm").addEventListener("input", onItemChange);
    $("#itemForm").addEventListener("change", onItemChange);
    $("#itemForm").addEventListener("submit", (e) => { e.preventDefault(); saveItem(); }); // Enter in the name box
    for (const [sel, which] of [["#itemFile", "img"], ["#itemFile2", "img2"]]) {
      $(sel).addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = ""; // picking the same file again still counts
        pickDrawing(which, file);
      });
    }
    $("#itemDrop2").addEventListener("click", () => { if (!ed) return; ed.files.img2 = false; ed.up = null; syncItem(); $("#itemFile2").focus(); });
    $("#itemPrompt").addEventListener("click", () => copyPrompt(false));
    $("#itemPrompt2").addEventListener("click", () => copyPrompt(true));
    iconLabel($("#itemPrompt"), "copy", "Copy Drawing Prompt");
    iconLabel($("#itemPrompt2"), "copy", "Copy Buttoned-Up Prompt");
    $("#itemReset").addEventListener("click", () => { if (!ed) return; ed.item.fit = { x: 0, y: 0, s: 1 }; $("#itemSize").value = "100"; placeFit(); });
    $("#itemSave").addEventListener("click", saveItem);
    $("#itemDelete").addEventListener("click", deleteItem);
    $("#itemCancel").addEventListener("click", () => $("#itemSheet").close(""));
    $("#itemSheet").addEventListener("close", () => {
      ed = null;
      drag = null;
      // Back to its card in Settings (drawn again meanwhile), or to Add Item.
      if ($("#settingsSheet").open && itemFocus != null) { renderUniItems(itemFocus); itemFocus = null; }
    });
    wireFit();
    document.addEventListener("error", onImgError, true);
    $("#setNoteText").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    $("#signOut").addEventListener("click", () => {
      leaving = true;
      for (const k of [LS.token, ...store.keys(LS.draftPrefix), LS.draft2, LS.oldDraft, LS.importText, LS.brush, LS.lastWeekly, LS.uploads]) store.del(k);
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

    // My Uniform. Its screens take part in Back like a window's steps: open while they show.
    const uniEl = $("#uniform");
    Object.defineProperty(uniEl, "open", { configurable: true, get() { return !this.hidden; } });
    uniEl.querySelector(".u-below").append(mannequinSvg(false));
    $("#uniformBtn").addEventListener("click", () => openUniform(unlocked() ? "pick" : "code"));
    for (const b of uniEl.querySelectorAll(".u-cal")) b.addEventListener("click", closeUniform);
    $("#uChange").addEventListener("click", () => nav.back(uniEl, () => showUni("pick", true)));
    $("#uCodeForm").addEventListener("submit", onUniformCode);
    $("#uCodeIn").addEventListener("input", () => { if ($("#uCodeIn").classList.contains("bad")) codeWrong(false); });
    $("#uRows").addEventListener("click", (e) => {
      const b = e.target.closest(".u-item");
      if (!b || b.disabled) return;
      uni.picks[b.dataset.cat] = b.dataset.id || null;
      syncPicker();
    });
    $("#uPicks").addEventListener("click", (e) => {
      const b = e.target.closest(".u-off");
      if (!b) return;
      uni.picks[b.dataset.cat] = null;
      syncPicker();
    });
    $("#uSeeBtn").addEventListener("click", () => { if (uni.picks.top && uni.picks.pants) uniTo("see"); });
    // Escape closes it, as it closes a window.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !uniEl.hidden && !document.querySelector("dialog[open]")) closeUniform(); });
    window.addEventListener("hashchange", () => { routeUniform(); });
    window.addEventListener("resize", () => { if (owner && preview) renderUniform(); });
  }

  // ---------- the opening ----------
  // The page stays out of sight (class "intro", set in the page's head) until the calendar is in. Then, from that
  // moment (class "opening" for one-time steps, "lit" for what keeps going):
  //   0 s     the page breathes in; his name falls into place letter by letter
  //   0.25 s  the days fall into place, top left to bottom right
  //   0.45 s  the status light switches on, then the status line types itself out (to 1.7 s)
  //   1.8 s   a sparkle in the middle of the strip; 2.1 s the strip opens both ways, then its colors flow
  //   2 s     a ring of light runs out along the grid from the badge; 2.05 s a shine crosses the badge
  //   2.35 s  a shine crosses Call Me, then the license (2.55 s)
  //   3.3 s   once every shine is done, a big sparkle bursts on the badge's corner (it outlasts "opening")
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
    restoreUniformCode().then(routeUniform).catch(() => { /* the button still opens it */ });
    if (token) await enterOwner();
  }

  boot();
})();
