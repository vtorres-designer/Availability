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
      if (top && Date.now() - (top.openedAt || 0) >= 350 && !(top.held && top.held())) top.close("");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const o = openOnes().sort((a, b) => (a.openSeq || 0) - (b.openSeq || 0));
      if (!o.length) return;
      const d = o[o.length - 1], ev = new Event("cancel", { cancelable: true });
      d.dispatchEvent(ev);
      if (!ev.defaultPrevented) d.close("");
    });
  }

  const SHIFT_KEYS = ["overnight", "swing", "morning"];
  const SHIFT_LABEL = { overnight: "Graveyard", swing: "Swing", morning: "Morning" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const LS = { token: "sa.token", savedSignal: "sa.saved", draftPrefix: "sa.d4.", draftPrefix3: "sa.d3.", draft2: "sa.draft2", oldDraft: "sa.draft", who: "sa.who", site: "sa.site", addr: "sa.addr", brush: "sa.brush", importText: "sa.import", pay: "sa.pay", fbContact: "sa.fbContact", lastWeekly: "sa.weekly", uploads: "sa.uploads" };
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
  const defaultPub = () => ({ name: "", empId: "", phone: "", notes: [nightNote("n1", NIGHT_LINE)], willing: ["overnight"], status: "", led: "green", nightStart: "", weekStart: 0, feedback: "", potFrom: "", potTo: "", potMax: 0, callHours: 10,
    licName: "", licNo: "", licIssued: "", licExpires: "", uniform: { hash: "", items: [] } });
  const defaultPriv = () => ({ otAfter: 40, pickup: 8, weekly: [], days: {}, uniformCode: "", secOrder: [], secView: "tiles" });

  // ---------- small helpers ----------
  // A line that must stay one line (text beside a swatch): its text shrinks in half-pixel steps until it fits, down to 12px.
  // It keeps a little room at each side of its box (pad, in pixels).
  function fitLine(el, pad = 12) {
    if (!el || !el.parentElement) return;
    el.style.fontSize = "";
    const room = el.parentElement.clientWidth - 2 * pad, max = parseFloat(getComputedStyle(el).fontSize);
    for (let fs = max; el.scrollWidth > room && fs > 12; fs -= 0.5) el.style.fontSize = `${fs - 0.5}px`;
  }
  const $ = (s) => document.querySelector(s);
  let leaving = false; // Stop Editing: from then on nothing is written, so a save still running can't put his hours back
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { if (leaving) return; try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
    keys(prefix) { try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)); } catch { return []; } },
  };
  // Each page load keeps its unsaved changes under its own key, so two tabs never overwrite each other's. This version
  // keeps them under sa.d4.*: a tab of an older version still open on this device folds every sa.d3.* record into its
  // own and drops the parts it doesn't know (notes, My Uniform), so it must never see these. Theirs are still read here.
  const OWN_DRAFT = LS.draftPrefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const draftKeys = () => store.keys(LS.draftPrefix).concat(store.keys(LS.draftPrefix3));
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
    // Returns false when no entry could be added (no tap just now).
    function add(entry) {
      if (!ok || !tapped()) return false;
      const run = () => {
        if (entry.sheet && !entry.sheet.open) return; // closed while it waited
        stack.push(entry);
        try { history.pushState({ sa: stack.length }, ""); } catch (e) { stack.pop(); }
      };
      if (pending) queued.push(run); else run();
      return true;
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
      step(d, undo) { return add({ sheet: d, step: true, undo }); },
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

  // A sheet that can't close right now (an item still uploading): its ×, Escape and a tap outside wait.
  const held = (d) => !!(d && d.held && d.held());
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
  const NOTES_MAX = 10; // of his own: the night-shift note doesn't count (he can't add or delete it, and it hides with Overnight)
  const ownNotes = (list) => list.filter((n) => !n.auto).length;
  const nightNote = (id, text) => ({ id, text, until: "", front: true, day: false, form: false, auto: "night" });
  const noteNum = (n) => (/^n\d{1,4}$/.test(n.id) ? Number(n.id.slice(1)) : 0);
  // One note with all its fields, in this order (null if it isn't one).
  function cleanNote1(n) {
    if (!n || typeof n !== "object") return null;
    const c = { id: typeof n.id === "string" ? n.id : "", text: typeof n.text === "string" ? n.text.slice(0, 140) : "", until: isDay(n.until) ? n.until : "",
      front: n.front === true, day: n.day === true, form: n.form === true };
    if (n.auto === "night") c.auto = "night";
    return c;
  }
  function cleanNotes(list) {
    const out = [];
    let night = null;
    for (const n of list) {
      const c = out.length <= NOTES_MAX ? cleanNote1(n) : null;
      if (!c) continue;
      if (c.auto) {
        if (night) continue; // only one
        night = c;
      } else if (ownNotes(out) >= NOTES_MAX) continue;
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
  // saved from it never differ. With Overnight unchecked that version took the line out by itself and put it back when
  // Overnight was checked again, so then the line stays.
  function notesFromOld(r) {
    const note = typeof r.note === "string" ? r.note.slice(0, 140) : "";
    const text = note.split(NIGHT_LINE).join("").replace(/\s{2,}/g, " ").trim();
    const out = text ? [{ id: "n1", text, until: isDay(r.noteUntil) ? r.noteUntil : "", front: true, day: false, form: false }] : [];
    const overnight = !Array.isArray(r.willing) || r.willing.indexOf("overnight") >= 0;
    out.push(nightNote(`n${out.length + 1}`, r.nightAuto === true && overnight && note.indexOf(NIGHT_LINE) < 0 ? "" : NIGHT_LINE));
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
    // The status line is only his own words now (Oct 15). Saved data from before then had none, so it keeps the sentence
    // it showed. An empty line hides it.
    if (typeof r.status === "string") d.status = r.status.trim().slice(0, 60);
    else d.status = acceptingText(d.willing);
    if (["green", "yellow", "red"].includes(r.led)) d.led = r.led;
    const ws = parseInt(r.weekStart, 10);
    if (ws >= 0 && ws <= 6) d.weekStart = ws;
    if (typeof r.feedback === "string") d.feedback = feedbackId(r.feedback);
    if (isTime(r.potFrom) && isTime(r.potTo)) { d.potFrom = r.potFrom; d.potTo = r.potTo; }
    if (typeof r.callHours === "number" && r.callHours >= 0 && r.callHours <= 48) d.callHours = r.callHours;
    if (Number(r.potMax) > 0 && Number(r.potMax) <= 24) d.potMax = Number(r.potMax);
    if (isTime(r.nightStart)) d.nightStart = r.nightStart;
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

  // One shift he works: start and end ("23:00", "07:00") and its paid hours. Hours alone (no times) count on the day.
  function cleanShift(x, pickup) {
    if (!x || typeof x !== "object") return null;
    const out = {};
    if (isTime(x.start) && isTime(x.end) && x.start !== x.end) { out.start = x.start; out.end = x.end; }
    const hrs = Number(x.hours);
    out.hours = hrs > 0 && hrs <= 24 ? hrs : out.start ? spanHours(out.start, out.end) : pickup;
    return out;
  }
  // His per-shift choices in Edit Day (Oct 15): 1 = supervisors can request that shift that day, 0 = they can't.
  // A shift without one follows what Add Schedule put on the day.
  function cleanPicks(o) {
    if (!o || typeof o !== "object") return null;
    const out = {};
    for (const t of SHIFT_KEYS) if (o[t] === 1 || o[t] === 0) out[t] = o[t];
    return Object.keys(out).length ? out : null;
  }
  // A day: work (one or more shifts: the first at the top, the rest in "more"), busy, open, or "none" (nothing from a
  // schedule, only his per-shift choices). Any of them can carry those choices in "o".
  function cleanPrivRec(rec, pickup) {
    if (!rec || typeof rec !== "object") return null;
    let out = null;
    if (rec.s === "work") {
      out = Object.assign({ s: "work" }, cleanShift(rec, pickup));
      const more = Array.isArray(rec.more) ? rec.more.map((x) => cleanShift(x, pickup)).filter(Boolean).slice(0, 4) : [];
      if (more.length) out.more = more;
      const note = cleanNote(rec.note);
      if (note) out.note = note;
    } else if (rec.s === "busy") {
      const note = cleanNote(rec.note);
      out = note ? { s: "busy", note } : { s: "busy" };
    } else if (rec.s === "open") {
      const w = cleanWilling(rec.w);
      out = w ? { s: "open", w } : { s: "open" };
      const note = cleanNote(rec.note); // a note on a day off too (Oct 15 audit: Edit Day's note showed on every day)
      if (note) out.note = note;
    } else if (rec.s === "none") {
      out = { s: "none" };
      const note = cleanNote(rec.note);
      if (note) out.note = note;
    }
    if (!out) return null;
    const o = cleanPicks(rec.o);
    if (o) out.o = o;
    else if (out.s === "none" && !out.note) return null; // nothing on it
    return out;
  }
  // The shifts he works on a day (none unless it's a work day).
  const workShifts = (rec) => (rec && rec.s === "work" ? [{ start: rec.start, end: rec.end, hours: rec.hours }].concat(rec.more || []) : []);
  // The shifts supervisors can request on a day: Add Schedule's answer (a day off offers his usual shifts, a work or
  // busy day none), then his per-shift choices on top. null for a day with nothing on it.
  function offerOf(rec, p) {
    if (!rec) return null;
    const base = rec.s === "open" ? rec.w || p.willing : [];
    const o = rec.o || {};
    return SHIFT_KEYS.filter((t) => o[t] === 1 || (o[t] !== 0 && base.includes(t)));
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

  // Whether the replaced Oct 12-13 copy counted him as working that day: a work record, or an every-week work
  // day that wasn't marked off (raw is the day's record as saved, before cleanPrivRec drops its "scheduleOff").
  function workingOn(k, v, raw) {
    const cur = v.days[k], rule = ruleOn(k, v);
    if (cur && cur.s === "work") return true;
    return !!(rule && rule.s === "work" && !(raw && raw.scheduleOff === true));
  }
  function normalizePriv(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPriv();
    if (typeof r.rev === "string") d.rev = r.rev;
    if (Number(r.otAfter) > 0) d.otAfter = Number(r.otAfter);
    if (Number(r.pickup) > 0 && Number(r.pickup) <= 24) d.pickup = Number(r.pickup);
    d.weekly = cleanWeekly(r.weekly, d.pickup);
    d.uniformCode = cleanCode(r.uniformCode);
    // The order he dragged Settings' sections into (Oct 15), by their keys.
    // Settings as tiles (the default, his choice Oct 15) or as a list. Stored as secView: the earlier setView defaulted to the
    // list, so a "list" there was never really chosen.
    if (r.secView === "list") d.secView = "list";
    if (Array.isArray(r.secOrder)) d.secOrder = r.secOrder.filter((x) => typeof x === "string" && /^[a-z]{1,20}$/.test(x)).slice(0, 30);
    if (r.days && typeof r.days === "object") {
      for (const [k, v] of Object.entries(r.days)) {
        const rec = isKey(k) ? cleanPrivRec(v, d.pickup) : null;
        if (rec) d.days[k] = rec;
      }
    }
    // A replaced copy of this site (Oct 12-13) kept the days he'd pick up shifts in a separate "pickups" list.
    // Fold them back into days, except where he's scheduled to work: that copy never let a pick cancel his work.
    let kept = null;
    if (r.pickups && typeof r.pickups === "object" && !Array.isArray(r.pickups)) {
      for (const [k, v] of Object.entries(r.pickups)) {
        if (!isKey(k) || !v || (v.s !== "open" && v.s !== "busy")) continue;
        const cur = d.days[k], chatWork = workingOn(k, d, r.days && r.days[k]);
        const busyPick = v.s === "busy" || (Array.isArray(v.w) && !v.w.length);
        // Set aside where the day is Working here, and an Available pick where that copy counted him working:
        // a pick never turns a day greener than that copy showed it.
        if ((cur ? cur.s === "work" : chatWork) || (chatWork && !busyPick)) { (kept = kept || {})[k] = v; continue; }
        const note = cleanNote(v.note) || (cur && cur.s === "busy" && v.s === "busy" ? cur.note : undefined);
        const rec = cleanPrivRec({ s: v.s, w: v.w, note }, d.pickup);
        if (rec) d.days[k] = rec;
      }
    }
    // Settings a newer version of the site added are kept, so saving from here doesn't erase them.
    // pubCopy is this version's own (see save), read straight from the variable.
    for (const k of Object.keys(r)) if (!(k in d) && k !== "v" && k !== "rev" && k !== "pickups" && k !== "pubCopy") d[k] = r[k];
    // Picks on work days can't be shown here. They're set aside under their own name (never folded in again, so a
    // later change to that day wins), so no note or shift list he typed is lost.
    if (kept) d.pickupsSetAside = Object.assign({}, r.pickupsSetAside && typeof r.pickupsSetAside === "object" ? r.pickupsSetAside : {}, kept);
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
  // Supervisors get these exact numbers too (his choice, Oct 15): a shift on the pay week's last day can give away
  // its start time (the hours before midnight are midnight minus the start), and he's fine with that.
  function hoursInWeek(weekStartKey, v) {
    const from = dayNumber(weekStartKey) * 1440, to = from + 7 * 1440;
    let total = 0;
    for (let i = -1; i < 7; i++) {
      const k = addDays(weekStartKey, i);
      for (const sh of workShifts(dayRec(k, v))) {
        const paid = Number(sh.hours) || 0;
        if (paid <= 0) continue;
        if (sh.start && sh.end) {
          const start = dayNumber(k) * 1440 + minutesOf(sh.start);
          let len = minutesOf(sh.end) - minutesOf(sh.start);
          if (len <= 0) len += 1440;
          const inside = Math.max(0, Math.min(start + len, to) - Math.max(start, from));
          total += (paid * inside) / len;
        } else if (i >= 0) {
          total += paid;
        }
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
    // A graveyard starts when he set it in Settings (some sites start at 10 PM, Oct 15) and runs his usual length;
    // without a setting it ends at 7 AM.
    const night = pub && isTime(pub.nightStart) ? minutesOf(pub.nightStart) : null;
    if (night != null) return { start: night < 720 ? night + 1440 : night, len: mins };
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
  // A day's color: green when one more usual shift (8 hours) has no overtime, yellow when it would touch overtime at
  // all (his choice, Oct 15: no more half-green P-OT days; each shift button says how many hours until overtime).
  function otKind(k, types, len, weekStart, left) {
    for (const t of types) {
      const r = otIn(k, defaultSpan(t, len), weekStart, left);
      if (!r) return null;
      if (otState(r) !== "open") return "ot";
    }
    return "open";
  }
  // Hours left before overtime in a pay week. His colors and supervisors' numbers use the same count.
  const privLeft = (v) => (w) => v.otAfter - hoursInWeek(w, v);
  // Which of the day's shifts would have any overtime.
  const otShifts = (k, v, p, types) => types.filter((t) => otIn(k, defaultSpan(t, v.pickup), p.weekStart, privLeft(v)).ot > 0);

  // What supervisors may see: open / ot / busy per day from today on. No times, hours, notes,
  // and no difference between working and busy.
  function derivePublic(p, v) {
    const out = {};
    const today = todayKey();
    for (const k of Object.keys(v.days).sort()) {
      if (k < today) continue;
      const rec = v.days[k];
      if (rec.s === "none" && !rec.o) continue; // only his note on it: still a blank day
      const types = offerOf(rec, p);
      if (!types.length) { out[k] = { s: "busy" }; continue; }
      const ots = otShifts(k, v, p, types);
      out[k] = sameSet(types, p.willing) ? { s: ots.length ? "ot" : "open" } : { s: ots.length ? "ot" : "open", w: types };
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
  // Every pay week the calendar shows, and the next one when a shift can run into it.
  function pubWeeks(p, days) {
    const out = {};
    for (const w of otWeeks(p, days)) out[w] = true;
    for (const k of Object.keys(days)) out[weekStartOf(k, p.weekStart)] = true;
    return Object.keys(out).sort();
  }
  // For each of those weeks: the hours scheduled, shown over the week as in edit mode ("39 hrs scheduled"), and the
  // hours left before overtime, used to count the overtime in whatever shift time a supervisor types. He's fine with
  // supervisors seeing his weekly totals (Oct 15).
  function derivePublicOt(p, v, days) {
    const left = {}, hrs = {};
    for (const w of pubWeeks(p, days)) {
      hrs[w] = hoursInWeek(w, v);
      left[w] = Math.max(0, round2(privLeft(v)(w)));
    }
    return { shift: v.pickup, left, hrs, after: v.otAfter };
  }
  function cleanOt(raw) {
    if (!raw || typeof raw !== "object" || !raw.left || typeof raw.left !== "object") return null;
    const shift = Number(raw.shift);
    if (!(shift > 0 && shift <= 24)) return null;
    const left = {};
    for (const [w, n] of Object.entries(raw.left)) if (isKey(w) && typeof n === "number" && n >= 0) left[w] = n;
    const hrs = {}; // weeks' scheduled hours (a file saved before Oct 15 doesn't have them)
    if (raw.hrs && typeof raw.hrs === "object") for (const [w, n] of Object.entries(raw.hrs)) if (isKey(w) && typeof n === "number" && n >= 0) hrs[w] = n;
    const after = Number(raw.after) > 0 ? Number(raw.after) : 0; // his overtime line (40)
    return { shift, left, hrs, after };
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
  let pubHash = ""; // My Uniform's hash as the public file has it now: the code's link works for supervisors once they agree
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

  // Files the page writes on GitHub are signed with his private no-reply address, never the account's own email (Oct 15:
  // a save from the page put his Gmail on a commit, after he'd removed it from the history).
  const NOREPLY = REPO.owner === "vtorres-designer" ? { name: "vtorres-designer", email: "331616106+vtorres-designer@users.noreply.github.com" } : null;
  async function gh(method, path, body, tok = token) {
    if (NOREPLY && body && (method === "PUT" || method === "DELETE") && path.indexOf("/contents/") === 0) body = Object.assign({ committer: NOREPLY, author: NOREPLY }, body);
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
    // His layout choices for Settings (list or tiles, the sections' order) save quietly: they're kept on this device at
    // once and go along with his next save, so they never count as changes waiting (Oct 15).
    const strip = (v) => JSON.stringify(Object.assign({}, v, { days: null, rev: null, secOrder: null, setView: null, secView: null }));
    return { days, settings: JSON.stringify(pub) !== JSON.stringify(saved.pub) || strip(priv) !== strip(saved.priv), publish: needsPublish };
  }

  // Unsaved changes, stored as only what this device changed. Each entry keeps the value it replaced ("from"),
  // so a restored change is applied only if nobody saved something else on that day since.
  function diffOf() {
    const c = changes();
    const d = { days: {}, pub: {}, priv: {} };
    if (!saved) return d;
    for (const k of c.days) d.days[k] = { to: priv.days[k] || null, from: saved.priv.days[k] || null };
    for (const f of Object.keys(pub)) if (f !== "uniform" && f !== "notes" && JSON.stringify(pub[f]) !== JSON.stringify(saved.pub[f])) d.pub[f] = { to: pub[f], from: saved.pub[f] };
    for (const f of ["otAfter", "pickup", "secOrder", "secView"]) if (!same(priv[f], saved.priv[f])) d.priv[f] = { to: priv[f], from: saved.priv[f] };
    // Notes, each on its own (by id) like My Uniform's items below, so a change to one note never undoes another's.
    d.nt = { items: {}, order: pub.notes.map((n) => n.id) };
    for (const id of new Set([...pub.notes, ...saved.pub.notes].map((n) => n.id))) {
      const to = noteIn(pub, id), from = noteIn(saved.pub, id);
      if (!same(to, from)) d.nt.items[id] = { to, from };
    }
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
  const noteIn = (p, id) => p.notes.filter((n) => n.id === id)[0] || null;
  const uniSize = (u) => (u && typeof u === "object" ? Object.keys(u.items || {}).length + (u.code ? 1 : 0) : 0);
  const ntSize = (n) => (n && typeof n === "object" ? Object.keys(n.items || {}).length : 0);
  const diffSize = (d) => Object.keys(d.days).length + Object.keys(d.pub).length + Object.keys(d.priv).length + Object.keys(d.wk || {}).length + uniSize(d.uni) + ntSize(d.nt);
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  // Removals first when a diff is applied, so they make room before anything new is added.
  const keeps = (entry) => (entry[1] && entry[1].to ? 1 : 0);

  // Unsaved note changes from the previous version (one note, the night-shift line inside it) become changes to the
  // notes they stand for, worked out the same way as a loaded file's note. Fields the change left alone come from the
  // notes as they are now.
  function oldNoteDraft(dp) {
    if (!dp || typeof dp !== "object" || dp.notes || !(dp.note || dp.noteUntil || dp.nightAuto)) return dp;
    const user = pub.notes.filter((n) => !n.auto)[0], night = pub.notes.filter((n) => n.auto)[0];
    const now = { note: [user ? user.text : "", night.text].filter(Boolean).join(" "), noteUntil: user ? user.until : "", nightAuto: true };
    // A change from before the line was moved into his note (no nightAuto in it, and a note without the line) was made
    // while the page added the line by itself: read both sides that way, or it never matches the notes it was made on.
    const was = dp.note && typeof dp.note === "object" ? dp.note.from : null;
    if (!dp.nightAuto && night.text === NIGHT_LINE && typeof was === "string" && was.indexOf(NIGHT_LINE) < 0) now.nightAuto = false;
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
    { const e = d.priv && d.priv.secView; if (e && take(e, priv.secView)) priv.secView = e.to === "list" ? "list" : "tiles"; }
    { const e = d.priv && d.priv.secOrder; if (e && Array.isArray(e.to) && take(e, priv.secOrder)) priv.secOrder = normalizePriv({ secOrder: e.to }).secOrder; }
    const full = { notes: applyNotes(d.nt, take), items: applyUniform(d.uni, take) };
    for (const [w, e] of Object.entries(d.wk || {})) {
      const dow = Number(w);
      if (!(dow >= 0 && dow <= 6) || !take(e, ruleFor(priv.weekly, dow))) continue;
      priv.weekly = cleanWeekly(priv.weekly.filter((r) => r.d !== dow).concat(e.to ? [Object.assign({}, e.to, { d: dow })] : []), priv.pickup);
    }
    return { applied, skipped, full };
  }
  // A new note or item from here that no longer fits, because another device or tab added some meanwhile: said, not
  // dropped without a word. full: what applyDiff returned.
  function fullText(full) {
    const out = [];
    const notes = full ? full.notes : [], items = full ? full.items : [];
    // The note's whole text, so he can add it again (nothing else keeps it).
    if (notes.length) out.push(`You can have ${NOTES_MAX} notes of your own, so ${notes.map((x) => (x.trim() ? `"${x.trim()}"` : "a new empty note")).join(", ")} ${notes.length === 1 ? "wasn't" : "weren't"} added. Delete one, then add it again.`);
    if (items.length) out.push(`My Uniform holds ${UNIFORM_MAX} items, so ${items.map((x) => `"${x}"`).join(", ")} ${items.length === 1 ? "wasn't" : "weren't"} added. Delete one, then add it again.`);
    return out.join(" ");
  }
  // Notes' part of a diff (see diffOf), note by note as applyUniform goes item by item. Ids are "n1", "n2"... in the order notes were
  // added, so a note added here and one added elsewhere can share one: the one from here then takes the next free id
  // (noteMoved: from which id to which, so the note open in Settings follows it).
  // There's always one night-shift note, and it's never removed. Returns the texts of new notes that didn't fit.
  const noteMoved = {};
  // The highest note id ever saved (the private settings' copy keeps it, see save): a new note never takes the id of one
  // deleted and saved, which another device may still have an unsaved change to.
  let noteTop = 0;
  function applyNotes(u, take) {
    for (const k of Object.keys(noteMoved)) delete noteMoved[k];
    if (!u || typeof u !== "object" || !u.items || typeof u.items !== "object") return [];
    const notes = pub.notes.slice(), order = Array.isArray(u.order) ? u.order : [];
    const rank = (id) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id));
    const list = Object.entries(u.items).sort((a, b) => keeps(a) - keeps(b) || rank(a[0]) - rank(b[0]));
    let free = Math.max(noteTop, ...notes.map(noteNum), ...list.map(([id]) => noteNum({ id }))) + 1;
    const full = [];
    for (const [id, entry] of list) {
      let e = entry;
      const to = e && e.to ? cleanNote1(e.to) : null;
      if (!e || typeof e !== "object" || (e.to && !(to && to.id === id))) continue; // a damaged entry
      let i = notes.findIndex((n) => n.id === id);
      // The night-shift note is the one marked night, whatever its id: a file an older copy of the page saved numbers the
      // notes by their place, so its id can change. A change to it goes to it, and a change to another note never does.
      // What it changes to decides (a note of his that took the night-shift note's old id is still his).
      if (to ? to.auto : e.from && e.from.auto) {
        i = notes.findIndex((n) => n.auto);
        if (i >= 0 && notes[i].id !== id) {
          const nid = notes[i].id, from = e.from ? cleanNote1(Object.assign({}, e.from, { id: nid })) : null;
          if (to) to.id = nid;
          e = { to, from };
        }
      } else if (i >= 0 && notes[i].auto) { i = -1; if (to) { to.id = `n${free++}`; noteMoved[id] = to.id; } }
      if (i >= 0 && notes[i].auto && !to) continue;
      if (i >= 0 && !e.from && to && !same(notes[i], to)) { to.id = `n${free++}`; noteMoved[id] = to.id; i = -1; } // a new note whose id is taken
      if (!take(e, i >= 0 ? notes[i] : null)) continue;
      if (i >= 0) { if (to) notes[i] = to; else notes.splice(i, 1); continue; }
      if (!to) continue;
      if (to.auto || ownNotes(notes) >= NOTES_MAX) { if (!to.auto) full.push(to.text); continue; }
      // New here: right after the note it followed on the device that added it (first, if it led the list).
      let at = order.indexOf(id) < 0 ? notes.length : 0;
      for (let j = order.indexOf(id) - 1; j >= 0; j--) {
        const p = notes.findIndex((n) => n.id === order[j]);
        if (p >= 0) { at = p + 1; break; }
      }
      notes.splice(at, 0, to);
    }
    pub.notes = cleanNotes(notes);
    return full;
  }
  // My Uniform's part of a diff (see diffOf). take(entry, current) says whether an entry applies. The hash is worked out
  // again from the code, so the two always go together. Returns the names of new items that didn't fit (40 at most).
  function applyUniform(u, take) {
    const full = [];
    if (!u || typeof u !== "object") return full;
    let hash = pub.uniform.hash;
    const items = pub.uniform.items.slice();
    const c = u.code;
    if (c && c.to && typeof c.to === "object" && (c.to.code === "" || cleanCode(c.to.code)) && take(c, { code: priv.uniformCode, hash })) {
      priv.uniformCode = cleanCode(c.to.code);
      hash = priv.uniformCode ? codeHash(priv.uniformCode) : /^[0-9a-f]{64}$/.test(c.to.hash) ? c.to.hash : "";
    }
    const order = Array.isArray(u.order) ? u.order : [];
    const rank = (id) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id));
    const list = Object.entries(u.items && typeof u.items === "object" ? u.items : {}).sort((a, b) => keeps(a) - keeps(b) || rank(a[0]) - rank(b[0]));
    for (let [id, e] of list) {
      let to = e && e.to ? cleanUniformItem(e.to) : null;
      if (!e || (e.to && !(to && to.id === id))) continue; // a damaged entry
      const i = items.findIndex((x) => x.id === id);
      // A change to an item deleted elsewhere since doesn't bring it back: its drawings went with it.
      if (i < 0 && e.from) { if (e.to) take(e, null); continue; }
      // Changed elsewhere too: only the parts changed here are taken, so the other save's changes stay (and a drawing
      // it stopped using, which its cleanup removed, isn't pointed at again).
      const was = to && i >= 0 && e.from ? cleanUniformItem(e.from) : null;
      if (was && !same(items[i], was)) {
        const both = mergeItem(items[i], was, to);
        if (!both) continue;
        to = both;
        e = { to, from: e.from };
      }
      if (!take(e, i >= 0 ? items[i] : null)) continue;
      if (i >= 0) { if (to) items[i] = to; else items.splice(i, 1); continue; }
      // The list is full with items saved elsewhere: those stay, and he's told this one wasn't added.
      if (items.length >= UNIFORM_MAX) { full.push(to.name); continue; }
      // New here: right after the item it followed on the device that added it (first, if it led the list).
      let at = order.indexOf(id) < 0 ? items.length : 0;
      for (let j = order.indexOf(id) - 1; j >= 0; j--) {
        const p = items.findIndex((x) => x.id === order[j]);
        if (p >= 0) { at = p + 1; break; }
      }
      items.splice(at, 0, to);
    }
    pub.uniform = cleanUniform({ hash, items });
    return full;
  }

  // An item's parts that go together: its name; its kind; its drawing with how it sits on the mannequin; the drawing
  // buttoned up for a tie, with the switch for it.
  const ITEM_PARTS = [["name"], ["cat", "blazer"], ["img", "fit", "box"], ["img2", "tie"]];
  // cur as saved elsewhere, with the parts this device changed (from was to to) taken from to.
  function mergeItem(cur, was, to) {
    const out = Object.assign({}, cur);
    for (const part of ITEM_PARTS) if (part.some((f) => !same(was[f], to[f]))) for (const f of part) out[f] = to[f];
    return cleanUniformItem(out);
  }

  // After a save, copies of the changes it included are done. Removing them keeps an old copy from
  // coming back later if that day is changed again.
  function pruneOtherDrafts() {
    for (const key of draftKeys()) {
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
      const nt = d.nt && typeof d.nt === "object" ? d.nt : {};
      for (const [id, e] of Object.entries(nt.items || {})) if (!e || same(noteIn(saved.pub, id), e.to)) { delete nt.items[id]; changed = true; }
      if (!changed) continue;
      if (diffSize({ days: d.days || {}, pub: d.pub || {}, priv: d.priv || {}, wk: d.wk || {}, uni: d.uni, nt: d.nt })) store.set(key, JSON.stringify(d));
      else store.del(key);
    }
  }

  // Unsaved changes of this tab that a newer tab took over (it brought them back and removed this tab's record of them,
  // see enterOwner): they're that tab's now, so what he does with them there (Save, or undo them) decides. Until one
  // changes again here, this tab doesn't store it again or put it back after a save. diffOf's shape; null: none.
  let handed = null;
  function withoutHanded(d) {
    if (!handed || !d.uni || !d.nt) return d;
    const both = [[d.days, handed.days], [d.pub, handed.pub], [d.priv, handed.priv], [d.wk, handed.wk], [d.uni.items, handed.uni.items], [d.nt.items, handed.nt.items]];
    for (const [mine, gone] of both) {
      for (const k of Object.keys(gone)) if (mine[k] && same(mine[k].to, gone[k].to)) delete mine[k]; else delete gone[k];
    }
    if (handed.uni.code && d.uni.code && same(d.uni.code.to, handed.uni.code.to)) delete d.uni.code;
    else delete handed.uni.code;
    return d;
  }

  // Another tab on this device saved: start from that save and keep this tab's own unsaved changes on top.
  async function rebase() {
    if (!owner || busy || saving || standIn) return;
    busy = true;
    try {
      const st = await loadOwnerState(token);
      const mine = withoutHanded(diffOf()), was = saved;
      handed = null;
      saved = { pub: clone(st.pub), priv: clone(st.priv) };
      pub = clone(st.pub);
      priv = clone(st.priv);
      forgetAutoCopies();
      const back = putBackLost(st);
      const said = [back.length ? lostSaid(st, back) : "", fullText(applyDiff(mine, false).full)].filter(Boolean).join(" ");
      if (noteMoved[noteSel]) noteSel = noteMoved[noteSel]; // the note open in Settings took a new id: it stays open
      pubSha = st.pubSha;
      privAt = st.privAt;
      privExists = st.privExists;
      needsPublish = st.behind;
      pubHash = st.pubHash;
      updated = st.updated;
      if ($("#settingsSheet").open) { atOpenAfter(was); fillSettings(true); renderWeekly(); renderNotes(); renderUniSettings(); }
      if (said) toast(said, 8000);
    } catch { /* offline: Save will notice a newer version */ }
    busy = false;
    persistDraft();
    render();
  }

  function persistDraft() {
    if (standIn || busy) return; // never store edits made on a stand-in or a half-loaded calendar
    const d = withoutHanded(diffOf());
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
  // A new schedule entry for a day keeps what he added in Edit Day: his per-shift choices (they override whatever the
  // schedule says) and his own note, unless the new entry brings a note of its own (Oct 15 audit: pasting the schedule
  // again used to wipe a note he'd typed).
  function setDayKeep(k, rec) {
    const cur = priv.days[k];
    const o = cur && cur.o, note = cur && cur.note;
    if (!o && !note) { setDay(k, rec); return; }
    // Cleared back to nothing: an every-week day goes back to its weekly shift, still with his choices (a bare "none"
    // would have hidden the weekly hours).
    let base = rec;
    const rule = rec ? null : ruleOn(k, priv);
    if (rule) { base = Object.assign({}, rule); delete base.d; delete base.from; }
    const keep = { o };
    // A work day's note is usually the site from an earlier paste: it only stays while the day is still a work day.
    if (note && !(base && base.note) && (cur.s !== "work" || (base && base.s === "work"))) keep.note = note;
    setDay(k, cleanPrivRec(Object.assign({}, base || { s: "none" }, keep), priv.pickup));
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
    if (brush === "work") setDayKeep(k, cur && cur.s === "work" ? null : workRec(null, null, priv.pickup));
    else if (brush === "busy") setDayKeep(k, cur && cur.s === "busy" ? null : { s: "busy" });
    else if (brush === "open") setDayKeep(k, cur && cur.s === "open" ? null : { s: "open" });
    afterChange();
  }

  // ---------- day info ----------
  function ownerInfo(k) {
    const rec = dayRec(k, priv);
    const booked = weekHours(k, priv, pub.weekStart);
    const base = { past: k < todayKey(), booked, rec, weekly: !!(rec && rec.weekly) };
    if (!rec || (rec.s === "none" && !rec.o)) return Object.assign(base, { kind: "unset" });
    const types = offerOf(rec, pub);
    if (!types.length) return Object.assign(base, { kind: rec.s === "work" ? "work" : "busy" });
    return Object.assign(base, { kind: otKind(k, types, priv.pickup, pub.weekStart, privLeft(priv)) });
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
  // The status line by the green light: his own words from Settings, or the sentence built from his shifts.
  const statusLine = () => pub.status;
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
  // The days breathe on the page clock's 3 s beat (--bd). The browser starts their glow when it next draws, which after
  // a busy first frame can be a fifth of a second after the calendar was built: on that frame each glow is pinned to the
  // beat, so a redraw (the tab shown again) picks it up exactly where it was.
  function syncBreath() {
    const weeks = $("#weeks");
    if (!weeks.getAnimations || !window.requestAnimationFrame) return;
    requestAnimationFrame(() => {
      if (!revealed || !document.documentElement.classList.contains("lit")) return;
      try {
        const bd = -parseFloat(weeks.style.getPropertyValue("--bd")) || 0, now = document.timeline ? document.timeline.currentTime : performance.now();
        for (const a of weeks.getAnimations({ subtree: true })) if (a.animationName === "breathe") a.startTime = now - ((((now - bd) % 3000) + 3000) % 3000);
      } catch (e) { /* an older browser: --bd alone keeps them close */ }
    });
  }
  function renderHero() {
    const ready = dataIn && (owner || !loadError);
    renderTitle();
    const letters = initials(pub.name);
    $("#shield").toggleAttribute("hidden", !letters); // an <svg> has no hidden property, only the attribute
    $("#badge").hidden = !letters; // and the frame it sits in, with its sparkle
    $("#shieldText").textContent = letters;
    $("#accepting").hidden = !ready || !pub.status;
    for (const c of ["yellow", "red"]) for (const el of [$("#accepting"), $("#statusMock")]) el.classList.toggle(`led-${c}`, pub.led === c);
    $("#acceptingText").textContent = statusLine();
    if (!typer) { $("#acceptingTyped").textContent = statusLine(); $("#acceptingRest").textContent = ""; }
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
    // The license box (Oct 15): one row per detail, its name on the left and the detail on the right, a line between rows.
    const renews = licRenews().replace(/^Renews /, "");
    $("#heroLicRows").replaceChildren(...[
      ["License No.", pub.licNo, "lic-no"],
      ["Issued", pub.licIssued ? dateText(pub.licIssued) : ""],
      [licExpired() ? "Expired" : "Expires", pub.licExpires ? dateText(pub.licExpires) : "", licExpired() ? "lic-bad" : ""],
      ["Renews", renews ? renews.charAt(0).toUpperCase() + renews.slice(1) : ""],
    ].filter((r) => r[1]).map(([k, v, cls]) => h("div", { class: `lic-row${cls ? ` ${cls}` : ""}` }, h("dt", { text: k }), h("dd", { text: v }))));
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
    fabCheck(); // the calendar under it moved or got shorter
  }
  // Pick a Day: bring the days they can ask about into view (only if they aren't already), and make them glow.
  function pickADay() {
    openHeroBox(null);
    const tiles = [...document.querySelectorAll("#weeks .day.open, #weeks .day.ot, #weeks .day.pot")].filter((b) => !b.disabled && !b.classList.contains("past"));
    if (!tiles.length) { toast("No open days on the calendar right now."); $("#heroCallBtn").focus(); return; }
    // Really visible: not under the calendar's sticky weekday row (laptops), a bar along the bottom (edit mode) or the
    // My Uniform button.
    const first = tiles[0], r = first.getBoundingClientRect(), cal = $(".cal").getBoundingClientRect();
    const dow = $(".cal .dow"), bars = ["#toolbar", "#previewBar", "#uniformBtn"].map((s) => $(s)).filter((b) => !b.hidden);
    const top = Math.max(0, cal.top, getComputedStyle(dow).position === "sticky" ? dow.getBoundingClientRect().bottom : 0);
    const bottom = Math.min(window.innerHeight, cal.bottom, ...bars.map((b) => b.getBoundingClientRect().top));
    // Scrolls even when the first day already peeks in at the bottom edge: the days come up to the middle (Oct 16).
    const centered = r.top >= top + (bottom - top) * 0.2 && r.bottom <= bottom - (bottom - top) * 0.2;
    if (!centered) {
      const smooth = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
      try { first.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" }); } catch (e) { first.scrollIntoView(); }
    }
    const weeks = $("#weeks");
    weeks.classList.remove("beckon", "drop"); // once the glow ended, the opening's drop would play again
    void weeks.offsetWidth; // restart the glow when it's tapped again
    weeks.classList.add("beckon");
    clearTimeout(pickADay.timer);
    pickADay.timer = setTimeout(() => weeks.classList.remove("beckon"), 4400);
    try { first.focus({ preventScroll: true }); } catch (e) { /* old browser: no focus move */ }
  }

  // A note shows while it has text, its show-until date hasn't passed (the viewer's clock), and, for the night-shift
  // line, while he takes overnights. Nothing shows before the calendar file is in, or when it couldn't be read.
  const nightOn = () => pub.willing.includes("overnight");
  const noteLive = (n) => !n.auto && !!n.text.trim() && !(n.until && todayKey() > n.until);
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
    aimWave();
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
        const showMonth = d.getDate() === 1; // only a new month's 1st (Oct 15): the week label already names the month
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
          disabled = info.past || info.kind === "unset";
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
        if (hrs > 0) head.append(h("span", { class: hrs > priv.otAfter ? "hrs over" : "hrs", text: `${num(hrs)} hrs scheduled${hrs > priv.otAfter ? " · overtime" : ""}` }));
      } else {
        // Supervisors: the week's scheduled hours, the same line he sees in edit mode (an older calendar file may not have them).
        // Overtime only past his limit (40 hours is not overtime; 40.5 is).
        const hrs = pubOt && pubOt.hrs && ws in pubOt.hrs ? pubOt.hrs[ws] : null, over = hrs != null && pubOt.after > 0 && hrs > pubOt.after;
        if (hrs > 0) head.append(h("span", { class: over ? "hrs over" : "hrs", text: `${num(hrs)} hrs scheduled${over ? " · overtime" : ""}` }));
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
    if (!asOwner) syncBreath();
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
    }
    // Only warnings now (Oct 15): the box shows up only while something needs fixing.
    const line = (...bits) => { if (hints.childNodes.length) hints.append(h("br")); hints.append(...bits); };
    if (!pub.phone) line("Add your cell number in Settings so supervisors can text you.");
    if (pub.licName && licExpired()) line(h("b", { text: "Your license shows Expired at the top. When you renew, enter the new dates in Settings." }));

    const c = changes();
    const n = receiptLines().length;
    if (c.publish && !c.days.size && !c.settings) line(h("b", { text: "Tap Review Changes, then Save Changes, to update what supervisors see." }));
    $("#ownerBanner").hidden = !hints.childNodes.length;
    const btn = $("#saveBtn");
    btn.disabled = saving || n === 0;
    btn.textContent = saving ? "Saving…" : n ? `Review Changes (${n})` : "No Changes";
    if ($("#receiptSheet").open) renderReceipt();
    for (const b of document.querySelectorAll(".brushes button")) b.setAttribute("aria-checked", String(b.dataset.brush === brush));
  }

  // ---------- owner: Review Changes (Oct 15) ----------
  // Every unsaved change as a line on a receipt, in plain words ("Wed, Oct 21: Shifts changed"), each with a button that
  // undoes just that change (back to how it was saved). His layout choices aren't on it (see changes).
  const PUB_LABEL = { name: "Your name", empId: "Employee ID", phone: "Cell number", status: "Status line", led: "Status light color",
    willing: "Shifts you offer on days off", callHours: "When to call instead of text", weekStart: "Pay period end day",
    nightStart: "Graveyard start time", feedback: "Feedback email", licName: "License name", licNo: "License number",
    licIssued: "License issued date", licExpires: "License expiration date", potFrom: "P-OT start times", potMax: "P-OT longest shift" };
  const PRIV_LABEL = { otAfter: "Overtime limit", pickup: "Usual shift length" };
  function dayChange(from, to) {
    if (!to) return "Cleared";
    const a = from ? workShifts(from) : [], b = workShifts(to), parts = [];
    if (!same(a, b)) parts.push(!b.length ? (a.length ? "Shift deleted" : "Changed") : a.length ? (b.length > a.length ? "Shift added" : "Shifts changed") : "Shift added");
    else if (!from || from.s !== to.s) { if (!(to.s === "none" || (!from && to.s === "open" && to.note))) parts.push(to.s === "busy" ? "Marked busy" : to.s === "open" ? "Day off" : "Changed"); }
    const n0 = (from && from.note) || "", n1 = to.note || "";
    if (n0 !== n1) parts.push(!n1 ? "Note deleted" : !n0 ? "Note added" : "Note changed");
    if (!same((from && from.o) || null, to.o || null)) parts.push("Shift choices changed");
    if (!same((from && from.w) || null, to.w || null)) parts.push("Shifts offered changed");
    return [...new Set(parts)].join(" · ") || "Changed";
  }
  function receiptLines() {
    const out = [];
    if (!saved) return out;
    const c = changes();
    for (const k of [...c.days].sort()) {
      const was = saved.priv.days[k];
      out.push({ label: shortDay(k), what: dayChange(was, priv.days[k]), undo: () => setDay(k, was ? clone(was) : null) });
    }
    let settingsSeen = 0;
    for (const f of Object.keys(PUB_LABEL)) {
      const fs = f === "potFrom" ? ["potFrom", "potTo"] : [f];
      if (fs.every((x) => same(pub[x], saved.pub[x]))) continue;
      settingsSeen++;
      out.push({ label: "Settings", what: PUB_LABEL[f], undo: () => { for (const x of fs) pub[x] = clone(saved.pub[x]); } });
    }
    for (const f of Object.keys(PRIV_LABEL)) {
      if (same(priv[f], saved.priv[f])) continue;
      settingsSeen++;
      out.push({ label: "Settings", what: PRIV_LABEL[f], undo: () => { priv[f] = saved.priv[f]; } });
    }
    for (let w = 0; w < 7; w++) {
      const now = ruleFor(priv.weekly, w), was = ruleFor(saved.priv.weekly, w);
      if (same(now, was)) continue;
      settingsSeen++;
      out.push({ label: `Every ${DOW_LONG[w]}`, what: !was ? "Added" : !now ? "Turned off" : "Changed",
        undo: () => { priv.weekly = cleanWeekly(priv.weekly.filter((r) => r.d !== w).concat(was ? [clone(was)] : []), priv.pickup); } });
    }
    const own = (p) => p.notes.filter((n) => !n.auto);
    for (const id of new Set([...own(pub), ...own(saved.pub)].map((n) => n.id))) {
      const now = noteIn(pub, id), was = noteIn(saved.pub, id);
      if (same(now, was)) continue;
      settingsSeen++;
      out.push({ label: "Notes to supervisors", what: !was ? `${noteTitle(now)} added` : !now ? "A note deleted" : `${noteTitle(now)} changed`,
        undo: () => {
          const i = pub.notes.findIndex((n) => n.id === id);
          if (!was) { if (i >= 0) pub.notes.splice(i, 1); }
          else if (i >= 0) pub.notes[i] = clone(was);
          else pub.notes.splice(Math.min(Math.max(0, saved.pub.notes.findIndex((n) => n.id === id)), pub.notes.length), 0, clone(was));
        } });
    }
    for (const id of new Set([...pub.uniform.items, ...saved.pub.uniform.items].map((x) => x.id))) {
      const now = uniformItemIn(pub, id), was = uniformItemIn(saved.pub, id);
      if (same(now, was)) continue;
      settingsSeen++;
      out.push({ label: "My Uniform", what: !was ? `${now.name} added` : !now ? `${was.name} deleted` : `${now.name} changed`,
        undo: () => {
          const items = pub.uniform.items, i = items.findIndex((x) => x.id === id);
          if (!was) { if (i >= 0) items.splice(i, 1); } else if (i >= 0) items[i] = clone(was); else items.push(clone(was));
        } });
    }
    if (priv.uniformCode !== saved.priv.uniformCode || pub.uniform.hash !== saved.pub.uniform.hash) {
      settingsSeen++;
      out.push({ label: "My Uniform", what: "Code changed", undo: () => { priv.uniformCode = saved.priv.uniformCode; pub.uniform.hash = saved.pub.uniform.hash; } });
    }
    // Anything else in the settings (like the notes' order): one line that puts all of it back.
    if (c.settings && !settingsSeen) {
      out.push({ label: "Settings", what: "Other changes", undo: () => {
        const keep = { secOrder: priv.secOrder, secView: priv.secView, days: priv.days };
        pub = clone(saved.pub);
        priv = Object.assign(clone(saved.priv), keep);
      } });
    }
    if (c.publish) out.push({ label: "Supervisors' calendar", what: "Needs updating", undo: null });
    return out;
  }
  function renderReceipt() {
    const lines = receiptLines();
    $("#rcWhen").textContent = new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("#rcLines").replaceChildren(...lines.map((l) => {
      const li = h("li", { class: "rc-line" }, h("span", { class: "rc-item" }, h("b", { text: l.label }), h("span", { text: l.what })));
      if (l.undo) {
        const del = h("button", { type: "button", class: "rc-del", "aria-label": `Undo: ${l.label}, ${l.what}`, title: "Undo this change" }, "×");
        del.addEventListener("click", () => {
          l.undo();
          if ($("#settingsSheet").open) { fillSettings(true); renderWeekly(); renderNotes(); }
          afterChange(); // redraws the receipt too (see renderOwnerBits)
          if (!receiptLines().length) $("#receiptSheet").close("");
        });
        li.append(del);
      }
      return li;
    }));
    if (!lines.length) $("#rcLines").append(h("li", { class: "rc-line rc-empty", text: "No changes." }));
    $("#rcTotal").textContent = String(lines.length);
    $("#rcSave").disabled = saving || !lines.length;
    $("#rcSave").textContent = saving ? "Saving…" : "Save Changes";
  }
  function openReceipt() {
    renderReceipt();
    showSheet("#receiptSheet");
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
    // The code's place is kept from the start (a white square the code fills), so the sheet opens at its full height
    // and doesn't jump taller once the code is drawn (Oct 16).
    const box = $("#shareQr");
    box.hidden = false;
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
    chev: '<polyline points="9 18 15 12 9 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  };
  // A small clock whose minute hand turns around the center (the hand stops for people who ask for less motion).
  const clockIcon = () => { const s = h("span", { class: "clock-ic", "aria-hidden": "true" }); s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" focusable="false"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="12" x2="15.5" y2="12"/><line class="clock-hand" x1="12" y1="12" x2="12" y2="5.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>'; return s; };
  const icon = (name) => { const s = h("span"); s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`; return s.firstChild; };
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
    // The form's notes sit above where focus lands (and show only here), so they're tied to it: a screen reader reads them
    // out with it.
    const notes = form && sheet.querySelector("aside.note-box");
    if (f && form) { if (notes) { notes.id = "formNotes"; f.setAttribute("aria-describedby", "formNotes"); } else f.removeAttribute("aria-describedby"); }
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
      h("p", { class: "qr-cap", text: "Text me from your phone:" }),
      // Spelled out for anyone who hasn't used a QR code before.
      h("ol", { class: "qr-steps" },
        h("li", { text: "Open your phone's camera app." }),
        h("li", { text: "Point it at this square code and hold still." }),
        h("li", { text: "Tap the link that pops up. Your texting app opens with the message filled in. Tap Send." })),
      h("p", { class: "muted small qr-or", text: `Or text ${prettyPhone()} from your phone.` }),
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

  // A start or end time box, its name in grey inside it until something's typed, with a two-part AM/PM bar beside it.
  function clockField(id, label, update, out) {
    const input = h("input", { type: "text", id, inputmode: "numeric", maxlength: "8", autocomplete: "off", placeholder: label, "aria-label": `${label} time` });
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
      const was = out ? out.offsetHeight : 0;
      update();
      if (out && out.offsetHeight !== was) $("#daySheet").openedAt = Date.now();
    };
    am.addEventListener("click", () => press("am"));
    pm.addEventListener("click", () => press("pm"));
    input.addEventListener("input", () => { sync(); update(); });
    return {
      el: h("div", { class: "field clock" }, input,
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
    const m = tr.memo[type || "pot"] || (tr.memo[type || "pot"] = { ctx: { ack: "" }, form: null });
    const ctx = m.ctx;
    const phone = isPhone(), texting = !!smsNumber();
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
        h("ul", null, h("li", { text: "Your name" }), h("li", { text: "The shift's start and end times" }), h("li", { text: "The site name and address" }), h("li", { text: "The pay rate" }))),
      h("div", { class: "pot-btns" }, sendNow, custom),
      other,
      qr ? qr.el : null);
    // Texting isn't set up: no way to send.
    const noText = h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." });
    // A P-OT day keeps a quiet way back to the calendar.
    const another = !type ? h("button", { type: "button", class: "linkish quiet", text: "Pick Another Day", onclick: () => $("#daySheet").close() }) : null;

    // The text goes out without times: overtime is told without numbers. Times go in on Customize Text First.
    const compute = () => {
      const r = { span: null, ot: null, no: [], ready: true, part: "", day: null, time: "" };
      r.raw = type ? shiftOt(k, type, null) || (info.kind === "ot" && (!info.x || info.x.indexOf(type) >= 0) ? true : null) : null;
      r.ot = type ? untimed(r.raw) : { part: true };
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
      // The top line: the day's answer, or for a picked shift its overtime counted for his usual shift ("some" for a part).
      if (type) shiftStatus(st.raw, false);
      else dayStatus();
      msgBlock.hidden = !texting;
      noText.hidden = texting;
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
          h("button", { type: "button", class: "linkish", text: "Change Shift", onclick: () => (tr.change ? tr.change() : tr.back()) }))
        : null,
      msgBlock,
      noText,
      another,
    ];
    const again = () => { show(steps, type ? ".shift-chosen .linkish" : null); update(); };
    const openForm = () => {
      // The same form comes back each time, with any edits to the message and the times typed.
      if (!m.form) m.form = textForm(k, info, type, tr.back, shiftStatus, { ctx });
      else { m.form.recall(); m.form.refresh(); }
      show(m.form.nodes, null);
      tr.forward(again);
    };
    custom.addEventListener("click", openForm);
    update();
    show(steps, type ? ".shift-chosen .linkish" : null);
    tr.openForm = openForm; // Customize Text First tapped on the floating card: openDay goes straight on to the form
  }

  // The full message form. back() returns to the simple window; status(ot, timed) updates the line at the top as the
  // overtime changes with the shift time. opts: {time} to fill Shift Time with, ctx shared with the simple window.
  // type null: a P-OT day, where his P-OT settings can turn a time down.
  function textForm(k, info, type, back, status, opts) {
    const pot = !type, ctx = (opts && opts.ctx) || { ack: "" };
    const remembered = (key) => store.get(key) || "";
    // Each box's name sits in grey inside it until something's typed, like Start and End.
    const field = (id, label, attrs, value) => {
      const input = h("input", Object.assign({ type: "text", id, placeholder: label, "aria-label": label }, attrs));
      input.value = value || "";
      return { input, el: h("div", { class: "field" }, input) };
    };
    const who = field("txWho", "Your Name", { maxlength: "40", autocomplete: "name" }, remembered(LS.who));
    // When the shift starts and ends, each with its AM/PM bar; a time that can't be read says so under them.
    const startF = clockField("txStart", "Start", () => refresh(), null);
    const endF = clockField("txEnd", "End", () => refresh(), null);
    const clockHint = h("p", { class: "muted small", "aria-live": "polite" });
    // On a P-OT day, once both times are in: hour by hour, which hours would be overtime.
    const barBox = h("div", { class: "stack" });
    let barWatch = null;
    const drawBar = (span, ot) => {
      if (barWatch) { barWatch.disconnect(); barWatch = null; }
      if (!pot || !span || !ot || ot.no || ot.part) { barBox.replaceChildren(); barBox.hidden = true; return; }
      const stretches = otStretches(k, span, pub.weekStart, pubLeft);
      const bar = otBar(span, stretches);
      barBox.replaceChildren(bar, otSummary(span, stretches, ot));
      barBox.hidden = false;
      fitBar(bar);
      barWatch = onWidth(bar, () => fitBar(bar));
    };
    const time = { el: h("div", { class: "stack" }, h("div", { class: "clocks" }, startF.el, endF.el), clockHint, barBox) };
    const site = field("txSite", "Site Name", { maxlength: "60", autocomplete: "organization" }, remembered(LS.site));
    const addr = field("txAddr", "Site Address", { maxlength: "100", autocomplete: "street-address" }, remembered(LS.addr));
    const pay = field("txPay", "Pay Rate", { maxlength: "30", autocomplete: "off" }, remembered(LS.pay));
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
      send = iconLabel(h("a", { class: "btn go" }), "message", "Send Text Now");
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
    } else if (opts && opts.onSend) {
      // The floating card on a computer: Send Text Now opens a screen of its own with the code (after the short-notice
      // check), so the form never has to squeeze the code in beside the message.
      showQr = iconLabel(h("button", { type: "button", class: "btn go" }), "message", "Send Text Now");
      showQr.addEventListener("click", () => {
        if (blocked) return;
        if (needsCheck()) { const key = cur.key; warnCall(k, cur.span, () => { ctx.ack = key; opts.onSend(msg.value); }); } else opts.onSend(msg.value);
      });
      sendBox = h("div", { class: "send" }, showQr);
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
      const v = { who: who.input.value.trim(), time: "", site: site.input.value.trim(), addr: addr.input.value.trim(), pay: pay.input.value.trim(), type };
      const s = startF.mins(), e = endF.mins();
      clockHint.textContent = startF.unreadable() || endF.unreadable() ? "Enter a time like 11, 1130 or 11:30, then pick AM or PM."
        : s != null && e != null && s === e ? "The start and end can't be the same time." : "";
      v.read = s != null && e != null && s !== e ? { start: hhmm(s), end: hhmm(e) } : null;
      if (v.read) v.time = timeText(s, e);
      clockHint.hidden = !clockHint.textContent;
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
      if (!qr) { showQr.disabled = blocked; showQr.classList.toggle("off", blocked); return; }
      const gate = !blocked && needsCheck();
      showQr.hidden = !gate;
      qr.show(!blocked && !gate);
      if (!blocked && !gate) qr.draw(msg.value);
    };
    const refresh = () => {
      const v = values(), t = v.read;
      const sp = spanOf(t);
      cur = { span: sp, key: spanKey(sp) };
      drawBar(sp, v.ot);
      shiftLabel.textContent = !pot ? `Shift: ${SHIFT_LABEL[type]}` : t ? `Shift: ${fmtTime(t.start)} to ${fmtTime(t.end)}` : "Shift: Not Set";
      blocked = !!(v.ot && v.ot.no);
      if (!edited) msg.value = composeMessage(k, v);
      if (send) send.classList.toggle("ot", otState(v.ot) !== "open");
      if (showQr) showQr.classList.toggle("ot", otState(v.ot) !== "open");
      sendState();
      // Without a time, a picked shift's line counts his usual shift ("some of the 8 hours").
      status(t || pot ? v.ot : rawOt(null), !!t);
    };
    for (const [f, key] of [[who, LS.who], [site, LS.site], [addr, LS.addr], [pay, LS.pay]]) {
      f.input.addEventListener("input", () => { if (key) store.set(key, f.input.value.trim()); refresh(); });
    }
    msg.addEventListener("input", () => { edited = true; reset.hidden = false; sendState(); });
    reset.addEventListener("click", () => { edited = false; reset.hidden = true; refresh(); });
    refresh();
    // Two columns on a laptop: the boxes on the left, the message and the way to send it on the right.
    const nodes = [h("div", { class: "tx-grid" },
      h("div", { class: "tx-col" },
        h("div", { class: "field-head shift-chosen" }, shiftLabel),
        h("p", { class: "muted small", text: "All optional. What you fill in is added to the message." }),
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
      refresh,
      // Name, site, address and pay typed since this form was made (in another shift's form). Blocked storage
      // returns null and leaves what's in the boxes.
      recall() {
        for (const [f, key] of [[who, LS.who], [site, LS.site], [addr, LS.addr], [pay, LS.pay]]) { const v = store.get(key); if (v != null) f.input.value = v; }
      },
    };
  }

  function openDay(k, pre, form) {
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
    const say = (text) => { if (statusText.textContent !== text) statusText.textContent = text; fitLine(line); };
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
      swatch.className = `sw ${st === "pot" ? "ot" : st}`; // any overtime is plain yellow
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
      openForm: null,
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
      else { const area = h("div", { class: "stack" }); wrap.append(area); shiftChoice(k, info, area, dayStatus, shiftStatus, tr, pre); }
    }
    $("#dayBody").replaceChildren(wrap);
    $("#daySheet").openedAt = Date.now();
    $("#daySheet").openerKey = k;
    showSheet("#daySheet");
    fitLine(line); // measured once it is on screen
    // Only now, once the window has its place in the history, so Back from the form returns to this window.
    if (form && tr.openForm) tr.openForm();
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
  // pre: a shift already picked from the floating buttons; Change Shift brings the buttons back.
  const SHIFT_ORDER = ["morning", "swing", "overnight"];
  function shiftChoice(k, info, area, dayStatus, shiftStatus, tr, pre) {
    const accepts = info.w || pub.willing;
    const show = showIn(area);
    if (pre) {
      tr.change = () => {
        $("#daySheet").close("");
        nav.closed($("#daySheet")); // before the shift buttons add their own history entry
        const t = document.querySelector(`#weeks .day[data-key="${k}"]`);
        if (t) floatPick(k, t); else openDay(k);
      };
      sendWindow(k, info, pre, area, dayStatus, shiftStatus, tr);
      return;
    }
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

  // A red (busy) day tapped: it shakes its head no, hard and quick, and opens nothing. Its name already says it's
  // not available, for screen readers.
  function shakeNo(tile) {
    if (!tile.animate) return;
    if (tile.shake) tile.shake.cancel();
    tile.shake = tile.animate([
      { transform: "translateX(0)" }, { transform: "translateX(-9px) rotate(-3deg)" }, { transform: "translateX(9px) rotate(3deg)" },
      { transform: "translateX(-8px) rotate(-2.5deg)" }, { transform: "translateX(8px) rotate(2.5deg)" },
      { transform: "translateX(-5px) rotate(-1.5deg)" }, { transform: "translateX(5px) rotate(1.5deg)" },
      { transform: "translateX(-2px)" }, { transform: "translateX(0)" },
    ], { duration: 480, easing: "ease-out" });
  }

  // The week's hours until overtime for a shift on day k, as the clock line under a yellow shift's name. A graveyard on
  // the pay week's last day runs into the next week, so it gets a line for each day ("Thu: 1 hr until overtime").
  function weekClock(k, t) {
    const leftIn = (w) => (pubOt && w in pubOt.left ? pubOt.left[w] : null);
    const say = (n) => (n <= 0 ? "overtime" : `${num(n)} ${n === 1 ? "hr" : "hrs"} until overtime`);
    const ws = weekStartOf(k, pub.weekStart), next = addDays(ws, 7);
    const here = leftIn(ws), there = leftIn(next);
    if (here == null) return null;
    // Each line: its own clock, the day, the colon, the hours, in columns, so the days start together and the colons line up.
    if (t === "overnight" && addDays(k, 1) === next && there != null) {
      return h("span", { class: "pf-tag pf-two" }, [[k, here], [next, there]].map(([d, n]) => [
        clockIcon(), h("span", { text: fmt(d, { weekday: "short" }) }), h("span", { text: ":" }), h("span", { text: say(n) })]));
    }
    return h("span", { class: "pf-tag" }, clockIcon(), h("span", { text: here <= 0 ? "Overtime this week" : say(here).replace(/^./, (c) => c.toUpperCase()) }));
  }

  // A green or yellow day tapped: it floats up off the calendar and splits into the three shifts. The ones he takes
  // are raised, bold and bob slowly (green, yellow or both, as that shift's overtime is); the ones he doesn't are
  // pressed in, see-through and still. Picking one opens the day window at that shift's text. A tap outside, Escape or
  // Back puts the day back.
  let pickEl = null;
  const stillMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  function floatPick(k, tile) {
    if (!pickEl) {
      pickEl = h("dialog", { class: "pick-float", id: "shiftPick", tabindex: "-1" });
      document.body.append(pickEl);
      pickEl.addEventListener("click", (e) => { if ((e.target === pickEl || e.target.classList.contains("pf-scrim")) && pickEl.leave) pickEl.leave(); });
      pickEl.addEventListener("cancel", (e) => { if (pickEl.leave) { e.preventDefault(); pickEl.leave(); } });
      pickEl.addEventListener("close", () => {
        nav.closed(pickEl);
        pickEl.leave = null;
        pickEl.replaceChildren();
        const t = pickEl.tile;
        if (pickEl.returnValue !== "picked" && t && t.isConnected) try { t.focus({ preventScroll: true }); } catch (x) { /* old browser */ }
      });
    }
    if (pickEl.open) return;
    const info = publicInfo(k), accepts = info.w || pub.willing, still = stillMotion();
    const r = tile.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    // The day itself, lifted off the page where it was.
    const ghost = tile.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.className = `${tile.className} pf-ghost`;
    ghost.setAttribute("aria-hidden", "true");
    ghost.tabIndex = -1;
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    for (const part of [".num", ".tag", ".mon"]) {
      const from = tile.querySelector(part), to = ghost.querySelector(part);
      if (from && to) to.style.fontSize = getComputedStyle(from).fontSize;
    }
    // Which day this is, over the three shifts, all in a column in the middle of the window.
    const W = Math.min(340, vw - 24);
    // On a computer's big screen the whole group (the day and its three shifts) is drawn bigger, to fill most of the
    // window's height (measured once it's on screen, below). Phones keep it as it is.
    let Z = 1;
    const col = h("div", { class: "pf-col", role: "group", "aria-labelledby": "pfDay" });
    Object.assign(col.style, { left: `${(vw - W) / 2}px`, width: `${W}px` });
    const answer = info.kind === "ot" ? mixedOt(k, info) || "I'm available, but it would be overtime" : "I'm available";
    const head = h("div", { class: "pf-head", id: "pfDay" },
      h("p", { class: "pf-kicker", text: fmt(k, { weekday: "long" }) }),
      h("p", { class: "pf-date", text: fmt(k, { month: "long", day: "numeric" }) }),
      h("p", { class: "pf-answer" }, h("span", { class: `sw ${info.kind}`, "aria-hidden": "true" }), h("span", { text: answer })),
      h("p", { class: "pf-ask", text: "Which shift do you need covered?" }));
    const slots = SHIFT_ORDER.map((t, i) => {
      const takes = accepts.indexOf(t) >= 0;
      const raw = shiftOt(k, t, null) || (info.kind === "ot" && (!info.x || info.x.indexOf(t) >= 0) ? true : null);
      // Yellow when the usual shift touches overtime at all. Then a ticking clock gives the week's hours until overtime,
      // the same count as the week's "hrs scheduled" (it never guesses when the shift starts). A graveyard on the pay
      // week's last day runs into the next week, so it gives both: "Thu: 1 hr until overtime · Fri: 5 hrs".
      const st = !takes ? "no" : otState(untimed(raw)) === "open" ? "open" : "ot";
      const tag = st !== "ot" ? null : weekClock(k, t);
      // A box with the shift's first letter on the left, the name in the middle, an arrow on the right (taken shifts only).
      const btn = h("button", { type: "button", class: `pf-btn ${st}`, "data-type": t },
        h("span", { class: "pf-letter", "aria-hidden": "true", text: SHIFT_LABEL[t][0] }),
        h("span", { class: "pf-mid" }, h("span", { class: "pf-name", text: SHIFT_LABEL[t] }), tag),
        h("span", { class: "pf-arrow", "aria-hidden": "true" }, takes ? icon("chev") : null));
      // Its shadow on the page below, under the edge (which stays put while the top presses down and back up).
      const shadow = h("span", { class: "pf-shadow", "aria-hidden": "true" });
      if (takes) {
        btn.addEventListener("click", () => toCard(t, slot));
      } else {
        btn.disabled = true;
        btn.setAttribute("aria-label", `${SHIFT_LABEL[t]}: not available`);
      }
      const slot = h("div", { class: `pf-slot${takes ? " takes" : ""}` }, shadow, btn);
      return slot;
    });
    col.append(head, ...slots);
    pickEl.tile = tile;
    // Back, in the top left corner of the window the whole time: from the shifts it puts the day back, from the text it
    // returns to the shifts, from the form to the text. What it does now is goBack.
    let goBack = () => { if (pickEl.leave) pickEl.leave(); };
    // One span per letter, so each can lift as the rainbow passes over it (--i: its place in the word).
    const corner = h("button", { type: "button", class: "pf-corner", "aria-label": "Back" }, icon("chev"),
      h("span", { class: "pf-word", "aria-hidden": "true" }, [..."Back"].map((c, i) => h("span", { class: "pf-ch", style: `--i:${i}`, text: c }))));
    corner.addEventListener("click", () => goBack());
    // The dim and blur over the page, as a layer of its own so it can fade in and out with the day (the window's own
    // backdrop popped on and off in one frame, Oct 16).
    const scrim = h("div", { class: "pf-scrim", "aria-hidden": "true" });
    pickEl.replaceChildren(scrim, ghost, col, corner);
    pickEl.setAttribute("aria-label", `${fmt(k, { weekday: "long", month: "long", day: "numeric" })}: pick a shift`);
    showSheet("#shiftPick");
    // The rainbow's slices: the word's width, and each letter's place in it.
    const word = corner.querySelector(".pf-word");
    word.style.setProperty("--w", `${word.offsetWidth}px`);
    for (const ch of word.children) ch.style.setProperty("--x", `${ch.offsetLeft - word.offsetLeft}px`);
    fitLine(head.querySelector(".pf-answer"));
    // The clock lines shrink until they fit between the letter box and the arrow (narrow phones, bigger text settings),
    // so they never run into the arrow or push the shift's name off center.
    for (const tg of col.querySelectorAll(".pf-tag")) {
      const room = tg.parentNode.clientWidth;
      for (let fs = 15; tg.scrollWidth > room && fs > 9; fs -= 0.5) tg.style.fontSize = `${fs - 0.5}px`;
    }
    col.style.top = `${Math.max(16, (vh - col.offsetHeight) / 2)}px`; // measured once it's on screen
    if (!isPhone() && vw >= 900) {
      // As tall as the window allows (with room above and below), no wider than about half the window, at most twice
      // its size; from its middle, so it stays centered. Back grows with it (its own size again in a card).
      Z = Math.max(1, Math.min((vh - 90) / col.offsetHeight, (vw * 0.45) / W, 2));
      col.style.transform = `scale(${Z})`;
      corner.style.fontSize = `${Math.round(Math.min(34 * Z, 64))}px`; // as big as the date it sits beside, roughly
    } else if (col.offsetHeight > vh - 32) {
      // A short window (a phone turned sideways): the whole group shrinks to fit, from its middle, so every shift can be
      // reached. It used to run off the bottom with no way to scroll to it (Oct 15 audit).
      Z = (vh - 32) / col.offsetHeight;
      col.style.top = `${(vh - col.offsetHeight) / 2}px`;
      col.style.transform = `scale(${Z})`;
    }
    // From the keyboard, focus goes to the first shift he takes, ready for Enter. After a tap it rests on the window
    // itself, so no focus ring shows on a button nobody has touched.
    const first = byKeys && col.querySelector(".pf-btn:not(:disabled)");
    const to = first || pickEl;
    try { to.focus({ preventScroll: true }); } catch (x) { to.focus(); }
    // From the day's middle to each button's: where a button starts, and goes back to.
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fromTile = (slot) => {
      const b = slot.getBoundingClientRect();
      // (Inside the bigger column a step counts Z times over, so the distance is divided by it.)
      return `translate(${(cx - (b.left + b.width / 2)) / Z}px, ${(cy - (b.top + b.height / 2)) / Z}px) scale(${Math.max(0.15, r.width / b.width)}, ${Math.max(0.15, r.height / b.height)})`;
    };
    const anim = (el, frames, o) => (el.animate ? el.animate(frames, o) : null);
    let closing = false, openCard = null, turning = false;
    const cornerSize = corner.style.fontSize; // Back's size beside the shifts (bigger on a computer), for coming back to them
    // A shift he takes, tapped: its button grows into a card in the middle of the window, with the text as a chat bubble,
    // a raised Send Text Now and a quieter Customize Text First. The other shifts and the heading fade away.
    const toCard = (t, slot) => {
      if (openCard || closing || turning) return;
      let card = null, growing = false;
      const raw = shiftOt(k, t, null) || (info.kind === "ot" && (!info.x || info.x.indexOf(t) >= 0) ? true : null);
      const ot = untimed(raw), yellow = otState(ot) !== "open";
      const text = composeMessage(k, { who: store.get(LS.who) || "", type: t, time: "", ot, part: "", day: null });
      const phone = isPhone(), qr = phone ? null : qrPanel();
      // A shift that may start soon asks for a call first (once).
      let acked = false;
      const gate = (go, url) => {
        if (shortNotice(k, null) && !acked) { warnCall(k, null, () => { acked = true; if (!url) go(); }, url); return false; }
        if (!url) go();
        return true;
      };
      const send = iconLabel(phone ? h("a", { class: `pf-btn pf-send ${yellow ? "ot" : "open"}`, href: smsHref(text) })
        : h("button", { type: "button", class: `pf-btn pf-send ${yellow ? "ot" : "open"}` }), "message", "Send Text Now");
      send.addEventListener("click", (e) => {
        if (phone) { if (!gate(null, send.getAttribute("href"))) e.preventDefault(); return; }
        gate(() => {
          // The code is how the text goes out from a computer, so the button goes away once it's showing.
          send.parentNode.hidden = true;
          qr.show(true);
          qr.draw(text, () => {
            center(); // the code made the card taller
            if (!card.classList.contains("pf-desk")) try { qr.el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (x) { /* old browser */ }
          });
        });
      });
      const custom = h("button", { type: "button", class: "pf-quiet", text: "Customize Text First" });
      custom.addEventListener("click", () => showForm());
      // Back to the shifts: the card shrinks back into the shift's button while the heading and the other shifts come
      // back around it, in the same window (Oct 16: it closed the window and opened it again, so the day showed lifting
      // off the calendar again before the shifts came back).
      const toShifts = () => {
        if (closing || turning || growing || openCard !== card) return;
        turning = true;
        openCard = null;
        goBack = () => { if (pickEl.leave) pickEl.leave(); };
        // The column where it was, its fades from a moment ago taken off; Back back in the window's corner.
        col.style.display = "";
        for (const el of [head, ...slots]) for (const a of el.getAnimations ? el.getAnimations() : []) if (!(window.CSSAnimation && a instanceof CSSAnimation)) a.cancel();
        corner.classList.remove("in-card");
        corner.style.left = corner.style.top = "";
        corner.style.fontSize = cornerSize;
        const leaving = card;
        const finish = () => {
          leaving.remove();
          slots.forEach((s) => s.classList.add("bob"));
          turning = false;
          const f = byKeys ? slot.querySelector(".pf-btn") : pickEl;
          try { f.focus({ preventScroll: true }); } catch (x) { /* old browser */ }
        };
        if (still || !leaving.animate) { finish(); return; }
        const from = leaving.getBoundingClientRect(), to = slot.getBoundingClientRect();
        for (const c of leaving.children) anim(c, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
        const shrink = anim(leaving, [
          { transform: "none", opacity: 1 },
          { opacity: 1, offset: 0.55 },
          { transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0 },
        ], { duration: 400, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
        // The shift takes the card's place as it lands; the heading, the other shifts and Back fade in around it.
        anim(slot, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 220, fill: "backwards" });
        for (const el of [head, ...slots.filter((s) => s !== slot)]) anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 140, easing: "ease-out", fill: "backwards" });
        anim(corner, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 180, fill: "backwards" });
        shrink.onfinish = finish;
      };
      goBack = toShifts;
      const notes = h("aside", { class: "note-box pf-notes" });
      fillNotes(notes, "day");
      const dayHead = () => h("div", { class: "pf-card-head" },
        h("div", { class: "pf-card-day" }, h("p", { class: "pf-kicker", text: fmt(k, { weekday: "long" }) }), h("p", { class: "pf-card-date", text: fmt(k, { month: "long", day: "numeric" }) })));
      // No shift chip or overtime clock here (Oct 15): the shift picker just showed both, and the text names the shift.
      const thread = h("div", { class: "pf-thread" }, h("p", { class: "pf-to", text: `To ${firstName() || "me"}` }), h("p", { class: "pf-bubble", text }));
      const sendSlot = h("div", { class: "pf-slot takes bob" }, h("span", { class: "pf-shadow", "aria-hidden": "true" }), send);
      const hint = h("p", { class: "pf-hint", text: "Customize Text First adds your name, the shift start and end time, the site address, and/or the pay rate." });
      // A computer with room for it (like the calendar's laptop page): side by side, the text on the left and the QR code,
      // already showing with its steps, on the right. A shift starting soon first asks for a call (its button says so).
      const desk = !phone && window.innerWidth >= 900;
      // A small texting app (computers): who it goes to along the top, the shift like a timestamp, the text as a sent
      // bubble, and a message box along the bottom (what it opens: onCompose).
      const msgsWin = (body, composeText, onCompose, extra) => {
        const initials = (pub.name || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        const compose = h("button", { type: "button", class: "pf-compose" }, icon("edit"), h("span", { text: composeText }));
        compose.addEventListener("click", onCompose);
        return h("div", { class: "pf-msgs" },
          h("div", { class: "pf-msgs-top" }, h("span", { class: "pf-avatar", "aria-hidden": "true", text: initials || "?" }),
            h("span", { class: "pf-msgs-who" }, h("b", { text: pub.name || "Me" }), h("small", { text: prettyPhone() }))),
          h("div", { class: "pf-msgs-thread" },
            h("p", { class: "pf-stamp" }, h("span", { text: `${SHIFT_LABEL[t]} shift` })),
            extra && !extra.hidden ? extra : null,
            h("p", { class: "pf-bubble", text: body })),
          compose);
      };
      const label = `${fmt(k, { weekday: "long", month: "long", day: "numeric" })}, ${SHIFT_LABEL[t]}: text me`;
      if (desk) {
        const waits = shortNotice(k, null);
        // A shift that may start soon: where the code will be, a panel says why it isn't there yet, with the button.
        let wait = null;
        if (waits) {
          iconLabel(send, "message", "Show QR Code");
          wait = h("div", { class: "pf-qr-wait" },
            h("span", { class: "pf-qr-ghost", "aria-hidden": "true" }),
            h("p", { class: "pf-qr-why", text: `This shift may start in less than ${hoursText(pub.callHours)}, so I may be asleep. You'll see how to call me first, then the QR code to text me.` }),
            sendSlot);
          send.addEventListener("click", () => { if (acked) wait.hidden = true; });
          new MutationObserver(() => { if (sendSlot.hidden) wait.hidden = true; }).observe(sendSlot, { attributes: true, attributeFilter: ["hidden"] });
        } else sendSlot.hidden = true;
        // The text, shown as a texting app would: who it goes to along the top, the shift like a timestamp, the message as a
        // sent bubble, and a message box at the bottom that opens Customize Text First.
        const msgs = msgsWin(text, "Customize this text: add your name, times, site or pay", () => showForm(), notes);
        card = h("div", { class: "pf-card pf-desk", role: "group", "aria-label": label },
          dayHead(),
          h("div", { class: "pf-desk-grid" }, msgs, h("div", { class: "pf-desk-col pf-desk-send" }, wait, qr.el)));
        if (!waits) { qr.show(true); requestAnimationFrame(() => qr.draw(text, () => center())); }
      } else card = h("div", { class: "pf-card", role: "group", "aria-label": label },
        dayHead(),
        notes.hidden ? null : notes,
        thread,
        sendSlot,
        qr ? qr.el : null,
        custom,
        hint,
        // Another texting app (copy the message and number): a backup, so it comes last. The question on one line, the two
        // links side by side under it.
        phone ? (() => {
          const oa = copyLinks(() => text, (go) => gate(go));
          oa.replaceChildren(h("span", { text: "Use a different app, like TextNow?" }), h("span", { class: "pf-other-links" }, ...oa.querySelectorAll("button")));
          return oa;
        })() : null);
      const sendView = [...card.childNodes];
      // The card's width: narrow on a phone; wide on a computer with room (the text beside the code, the form's boxes
      // beside the message).
      // The height that can really be seen: on a phone, the browser's toolbars (any browser) cover part of the window, so the card's
      // bottom would hide behind them.
      const seen = () => (window.visualViewport ? Math.min(window.visualViewport.height, window.innerHeight) : window.innerHeight);
      const size = (wide) => {
        const w = window.innerWidth, cw = wide && w >= 900 ? Math.min(900, w - 48) : Math.min(400, w - 24);
        Object.assign(card.style, { left: `${(w - cw) / 2}px`, width: `${cw}px`, maxHeight: `${seen() - 24}px` });
      };
      size(desk);
      openCard = card;
      pickEl.append(card);
      // Once there's a card, Back moves from the window's corner into the card's own, level with the date.
      corner.classList.add("in-card"); corner.style.fontSize = "";
      pickEl.append(corner); // after the card, so it floats over it
      // Where the date is too wide for Back to sit beside it (narrow phones, long months), Back gets a line of its own above.
      function fitCorner() {
        card.classList.remove("back-row");
        center();
        const day = card.querySelector(".pf-card-day");
        if (!day) return;
        const b = corner.getBoundingClientRect();
        const left = Math.min(...[...day.children].map((p) => { const r = document.createRange(); r.selectNodeContents(p); return r.getBoundingClientRect().left; }));
        if (b.right + 8 > left && b.bottom > day.getBoundingClientRect().top) { card.classList.add("back-row"); center(); }
      }
      // Full height: the glass Back floats over whatever is under it.
      // Back floats over the card's top left corner and stays there on the screen while the card scrolls under it.
      const placeCorner = () => {
        if (openCard !== card) return; // gone back to the shifts: Back is in the window's corner again
        const narrow = window.innerWidth <= 600, row = card.classList.contains("back-row");
        corner.style.left = `${parseFloat(card.style.left) + (narrow ? 12 : 14)}px`;
        corner.style.top = `${parseFloat(card.style.top) + (row ? 12 : narrow ? 20 : 18)}px`;
      };
      // The box being typed in stays in sight above a phone's keyboard; for a start or end time, its overtime note too.
      function inSight() {
        const a = document.activeElement;
        if (!a || !card.contains(a) || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
        const note = a.closest(".field.clock") && card.querySelector(".pf-otnote:not([hidden])");
        const c = card.getBoundingClientRect(), r = a.getBoundingClientRect(), bottom = note ? note.getBoundingClientRect().bottom : r.bottom;
        if (bottom > c.bottom - 8) card.scrollTop += Math.min(bottom - c.bottom + 16, r.top - c.top - 8);
        else if (r.top < c.top + 8) card.scrollTop -= c.top - r.top + 16;
      }
      // Centered in what can be seen. When a phone's keyboard opens, what can be seen gets shorter and can also start
      // lower down (offsetTop), so the card moves with it rather than staying where the keyboard pushed the view away.
      const center = () => {
        const off = window.visualViewport ? window.visualViewport.offsetTop : 0;
        card.style.top = `${off + Math.max(12, (seen() - card.offsetHeight) / 2)}px`;
        placeCorner();
      };
      // A phone browser's toolbars slide in and out as the page scrolls: the card follows what can be seen.
      if (window.visualViewport) {
        const follow = () => {
          if (!card.isConnected) { window.visualViewport.removeEventListener("resize", follow); window.visualViewport.removeEventListener("scroll", follow); return; }
          card.style.maxHeight = `${seen() - 24}px`;
          center();
          inSight();
        };
        window.visualViewport.addEventListener("resize", follow);
        window.visualViewport.addEventListener("scroll", follow);
        card.addEventListener("input", () => requestAnimationFrame(inSight)); // the overtime note can appear as times are typed
      }
      fitCorner(); // Back's first place: beside the date, or above it
      center();
      // Customize Text First: the full form in the same card (name, times, site, pay, the message to edit, and the way to
      // send it). Back, or the phone's back gesture, returns to the text as it was.
      let form = null, formView = null;
      // The message bubble is as tall as its text, like a real text message (it grows and shrinks as it changes).
      const fitBubble = () => {
        const m = card.querySelector("#txMsg");
        if (!m) return;
        m.rows = 1; // its own minimum of 5 lines would leave room under a short text
        m.style.height = "0px";
        m.style.height = `${m.scrollHeight + 2}px`;
      };
      // Under the Start and End boxes, once both are typed: how much of those hours would be overtime, right where the
      // supervisor is looking (soft yellow), or that none would be (grey). Nothing until then: the chip above already
      // says whether the day is overtime.
      const otNote = h("p", { class: "pf-otnote", "aria-live": "polite", hidden: true });
      const setStatus = (o, timed) => {
        requestAnimationFrame(fitBubble); // called whenever the form rewrites the message
        const st = otState(o), no = !!(o && o.no);
        otNote.hidden = !timed && !no;
        otNote.classList.toggle("ot", no || st !== "open");
        otNote.textContent = no ? o.no.join(" ")
          : st === "open" ? "No overtime for these hours"
          : st === "ot" ? `All ${hoursText(o.hours)} would be overtime`
          : `${num(o.ot)} of the ${hoursText(o.hours)} would be overtime`;
      };
      // One screen of the card for another (the text, the form, the code). The card stretches from its old size to its new
      // one while what was on it fades out where it was and the new screen fades in (Oct 16: it jumped to the new size
      // in one frame, then filled in).
      const swap = (nodes, wide) => {
        const from = card.getBoundingClientRect(), top = card.scrollTop;
        const moving = !still && !!card.animate;
        let was = null;
        if (moving && card.firstChild) {
          was = h("div", { class: `${card.className} pf-was`, "aria-hidden": "true" });
          was.style.cssText = card.style.cssText;
          was.append(...card.childNodes);
          card.after(was);
          was.scrollTop = top;
        }
        card.replaceChildren(...nodes);
        fitCorner(); // where Back sits for this screen
        card.classList.toggle("pf-form", nodes === formView);
        size(wide);
        card.scrollTop = 0;
        center();
        if (!moving) return;
        const to = card.getBoundingClientRect();
        anim(card, [
          { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width}, ${from.height / to.height})` },
          { transform: "none" },
        ], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
        for (const c of card.children) anim(c, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: 130, fill: "backwards" });
        if (was) {
          const out = anim(was, [{ opacity: 1 }, { opacity: 0 }], { duration: 130, fill: "forwards" });
          out.onfinish = () => was.remove();
        }
      };
      const showSend = () => { swap(sendView, desk); goBack = toShifts; };
      function showForm() {
        if (!form) {
          form = textForm(k, info, t, () => {}, setStatus, { ctx: { ack: acked ? "none" : "" }, onSend: desk ? sendCustom : null });
          const fnotes = h("aside", { class: "note-box pf-notes" });
          fillNotes(fnotes, "form");
          card.addEventListener("input", (e) => { if (e.target.id === "txMsg") fitBubble(); });
          // The form's own "Shift:" line names the shift (no chip or clocks, Oct 15: the picker already showed them); the
          // line under the times says whether it would be overtime.
          formView = [dayHead(), fnotes.hidden ? null : fnotes, ...form.nodes].filter(Boolean);
          const clocks = form.nodes[0].querySelector(".clocks");
          if (clocks) clocks.after(otNote);
        } else { form.recall(); form.refresh(); }
        swap(formView, true);
        fitBubble();
        nav.step(pickEl, showSend);
        goBack = () => nav.back(pickEl, showSend);
      }
      // Back from the code to the form (Edit this text, Back, or the back gesture).
      const backToForm = () => { swap(formView, true); fitBubble(); goBack = () => nav.back(pickEl, showSend); };
      // Send Text Now on the form (a computer): the customized text in the texting app on the left, the code on the right.
      function sendCustom(txt) {
        const q = qrPanel();
        swap([dayHead(), h("div", { class: "pf-desk-grid" }, msgsWin(txt, "Edit this text", () => nav.back(pickEl, backToForm)), h("div", { class: "pf-desk-col pf-desk-send" }, q.el))], true);
        q.show(true);
        requestAnimationFrame(() => q.draw(txt, () => center()));
        nav.step(pickEl, backToForm);
        goBack = () => nav.back(pickEl, backToForm);
      }
      try { pickEl.focus({ preventScroll: true }); } catch (x) { /* old browser */ }
      const done = () => { growing = false; col.style.display = "none"; }; // out of sight and reach, kept for Back to the shifts
      if (still || !card.animate) { done(); return; }
      // The tapped button grows into the card; everything else in the column fades out.
      const from = slot.getBoundingClientRect(), to = card.getBoundingClientRect();
      slots.forEach((s) => s.classList.remove("bob"));
      [head, ...slots].forEach((el) => anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: el === slot ? 120 : 200, fill: "forwards" }));
      growing = true;
      const grow = anim(card, [
        { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ], { duration: 420, easing: "cubic-bezier(.2,.9,.25,1)" });
      for (const c of card.children) anim(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 200, fill: "backwards" });
      anim(corner, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 200, fill: "backwards" }); // Back arrives with the card's content
      if (grow) grow.onfinish = done; else done();
    };
    pickEl.leave = () => {
      if (closing || turning) return;
      closing = true;
      const card = openCard;
      if (card) {
        const a = !still && card.animate ? anim(card, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 180, fill: "forwards" }) : null;
        if (a) anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
        if (a) a.onfinish = () => pickEl.close(""); else pickEl.close("");
        return;
      }
      if (still || !ghost.animate) { pickEl.close(""); return; }
      slots.forEach((s) => s.classList.remove("bob"));
      anim(head, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
      anim(corner, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
      slots.forEach((s) => anim(s, [{ transform: "none", opacity: 1 }, { transform: fromTile(s), opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" }));
      const back = anim(ghost, [{ transform: "translateY(-12px) scale(1.18)", opacity: 0 }, { transform: "translateY(-12px) scale(1.18)", opacity: 1, offset: 0.5 }, { transform: "none", opacity: 1 }],
        { duration: 380, delay: 120, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" });
      // The page comes back as the day settles into it, so nothing is left to snap when the window closes.
      anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 340, delay: 160, easing: "ease-in-out", fill: "forwards" });
      if (back) back.onfinish = () => pickEl.close(""); else pickEl.close("");
    };
    if (still || !ghost.animate) {
      ghost.style.opacity = "0";
      return;
    }
    // Up off the page; then it opens into the three, each flying out of it, a beat apart; then the raised ones bob.
    anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    anim(ghost, [{ transform: "none" }, { transform: "translateY(-12px) scale(1.18)" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    anim(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 240, fill: "forwards" });
    anim(head, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 180, easing: "ease-out", fill: "backwards" });
    anim(corner, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 150, fill: "backwards" });
    slots.forEach((s, i) => {
      const a = anim(s, [{ transform: fromTile(s), opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1 }],
        { duration: 520, delay: 160 + i * 80, easing: "cubic-bezier(.2,1.25,.35,1)", fill: "backwards" });
      const done = () => s.classList.add("bob");
      if (a) a.onfinish = done; else done();
    });
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
    del(k) { try { sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
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
        h("p", { class: "u-lbl", id: `uRow-${cat}` }, label, h("span", { "aria-hidden": "true", text: ` · ${list.length}` })), // the row's name is just "Tops"
        h("div", { class: "u-strip", role: "group", "aria-labelledby": `uRow-${cat}` }, cards),
        extra ? h("p", { class: "u-hint", id: `uWhy-${cat}`, hidden: true }) : null);
    }).filter(Boolean));
  }
  // The picks as they are now: which cards are on, the Tie and Blazer rows (off when the top can't take one, and the
  // pick dropped), the "Your picks" bubbles, and the button to the mannequin.
  function syncPicker() {
    const p = uniPicked(), dropped = [];
    for (const cat of ["tie", "blazer"]) {
      const ok = !p.top || p.top[cat], row = document.querySelector(`#uRows .u-row[data-cat="${cat}"]`);
      const why = ok ? "" : `No ${cat} with the ${p.top.name.split(",")[0].trim().split(/\s+/).map(lowWord).join(" ")}.`;
      if (!ok) { if (p[cat]) dropped.push(why); uni.picks[cat] = null; p[cat] = null; }
      if (!row) continue;
      for (const b of row.querySelectorAll(".u-item")) { b.disabled = !ok; b.classList.toggle("off", !ok && !!b.dataset.id); }
      const hint = row.querySelector(".u-hint");
      hint.hidden = ok;
      hint.textContent = why;
      if (ok) row.querySelector(".u-strip").removeAttribute("aria-describedby"); else row.querySelector(".u-strip").setAttribute("aria-describedby", hint.id);
    }
    // A pick that was just dropped is said (it goes without a word otherwise: only the card they tapped has focus).
    const said = $("#uSaid");
    said.textContent = "";
    if (dropped.length) setTimeout(() => { said.textContent = dropped.join(" "); }, 100);
    for (const b of document.querySelectorAll("#uRows .u-item")) b.setAttribute("aria-pressed", String((uni.picks[b.dataset.cat] || "") === b.dataset.id));
    const box = $("#uPicks"), hadFocus = box.contains(document.activeElement);
    const bubble = (cat, x, src) => h("span", { class: "u-bubble" }, uniThumb(x, 24, 24, src), h("span", { class: "u-name", text: x.name }),
      h("button", { type: "button", class: "u-off", "data-cat": cat, "aria-label": `Take off ${x.name}`, text: "×" }));
    const list = [["top", p.top, p.top && p.tie && p.top.img2], ["pants", p.pants], ["tie", p.tie], ["blazer", p.blazer]].filter((x) => x[1]);
    box.replaceChildren(...list.map((x) => bubble(...x)), ...(!list.length ? [h("span", { class: "u-empty", text: "Nothing picked yet." })] : []));
    // Taking one off with the keyboard: on to the one that took its place (the one before, if it was the last), or the
    // first row once none are left.
    if (hadFocus && !box.contains(document.activeElement)) {
      const offs = box.querySelectorAll(".u-off"), next = offs[Math.min(uni.offAt || 0, offs.length - 1)] || $("#uRows .u-item");
      if (next) next.focus();
    }
    // The mannequin needs a top and pants: until both are picked, a line says what's still missing.
    const need = !p.top && !p.pants ? "Pick a top and pants first." : !p.top ? "Pick a top first." : !p.pants ? "Pick pants first." : "";
    $("#uSeeBtn").disabled = !!need;
    $("#uNeed").textContent = need;
    $("#uNeed").hidden = !need;
    if (need) $("#uSeeBtn").setAttribute("aria-describedby", "uNeed"); else $("#uSeeBtn").removeAttribute("aria-describedby");
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
    $("#uFrame").setAttribute("aria-label", `The mannequin wearing ${names.join("; ")}`); // the names can have commas
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
    uni.shownAt = performance.now(); // a fast second tap doesn't land on what just appeared (see wire)
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
    // A window zoomed far in can leave it out of sight: brought to the middle (with Open under the code box, mostly).
    const b = f && f.getBoundingClientRect();
    if (b && (b.bottom > window.innerHeight || b.top < 0)) try { f.scrollIntoView({ block: "center" }); } catch (e) { /* old browser */ }
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
    for (const s of [".page", "#toolbar", "#previewBar", "#uniformBtn"]) $(s).setAttribute("inert", "");
    for (const s of [".page", "#uniformBtn"]) $(s).setAttribute("aria-hidden", "true");
    uni.scroll = {};
    showUni(step);
    // Opened by a link as the page loaded, it gets no history entry (browsers add one only right after a tap): the first
    // tap or key inside adds it (see wire), so Back from here comes back to the calendar instead of leaving the page.
    uni.noEntry = !nav.step(el, hideUniform);
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
    uni.noEntry = false;
    document.documentElement.classList.remove("uni-open");
    for (const s of [".page", "#toolbar", "#previewBar", "#uniformBtn"]) $(s).removeAttribute("inert");
    for (const s of [".page", "#uniformBtn"]) $(s).removeAttribute("aria-hidden");
    if (window.pageYOffset !== uni.pageY) window.scrollTo(0, uni.pageY);
    // Focus goes back to the button, or, while it's stepped aside (or hidden), to the calendar, so it never drops to
    // the page's start.
    fabDodge();
    const fab = $("#uniformBtn"), cal = $(".page > .cal");
    const back = !fab.hidden && !fab.classList.contains("tuck") ? fab : cal;
    if (back === cal) cal.setAttribute("tabindex", "-1");
    try { back.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  }
  function closeUniform() {
    hideUniform();
    nav.closed($("#uniform"));
  }
  // "#uniform" and "#uniform-<CODE>" (a wrong or old code shows the code screen, with it filled in). The address bar
  // is cleared at once (by a line at the top of index.html, before this file has even loaded; here, if that couldn't),
  // before the calendar is in and even when My Uniform can't open, so the code isn't left in it or in a copied link.
  // Until the calendar is in, the link waits in this tab's session (a reload meanwhile, or after a
  // failed load, still opens it); once it's used, it's gone, so a later reload doesn't open My Uniform again.
  const UNI_LINK = "sa.uniformLink";
  let uniLinkWaiting = "";
  // Also with anything after it: a text that ends with the link can hand over "?", "/" or ")" with it.
  const isUniformLink = (hash) => /^#uniform(?![A-Za-z0-9])/i.test(hash);
  // The code: the letters and numbers right after "#uniform-" (spaces in it don't count).
  function linkCode(hash) {
    if (hash.charAt(8) !== "-") return "";
    let raw = hash.slice(9);
    try { raw = decodeURIComponent(raw); } catch (e) { /* as it is */ }
    return raw.match(/^[A-Za-z0-9 ]*/)[0].replace(/ /g, "").slice(0, 8).toUpperCase();
  }
  function takeUniformLink() {
    if (!isUniformLink(location.hash)) return;
    uniLinkWaiting = location.hash;
    session.set(UNI_LINK, uniLinkWaiting);
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) { /* ignore */ }
  }
  async function routeUniform() {
    takeUniformLink();
    const link = uniLinkWaiting || session.get(UNI_LINK) || "";
    if (!isUniformLink(link)) return;
    // The calendar isn't in yet (boot comes back for it), or it couldn't be read (a refresh comes back for it).
    if (!dataIn) { if (loadError && !ownerView()) toast("My Uniform isn't available right now.", 4200); return; }
    uniLinkWaiting = "";
    session.del(UNI_LINK);
    const code = linkCode(link);
    if (!uniformLive()) {
      // Not open (yet): a code that matches is still kept for this visit, so it opens unlocked once it is.
      if (code && pub.uniform.hash) { try { await tryUniformCode(code); } catch (e) { /* ask again */ } }
      if (!ownerView()) toast("My Uniform isn't available right now.", 4200);
      return;
    }
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
    document.documentElement.classList.toggle("fab-room", on); // a focused day or link is scrolled clear of it
    for (const el of document.querySelectorAll("#uniform .u-who")) { el.textContent = pub.name; el.hidden = !pub.name; }
    if (owner && preview) document.body.style.setProperty("--bar-h", `${$("#previewBar").offsetHeight}px`);
    fabCheck();
  }
  // The button floats over the page. Where it would sit on a day or a footer link (and take its tap) or on the employee
  // ID, it steps aside until they've scrolled on; at the page's end there's room for it under the links. Only the part
  // of a day that can be seen counts: a calendar that scrolls by itself (laptops) hides the rest of its weeks, and those
  // never put the button away. It checks again as that calendar scrolls, and as a box in the header opens or closes.
  let fabFrame = 0;
  // The last thing done was a key (not a tap, a click or a touch).
  let byKeys = false;
  document.addEventListener("keydown", () => { byKeys = true; }, true);
  for (const t of ["pointerdown", "mousedown", "touchstart"]) document.addEventListener(t, () => { byKeys = false; }, { capture: true, passive: true });
  function fabDodge() {
    fabFrame = 0;
    const fab = $("#uniformBtn");
    if (fab.hidden) return;
    const r = fab.getBoundingClientRect(), cal = $(".page > .cal");
    let top = -Infinity, bottom = Infinity;
    if (cal.scrollHeight > cal.clientHeight + 1) { const c = cal.getBoundingClientRect(); top = c.top + cal.clientTop; bottom = top + cal.clientHeight; }
    const under = (el) => {
      const b = el.getBoundingClientRect(), inCal = el.classList.contains("day");
      const t = inCal ? Math.max(b.top, top) : b.top, btm = inCal ? Math.min(b.bottom, bottom) : b.bottom;
      return b.width > 0 && btm > t && b.left < r.right && b.right > r.left && t < r.bottom && btm > r.top;
    };
    // Never while it has the keyboard's focus: stepping aside would drop the focus to the page. Focus the page gave it
    // back after a tap or a Back gesture doesn't keep it there (a finger's scroll never moves the focus).
    const kept = fab === document.activeElement && byKeys;
    fab.classList.toggle("tuck", !kept && Array.prototype.some.call(document.querySelectorAll("#weeks .day, .foot .linkish, .foot .empid"), under));
  }
  function fabCheck() { if (!fabFrame) fabFrame = requestAnimationFrame(fabDodge); }

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
    Page: location.href.replace(/#uniform.*$/i, ""), // never a My Uniform code
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
    fillEdit();
    $("#editSheet").openerKey = k;
    showSheet("#editSheet");
  }

  function weekLine(k) {
    const info = ownerInfo(k);
    const ws = weekStartOf(k, pub.weekStart);
    let line = `${weekLabel(ws)}: ${num(info.booked)} hrs scheduled.`;
    const shift = `One more ${num(priv.pickup)}-hr shift`;
    if (info.kind === "ot") line += ` ${shift} would reach overtime, so supervisors see yellow.`;
    else if (info.kind === "open") line += " Supervisors see green.";
    return line;
  }

  function ruleText(r) {
    const when = r.s === "work" && r.start ? `, ${fmtTime(r.start)} – ${fmtTime(r.end)}` : "";
    return `${r.s === "work" ? "Working" : "Busy"} every ${DOW_LONG[r.d]}${when}`;
  }

  // ---------- Edit Day (Oct 15) ----------
  // The shifts he works that day (filled in from Add Schedule; each can be changed or deleted, and more added), one
  // note for the day, and for each shift type two boxes that override the schedule for supervisors: Available (they can
  // request it that day) or Unavailable (they can't). Neither box: the schedule decides.
  let editRows = [], editWas = null, editSeq = 0;
  const hhmmOf = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const clockState = (t) => {
    if (!t) return { v: "", ap: null };
    const [hh, mm] = t.split(":").map(Number);
    return { v: `${hh % 12 || 12}${mm ? `:${pad(mm)}` : ""}`, ap: hh < 12 ? "am" : "pm" };
  };
  function shiftRow(orig) {
    const row = { orig };
    const n = ++editSeq;
    const changed = () => { showHrs(); onEditChange({ target: row.el }); };
    row.start = clockField(`es${n}`, "Start", changed, null);
    row.end = clockField(`ee${n}`, "End", changed, null);
    if (orig) { row.start.restore(clockState(orig.start)); row.end.restore(clockState(orig.end)); }
    // The shift as typed, or what it was while a time is half typed (an hours-only shift keeps its hours).
    row.read = () => {
      const a = row.start.mins(), b = row.end.mins();
      if (a != null && b != null && a !== b) {
        const start = hhmmOf(a), end = hhmmOf(b);
        const same = orig && orig.start === start && orig.end === end;
        return { start, end, hours: same ? orig.hours : spanHours(start, end) };
      }
      return orig || null;
    };
    const hrs = h("span", { class: "muted small shift-hrs" });
    const showHrs = () => { const r = row.read(); hrs.textContent = r ? `${num(r.hours)} hrs` : "Enter start and end"; };
    const del = h("button", { type: "button", class: "linkish shift-del", text: "Delete Shift" });
    del.addEventListener("click", () => {
      editRows = editRows.filter((x) => x !== row);
      row.el.remove();
      onEditChange({ target: del });
    });
    row.el = h("div", { class: "shift-row" }, h("div", { class: "clocks" }, row.start.el, row.end.el), h("div", { class: "shift-foot" }, hrs, del));
    showHrs();
    return row;
  }
  const pickBoxes = (t) => ({ yes: $(`#pk1-${t}`), no: $(`#pk0-${t}`) });
  function pickRow(t, v) {
    const box = (val, text) => {
      const input = h("input", { type: "checkbox", id: `pk${val}-${t}` });
      input.checked = v === val;
      input.addEventListener("change", () => { if (input.checked) $(`#pk${1 - val}-${t}`).checked = false; });
      return h("label", { class: `check pick-box ${val ? "yes" : "no"}`, for: `pk${val}-${t}` }, input, h("span", { text }));
    };
    return h("div", { class: "pick-row" },
      h("span", { class: "pick-name" }, h("b", { text: SHIFT_LABEL[t] }), h("small", { class: "muted", id: `pka-${t}` })),
      box(1, "Available"), box(0, "Unavailable"));
  }
  // The day as Edit Day now shows it.
  function editRecord() {
    const k = editKey, rule = ruleOn(k, priv);
    const shifts = editRows.map((r) => r.read()).filter(Boolean);
    const o = {};
    for (const t of SHIFT_KEYS) { const b = pickBoxes(t); if (b.yes.checked) o[t] = 1; else if (b.no.checked) o[t] = 0; }
    let rec;
    if (shifts.length) rec = Object.assign({ s: "work" }, shifts[0], { more: shifts.slice(1), note: $("#workNote").value });
    else if (editWas && (editWas.s === "busy" || editWas.s === "open")) rec = Object.assign({}, editWas);
    else if ((editWas && editWas.s === "work") || (!editWas && rule && rule.s === "work")) rec = { s: "open" }; // its shift was cancelled: a day off
    else if (!editWas && rule) rec = { s: "busy" };
    else rec = { s: "none" };
    // The sticky note belongs to the day, with or without a shift on it.
    const out = cleanPrivRec(Object.assign(rec, { o, note: $("#workNote").value }), priv.pickup);
    // An every-week day left as Settings has it keeps following Settings.
    if (!editWas && rule && out && JSON.stringify(out) === JSON.stringify(cleanPrivRec({ s: rule.s, start: rule.start, end: rule.end, hours: rule.hours }, priv.pickup))) return null;
    return out;
  }
  function refreshEdit() {
    const k = editKey, rule = ruleOn(k, priv), rec = dayRec(k, priv);
    // What the schedule alone says for each shift, beside its boxes.
    const plain = rec ? offerOf(Object.assign({}, rec, { o: null }), pub) : [];
    for (const t of SHIFT_KEYS) $(`#pka-${t}`).textContent = plain.includes(t) ? "Schedule: can request" : "Schedule: can't request";
    $("#editRuleNote").hidden = !rule;
    $("#editRuleNote").textContent = rule ? `${ruleText(rule)} (from Settings).${priv.days[k] ? " Changed for this date only." : ""}` : "";
    $("#editWeek").textContent = weekLine(k);
  }
  function fillEdit() {
    const k = editKey, rec = dayRec(k, priv);
    editWas = priv.days[k] ? clone(priv.days[k]) : null;
    editRows = workShifts(rec).map((x) => shiftRow(x));
    $("#shiftRows").replaceChildren(...editRows.map((r) => r.el));
    $("#workNote").value = rec && rec.note ? rec.note : "";
    const o = (rec && rec.o) || {};
    $("#pickRows").replaceChildren(...SHIFT_KEYS.map((t) => pickRow(t, o[t])));
    refreshEdit();
  }
  function onEditChange() {
    if (!editKey) return;
    setDay(editKey, editRecord());
    refreshEdit();
    afterChange();
  }
  function addShiftRow() {
    const row = shiftRow(null);
    editRows.push(row);
    $("#shiftRows").append(row.el);
    try { row.el.querySelector("input").focus(); } catch (e) { /* ignore */ }
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
    // Days between his dates that the list skips are days off, so they turn available (Oct 15). That waits until every
    // line reads cleanly, so a skipped line's days are never turned green.
    $("#gapBox").hidden = true;
    const gapOpen = plan.gaps.length > 0 && !errors.length;
    if (plan.gaps.length) {
      const one = plan.gaps.length === 1;
      box.append(h("p", { class: "muted small", text: errors.length
        ? "Fix the skipped lines to fill in the days between your dates."
        : `${plan.gaps.length} day${one ? "" : "s"} between your dates ${one ? "isn't" : "aren't"} in your list, so ${one ? "it" : "they"}'ll show as available.` }));
    }
    const total = n + (gapOpen ? plan.gaps.length : 0);
    $("#importApply").disabled = total === 0;
    $("#importApply").textContent = total ? `Add ${total} Day${total === 1 ? "" : "s"} to Calendar` : "Add to Calendar";
  }

  function applyImport() {
    if (!importResult) return;
    const plan = planImport(importResult);
    for (const [k, rec] of plan.final) {
      if (rec.s === "clear") setDayKeep(k, null);
      else setDayKeep(k, cleanPrivRec(Object.assign({}, rec, rec.s === "work" && rec.hours == null ? { hours: priv.pickup } : {}), priv.pickup));
    }
    const gapOpen = plan.gaps.length > 0 && !importResult.errors.length;
    if (gapOpen) for (const k of plan.gaps) setDayKeep(k, { s: "open" });
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
    renderImport();
    showSheet("#importSheet");
  }

  // ---------- owner: settings ----------
  function otExplain() {
    const end = DOW_LONG[(pub.weekStart + 6) % 7];
    return `Each pay week ends ${end} at midnight. Hours worked after that count toward the next week, and a shift that crosses midnight is split between the two weeks (an overnight you'd pick up on the last day is counted the same way). A day is green when one more ${num(priv.pickup)}-hour shift would keep its pay week at ${num(priv.otAfter)} hours or less, and yellow when any of that shift would be overtime. On a yellow day, each shift button says how many hours until overtime. Hours past ${num(priv.otAfter)} are overtime, not ${num(priv.otAfter)} itself. Supervisors see each week's scheduled hours, and their texts say how many hours would be overtime. Those numbers are exact, so an overnight on a pay week's last day can show when it starts.`;
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
  // The built-in night-shift note is hidden for good (his choice, Oct 15): only his own notes, Note 1, Note 2, ...
  // It stays in the saved data so older files and drafts still read, but never shows anywhere.
  const noteTabs = () => pub.notes.filter((n) => !n.auto);
  const noteTitle = (n) => (n.auto ? "Night shifts" : `Note ${pub.notes.filter((x) => !x.auto).indexOf(n) + 1}`);
  const openNote = () => pub.notes.filter((n) => n.id === noteSel)[0] || null;
  function renderNotes() {
    const list = noteTabs();
    // The open note is gone (deleted in another tab): the first tab opens, and if he was in the note's fields, focus
    // goes to its tab, so what he types next never lands in another note.
    let lost = false;
    if (!list.some((n) => n.id === noteSel)) { lost = !!noteSel && $("#noteEdit").contains(document.activeElement); noteSel = list.length ? list[0].id : ""; }
    const n = openNote();
    renderNoteTabs(list);
    if (lost) try { (noteSel ? $(`#noteTab-${noteSel}`) : $("#noteAdd")).focus(); } catch (e) { /* ignore */ }
    $("#noteAdd").hidden = ownNotes(pub.notes) >= NOTES_MAX;
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
  // The tabs are only redrawn when one of them changed: leaving the text box after typing redraws them, and a tab
  // redrawn under a finger or mouse that's pressing it would lose that tap.
  let noteTabsKey = "";
  function renderNoteTabs(list) {
    const tabs = $("#noteTabs"), focused = tabs.contains(document.activeElement);
    const lit = (x) => PLACES.some((p) => x[p]) && noteLive(x);
    const key = JSON.stringify(list.map((x) => [x.id, noteTitle(x), x.id === noteSel, lit(x)]));
    if (key === noteTabsKey && tabs.children.length === list.length) return;
    noteTabsKey = key;
    // The light, said: it's only drawn.
    tabs.replaceChildren(...list.map((x) => h("button", { type: "button", role: "tab", class: "note-tab", id: `noteTab-${x.id}`, "data-id": x.id,
      "aria-selected": String(x.id === noteSel), "aria-controls": "noteEdit", tabindex: x.id === noteSel ? "0" : "-1", "aria-label": `${noteTitle(x)}, ${lit(x) ? "showing" : "not showing"}` },
    h("span", { class: lit(x) ? "pip" : "pip off", "aria-hidden": "true" }), noteTitle(x))));
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
    if (ownNotes(pub.notes) >= NOTES_MAX) return;
    // A new id, also unlike the notes deleted since the last save and before (noteTop), so a change to a deleted note
    // can't land on it.
    const n = { id: `n${Math.max(noteTop, ...pub.notes.map(noteNum), ...(saved ? saved.pub.notes.map(noteNum) : [])) + 1}`, text: "", until: "", front: true, day: false, form: false };
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
  // from when Settings opened. Nor does an empty box when that one couldn't be read here (the box started empty): only
  // a new code replaces it.
  // A code too short to use is said once he leaves the box (left), not at the first letter of every new code he types.
  function readUniCode(t, left) {
    const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (v !== t.value) { const at = Math.min(t.selectionStart || v.length, v.length); t.value = v; try { t.setSelectionRange(at, at); } catch (e) { /* ignore */ } }
    const code = cleanCode(v), bad = !!v && !code, err = $("#uniCodeError");
    if (!bad) err.hidden = true;
    else if (left) err.hidden = false;
    t.setAttribute("aria-invalid", String(!err.hidden));
    if (code || (!v && uniAtOpen.code)) setUniformCode(code);
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
    // The focus stays on the button, so the new code is said (the box and the link changed out of sight of a screen reader).
    uniSay(`New code ${input.value.split("").join(" ")}. It works for supervisors once you tap Save.`);
  }
  // The "couldn't read the code" line: the box starts empty there, so emptying it can't turn My Uniform off. This does.
  function uniTurnOff() {
    if (uniLocked()) return;
    uniAtOpen = { code: "", hash: "" }; // a half-typed code now falls back to off
    $("#setUniCode").value = "";
    readUniCode($("#setUniCode"));
    afterChange();
    try { $("#setUniCode").focus(); } catch (e) { /* ignore */ }
    uniSay("My Uniform is off. Supervisors stop seeing it once you tap Save.");
  }
  // Said to screen readers (Settings → My Uniform's status line, out of sight).
  const uniSay = (text) => { const el = $("#uniSaid"); el.textContent = ""; setTimeout(() => { el.textContent = text; }, 50); };
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
    // Not the box he's in, nor one still holding a code too short to use (it keeps what he typed, and its line, as the
    // email box does).
    if (document.activeElement !== input && $("#uniCodeError").hidden) input.value = priv.uniformCode;
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
    // A new code (or one a save didn't get into the public file) opens it for supervisors only once it's saved.
    $("#uniLinkWait").hidden = !link || pub.uniform.hash === pubHash;
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
  // While it uploads, the window stays open (Cancel, ×, Escape and a tap outside wait), so the item isn't lost. Save Item
  // only says it's off (saveItem waits): a disabled button would drop the keyboard's focus to the page.
  function syncItemBusy() {
    const busyNow = !!(ed && ed.busy);
    $("#itemSave").setAttribute("aria-disabled", String(busyNow));
    $("#itemSave").textContent = busyNow ? "Uploading…" : "Save Item";
    for (const s of ["#itemDelete", "#itemCancel", "#itemSheet .x"]) $(s).disabled = busyNow;
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
      src ? null : h("p", { class: "fit-empty" }, h("span", { text: "Pick a drawing to see it here." }))].filter(Boolean));
    frame.classList.toggle("empty", !src);
    $("#itemSize").value = String(Math.round(it.fit.s * 100));
    $("#itemSize").disabled = !src;
    $("#itemReset").disabled = !src;
    frame.tabIndex = src ? 0 : -1; // nothing to move yet, like the size slider
    frame.setAttribute("aria-disabled", String(!src));
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
    // Its buttoned-up drawing (new, or the one it had). Turning the tie switch off here drops it; one it had with the switch
    // already off (from an older file) stays as it was.
    const keep2 = f.img2 === false ? null : tie ? f.img2 || it.img2 || null : mine.was && !mine.was.tie ? it.img2 || null : null;
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
        if (ed === mine) { syncItemBusy(); fail(uploadError(e)); } else toast(uploadError(e), 6000);
        return;
      }
    }
    await whenFree(); // a reload or merge under way finishes first, so it doesn't drop this
    // The window stays open while it uploads, but a phone's Back can still close it: the item is then saved all the same.
    const open = ed === mine;
    mine.busy = false;
    const item = cleanUniformItem(Object.assign({}, it, { id, img, img2 }));
    if (!item) { if (open) { syncItemBusy(); fail("Couldn't save this item. Check its drawing and name, then try again."); } return; }
    const list = pub.uniform.items.slice(), at = mine.was ? list.findIndex((x) => x.id === mine.was.id) : -1;
    let said = `Item ${mine.was ? "updated" : "added"}. Tap Save to show supervisors.`;
    // Deleted in another tab or on another device since it opened: its drawings went with it, so it doesn't come back.
    if (mine.was && at < 0) said = "This item was deleted in another tab or on another device, so your changes to it weren't kept.";
    else if (mine.was && same(item, mine.was)) said = ""; // nothing changed
    else if (at < 0 && list.length >= UNIFORM_MAX) said = `My Uniform holds ${UNIFORM_MAX} items (another tab or device added some), so this one wasn't added. Delete one, then add it again.`;
    else {
      if (at >= 0) list[at] = item; else list.push(item);
      pub.uniform = { hash: pub.uniform.hash, items: list };
    }
    if (open) {
      itemFocus = uniformItemIn(pub, item.id) ? item.id : "";
      ed = null;
      $("#itemSheet").close("");
    }
    afterChange();
    renderUniSettings();
    if (said) toast(said, 4200);
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
    for (const key of draftKeys()) {
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
      // One uploaded here in the last minutes may belong to an item a Save Item is still adding (in this tab or another).
      const fresh = mine[path] && Date.now() - mine[path] < 10 * 60000;
      // With no clothes saved, an old file may be one of a list an older copy of the page dropped: it stays.
      const old = saved.pub.uniform.items.length && !(Date.now() - made < 30 * 86400000);
      if (!(was[path] || (mine[path] && !fresh) || old)) continue; // maybe another device's unsaved item
      try { await gh("DELETE", `/contents/${path}`, { message: "Remove unused uniform image", sha: file.sha }); gone.push(path); } catch (e) { /* next time */ }
    }
    forget(gone);
  }
  // Edit mode: a drawing the site doesn't have yet (uploaded a moment ago, here or on another device) comes from GitHub.
  const fromApi = {};
  function onImgError(e) {
    const img = e.target;
    if (!img || img.tagName !== "IMG") return;
    if (img.classList.contains("u-layer")) img.classList.add("gone"); // hidden until it loads (see wire)
    if (!owner || !token) return;
    const path = img.getAttribute("src") || "";
    if (!/^uniform\/[A-Za-z0-9-]+\.(png|webp|jpe?g)$/.test(path) || uniformMem[path] || fromApi[path]) return;
    fromApi[path] = apiDrawing(path).then((blob) => {
      uniformMem[path] = URL.createObjectURL(blob);
      for (const x of document.querySelectorAll(`img[src="${path}"]`)) x.src = uniformMem[path];
    }).catch(() => { /* stays empty */ });
  }

  let fbAtOpen = "";
  let potAtOpen = { from: "", to: "" };
  // Another tab saved while Settings is open: a half-typed email, P-OT range or code then keeps what's saved now, not
  // what was saved when Settings opened (unless he'd changed it here before). was: the saved settings before.
  function atOpenAfter(was) {
    if (same(fbAtOpen, was.pub.feedback)) fbAtOpen = saved.pub.feedback;
    if (same(potAtOpen, { from: was.pub.potFrom, to: was.pub.potTo })) potAtOpen = { from: saved.pub.potFrom, to: saved.pub.potTo };
    if (same(uniAtOpen, { code: was.priv.uniformCode, hash: was.pub.uniform.hash })) uniAtOpen = { code: saved.priv.uniformCode, hash: saved.pub.uniform.hash };
  }
  // Settings' boxes show the settings as they are here. rebased: another tab's save came in while Settings is open, so
  // every box shows its saved value now (or this tab's own change on top), except the one he's in and one still holding
  // a half-typed email or P-OT range (those keep what he typed). Otherwise a box left showing the old value, such as a
  // shift checkbox, would put it back with his next change.
  function fillSettings(rebased) {
    const put = (id, v) => { const el = $(id); if (!rebased || el !== document.activeElement) el.value = v; };
    put("#setCallHours", num(pub.callHours));
    put("#setName", pub.name);
    put("#setStatus", pub.status);
    put("#setLed", pub.led);
    for (const c of ["yellow", "red"]) $("#statusMock").classList.toggle(`led-${c}`, pub.led === c);
    put("#setEmpId", pub.empId);
    put("#setPhone", pub.phone);
    put("#setLicName", pub.licName);
    put("#setLicNo", pub.licNo);
    put("#setLicIssued", pub.licIssued);
    put("#setLicExpires", pub.licExpires);
    if (!rebased || $("#setFeedbackError").hidden) put("#setFeedback", pub.feedback);
    put("#setWeekEnd", String((pub.weekStart + 6) % 7));
    put("#setOt", num(priv.otAfter));
    put("#setPickup", num(priv.pickup));
    put("#setNightStart", pub.nightStart);
    $("#otExplain").textContent = otExplain();
    if (!rebased || $("#setPotError").hidden) put("#setPotStart", pub.potFrom ? `${hhmm24(pub.potFrom)}-${hhmm24(pub.potTo)}` : "");
    put("#setPotMax", pub.potMax ? num(pub.potMax) : "");
    if (rebased) for (const x of SHIFT_KEYS) { const c = $(`#sw-${x}`); if (c) c.checked = pub.willing.includes(x); }
    else $("#setWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`sw-${x}`, x, pub.willing.includes(x))));
  }
  // Settings' sections in the order he dragged them into (priv.secOrder, saved with his settings so every device
  // matches). Sections it doesn't name keep their place after the ones it does.
  const foldGroups = () => [...document.querySelectorAll("#settingsSheet [data-sec]")];
  function applySecOrder() {
    const list = foldGroups(), order = priv.secOrder || [];
    if (!list.length) return;
    const end = list[list.length - 1].nextSibling, parent = list[0].parentNode;
    const rank = (g) => { const i = order.indexOf(g.dataset.sec); return i < 0 ? order.length + list.indexOf(g) : i; };
    for (const g of [...list].sort((a, b) => rank(a) - rank(b))) parent.insertBefore(g, end);
  }
  // Press the grip and drag up or down: the section moves past the ones it's dragged over. Works with a finger too.
  // While dragging (Oct 15): the section lifts and follows the pointer, a grey dotted outline marks where it will land,
  // and the other sections slide out of its way. Letting go drops it into the outline.
  function dragSection(g, grip) {
    let slot = null, startY = 0, top0 = 0, startX = 0, left0 = 0, scroller = null, before = "", last = null, tick = 0;
    // The box that really scrolls around the sections (the Settings window itself, as it turns out).
    const scrollBox = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
      }
      return document.scrollingElement || document.documentElement;
    };
    const tiled = () => $("#secList").classList.contains("tiles");
    const others = () => foldGroups().filter((o) => o !== g && !o.hidden);
    // Slides each section from where it was to where it is now.
    const glide = (list, from) => list.forEach((o, i) => {
      const r = o.getBoundingClientRect(), dx = from[i].left - r.left, dy = from[i].top - r.top;
      if (!dx && !dy) return;
      o.style.transition = "none";
      o.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { o.style.transition = "transform 0.18s ease"; o.style.transform = ""; });
    });
    // Held near the top or bottom edge, Settings keeps scrolling (faster nearer the edge), even while the finger is still
    // (Oct 15 audit: it only scrolled while the finger moved, so on a small phone a section couldn't reach the top).
    const edgeScroll = () => {
      tick = 0;
      if (!last) return;
      const box = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const zone = 70, up = box.top + zone - last.clientY, down = last.clientY - (box.bottom - zone);
      const step = up > 0 ? -Math.ceil(up / 4) : down > 0 ? Math.ceil(down / 4) : 0;
      if (step) {
        const was = scroller.scrollTop;
        scroller.scrollTop += step;
        if (scroller.scrollTop !== was) place(last);
      }
      tick = requestAnimationFrame(edgeScroll);
    };
    const move = (e) => {
      last = { clientX: e.clientX, clientY: e.clientY };
      place(last);
    };
    const place = (e) => {
      g.style.top = `${top0 + e.clientY - startY}px`;
      if (tiled()) g.style.left = `${left0 + e.clientX - startX}px`;
      const list = others(), from = list.map((o) => o.getBoundingClientRect());
      let target = null;
      for (const o of list) {
        const r = o.getBoundingClientRect();
        // A list: above a section's middle. Tiles: on an earlier row, or on its row left of its middle.
        const ahead = tiled() ? e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) : e.clientY < r.top + r.height / 2;
        if (ahead) { target = o; break; }
      }
      const where = target ? target : list[list.length - 1].nextSibling;
      if (slot.nextSibling === where || slot === where) return;
      if (target) target.before(slot); else list[list.length - 1].after(slot);
      glide(list, from);
    };
    const stop = () => {
      cancelAnimationFrame(tick);
      tick = 0;
      last = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      const from = g.getBoundingClientRect();
      slot.replaceWith(g);
      g.classList.remove("dragging");
      document.documentElement.classList.remove("sec-dragging");
      Object.assign(g.style, { position: "", top: "", left: "", width: "", zIndex: "" });
      glide([g], [from]);
      const now = foldGroups().map((x) => x.dataset.sec).join();
      if (now !== before) { priv.secOrder = now.split(","); afterChange(); }
      g.dragged = now !== before;
      setTimeout(() => { g.dragged = false; }, 0); // after the click that ends a drag
    };
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      scroller = scrollBox(g);
      before = foldGroups().map((x) => x.dataset.sec).join();
      const r = g.getBoundingClientRect();
      slot = h("div", { class: "fold-slot", "aria-hidden": "true" });
      slot.style.height = `${r.height}px`;
      g.before(slot);
      startY = e.clientY; top0 = r.top; startX = e.clientX; left0 = r.left;
      g.classList.add("dragging");
      document.documentElement.classList.add("sec-dragging");
      try { window.getSelection().removeAllRanges(); } catch (x) { /* ignore */ }
      Object.assign(g.style, { position: "fixed", top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, zIndex: "50" });
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      last = { clientX: e.clientX, clientY: e.clientY };
      tick = requestAnimationFrame(edgeScroll);
    });
  }
  // A small picture for each section, shown on its tile.
  const SEC_ICONS = {
    info: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.3-7 8-7s7 2.5 8 7"/>',
    offer: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
    status: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    weekly: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    notes: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h6"/>',
    license: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2.2"/><path d="M4.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h5M14 13.5h3.5"/>',
    uniform: '<path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3z"/>',
    creds: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><circle cx="12.5" cy="13" r="3"/><path d="M11 15.5l-1 4 2.5-1.3 2.5 1.3-1-4"/>',
    feedback: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    payweek: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h3M7 17.5h3M14 14h3M14 17.5h3"/>',
    shifttimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    pot: '<circle cx="12" cy="12" r="9"/>',
  };
  function secIcon(k) {
    const el = h("span", { class: "fold-icon", "aria-hidden": "true" });
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SEC_ICONS[k] || ""}</svg>`;
    return el;
  }
  // List or tiles, as he last picked (saved with his settings).
  function showView() {
    const tiles = priv.secView !== "list";
    $("#secList").classList.toggle("tiles", tiles);
    for (const b of document.querySelectorAll(".view-pick .vp")) b.setAttribute("aria-pressed", String((b.dataset.view === "tiles") === tiles));
  }
  function openSettings() {
    noteSel = "";
    renderNotes();
    uniAtOpen = { code: priv.uniformCode, hash: pub.uniform.hash };
    $("#uniCodeError").hidden = true;
    $("#setUniCode").setAttribute("aria-invalid", "false");
    $("#setUniCode").value = priv.uniformCode;
    renderUniSettings();
    fbAtOpen = pub.feedback;
    $("#setFeedbackError").hidden = true;
    $("#fbTestResult").hidden = true;
    renderCred();
    if (!credBusy && (credInfo === undefined || credError)) loadCredInfo();
    $("#setPotError").hidden = true;
    potAtOpen = { from: pub.potFrom, to: pub.potTo };
    fillSettings(false);
    applySecOrder();
    showView();
    renderWeekly();
    $("#repoLine").textContent = `Saves to github.com/${REPO.owner}/${REPO.name}`;
    showSheet("#settingsSheet");
    fitNoteText();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.closest && t.closest("#noteEdit")) { if (!editNote(t)) return; }
    else if (t.id === "setCallHours") { const n = Number(t.value); if (t.value.trim() !== "" && n >= 0 && n <= 48) pub.callHours = n; }
    else if (t.id === "setLed") pub.led = ["green", "yellow", "red"].includes(t.value) ? t.value : "green";
    else if (t.id === "setStatus") pub.status = t.value.trim().slice(0, 60);
    else if (t.id === "setName") pub.name = t.value.trim().slice(0, 40);
    else if (t.id === "setEmpId") pub.empId = t.value.trim().slice(0, 20);
    else if (t.id === "setPhone") pub.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setLicName") pub.licName = t.value.trim().slice(0, 60);
    else if (t.id === "setLicNo") pub.licNo = t.value.trim().slice(0, 40);
    else if (t.id === "setLicIssued") pub.licIssued = isDay(t.value) ? t.value : "";
    else if (t.id === "setLicExpires") pub.licExpires = isDay(t.value) ? t.value : "";
    else if (t.id === "setUniCode") { if (uniLocked()) return; readUniCode(t, e.type === "change"); }
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
    else if (t.id === "setNightStart") pub.nightStart = isTime(t.value) ? t.value : "";
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
  // Whether the public file is behind the hours (the private settings) it's built from, as a save that stopped after
  // storing the hours leaves it: the days from today on, the every-week days, and the hours left before overtime in the
  // weeks that matter (read: the hours could be read; a schedule rebuilt from the public file has none to compare).
  function fileBehind(file, v, read) {
    const p = file.pub, today = todayKey();
    const upcoming = (days) => JSON.stringify(Object.keys(days).filter((k) => k >= today).sort().map((k) => [k, days[k]]));
    const derived = derivePublic(p, v), weeks = pubWeeks(p, derived);
    const nearOt = (o) => (o ? JSON.stringify([o.shift, weeks.map((w) => [w in o.left ? o.left[w] : null, o.hrs && w in o.hrs ? o.hrs[w] : null])]) : "");
    const otBehind = read && nearOt(file.ot) !== nearOt(derivePublicOt(p, v, derived));
    return !!file.migrated || upcoming(file.days) !== upcoming(derived) || !same(file.weekly, weeklyPublic(v)) || otBehind;
  }
  // The private settings also keep a copy of the notes and My Uniform clothes his last save in this version had (pubCopy,
  // see save). An older copy of this page leaves both out of the public file when it saves, but it keeps settings it
  // doesn't know in the private ones, so the copy is still there. Like his hours, the copy wins where the file doesn't
  // have what it says, and the file needs publishing again.
  async function loadOwnerState(tok) {
    const [pubRes, privRes] = await Promise.all([getPublicRemote(tok), getPrivateRemote(tok)]);
    const file = readPublicFile(pubRes.raw);
    let p = file.pub, v, parsed = null;
    if (privRes.status === 200) {
      try { parsed = JSON.parse(privRes.value); } catch { /* unreadable: rebuild below */ }
      if (!parsed || typeof parsed !== "object") parsed = null;
      v = parsed ? normalizePriv(parsed) : file.migrated ? file.migrated.priv : privFromPublicDays(file.days, file.weekly);
    } else {
      v = file.migrated ? file.migrated.priv : privFromPublicDays(file.days, file.weekly);
    }
    // Older copies of this page don't know every-week days and save without them. The new version always writes the key.
    const weeklyLost = privRes.status === 200 && !/"weekly"\s*:/.test(privRes.value || "");
    // Nor his notes or My Uniform, which they leave out of the public file (this version always writes both).
    const raw = pubRes.raw && typeof pubRes.raw === "object" ? pubRes.raw : {};
    const pubLost = raw.v === 2 && (!Array.isArray(raw.notes) || !raw.uniform || typeof raw.uniform !== "object");
    // The copy is newer than the file when the file lost them, or when the private settings were saved after it (a save
    // writes the same rev into both, private first: the public part of his last save didn't go through). Only a save by an
    // older copy (both with one rev) took them off his page; that's said (lostWhat, for lostText).
    const copy = parsed && parsed.pubCopy && typeof parsed.pubCopy === "object" && Array.isArray(parsed.pubCopy.notes) ? parsed.pubCopy : null;
    if (copy && Number(copy.noteTop) > 0 && Number(copy.noteTop) < 1e4) noteTop = Math.max(noteTop, Math.floor(Number(copy.noteTop)));
    const lostWhat = [], dropped = [];
    let copyBehind = false;
    if (copy && (pubLost || parsed.rev !== raw.rev)) {
      const older = pubLost && typeof raw.rev === "string" && raw.rev === parsed.rev;
      let notes = cleanNotes(copy.notes);
      // A note the older copy added (its one note) stays too. (Otherwise the copy is just newer: what isn't in it was deleted.)
      // One that no longer fits (he has 10 of his own) is named with its whole text (dropped, see fullText).
      if (older) {
        const texts = notes.map((n) => n.text), added = p.notes.filter((n) => !n.auto && texts.indexOf(n.text) < 0);
        notes = cleanNotes(notes.filter((n) => !n.auto).concat(added, notes.filter((n) => n.auto)));
        const kept = notes.map((n) => n.text);
        for (const n of added) if (kept.indexOf(n.text) < 0) dropped.push(n.text);
      }
      const core = (list, own) => list.filter((n) => !n.auto === own).map((n) => Object.assign({}, n, { id: "" }));
      if (!same(core(notes, true), core(p.notes, true))) lostWhat.push("notes");
      else if (!same(core(notes, false), core(p.notes, false))) lostWhat.push("night"); // only the night-shift note differs
      if (!same(notes, p.notes)) { p.notes = notes; copyBehind = true; }
      const items = cleanUniform({ items: copy.items }).items;
      if (!same(items, p.uniform.items)) { if (items.length) lostWhat.push("My Uniform clothes"); p.uniform = { hash: p.uniform.hash, items }; copyBehind = true; }
      if (!older) { lostWhat.length = 0; dropped.length = 0; }
    }
    // The private schedule is the source of truth and the public file is built from it. If they differ
    // (a save stopped after storing the hours), the public file just needs publishing again.
    // My Uniform's code and its hash go together. A save that stopped after the private settings (or an older copy of
    // this page, which leaves My Uniform out of the public file) leaves the file with another code's hash, or none: the
    // code he has wins, as his hours do, and the file needs publishing again. So does a code he turned off ("" in the
    // private settings; a code this version couldn't read is left out of them, and the file's hash then stays).
    const pubHash = p.uniform.hash;
    const wanted = v.uniformCode ? codeHash(v.uniformCode) : parsed && parsed.uniformCode === "" ? "" : pubHash, hashBehind = wanted !== pubHash;
    if (hashBehind) p.uniform = { hash: wanted, items: p.uniform.items };
    const behind = fileBehind(file, v, privRes.status === 200) || hashBehind || copyBehind;
    return { weeklyLost, lostWhat, dropped, pub: p, priv: v, pubHash, pubSha: pubRes.sha, privAt: privRes.updatedAt || null, privExists: privRes.status === 200, privAccess: privRes.status !== 403, updated: file.updated, behind };
  }
  // What an older open copy of this page left out when it saved: every-week days (from the private settings: this device's
  // last copy of them puts them back, as unsaved changes), and the notes and My Uniform's clothes (the private settings'
  // copy put them back already, see loadOwnerState). Returns what came back, for lostText.
  function putBackLost(st) {
    const back = [];
    try {
      const last = cleanWeekly(JSON.parse(store.get(LS.lastWeekly) || "[]"), priv.pickup);
      if (st.weeklyLost && last.length && !priv.weekly.length) { priv.weekly = last; back.push("every-week days"); }
      else if (!st.weeklyLost) store.set(LS.lastWeekly, JSON.stringify(st.priv.weekly));
    } catch { /* unreadable */ }
    return back.concat(st.lostWhat);
  }
  // lostText, then the note the older copy added that didn't fit (st: from loadOwnerState), with its whole text.
  const lostSaid = (st, back, kept) => [lostText(back, kept), fullText({ notes: st.dropped || [], items: [] })].filter(Boolean).join(" ");
  // back: what came back ("night": his night-shift note, which the older copy changed rather than removed).
  function lostText(back, kept) {
    const gone = back.filter((x) => x !== "night"), night = back.indexOf("night") >= 0;
    const what = [gone.length ? `removed your ${gone.length > 1 ? `${gone.slice(0, -1).join(", ")} and ${gone[gone.length - 1]}` : gone[0]}` : "", night ? "changed your night-shift note" : ""].filter(Boolean).join(" and ");
    const after = gone.length ? (kept ? "They're back, and saved." : "They're back here. Tap Save to keep them.") : kept ? "It's back as you had it, and saved." : "It's back as you had it here. Tap Save to keep it.";
    return `An older open copy of this page ${what} when it saved. ${after}`;
  }

  async function enterOwner() {
    busy = true;
    try {
      const st = await loadOwnerState(token);
      owner = true;
      brush = "edit"; // the tap tools are gone (Oct 15): tapping a day always opens Edit Day
      saved = { pub: clone(st.pub), priv: clone(st.priv) };
      pubSha = st.pubSha;
      privAt = st.privAt;
      privExists = st.privExists;
      privAccess = st.privAccess;
      standIn = !st.privAccess;
      needsPublish = st.behind;
      pubHash = st.pubHash;
      updated = st.updated;
      pub = clone(st.pub);
      priv = clone(st.priv);
      dataIn = true;
      store.del(LS.draft2); // from a test build; never stored real data
      forgetAutoCopies();
      const back = putBackLost(st), was = JSON.stringify([pub, priv]);
      let restored = false;
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
        for (const key of draftKeys()) {
          if (key === OWN_DRAFT) continue;
          try {
            const d = JSON.parse(store.get(key));
            if (d && typeof d === "object" && Date.now() - (d.ts || 0) < 30 * 86400000) drafts.push(d);
          } catch { /* unreadable */ }
          store.del(key);
        }
        drafts.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        let skipped = 0, replaced = 0;
        const full = { notes: [], items: [] };
        // Unsaved changes made on the replaced Oct 12-13 copy (it kept a "pickups" list) follow different rules,
        // so they aren't guessed at; he's told to check those days instead.
        for (const d of drafts) {
          if (d.pickups) { replaced++; continue; }
          const r = applyDiff(d, true);
          skipped += r.skipped; full.notes.push(...r.full.notes); full.items.push(...r.full.items);
        }
        // Only what the unsaved changes brought (not what was put back above).
        restored = JSON.stringify([pub, priv]) !== was;
        const said = [skipped ? `${skipped} unsaved change${skipped === 1 ? " was skipped because it was" : "s were skipped because they were"} saved differently from somewhere else since.` : "", fullText(full)].filter(Boolean).join(" ");
        if (said) setTimeout(() => toast(said, 6000), 3500);
        if (replaced) setTimeout(() => toast("Changes you hadn't saved on the Oct 12-13 version of this site couldn't be brought back. Check the days you changed then.", 8000), said ? 10000 : 3500);
      }
      if (back.length) setTimeout(() => toast(lostSaid(st, back), 8000), 600);
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
      return { restored };
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
    $("#unlockDraft").hidden = !(draftKeys().length || store.get(LS.oldDraft) || store.get(LS.importText));
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

  // The private variable's contents, trimmed of old days if it would be too big for GitHub. copy: see pubCopy (save).
  function privatePayload(v, ws, copy) {
    const today = todayKey();
    // Even when space is short, the day before this pay week stays: an overnight on it runs into this week's hours.
    for (const cutoff of [addDays(today, -60), addDays(today, -14), addDays(weekStartOf(today, ws), -1)]) {
      const out = Object.assign({}, v, { v: 2, rev: "", days: {} }, copy ? { pubCopy: copy } : {});
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

  // Returns true once both are saved.
  async function save(force) {
    if (saving) return false;
    if (!privAccess) { showSheet("#keySheet"); return false; }
    // Work from a snapshot, so edits made while saving stay as unsaved changes.
    const snapPub = clone(pub);
    const top = Math.max(noteTop, ...snapPub.notes.map(noteNum), ...saved.pub.notes.map(noteNum));
    const payload = privatePayload(clone(priv), snapPub.weekStart, { notes: snapPub.notes, items: snapPub.uniform.items, noteTop: top });
    if (!payload) { toast("Your calendar has too many days to save. Clear some far-off days and try again.", 6000); return false; }
    saving = true;
    renderOwnerBits();
    const stamp = new Date().toISOString();
    const rev = `${stamp}~${Math.random().toString(36).slice(2, 6)}`;
    const pubDaysOut = derivePublic(snapPub, payload.priv);
    const pubOut = Object.assign({ v: 2 }, snapPub, { days: pubDaysOut, weekly: weeklyPublic(payload.priv), ot: derivePublicOt(snapPub, payload.priv, pubDaysOut), updated: stamp, rev });
    // The private settings keep a copy of the notes and clothes the public file gets (pubCopy, see loadOwnerState). A code
    // this device couldn't read (the file has a hash, the private settings no code) is left out, so it isn't taken for
    // one he turned off.
    const privOut = Object.assign(JSON.parse(payload.text), { rev });
    if (!payload.priv.uniformCode && snapPub.uniform.hash) delete privOut.uniformCode;
    const privText = JSON.stringify(privOut);
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
      // Hours first: they're the source of truth. If the public file then fails, the next load republishes it (notes and
      // clothes too: their copy went with the hours). The other public settings are only in that file, so until it's
      // written they stay unsaved changes, kept in this tab's draft like any other: a reload then doesn't lose them.
      stage = "private";
      lastPrivText = privText;
      await writePrivate(privText, force);
      for (const k of Object.keys(priv.days)) if (k < payload.cutoff) delete priv.days[k];
      saved = { pub: before.pub, priv: payload.priv };
      needsPublish = fileBehind(readPublicFile(remotePub.raw), payload.priv, true); // as the next visit would count it
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
      saved = { pub: snapPub, priv: payload.priv };
      pubHash = snapPub.uniform.hash;
      updated = stamp;
      needsPublish = false;
      pruneOtherDrafts();
      forgetAutoCopies();
      handed = null; // what this tab still had of them is saved now
      noteTop = Math.max(noteTop, top);
      store.set(LS.lastWeekly, JSON.stringify(saved.priv.weekly));
      store.set(LS.savedSignal, rev); // other open tabs rebase on this save
      toast("Saved. Supervisors will see it within a minute or two.", 4200);
      cleanUniformFiles(before).catch(() => { /* best effort */ });
      return true;
    } catch (e) {
      if (e.conflict || (stage === "private" && e.status === 409)) showSheet("#conflictSheet");
      else if (e.key || (stage === "private" && e.status === 403)) { privAccess = false; showSheet("#keySheet"); }
      else if (e.status === 401) toast("GitHub no longer accepts your key. Open Settings, tap Stop Editing on This Device, then connect again.", 6000);
      else if (stage === "private" && e.status === 422) toast("GitHub wouldn't store your hours. Clear some far-off days and tap Save again.", 7000);
      else if (stage === "public" && (e.status === 403 || e.status === 404)) toast("Your hours are saved, but your key can't update the calendar file. On GitHub, set the token's Contents permission to Read and write.", 7000);
      else if (stage === "public") toast("Your hours are saved, but the public calendar didn't update. Tap Save again.", 6000);
      else toast("Couldn't save. Check your connection and tap Save again.", 5000);
      return false;
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
    const back = putBackLost(st);
    const full = fullText(applyDiff(mine, false).full);
    pubSha = st.pubSha;
    privAt = st.privAt;
    privExists = st.privExists;
    needsPublish = st.behind;
    pubHash = st.pubHash;
    busy = false;
    persistDraft();
    render();
    // Said once it's saved (a failed save says so instead, and what came back stays as unsaved changes).
    if ((await save(false)) && (back.length || full)) toast(["Saved.", back.length ? lostSaid(st, back, true) : "", full].filter(Boolean).join(" "), 9000);
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
    // The key could read his schedule all along (only saving was off): keep it as it is here, with his unsaved changes.
    if (!standIn) {
      privAccess = true;
      render();
      if ($("#settingsSheet").open) {
        renderUniSettings();
        // Show Me How, which the closed steps gave the focus back to, is gone now: on to the code box it unlocked.
        const a = document.activeElement;
        if (!a || a === document.body || $("#uniLocked").contains(a)) try { $("#setUniCode").focus(); } catch (e) { /* ignore */ }
      }
      toast("Your key is set.");
      return;
    }
    const res = await enterOwner(); // loads the real schedule (rebuilt from the public file until now) and any draft saved before
    if (owner && !res.restored) toast("Your key is set.");
  }

  // ---------- wiring ----------
  function wire() {
    for (const el of document.querySelectorAll(".repo-name")) el.textContent = REPO.name;
    for (const x of document.querySelectorAll(".sheet .x")) {
      x.type = "button";
      x.addEventListener("click", () => { const d = x.closest("dialog"); if (!held(d)) d.close(""); });
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
    $("#itemSheet").held = () => !!(ed && ed.busy);
    for (const d of document.querySelectorAll("dialog.sheet")) {
      d.addEventListener("click", (e) => { if (e.target === d && !held(d)) d.close(""); });
      d.addEventListener("cancel", (e) => { if (held(d)) e.preventDefault(); else d.returnValue = ""; });
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
      if (!ownerView()) {
        const kind = publicInfo(k).kind;
        if (kind === "busy") return shakeNo(b);
        return (kind === "open" || kind === "ot") && smsNumber() ? floatPick(k, b) : openDay(k);
      }
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
      else if ($("#setUniCode").value && !cleanCode($("#setUniCode").value) && !uniLocked()) toast("Your My Uniform code didn't change, because the new one wasn't 4 to 8 letters or numbers.", 5000);
    });
    $("#credRemove").addEventListener("click", removeCred);
    $("#fbTest").addEventListener("click", onFeedbackTest);
    $("#unlockForm").addEventListener("submit", onUnlock);
    $("#editForm").addEventListener("change", (e) => { if (!e.target.closest(".field.clock")) onEditChange(); });
    // The day's note is one line, written on a sticky note: Enter doesn't start a new line, and a pasted line break
    // becomes a space.
    $("#workNote").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    $("#workNote").addEventListener("input", (e) => {
      if (/[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*[\r\n]+\s*/g, " ");
      onEditChange();
    });
    $("#addShift").addEventListener("click", addShiftRow);
    // Settings sections fold to their titles (Oct 15): tap a title to open or close it. All start closed.
    // The sections live in one box, so they can be shown as a list or as tiles (Oct 15).
    {
      const all = [...document.querySelectorAll("#settingsSheet [data-fold]")];
      const box = h("div", { id: "secList", class: "sec-list" });
      all[0].before(box);
      box.append(...all);
      for (const b of document.querySelectorAll(".view-pick .vp")) b.addEventListener("click", () => {
        if ((priv.secView === "list" ? "list" : "tiles") === b.dataset.view) return;
        priv.secView = b.dataset.view;
        showView();
        afterChange();
      });
    }
    for (const g of document.querySelectorAll("#settingsSheet [data-fold]")) {
      const grip = h("span", { class: "fold-grip", title: "Drag to move this section", "aria-hidden": "true" });
      const head = h("button", { type: "button", class: "fold-head", "aria-expanded": "false" }, grip, secIcon(g.dataset.sec), h("span", { class: "fold-name", text: g.dataset.fold }), h("i", { class: "fold-chev", "aria-hidden": "true" }));
      dragSection(g, grip);
      head.addEventListener("click", (e) => {
        if (e.target.closest(".fold-grip") || g.dragged) return;
        const open = g.classList.toggle("open");
        head.setAttribute("aria-expanded", String(open));
        if (open) fitNoteText();
      });
      // The section's old title line would repeat the new one: only its explanation in brackets stays, as a subtitle.
      const old = g.firstElementChild;
      if (old && old.matches("span.label")) {
        const m = old.textContent.match(/\(([^)]*)\)\s*$/);
        if (m) old.textContent = m[1].charAt(0).toUpperCase() + m[1].slice(1) + ".";
        else old.remove();
      }
      g.prepend(head);
      g.classList.add("fold");
    }
    // Enter on a checkbox or switch would press Done (the form's default button) and close Settings, losing his place in
    // the notes: it does nothing there, as in an item's window. Enter in a text box is still Done.
    $("#settingsForm").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches("input[type=checkbox], input[type=radio]")) e.preventDefault(); });
    $("#settingsForm").addEventListener("input", onSettingsChange);
    $("#settingsForm").addEventListener("change", onSettingsChange);
    // Settings' copy of the status line (Oct 15): tapping its light steps green, yellow, red.
    $("#mockDot").addEventListener("click", () => {
      const sel = $("#setLed"), order = ["green", "yellow", "red"];
      sel.value = order[(order.indexOf(sel.value) + 1) % order.length];
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      for (const c of ["yellow", "red"]) $("#statusMock").classList.toggle(`led-${c}`, sel.value === c);
    });
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
    $("#uniTurnOff").addEventListener("click", uniTurnOff);
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
    // A drawing that failed and then came in after all (from GitHub, in edit mode) shows again.
    document.addEventListener("load", (e) => { if (e.target.classList && e.target.classList.contains("gone")) e.target.classList.remove("gone"); }, true);
    $("#setNoteText").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    $("#signOut").addEventListener("click", () => {
      leaving = true;
      for (const k of [LS.token, ...draftKeys(), LS.draft2, LS.oldDraft, LS.importText, LS.brush, LS.lastWeekly, LS.uploads]) store.del(k);
      // And My Uniform's code, if he opened it in his preview in this tab: the next person here is asked for it.
      for (const k of [UNI_KEY, UNI_LINK]) session.del(k);
      nav.leave(() => location.reload());
    });
    $("#settingsBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openSettings()));
    $("#importBtn").addEventListener("click", () => (busy ? toast("One moment, loading your calendar…") : standIn ? showSheet("#keySheet") : openImport()));
    $("#unlockDiscard").addEventListener("click", () => {
      for (const k of [...draftKeys(), LS.draft2, LS.oldDraft, LS.importText, LS.lastWeekly]) store.del(k);
      $("#unlockDraft").hidden = true;
      toast("Discarded");
    });
    // Two tabs editing at once would overwrite each other's unsaved changes.
    window.addEventListener("storage", (e) => {
      if (owner && e.key === LS.savedSignal) rebase();
      // A newer tab took this tab's unsaved changes over (see handed).
      if (owner && saved && e.key === OWN_DRAFT && e.oldValue && !e.newValue) handed = diffOf();
      // Stop Editing (or Discard, in the connect window) in a tab of an older version of the page: it clears only its own
      // kind of unsaved changes, and always the every-week days' copy, which a key that stopped working leaves. This
      // version's unsaved changes go too, as its own Stop Editing clears them.
      if ((e.key === LS.token || e.key === LS.lastWeekly) && !e.newValue && !store.get(LS.token) && !store.get(LS.lastWeekly)) {
        for (const k of [...store.keys(LS.draftPrefix), LS.uploads]) store.del(k);
      }
      // Stop Editing in another tab: this one stops too (even mid-load), so it doesn't keep his hours on screen or write new drafts.
      if (e.key === LS.token && !e.newValue && token) { leaving = true; token = null; for (const k of [UNI_KEY, UNI_LINK]) session.del(k); nav.leave(() => location.reload()); }
    });
    let importTimer = 0;
    $("#importText").addEventListener("input", () => { clearTimeout(importTimer); importTimer = setTimeout(renderImport, 200); });
    $("#importApply").addEventListener("click", applyImport);
    $("#saveBtn").addEventListener("click", () => (busy ? null : openReceipt()));
    $("#rcSave").addEventListener("click", async () => { if (busy || saving) return; if (await save(false)) $("#receiptSheet").close(""); });
    $("#conflictSheet").addEventListener("close", onConflict);
    $("#keySheet").addEventListener("close", onKeyRetry);
    // The preview is a screen of its own: Back (the button or the gesture) returns to editing.
    // Focus goes with it: to the page's title going in, back to the button coming out.
    const endPreview = () => { if (!preview) return; preview = false; render(); try { $("#previewBtn").focus(); } catch (e) { /* ignore */ } };
    $("#previewBtn").addEventListener("click", () => {
      preview = true;
      render();
      window.scrollTo(0, 0);
      nav.page(endPreview);
      $("#title").setAttribute("tabindex", "-1");
      try { $("#title").focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    $("#previewExit").addEventListener("click", () => nav.back(null, endPreview));
    for (const b of document.querySelectorAll(".brushes button")) {
      b.addEventListener("click", () => {
        brush = b.dataset.brush;
        store.set(LS.brush, brush);
        renderOwnerBits();
      });
    }
    // Keep "today" right if the page stays open past midnight.
    // Not before the calendar is in: that would swap "Loading calendar…" for a gray calendar.
    document.addEventListener("visibilitychange", () => { if (!document.hidden && (dataIn || loadError)) render(); });

    // My Uniform. Its screens take part in Back like a window's steps: open while they show.
    const uniEl = $("#uniform");
    Object.defineProperty(uniEl, "open", { configurable: true, get() { return !this.hidden; } });
    uniEl.querySelector(".u-below").append(mannequinSvg(false));
    // Browsers with windows but without inert (Safari 15.4, Firefox 98-111) would let Tab out to the page underneath:
    // there the focus comes back in, at the other end from where it left.
    if (!("inert" in HTMLElement.prototype)) {
      document.addEventListener("focusin", (e) => {
        const t = e.target;
        if (uniEl.hidden || !t || t === document.body || uniEl.contains(t) || (t.closest && t.closest("dialog[open]"))) return;
        const all = Array.prototype.filter.call(uniEl.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"), (x) => !x.disabled && x.getClientRects().length);
        if (!all.length) return;
        const to = e.relatedTarget === all[0] ? all[all.length - 1] : all[0];
        to.focus();
      });
    }
    $("#uniformBtn").addEventListener("click", () => openUniform(unlocked() ? "pick" : "code"));
    // As in the day window, a tap right after the clothes or the mannequin appear is the second half of a double tap (on
    // the corner button, Open or See It On the Mannequin): it would pick clothes, or send the text.
    // Timed from when the tap happened (the event's own time), not when a busy phone gets round to it.
    uniEl.addEventListener("click", (e) => {
      const at = e.timeStamp > 1e12 || !e.timeStamp ? performance.now() : e.timeStamp; // older browsers: a date, or none
      if (uni.step !== "code" && at - (uni.shownAt || 0) < 350) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
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
    // A card reached with Tab comes fully into view in its row: browsers leave one that's partly in view where it is.
    // It goes to the row's start, where the row would snap it anyway. Not one tapped or clicked: it would move out from
    // under the finger before the tap ends.
    let rowPress = 0;
    for (const t of ["mousedown", "touchstart"]) $("#uRows").addEventListener(t, () => { rowPress = Date.now(); }, { capture: true, passive: true });
    $("#uRows").addEventListener("focusin", (e) => {
      const b = e.target.closest(".u-item"), s = b && b.parentNode;
      if (!s || s.scrollWidth <= s.clientWidth || Date.now() - rowPress < 1000) return;
      const a = b.getBoundingClientRect(), r = s.getBoundingClientRect();
      if (a.left < r.left || a.right > r.right) s.scrollLeft += a.left - r.left - 5; // 5: the row's scroll-padding
    });
    $("#uPicks").addEventListener("click", (e) => {
      const b = e.target.closest(".u-off");
      if (!b) return;
      uni.offAt = Array.prototype.indexOf.call($("#uPicks").querySelectorAll(".u-off"), b);
      uni.picks[b.dataset.cat] = null;
      syncPicker();
    });
    $("#uSeeBtn").addEventListener("click", () => { if (uni.picks.top && uni.picks.pants) uniTo("see"); });
    // The history entry a view opened by a link didn't get (see openUniform): added before the tap or key does anything.
    // Browsers count a touch from when it ends, a mouse or key from when it goes down.
    for (const t of ["keydown", "mousedown", "pointerdown", "pointerup", "touchend"]) {
      uniEl.addEventListener(t, () => { if (uni.noEntry && nav.step(uniEl, hideUniform)) uni.noEntry = false; }, true);
    }
    // Escape closes it, as it closes a window.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !uniEl.hidden && !document.querySelector("dialog[open]")) closeUniform(); });
    window.addEventListener("hashchange", () => { routeUniform(); });
    // From the keyboard, a footer link brings the page's end into view, where the corner button has room under the links:
    // so the next Tab reaches it (stepped aside, it can't take the focus). A click there doesn't move the page.
    let tabAt = 0;
    document.addEventListener("keydown", (e) => { if (e.key === "Tab") tabAt = Date.now(); }, true);
    $(".page > .foot").addEventListener("focusin", () => {
      if ($("#uniformBtn").hidden || Date.now() - tabAt > 500) return;
      window.scrollTo(0, document.documentElement.scrollHeight);
      fabDodge();
    });
    $("#uniformBtn").addEventListener("blur", fabCheck);
    window.addEventListener("scroll", fabCheck, { passive: true });
    $(".page > .cal").addEventListener("scroll", fabCheck, { passive: true });
    window.addEventListener("resize", fabCheck);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fabCheck).catch(() => { /* ignore */ });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fabCheck); // the fonts can come in late
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
  //           and, together with it and taking the same time, Call Me and the license
  //   2.05 s  with the badge's shine, a small sparkle bursts on the badge's corner (it outlasts "opening")
  // and then for good: the status light and his name glow together, the days he can take breathe together, the
  // grid drifts, the arrow nudges, and the button icons glitch now and then. All timings live in app.css.
  // A slow connection shows the page as it is after 1.5 s, with only the lasting effects. Reduced motion: none of it.
  // A computer's wide header (supervisors' view): its waves start from the middle of the whole group (badge, name,
  // status and buttons) that falls onto the grid, not from the badge. Measured from what's drawn, not the boxes (the
  // name's box runs on to the window's edge), each time the header is drawn and when the window changes size.
  function aimWave() {
    const hero = $(".hero");
    if (!hero) return;
    hero.style.removeProperty("--wx");
    hero.style.removeProperty("--wy");
    if (!window.matchMedia("(min-width: 960px) and (min-height: 560px)").matches || ownerView()) return;
    const drawn = (el) => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); };
    const rs = [".hero .badge", "#title", "#accepting", "#heroChips"].map((q) => $(q)).filter((el) => el && !el.hidden).map(drawn).filter((r) => r.width > 0);
    if (!rs.length) return;
    const hr = hero.getBoundingClientRect();
    hero.style.setProperty("--wx", `${(Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2 - hr.left}px`);
    hero.style.setProperty("--wy", `${(Math.min(...rs.map((r) => r.top)) + Math.max(...rs.map((r) => r.bottom))) / 2 - hr.top}px`);
  }
  window.addEventListener("resize", () => aimWave());

  let revealed = false;
  function reveal(animate) {
    if (revealed) return;
    revealed = true;
    const root = document.documentElement, page = $(".page"), weeks = $("#weeks");
    if (!root.classList.contains("intro")) return;
    // This page itself came in so slowly that app.css's 4-second failsafe already showed it: it stays on screen as it
    // is, never hidden again to play the opening.
    if (getComputedStyle(page).opacity !== "0") animate = false;
    root.classList.remove("intro");
    try { if (window.CSS && CSS.registerProperty) { CSS.registerProperty({ name: "--r", syntax: "<length>", inherits: false, initialValue: "0px" }); root.classList.add("ripple-ok"); } } catch (e) { /* already registered */ }
    aimWave();
    root.classList.add("lit");
    syncBreath();
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
    setTimeout(fabCheck, 1800); // the days have fallen into place
    setTimeout(() => { root.classList.remove("opening"); weeks.classList.remove("drop"); }, 4000);
  }

  // The calendar file. A request that never gets an answer (a phone's connection that dropped) would leave "Loading
  // calendar…" up for good: after 15 s the load error shows and the file is asked for once more. The first answer is
  // used, even a late one (the calendar then replaces the error).
  function calendarFile() {
    const get = () => fetch(`data.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    return new Promise((resolve, reject) => {
      let waiting = 1;
      const timer = setTimeout(() => { loadError = true; render(); waiting++; get().then(done, fail); }, 15000);
      const done = (j) => { clearTimeout(timer); resolve(j); };
      const fail = (e) => { if (--waiting > 0) return; clearTimeout(timer); reject(e); };
      get().then(done, fail);
    });
  }

  // The page's fonts, once their stylesheet is in (it loads without holding up the page): resolves when they're ready,
  // or after ms, whichever is first.
  function fontsIn(ms) {
    return new Promise((resolve) => {
      if (ms <= 0 || !document.fonts || !document.fonts.load) { resolve(); return; }
      setTimeout(resolve, ms);
      const faces = ['700 1em "Barlow Semi Condensed"', '400 1em "Source Sans 3"', '600 1em "Source Sans 3"', '700 1em "Source Sans 3"', '400 1em "JetBrains Mono"'];
      // (The style is brought up to date first, so the fonts' stylesheet counts: without it the fonts weren't known yet,
      // nothing waited, and they came in during the opening anyway.)
      const go = () => { void document.documentElement.offsetWidth; Promise.all(faces.map((f) => document.fonts.load(f))).then(() => document.fonts.ready).then(() => resolve(), () => resolve()); };
      const link = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
      if (!link || link.media === "all") go();
      else { link.addEventListener("load", () => setTimeout(go, 0), { once: true }); link.addEventListener("error", () => resolve(), { once: true }); }
    });
  }

  const bootAt = performance.now();
  async function boot() {
    wire();
    takeUniformLink();
    checkCred();
    const slow = setTimeout(() => reveal(false), 1500);
    let late = false;
    try {
      const file = readPublicFile(await calendarFile());
      late = loadError; // the 15 s load error was up, with a gray calendar that could be tapped
      pub = file.pub;
      pubDays = file.days;
      pubWeekly = file.weekly;
      pubOt = file.ot;
      updated = file.updated;
      dataIn = true;
      loadError = false;
    } catch {
      loadError = true;
    }
    const shownEarly = revealed; // a slow connection: the page has been up for a while, still loading
    render();
    // The calendar fades in over the "Loading calendar…" page it replaces, instead of swapping in in one frame (Oct 16).
    if (shownEarly && !stillMotion() && $(".page").animate) $(".page").animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
    // A day window opened on that gray calendar shows the day as it was then ("Not set yet"): it closes now that the real
    // days are in (and a My Uniform link that waited opens with nothing over it).
    // Its history entry goes now, not when its close event comes: by then the link's My Uniform has added its own.
    if (late) for (const s of ["#callSheet", "#daySheet"]) if ($(s).open) { $(s).close(""); nav.closed($(s)); }
    // The fonts come in before the opening plays (within the same 1.5 s): arriving in the middle of it, they made the
    // whole page lay itself out again, so his name stopped partway down and then jumped into place (Oct 16).
    await fontsIn(1400 - (performance.now() - bootAt));
    void document.body.offsetHeight; // the page laid out in them now, while it's still hidden, not in the opening's first frames
    clearTimeout(slow);
    reveal(true);
    // The QR code maker (56 KB), fetched once the opening is over, so a code is drawn the moment it's asked for
    // (Share This Calendar, a computer's text card) instead of a blank square for half a second first (Oct 16).
    setTimeout(() => { loadQr().catch(() => { /* fetched again when a code is asked for */ }); }, 5000);
    restoreUniformCode().then(routeUniform).catch(() => { /* the button still opens it */ });
    if (token) await enterOwner();
  }

  // While any window is open (the shift picker, the send card, a sheet), the page underneath holds its animations still:
  // the breathing days, the glows and the drifting grid can't be seen behind the dim and blur, and redrawing them under
  // the blur every frame made the picker's animations stutter on iPhones (Oct 15).
  if (window.MutationObserver) {
    const sync = () => document.documentElement.classList.toggle("overlay-open", !!document.querySelector("dialog[open]"));
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
  }

  boot();
})();
