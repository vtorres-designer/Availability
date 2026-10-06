"use strict";
(() => {
  const SHIFT_KEYS = ["overnight", "swing", "morning"];
  const SHIFT_LABEL = { overnight: "Overnight", swing: "Swing", morning: "Morning" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const LS = { token: "sa.token", draft: "sa.draft2", oldDraft: "sa.draft", who: "sa.who", brush: "sa.brush", importText: "sa.import" };
  const PRIVATE_VAR = "AVAILABILITY_PRIVATE";
  const VAR_LIMIT = 47 * 1024; // GitHub allows 48 KB per variable
  const PUBLIC_TAG = { open: "Open", ot: "OT", busy: "Busy", unset: "" };
  const OWNER_TAG = { open: "Open", ot: "OT", work: "Work", busy: "Busy", unset: "" };

  // Public settings live in data.json, which anyone can read. Private ones (hours, notes, overtime rules)
  // live in a repository variable that only the owner's key can read.
  const defaultPub = () => ({ name: "Vincent", phone: "", note: "", willing: ["overnight"], weekStart: 0 });
  const defaultPriv = () => ({ otAfter: 40, pickup: 8, days: {} });

  // ---------- small helpers ----------
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
  };
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
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
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
    const ta = h("textarea", { style: "position:fixed;opacity:0;top:0;left:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }

  // ---------- data model ----------
  const cleanWilling = (w) => (Array.isArray(w) ? SHIFT_KEYS.filter((k) => w.includes(k)) : null);
  const cleanNote = (n) => (typeof n === "string" ? n.trim().slice(0, 100) : "");

  function normalizePub(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPub();
    if (typeof r.name === "string") d.name = r.name.trim().slice(0, 40);
    if (typeof r.phone === "string") d.phone = r.phone.trim().slice(0, 20);
    if (typeof r.note === "string") d.note = r.note.slice(0, 140);
    if (Array.isArray(r.willing)) d.willing = cleanWilling(r.willing);
    const ws = parseInt(r.weekStart, 10);
    if (ws >= 0 && ws <= 6) d.weekStart = ws;
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

  function normalizePriv(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = defaultPriv();
    if (Number(r.otAfter) > 0) d.otAfter = Number(r.otAfter);
    if (Number(r.pickup) > 0 && Number(r.pickup) <= 24) d.pickup = Number(r.pickup);
    if (r.days && typeof r.days === "object") {
      for (const [k, v] of Object.entries(r.days)) {
        const rec = isKey(k) ? cleanPrivRec(v, d.pickup) : null;
        if (rec) d.days[k] = rec;
      }
    }
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
  function privFromPublicDays(days) {
    const priv = defaultPriv();
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
    if (raw && raw.v === 2) return { pub: normalizePub(raw), days: normalizePublicDays(raw.days), updated: raw.updated || null };
    const m = migrateV1(raw);
    return { pub: m.pub, days: derivePublic(m.pub, m.priv), updated: (raw && raw.updated) || null, migrated: m };
  }

  const weekStartOf = (k, ws) => addDays(k, -((dateOf(k).getDay() - ws + 7) % 7));

  function weekHours(k, priv, ws) {
    const start = weekStartOf(k, ws);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const rec = priv.days[addDays(start, i)];
      if (rec && rec.s === "work") total += Number(rec.hours) || 0;
    }
    return total;
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
      const ot = weekHours(k, v, p.weekStart) + v.pickup > v.otAfter;
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
  let lastPrivText = null; // what this device last wrote to the private variable

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
    const days = new Set([...keys].filter((k) => JSON.stringify(priv.days[k] ?? null) !== JSON.stringify(saved.priv.days[k] ?? null)));
    const strip = (v) => JSON.stringify(Object.assign({}, v, { days: null }));
    return { days, settings: JSON.stringify(pub) !== JSON.stringify(saved.pub) || strip(priv) !== strip(saved.priv), publish: needsPublish };
  }

  function persistDraft() {
    if (!privAccess) return; // edits on top of a stand-in schedule must never replace the real one
    const c = changes();
    if (c.days.size || c.settings) store.set(LS.draft, JSON.stringify({ pubSha, privAt, pub, priv }));
    else store.del(LS.draft);
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
    const cur = priv.days[k];
    if (brush === "work") setDay(k, cur && cur.s === "work" ? null : workRec(null, null, priv.pickup));
    else if (brush === "busy") setDay(k, cur && cur.s === "busy" ? null : { s: "busy" });
    else if (brush === "open") setDay(k, cur && cur.s === "open" ? null : { s: "open" });
    afterChange();
  }

  // ---------- day info ----------
  function ownerInfo(k) {
    const rec = priv.days[k] || null;
    const booked = weekHours(k, priv, pub.weekStart);
    const base = { past: k < todayKey(), booked, rec };
    if (!rec) return Object.assign(base, { kind: "unset" });
    if (rec.s === "work" || rec.s === "busy") return Object.assign(base, { kind: rec.s });
    if (rec.w && rec.w.length === 0) return Object.assign(base, { kind: "busy" });
    return Object.assign(base, { kind: booked + priv.pickup > priv.otAfter ? "ot" : "open" });
  }

  function publicInfo(k) {
    const rec = pubDays[k];
    return { past: k < todayKey(), kind: rec ? rec.s : "unset", w: rec && rec.w ? rec.w : null };
  }

  function publicStatusText(kind) {
    return { open: "Available", ot: "Available, but it would be overtime", busy: "Not available", unset: "Not set yet" }[kind];
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
    if (owner && preview) pubDays = derivePublic(pub, priv);
    $("#title").textContent = `${possessive(pub.name)} availability`;
    document.title = `${possessive(pub.name)} Shift Availability`;
    $("#note").hidden = !pub.note;
    $("#note").textContent = pub.note;
    $("#updated").textContent = loadError
      ? "Couldn't load the latest calendar. Check your connection and refresh."
      : updated
        ? `Updated ${new Date(updated).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "";

    const w = $("#willing");
    w.replaceChildren();
    if (pub.willing.length) {
      w.append(h("span", { class: "lbl", text: "Shifts I'll pick up:" }));
      for (const k of pub.willing) w.append(h("span", { class: "chip", text: SHIFT_LABEL[k] }));
    }

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
        let cls, tag, label, disabled = false;
        if (asOwner) {
          const info = ownerInfo(k);
          cls = ["day", info.kind];
          if (info.kind === "busy") cls.push("hatch");
          if (info.past) cls.push("past");
          tag = OWNER_TAG[info.kind];
          label = info.kind === "work" ? "Working" : info.kind === "busy" ? "Busy" : publicStatusText(info.kind);
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
          h("span", { class: "tag", text: tag })));
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
    $("#ownerLink").hidden = owner;
    if (asOwner) renderOwnerBits();
  }

  function renderOwnerBits() {
    const hints = $("#ownerHints");
    hints.replaceChildren();
    if (!privAccess) {
      hints.append(h("b", { text: "One more step before you can save. " }),
        h("button", { type: "button", class: "linkish", text: "Fix my GitHub key", onclick: () => showSheet("#keySheet") }));
    } else if (!Object.keys(priv.days).length) {
      hints.append("Every day is gray until you mark it. Tap ", h("b", { text: "Add schedule" }), " to paste your work schedule, or pick a tool below and tap days.");
    } else {
      hints.append("Tap a tool below, then tap days. Red: working or busy. Green: available. Yellow shows up on its own when a shift would be overtime.");
    }
    if (!pub.phone) hints.append(h("br"), "Add your cell number in Settings so supervisors can text you.");

    const c = changes();
    const n = c.days.size + (c.settings ? 1 : 0) + (c.publish ? 1 : 0);
    if (c.publish && !c.days.size && !c.settings) hints.append(h("br"), h("b", { text: "Tap Save to update what supervisors see." }));
    const btn = $("#saveBtn");
    btn.disabled = saving || n === 0;
    btn.textContent = saving ? "Saving…" : n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Saved";
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

  function smsBody(k, sk, who) {
    let ask;
    if (sk) {
      const label = SHIFT_LABEL[sk].toLowerCase();
      const article = /^[aeiou]/.test(label) ? "an" : "a";
      ask = sk === "overnight" ? `${article} ${label} shift on the night of ${shortDay(k)}?` : `${article} ${label} shift on ${shortDay(k)}?`;
    } else {
      ask = `a shift on ${shortDay(k)}?`;
    }
    const hi = pub.name ? `Hi ${pub.name}` : "Hi";
    return who ? `${hi}, it's ${who}. Can you cover ${ask}` : `${hi}, can you cover ${ask}`;
  }
  const smsHref = (body) => `sms:${smsNumber()}${apple() ? "&" : "?"}body=${encodeURIComponent(body)}`;

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
      if (!smsNumber()) {
        wrap.append(h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." }));
      } else {
        const whoInput = h("input", { type: "text", id: "who", maxlength: "40", autocomplete: "name", placeholder: "So I know who's asking" });
        whoInput.value = store.get(LS.who) || "";
        const shifts = info.w || pub.willing;
        const links = (shifts.length ? shifts : [null]).map((sk) => ({
          sk,
          a: h("a", { class: `btn go wide${info.kind === "ot" ? " ot" : ""}` },
            h("span", { text: sk ? `Text me about ${SHIFT_LABEL[sk]}` : "Text me about this day" }),
            info.kind === "ot" ? h("span", { class: "option-note", text: "Would be overtime" }) : null),
        }));
        const refresh = () => {
          const who = whoInput.value.trim();
          for (const { a, sk } of links) a.href = smsHref(smsBody(k, sk, who));
        };
        whoInput.addEventListener("input", () => { store.set(LS.who, whoInput.value.trim()); refresh(); });
        refresh();
        const copyBtn = h("button", { type: "button", class: "btn ghost sm", text: "Copy number" });
        copyBtn.addEventListener("click", async () => {
          const ok = await copyText(prettyPhone());
          copyBtn.textContent = ok ? "Copied" : "Press and hold the number";
          setTimeout(() => { copyBtn.textContent = "Copy number"; }, 2500);
        });
        wrap.append(
          h("label", { class: "field" }, h("span", { class: "label", text: "Your name (optional)" }), whoInput),
          h("div", { class: "options" }, links.map((l) => l.a)),
          h("p", { class: "muted small", text: "Opens your texting app with the message filled in. Add the site and times, then hit send." }),
          h("p", { class: "contact" }, h("span", { text: "Or text" }), h("b", { text: prettyPhone() }), copyBtn)
        );
      }
    }
    $("#dayBody").replaceChildren(wrap);
    $("#daySheet").showModal();
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

  function fillEdit(fillInputs) {
    const k = editKey;
    const rec = priv.days[k];
    const st = rec ? rec.s : "unset";
    $(`#st${st[0].toUpperCase()}${st.slice(1)}`).checked = true;
    for (const [id, s] of [["#editWork", "work"], ["#editBusy", "busy"], ["#editOpen", "open"], ["#editUnset", "unset"]]) $(id).hidden = st !== s;
    if (fillInputs) {
      $("#workStart").value = rec && rec.s === "work" && rec.start ? rec.start : "";
      $("#workEnd").value = rec && rec.s === "work" && rec.end ? rec.end : "";
      $("#workHours").value = rec && rec.s === "work" ? num(rec.hours) : num(priv.pickup);
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
        if (!final.has(k) && !priv.days[k] && !skipped.has(k)) gaps.push(k);
      }
    }
    if (gaps.length > 200) gaps = [];
    const replaced = [...final.entries()].filter(([k, rec]) => priv.days[k] && rec.s !== "clear" && priv.days[k].s !== rec.s).length;
    return { final, gaps, replaced };
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
      $("#importApply").textContent = "Add to calendar";
      return;
    }
    const rows = [];
    for (const it of items) {
      rows.push({ line: it.line, el: h("li", { class: "pv-item" },
        h("span", { class: `dot ${dotFor(it.rec.s)}` }),
        h("span", { class: "pv-text" },
          h("b", { text: describeKeys(it) }),
          h("span", { text: describeRec(it.rec) }),
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
    box.append(h("p", { class: errors.length ? "pv-sum warn" : "pv-sum", text: summary.join(" · ") }), h("ul", { class: "pv-list" }, rows.map((r) => r.el)));

    const gapBox = $("#gapBox");
    gapBox.hidden = !plan.gaps.length;
    if (plan.gaps.length) {
      $("#gapLegend").textContent = `${plan.gaps.length} gray day${plan.gaps.length === 1 ? "" : "s"} between ${shortDay(plan.final.size ? [...plan.final.keys()].sort()[0] : plan.gaps[0])} and ${shortDay([...plan.final.keys()].sort().pop())} aren't in your list.`;
    }
    const gapOpen = !gapBox.hidden && $("#gapOpen").checked;
    const total = n + (gapOpen ? plan.gaps.length : 0);
    $("#importApply").disabled = total === 0;
    $("#importApply").textContent = total ? `Add ${total} day${total === 1 ? "" : "s"} to calendar` : "Add to calendar";
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
    toast(`Added ${total} day${total === 1 ? "" : "s"}.${leftover ? " Lines that couldn't be read are still in Add schedule." : ""} Check them, then tap Save.`, 5000);
  }

  function openImport() {
    $("#importText").value = store.get(LS.importText) || "";
    $("#gapGray").checked = true;
    renderImport();
    $("#importSheet").showModal();
  }

  // ---------- owner: settings ----------
  function otExplain() {
    return `A green day turns yellow when one more ${num(priv.pickup)}-hour shift would push that pay week past ${num(priv.otAfter)} hours.`;
  }

  function openSettings() {
    $("#setNote").value = pub.note;
    $("#setName").value = pub.name;
    $("#setPhone").value = pub.phone;
    $("#setWeekStart").value = String(pub.weekStart);
    $("#setOt").value = num(priv.otAfter);
    $("#setPickup").value = num(priv.pickup);
    $("#otExplain").textContent = otExplain();
    $("#setWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`sw-${x}`, x, pub.willing.includes(x))));
    $("#repoLine").textContent = `Saves to github.com/${REPO.owner}/${REPO.name}`;
    $("#settingsSheet").showModal();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.id === "setNote") pub.note = t.value.slice(0, 140);
    else if (t.id === "setName") pub.name = t.value.trim().slice(0, 40);
    else if (t.id === "setPhone") pub.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setWeekStart") pub.weekStart = parseInt(t.value, 10) || 0;
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
      v = parsed ? normalizePriv(parsed) : file.migrated ? file.migrated.priv : privFromPublicDays(file.days);
    } else {
      v = file.migrated ? file.migrated.priv : privFromPublicDays(file.days);
    }
    const today = todayKey();
    const upcoming = (days) => JSON.stringify(Object.keys(days).filter((k) => k >= today).sort().map((k) => [k, days[k]]));
    const behind = !!file.migrated || upcoming(file.days) !== upcoming(derivePublic(p, v));
    return { pub: p, priv: v, pubSha: pubRes.sha, privAt: privRes.updatedAt || null, privExists: privRes.status === 200, privAccess: privRes.status !== 403, updated: file.updated, behind };
  }

  async function enterOwner() {
    try {
      const st = await loadOwnerState(token);
      owner = true;
      brush = ["edit", "work", "busy", "open"].includes(store.get(LS.brush)) ? store.get(LS.brush) : "edit";
      saved = { pub: clone(st.pub), priv: clone(st.priv) };
      pubSha = st.pubSha;
      privAt = st.privAt;
      privExists = st.privExists;
      privAccess = st.privAccess;
      needsPublish = st.behind;
      updated = st.updated;
      pub = clone(st.pub);
      priv = clone(st.priv);
      let restored = false;
      try {
        // An unsaved draft from the first version of the site is converted, not dropped.
        const old = JSON.parse(store.get(LS.oldDraft) || "null");
        if (old && old.data && !store.get(LS.draft)) {
          const m = migrateV1(old.data);
          store.set(LS.draft, JSON.stringify({ pubSha: old.baseSha || null, privAt: null, pub: m.pub, priv: m.priv }));
        }
      } catch { /* unreadable old draft */ }
      store.del(LS.oldDraft);
      try {
        const d = privAccess ? JSON.parse(store.get(LS.draft) || "null") : null;
        if (d && d.pub && d.priv) {
          pub = normalizePub(d.pub);
          priv = normalizePriv(d.priv);
          // Keep the versions the draft started from, so Save notices if another device saved since.
          pubSha = d.pubSha || pubSha;
          privAt = d.privAt !== undefined ? d.privAt : privAt;
          restored = true;
        }
      } catch { /* bad draft */ }
      loadError = false;
      render();
      const c = changes();
      if (restored && (c.days.size || c.settings)) toast("Restored changes you hadn't saved yet");
      if (!privAccess) showSheet("#keySheet");
    } catch (e) {
      owner = false;
      if (e.status === 401) {
        store.del(LS.token);
        token = null;
        render();
        openUnlock("GitHub no longer accepts your saved key. Make a new one and paste it here.");
      } else {
        render();
        toast("Couldn't reach GitHub, so editing is off for now. Refresh to try again.", 5000);
      }
    }
  }

  function openUnlock(msg) {
    for (const el of document.querySelectorAll(".repo-name")) el.textContent = REPO.name;
    $("#unlockError").hidden = !msg;
    $("#unlockError").textContent = msg || "";
    $("#unlockSheet").showModal();
  }

  async function onUnlock(e) {
    e.preventDefault();
    if (e.submitter && e.submitter.value === "close") { $("#unlockSheet").close(); return; }
    const tok = $("#tokenInput").value.trim();
    const err = $("#unlockError");
    if (!tok) { err.textContent = "Paste your GitHub token first."; err.hidden = false; return; }
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
      if (owner) toast("Connected. You can edit now.");
    } catch (x) {
      err.hidden = false;
      err.textContent = x.status === 401
        ? "GitHub didn't accept that token. Copy it again and paste the whole thing."
        : x.status === 404 || x.status === 403
          ? `That token can't see the "${REPO.name}" repository. Edit the token: add it under Repository access and set Contents to Read and write.`
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
      const out = { v: 2, otAfter: v.otAfter, pickup: v.pickup, days: {} };
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
    const pubOut = Object.assign({ v: 2 }, snapPub, { days: derivePublic(snapPub, payload.priv), updated: stamp });
    let stage = "check";
    try {
      // Check both files before writing either, so a newer save from another device is never overwritten.
      const remotePub = await getPublicRemote(token);
      const remotePriv = await getPrivateRemote(token);
      if (remotePriv.status === 403) { privAccess = false; throw Object.assign(new Error("key"), { key: true }); }
      if (!force) {
        if (remotePub.sha !== pubSha) throw conflictError();
        if (remotePriv.status === 200 && remotePriv.updatedAt !== privAt && remotePriv.value !== lastPrivText) throw conflictError();
        if (remotePriv.status === 404 && privExists) throw conflictError(); // deleted elsewhere: let him choose
      }
      pubSha = remotePub.sha;
      privExists = remotePriv.status === 200;
      if (privExists) privAt = remotePriv.updatedAt;
      stage = "private";
      await writePrivate(payload.text, force);
      stage = "public";
      const res = await gh("PUT", "/contents/data.json", {
        message: `Update availability (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
        content: b64encode(JSON.stringify(pubOut, null, 2) + "\n"),
        sha: pubSha,
      });
      pubSha = res.content.sha;
      for (const k of Object.keys(priv.days)) if (k < payload.cutoff) delete priv.days[k];
      saved = { pub: snapPub, priv: payload.priv };
      needsPublish = false;
      updated = stamp;
      toast("Saved. Supervisors will see it within a minute or two.", 4200);
    } catch (e) {
      if (stage === "public") needsPublish = true; // hours saved privately, public calendar not yet
      if (e.conflict || e.status === 409 || (stage === "public" && e.status === 422)) showSheet("#conflictSheet");
      else if (e.key || (stage === "private" && e.status === 403)) { privAccess = false; showSheet("#keySheet"); }
      else if (e.status === 401) toast("GitHub no longer accepts your key. Open Settings, tap Stop editing, then connect again.", 6000);
      else if (stage === "private" && e.status === 422) toast("GitHub wouldn't store your hours. Clear some far-off days and try again.", 6000);
      else if (stage === "public" && (e.status === 403 || e.status === 404)) toast("Your key can't save the calendar file. On GitHub, set the token's Contents permission to Read and write.", 6000);
      else toast("Couldn't save. Check your connection and tap Save again.", 5000);
    } finally {
      saving = false;
      persistDraft();
      render();
    }
  }

  async function onConflict() {
    const v = $("#conflictSheet").returnValue;
    if (v === "overwrite") return save(true);
    if (v === "reload") {
      store.del(LS.draft);
      await enterOwner();
      if (owner) toast("Loaded the newer calendar");
    }
  }

  async function onKeyRetry() {
    if ($("#keySheet").returnValue !== "retry") return;
    let r;
    try { r = await getPrivateRemote(token); } catch { toast("Couldn't reach GitHub. Try again in a moment."); return; }
    if (r.status === 403) { toast("Still missing the Variables permission. Check the token's settings on GitHub.", 5000); return; }
    if (r.status === 200) {
      // Your saved hours exist: load them instead of the stand-in rebuilt from the public file.
      // Edits made while the key was missing were never stored; a draft made before that is restored as usual.
      const hadEdits = (() => { const c = changes(); return c.days.size > 0 || c.settings; })();
      await enterOwner();
      if (owner) toast(hadEdits ? "Loaded your saved hours. Redo any changes you just made, then tap Save." : "Your key is set.", 5000);
      return;
    }
    privAccess = true;
    privExists = false;
    persistDraft();
    render();
    toast("Your key can now read the private store. If Save still fails, set Variables to Read and write.", 5000);
  }

  // ---------- wiring ----------
  function wire() {
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
      if (brush === "edit") openEdit(k);
      else applyBrush(k);
    });
    $("#ownerLink").addEventListener("click", () => (token ? enterOwner() : openUnlock()));
    $("#unlockForm").addEventListener("submit", onUnlock);
    $("#editForm").addEventListener("change", onEditChange);
    for (const id of ["#workHours", "#workNote", "#busyNote"]) $(id).addEventListener("input", onEditChange);
    $("#useUsual").addEventListener("click", () => { setDay(editKey, { s: "open" }); fillEdit(false); afterChange(); });
    $("#settingsForm").addEventListener("input", onSettingsChange);
    $("#settingsForm").addEventListener("change", onSettingsChange);
    $("#signOut").addEventListener("click", () => {
      for (const k of [LS.token, LS.draft, LS.oldDraft, LS.importText, LS.brush]) store.del(k);
      location.reload();
    });
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#importBtn").addEventListener("click", openImport);
    let importTimer = 0;
    $("#importText").addEventListener("input", () => { clearTimeout(importTimer); importTimer = setTimeout(renderImport, 200); });
    $("#gapBox").addEventListener("change", renderImport);
    $("#importApply").addEventListener("click", applyImport);
    $("#saveBtn").addEventListener("click", () => save(false));
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
    try {
      const r = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const file = readPublicFile(await r.json());
      pub = file.pub;
      pubDays = file.days;
      updated = file.updated;
    } catch {
      loadError = true;
    }
    render();
    if (token) await enterOwner();
  }

  boot();
})();
