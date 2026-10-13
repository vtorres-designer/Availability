// A small stand-in for Google's services, so Code.gs + Engine.gs can run in Node.
const fs = require('fs'), vm = require('vm');
module.exports = function load(opts = {}) {
  const sheets = {}, propsStore = Object.assign({}, opts.props || {}), fetches = [], cache = {};
  function mkSheet(name) {
    const rows = [];
    const sh = {
      rows, getName: () => name,
      appendRow: (r) => rows.push(r.slice()),
      setFrozenRows() {}, hideColumns() {}, setColumnWidth() {},
      getLastRow: () => rows.length, getLastColumn: () => rows.length ? rows[0].length : 0,
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = []; for (let i = 0; i < nc; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
        setValue: (v) => { rows[r - 1][c - 1] = v; }, setValues: (vs) => vs.forEach((row, i) => row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; })),
        setFontWeight() { return this; }, insertCheckboxes() {}, clearContent: () => { rows.splice(r - 1, nr); },
      }),
    };
    return sh;
  }
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n)), getSheets: () => Object.values(sheets), deleteSheet() {}, setActiveSheet() {}, setSpreadsheetTimeZone() {} };
  const pad = n => String(n).padStart(2, '0');
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, encodeURIComponent,
    SpreadsheetApp: { getActive: () => ss, getUi: () => ({ alert() {}, createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => propsStore[k] ?? null, setProperty: (k, v) => { propsStore[k] = v; }, deleteProperty: k => { delete propsStore[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/XYZ/exec' }) },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(),
      formatDate: (d, tz, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(d).map(x => [x.type, x.value]));
        if (f === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
        if (f === 'HH:mm') return `${p.hour}:${p.minute}`;
        if (f === 'EEEE') return p.weekday;
        return `${p.weekday.slice(0, 3)} ${+p.month}/${+p.day} ${p.hour}:${p.minute}`;
      },
    },
    UrlFetchApp: {
      fetch: (url, o = {}) => {
        fetches.push({ url, o });
        const r = opts.fetch(url, o);
        return { getResponseCode: () => r.code || 200, getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
      },
    },
    HtmlService: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/Engine.gs', 'utf8') + '\n' + fs.readFileSync(__dirname + '/Code.gs', 'utf8') + '\nthis.__x = {ENGINE, doPost, handleText, apiEntry, apiList, apiAct, apiOutcome, apiSites, apiSaveSite, ensureSheets, setupState, saveSetup, runSamples, COL, LOG_HEAD};', ctx);
  return Object.assign(ctx.__x, { sheets, props: propsStore, fetches });
};
