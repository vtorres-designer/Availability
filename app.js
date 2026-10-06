"use strict";
(() => {
  const SHIFT_KEYS = ["overnight", "swing", "morning"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const LS = { token: "sa.token", draft: "sa.draft", who: "sa.who", brush: "sa.brush" };
  const TAGS = { open: "Open", ot: "OT", work: "Work", off: "Busy", unset: "TBD" };

  const defaults = () => ({
    name: "Vincent",
    phone: "",
    note: "",
    through: "",
    weekStart: 0,
    otAfter: 40,
    willing: ["overnight"],
    shifts: {
      overnight: { label: "Overnight", start: "22:00", end: "07:00", hours: 9 },
      swing: { label: "Swing", start: "14:00", end: "22:00", hours: 8 },
      morning: { label: "Morning", start: "06:00", end: "14:00", hours: 8 },
    },
    days: {},
    updated: null,
  });

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
  const fmt = (k, o) => dateOf(k).toLocaleDateString("en-US", o);
  const shortDay = (k) => fmt(k, { weekday: "short", month: "short", day: "numeric" });
  const longDay = (k) => fmt(k, { weekday: "long", month: "long", day: "numeric" });
  const toMin = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const num = (n) => String(+Number(n).toFixed(2));
  const possessive = (name) => (name ? (/s$/i.test(name) ? `${name}'` : `${name}'s`) : "My");

  function fmtTime(t) {
    const m = toMin(t), h = Math.floor(m / 60) % 24, mm = m % 60;
    const h12 = h % 12 || 12, ap = h < 12 ? "AM" : "PM";
    return mm ? `${h12}:${pad(mm)} ${ap}` : `${h12} ${ap}`;
  }
  const crosses = (s) => toMin(s.end) <= toMin(s.start);
  const spanHours = (s) => { let m = toMin(s.end) - toMin(s.start); if (m <= 0) m += 1440; return m / 60; };
  const shiftHours = (key) => { const s = data.shifts[key]; return Number(s.hours) > 0 ? Number(s.hours) : spanHours(s); };

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

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
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

  // ---------- data ----------
  function normalize(raw) {
    const base = defaults();
    const r = raw && typeof raw === "object" ? raw : {};
    const d = Object.assign(base, r);
    d.shifts = {};
    for (const k of SHIFT_KEYS) d.shifts[k] = Object.assign(defaults().shifts[k], (r.shifts && r.shifts[k]) || {});
    d.willing = Array.isArray(r.willing) ? r.willing.filter((k) => SHIFT_KEYS.includes(k)) : defaults().willing;
    d.days = {};
    if (r.days && typeof r.days === "object") for (const [k, v] of Object.entries(r.days)) if (isKey(k) && v && typeof v === "object") d.days[k] = v;
    d.weekStart = Math.min(6, Math.max(0, parseInt(d.weekStart, 10) || 0));
    d.otAfter = Number(d.otAfter) > 0 ? Number(d.otAfter) : 40;
    d.through = isKey(d.through) ? d.through : "";
    d.name = String(d.name || "").slice(0, 40);
    d.phone = String(d.phone || "").slice(0, 20);
    d.note = String(d.note || "").slice(0, 140);
    return d;
  }

  const workHours = (rec) => (Number(rec.hours) > 0 ? Number(rec.hours) : shiftHours(SHIFT_KEYS.includes(rec.shift) ? rec.shift : "overnight"));
  const weekStartOf = (k) => addDays(k, -((dateOf(k).getDay() - data.weekStart + 7) % 7));

  function weekHours(k) {
    const ws = weekStartOf(k);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const rec = data.days[addDays(ws, i)];
      if (rec && rec.s === "work") total += workHours(rec);
    }
    return total;
  }

  function dayInfo(k) {
    const rec = data.days[k] || null;
    const past = k < todayKey();
    const booked = weekHours(k);
    if (rec && rec.s === "work") {
      const shift = SHIFT_KEYS.includes(rec.shift) ? rec.shift : "overnight";
      return { kind: "work", past, shift, hours: workHours(rec), booked };
    }
    if (rec && rec.s === "off") return { kind: "off", past, booked };
    const explicitOpen = rec && rec.s === "open";
    if (!explicitOpen && (!data.through || k > data.through)) return { kind: "unset", past, booked };
    const willing = (rec && Array.isArray(rec.willing) ? rec.willing : data.willing).filter((x) => SHIFT_KEYS.includes(x));
    if (!willing.length) return { kind: "off", past, booked };
    const options = willing.map((x) => ({ key: x, hours: shiftHours(x), ot: booked + shiftHours(x) > data.otAfter }));
    return { kind: options.every((o) => o.ot) ? "ot" : "open", past, options, booked };
  }

  function statusText(info) {
    if (info.kind === "work") return `Working, ${data.shifts[info.shift].label.toLowerCase()} shift`;
    if (info.kind === "off") return "Unavailable";
    if (info.kind === "unset") return "Not set yet";
    if (info.kind === "ot") return "Available, but it would be overtime";
    return "Available";
  }

  // ---------- state ----------
  const REPO = (() => {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const first = location.pathname.split("/").filter(Boolean)[0];
      return { owner: host.split(".")[0], name: first && !first.includes(".") ? first : host };
    }
    return { owner: "vtorres-designer", name: "availability" };
  })();
  const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/data.json`;

  let data = normalize(null);
  let savedObj = null; // owner: last saved copy
  let sha = null;
  let token = store.get(LS.token);
  let owner = false;
  let brush = "edit";
  let saving = false;
  let loadError = false;

  // ---------- GitHub ----------
  const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function gh(method, body, tok = token) {
    const res = await fetch(API, {
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
    return res.json();
  }

  async function fetchRemote(tok) {
    const j = await gh("GET", null, tok);
    return { data: normalize(JSON.parse(b64decode(j.content))), sha: j.sha };
  }

  // ---------- owner changes ----------
  function changes() {
    if (!savedObj) return { days: new Set(), settings: false };
    const keys = new Set([...Object.keys(data.days), ...Object.keys(savedObj.days)]);
    const days = new Set([...keys].filter((k) => JSON.stringify(data.days[k] ?? null) !== JSON.stringify(savedObj.days[k] ?? null)));
    const strip = (o) => JSON.stringify(Object.assign({}, o, { days: null, updated: null }));
    return { days, settings: strip(data) !== strip(savedObj) };
  }

  function afterChange() {
    const c = changes();
    if (c.days.size || c.settings) store.set(LS.draft, JSON.stringify({ baseSha: sha, data }));
    else store.del(LS.draft);
    render();
  }

  function setDay(k, rec) {
    if (rec) data.days[k] = rec;
    else delete data.days[k];
  }
  const openRec = (k, willing) => {
    const custom = willing && !sameSet(willing, data.willing);
    if (custom) return { s: "open", willing: SHIFT_KEYS.filter((x) => willing.includes(x)) };
    return !data.through || k > data.through ? { s: "open" } : null;
  };
  const workRec = (shift, hours) => ({ s: "work", shift, hours: Number(hours) > 0 ? Number(hours) : shiftHours(shift) });
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function applyBrush(k) {
    const cur = data.days[k];
    if (brush === "work") setDay(k, cur && cur.s === "work" ? openRec(k) : workRec("overnight"));
    else if (brush === "off") setDay(k, cur && cur.s === "off" ? openRec(k) : { s: "off" });
    else if (brush === "open") setDay(k, openRec(k, cur && cur.s === "open" ? cur.willing : null));
    afterChange();
  }

  // ---------- render ----------
  function weekRange() {
    const today = todayKey();
    const start = weekStartOf(today);
    let end;
    if (owner) {
      end = addDays(start, 7 * 7);
      if (data.through) { const t = addDays(weekStartOf(data.through), 7 * 4); if (t > end) end = t; }
    } else {
      end = data.through ? addDays(weekStartOf(data.through), 7) : addDays(start, 7 * 2);
      const marked = Object.keys(data.days).filter((k) => k >= start).sort().pop();
      if (marked && weekStartOf(marked) > end) end = weekStartOf(marked);
      if (end < addDays(start, 7)) end = addDays(start, 7);
    }
    const cap = addDays(start, 7 * 30);
    if (end > cap) end = cap;
    const weeks = [];
    for (let ws = start; ws <= end; ws = addDays(ws, 7)) weeks.push(ws);
    return weeks;
  }

  function weekLabel(ws) {
    const we = addDays(ws, 6);
    const a = dateOf(ws), b = dateOf(we);
    const m1 = fmt(ws, { month: "short" });
    return a.getMonth() === b.getMonth() ? `${m1} ${a.getDate()} – ${b.getDate()}` : `${m1} ${a.getDate()} – ${fmt(we, { month: "short" })} ${b.getDate()}`;
  }

  function render() {
    const name = data.name || "";
    const title = `${possessive(name)} availability`;
    $("#title").textContent = title;
    document.title = `${possessive(name)} Shift Availability`;
    $("#note").hidden = !data.note;
    $("#note").textContent = data.note;
    $("#updated").textContent = loadError
      ? "Couldn't load the latest calendar. Check your connection and refresh."
      : data.updated
        ? `Updated ${new Date(data.updated).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "";

    const w = $("#willing");
    w.replaceChildren();
    if (data.willing.length) {
      w.append(h("span", { class: "lbl", text: "Shifts I'll pick up:" }));
      for (const k of data.willing) {
        const s = data.shifts[k];
        w.append(h("span", { class: "chip" }, h("b", { text: s.label }), h("span", { text: `${fmtTime(s.start)}–${fmtTime(s.end)}` })));
      }
    }

    $("#dow").replaceChildren(...Array.from({ length: 7 }, (_, i) => h("span", { text: DOW[(data.weekStart + i) % 7] })));

    const today = todayKey();
    const pending = owner ? changes().days : new Set();
    const frag = document.createDocumentFragment();
    weekRange().forEach((ws, wi) => {
      const hrs = weekHours(ws);
      const days = h("div", { class: "days" });
      let anyKnown = false;
      for (let i = 0; i < 7; i++) {
        const k = addDays(ws, i);
        const info = dayInfo(k);
        if (info.kind !== "unset") anyKnown = true;
        const d = dateOf(k);
        const showPast = info.past && !owner;
        const cls = ["day", showPast ? "past" : info.kind];
        if (info.past && owner) cls.push("past");
        if (k === today) cls.push("today");
        if (pending.has(k)) cls.push("pending");
        const showMonth = d.getDate() === 1 || (wi === 0 && i === 0);
        days.append(h("button", {
          type: "button",
          class: cls.join(" "),
          "data-key": k,
          "aria-label": `${longDay(k)}: ${showPast ? "past" : statusText(info)}`,
          disabled: showPast ? true : null,
        },
        h("span", { class: "mon", text: showMonth ? fmt(k, { month: "short" }) : "" }),
        h("span", { class: "num", text: d.getDate() }),
        h("span", { class: "tag", text: showPast ? "" : TAGS[info.kind] })));
      }
      let right = "";
      if (hrs > 0) right = `${num(hrs)} hrs scheduled`;
      else if (!anyKnown) right = "Not posted yet";
      frag.append(h("div", { class: "week" },
        h("div", { class: "week-head" },
          h("b", { text: weekLabel(ws) }),
          h("span", { class: hrs >= data.otAfter ? "hrs over" : "hrs", text: hrs >= data.otAfter ? `${right} · at overtime` : right })),
        days));
    });
    $("#weeks").replaceChildren(frag);

    document.body.classList.toggle("owner", owner);
    $("#toolbar").hidden = !owner;
    $("#ownerBanner").hidden = !owner;
    $("#ownerLink").hidden = owner;
    if (owner) renderOwnerBits();
  }

  function renderOwnerBits() {
    const line = $("#throughLine");
    line.replaceChildren();
    const fix = h("button", { type: "button", class: "linkish", text: "Change", onclick: openSettings });
    if (data.through) line.append(`Supervisors see your nights through ${longDay(data.through)}. `, fix);
    else line.append("Mark your working nights, then set how far your schedule is entered so open nights turn green. ", fix);
    if (!data.phone) line.append(h("br"), "Add your cell number in Settings so supervisors can text you.");

    const c = changes();
    const n = c.days.size + (c.settings ? 1 : 0);
    const btn = $("#saveBtn");
    btn.disabled = saving || n === 0;
    btn.textContent = saving ? "Saving…" : n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Saved";
    for (const b of document.querySelectorAll(".brushes button")) b.setAttribute("aria-checked", String(b.dataset.brush === brush));
  }

  // ---------- supervisor sheet ----------
  function smsNumber() {
    const raw = data.phone.trim();
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    if (raw.startsWith("+")) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
    return digits;
  }
  function prettyPhone() {
    const d = data.phone.replace(/\D/g, "");
    const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
    return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : data.phone.trim();
  }
  const apple = () => /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(navigator.userAgent);

  function smsBody(k, sk, who) {
    const s = data.shifts[sk];
    const label = s.label.toLowerCase();
    const article = /^[aeiou]/.test(label) ? "an" : "a";
    const when = crosses(s)
      ? `from ${shortDay(k)} at ${fmtTime(s.start)} to ${shortDay(addDays(k, 1))} at ${fmtTime(s.end)}`
      : `on ${shortDay(k)}, ${fmtTime(s.start)} – ${fmtTime(s.end)}`;
    const ask = `${article} ${label} shift ${when}?`;
    const hi = data.name ? `Hi ${data.name}` : "Hi";
    return who ? `${hi}, it's ${who}. Can you cover ${ask}` : `${hi}, can you cover ${ask}`;
  }
  const smsHref = (body) => `sms:${smsNumber()}${apple() ? "&" : "?"}body=${encodeURIComponent(body)}`;

  function optionNote(k, o) {
    const s = data.shifts[o.key];
    const dow = fmt(k, { weekday: "short" });
    const span = crosses(s)
      ? `${fmtTime(s.start)} ${dow} – ${fmtTime(s.end)} ${fmt(addDays(k, 1), { weekday: "short" })}`
      : `${fmtTime(s.start)} – ${fmtTime(s.end)}`;
    return `${span} · ${num(o.hours)} hrs${o.ot ? " · overtime" : ""}`;
  }

  function openDay(k) {
    const info = dayInfo(k);
    $("#dayKicker").textContent = fmt(k, { weekday: "long" });
    $("#dayTitle").textContent = fmt(k, { month: "long", day: "numeric" });
    const body = $("#dayBody");
    body.replaceChildren();
    const sw = { open: "open", ot: "ot", work: "busy", off: "busy", unset: "none" }[info.kind];
    const headline = {
      open: "I'm available",
      ot: "I'm available, but it would be overtime",
      work: "I'm working this night",
      off: "I'm not available this night",
      unset: "Not set yet",
    }[info.kind];
    const wrap = h("div", { class: "stack" }, h("p", { class: "status-line" }, h("span", { class: `sw ${sw}` }), headline));

    if (info.kind === "work") {
      const s = data.shifts[info.shift];
      wrap.append(h("p", { class: "muted", text: `${s.label} shift, ${fmtTime(s.start)} – ${fmtTime(s.end)}.` }));
    } else if (info.kind === "unset") {
      wrap.append(h("p", { class: "muted", text: "I haven't entered my schedule this far out yet. Check back closer to the date." }));
    } else if (info.kind === "open" || info.kind === "ot") {
      if (info.booked > 0) wrap.append(h("p", { class: "muted", text: `I have ${num(info.booked)} hrs scheduled that week (overtime starts after ${num(data.otAfter)}).` }));
      if (!smsNumber()) {
        wrap.append(h("p", { class: "muted", text: "Texting isn't set up yet. Reach me the usual way." }));
      } else {
        const whoInput = h("input", { type: "text", id: "who", maxlength: "40", autocomplete: "name", placeholder: "So I know who's asking" });
        whoInput.value = store.get(LS.who) || "";
        const links = info.options.map((o) => {
          const a = h("a", { class: `btn go wide${o.ot ? " ot" : ""}` },
            h("span", { text: `Text me about ${data.shifts[o.key].label}` }),
            h("span", { class: "option-note", text: optionNote(k, o) }));
          return { a, o };
        });
        const refresh = () => {
          const who = whoInput.value.trim();
          for (const { a, o } of links) a.href = smsHref(smsBody(k, o.key, who));
        };
        whoInput.addEventListener("input", () => { store.set(LS.who, whoInput.value.trim()); refresh(); });
        refresh();
        const copyBtn = h("button", { type: "button", class: "btn ghost sm", text: "Copy number" });
        copyBtn.addEventListener("click", async () => { toast((await copyText(prettyPhone())) ? "Number copied" : "Couldn't copy. Press and hold the number instead."); });
        wrap.append(
          h("label", { class: "field" }, h("span", { class: "label", text: "Your name (optional)" }), whoInput),
          h("div", { class: "options" }, links.map((l) => l.a)),
          h("p", { class: "muted small", text: "Opens your texting app with the message filled in. Add your site or post, then hit send." }),
          h("p", { class: "contact" }, h("span", { text: "Or text" }), h("b", { text: prettyPhone() }), copyBtn)
        );
      }
    }
    body.append(wrap);
    $("#daySheet").showModal();
  }

  // ---------- owner: edit sheet ----------
  let editKey = null;
  function openEdit(k) {
    editKey = k;
    $("#editTitle").textContent = shortDay(k);
    const sel = $("#workShift");
    sel.replaceChildren(...SHIFT_KEYS.map((x) => h("option", { value: x, text: `${data.shifts[x].label} (${fmtTime(data.shifts[x].start)}–${fmtTime(data.shifts[x].end)})` })));
    fillEdit();
    $("#editSheet").showModal();
  }

  function fillEdit() {
    const k = editKey;
    const rec = data.days[k];
    const st = rec && (rec.s === "work" || rec.s === "off") ? rec.s : "open";
    $(`#st${st === "open" ? "Open" : st === "work" ? "Work" : "Off"}`).checked = true;
    $("#editWork").hidden = st !== "work";
    $("#editOpen").hidden = st !== "open";
    $("#editOff").hidden = st !== "off";
    if (st === "work") {
      $("#workShift").value = SHIFT_KEYS.includes(rec.shift) ? rec.shift : "overnight";
      $("#workHours").value = num(workHours(rec));
    }
    const willing = rec && rec.s === "open" && Array.isArray(rec.willing) ? rec.willing : data.willing;
    $("#editWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`ew-${x}`, x, willing.includes(x))));
    $("#useUsual").hidden = !(rec && Array.isArray(rec.willing));
    const info = dayInfo(k);
    let line = `${weekLabel(weekStartOf(k))}: ${num(info.booked)} hrs scheduled.`;
    if (st === "open") {
      if (!data.through || k > data.through) line += " This night is past your \"entered through\" date, so it shows green only because you marked it.";
      if (info.kind === "ot") line += " Shows yellow: any shift would go past overtime.";
    }
    $("#editWeek").textContent = line;
  }

  function checkRow(id, x, checked) {
    const s = data.shifts[x];
    return h("label", { class: "check", for: id },
      h("input", { type: "checkbox", id, value: x, checked: checked ? true : null }),
      h("span", null, h("b", { text: s.label }), h("small", { text: `${fmtTime(s.start)} – ${fmtTime(s.end)} · ${num(shiftHours(x))} hrs` })));
  }

  function onEditChange(e) {
    const k = editKey;
    if (!k) return;
    const st = document.querySelector('input[name="st"]:checked').value;
    if (st === "work") {
      const shift = $("#workShift").value || "overnight";
      const hoursEl = $("#workHours");
      if (e && (e.target.id === "workShift" || e.target.name === "st")) hoursEl.value = num(shiftHours(shift));
      setDay(k, workRec(shift, hoursEl.value));
    } else if (st === "off") {
      setDay(k, { s: "off" });
    } else {
      const fromBoxes = e && e.target.closest && e.target.closest("#editWilling");
      const cur = data.days[k];
      const willing = fromBoxes
        ? [...document.querySelectorAll("#editWilling input:checked")].map((i) => i.value)
        : cur && cur.s === "open" ? cur.willing : null;
      setDay(k, openRec(k, willing));
    }
    fillEdit();
    afterChange();
  }

  // ---------- owner: settings ----------
  function openSettings() {
    $("#setThrough").value = data.through;
    $("#setNote").value = data.note;
    $("#setName").value = data.name;
    $("#setPhone").value = data.phone;
    $("#setWeekStart").value = String(data.weekStart);
    $("#setOt").value = num(data.otAfter);
    $("#setWilling").replaceChildren(...SHIFT_KEYS.map((x) => checkRow(`sw-${x}`, x, data.willing.includes(x))));
    $("#setShifts").replaceChildren(...SHIFT_KEYS.map((x) => {
      const s = data.shifts[x];
      return h("div", { class: "shift-row", "data-shift": x },
        h("span", { class: "name", text: s.label }),
        h("label", { class: "field" }, h("span", { class: "label", text: "Starts" }), h("input", { type: "time", "data-f": "start", id: `st-${x}`, value: s.start })),
        h("label", { class: "field" }, h("span", { class: "label", text: "Ends" }), h("input", { type: "time", "data-f": "end", id: `en-${x}`, value: s.end })),
        h("label", { class: "field" }, h("span", { class: "label", text: "Paid hrs" }), h("input", { type: "number", "data-f": "hours", id: `hr-${x}`, min: "1", max: "24", step: "0.25", inputmode: "decimal", value: num(s.hours) })));
    }));
    $("#repoLine").textContent = `Saves to github.com/${REPO.owner}/${REPO.name}`;
    $("#settingsSheet").showModal();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.id === "setThrough") data.through = isKey(t.value) ? t.value : "";
    else if (t.id === "setNote") data.note = t.value.slice(0, 140);
    else if (t.id === "setName") data.name = t.value.trim().slice(0, 40);
    else if (t.id === "setPhone") data.phone = t.value.trim().slice(0, 20);
    else if (t.id === "setWeekStart") data.weekStart = parseInt(t.value, 10) || 0;
    else if (t.id === "setOt") { if (Number(t.value) > 0) data.otAfter = Number(t.value); }
    else if (t.closest("#setWilling")) data.willing = [...document.querySelectorAll("#setWilling input:checked")].map((i) => i.value);
    else if (t.dataset.f) {
      const x = t.closest("[data-shift]").dataset.shift;
      const s = data.shifts[x];
      if (t.dataset.f === "hours") { if (Number(t.value) > 0) s.hours = Number(t.value); }
      else if (t.value) {
        s[t.dataset.f] = t.value;
        s.hours = spanHours(s);
        $(`#hr-${x}`).value = num(s.hours);
      }
    } else return;
    afterChange();
  }

  // ---------- owner: connect / save ----------
  async function enterOwner() {
    owner = true;
    brush = ["edit", "work", "off", "open"].includes(store.get(LS.brush)) ? store.get(LS.brush) : "edit";
    try {
      const remote = await fetchRemote(token);
      savedObj = remote.data;
      sha = remote.sha;
      let restored = false;
      try {
        const d = JSON.parse(store.get(LS.draft) || "null");
        if (d && d.data) {
          data = normalize(d.data);
          sha = d.baseSha || sha; // an older base makes Save report the conflict instead of overwriting
          restored = true;
        }
      } catch { /* bad draft */ }
      if (!restored) data = clone(savedObj);
      loadError = false;
      render();
      const c = changes();
      if (restored && (c.days.size || c.settings)) toast("Restored changes you hadn't saved yet");
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
    $("#repoName").textContent = REPO.name;
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
      await fetchRemote(tok);
      token = tok;
      store.set(LS.token, tok);
      $("#tokenInput").value = "";
      $("#unlockSheet").close();
      await enterOwner();
      toast("Connected. You can edit now.");
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

  async function save(force) {
    if (saving) return;
    saving = true;
    renderOwnerBits();
    const out = clone(data);
    out.updated = new Date().toISOString();
    const cutoff = addDays(todayKey(), -60);
    for (const k of Object.keys(out.days)) if (k < cutoff) delete out.days[k];
    try {
      if (force) sha = (await fetchRemote(token)).sha;
      const res = await gh("PUT", {
        message: `Update availability (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
        content: b64encode(JSON.stringify(out, null, 2) + "\n"),
        sha,
      });
      sha = res.content.sha;
      data = normalize(out);
      savedObj = clone(data);
      store.del(LS.draft);
      toast("Saved. Supervisors will see it within a minute or two.", 4200);
    } catch (e) {
      if (e.status === 409 || e.status === 422) $("#conflictSheet").showModal();
      else if (e.status === 401) toast("GitHub no longer accepts your key. Open Settings, tap Stop editing, then connect again.", 6000);
      else if (e.status === 403 || e.status === 404) toast("Your key can read but not save. On GitHub, set the token's Contents permission to Read and write.", 6000);
      else toast("Couldn't save. Check your connection and tap Save again.", 5000);
    } finally {
      saving = false;
      render();
    }
  }

  async function onConflict() {
    const v = $("#conflictSheet").returnValue;
    if (v === "overwrite") return save(true);
    if (v === "reload") {
      store.del(LS.draft);
      await enterOwner();
      toast("Loaded the newer calendar");
    }
  }

  // ---------- wiring ----------
  function wire() {
    for (const x of document.querySelectorAll(".sheet .x")) {
      x.type = "button";
      x.addEventListener("click", () => x.closest("dialog").close());
    }
    for (const d of document.querySelectorAll("dialog.sheet")) {
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    }
    $("#weeks").addEventListener("click", (e) => {
      const b = e.target.closest(".day");
      if (!b || b.disabled) return;
      const k = b.dataset.key;
      if (!owner) return openDay(k);
      if (brush === "edit") openEdit(k);
      else applyBrush(k);
    });
    $("#ownerLink").addEventListener("click", () => (token ? enterOwner() : openUnlock()));
    $("#unlockForm").addEventListener("submit", onUnlock);
    $("#editForm").addEventListener("change", onEditChange);
    $("#workHours").addEventListener("input", onEditChange);
    $("#useUsual").addEventListener("click", () => { setDay(editKey, openRec(editKey)); fillEdit(); afterChange(); });
    $("#settingsForm").addEventListener("input", onSettingsChange);
    $("#settingsForm").addEventListener("change", onSettingsChange);
    for (const b of document.querySelectorAll("[data-through]")) {
      b.addEventListener("click", () => {
        const base = data.through && data.through >= todayKey() ? data.through : addDays(weekStartOf(todayKey()), 6);
        data.through = addDays(base, 7 * Number(b.dataset.through));
        $("#setThrough").value = data.through;
        afterChange();
      });
    }
    $("#signOut").addEventListener("click", () => {
      store.del(LS.token);
      store.del(LS.draft);
      location.reload();
    });
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#saveBtn").addEventListener("click", () => save(false));
    $("#conflictSheet").addEventListener("close", onConflict);
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
      data = normalize(await r.json());
    } catch {
      loadError = true;
    }
    render();
    if (token) await enterOwner();
  }

  boot();
})();
