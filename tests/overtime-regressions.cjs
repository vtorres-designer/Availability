// Synthetic schedules and intercepted requests only. Run: node tests/overtime-regressions.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace('  boot();', `
  window.otTest = { normalizePub, normalizePriv, derivePublicOt, hoursInWeek, potShift, typedSpan,
    shiftOt, cleanOt, addDays, todayKey, dateOf, weekStartOf, defaultSpan, otIn, otStretches, otKind,
    configure(p, days, ot) { pub = normalizePub(p); pubDays = days; pubOt = cleanOt(ot); } };
  boot();`);
const base = { v: 2, name: 'Test Owner', phone: '5555555555', willing: ['overnight'], weekStart: 5,
  weekly: [], days: {}, ot: null, callHours: 0 };
const files = new Set(['index.html', 'app.js', 'app.css', 'parser.js', 'vendor/qrcode.js']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
  if (name === 'data.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(base)); return; }
  if (!files.has(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(name === 'app.js' ? source : fs.readFileSync(path.join(root, name)));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const modelPage = await browser.newPage({ timezoneId: 'America/Denver', reducedMotion: 'reduce' });
    await modelPage.goto(url);
    await modelPage.waitForFunction(() => window.otTest);
    const model = await modelPage.evaluate(() => {
      const m = otTest;
      let fri = m.addDays(m.todayKey(), 1);
      while (m.dateOf(fri).getDay() !== 5) fri = m.addDays(fri, 1);
      const thu = m.addDays(fri, 6), next = m.addDays(fri, 7), mon = m.addDays(fri, 3);
      const p = m.normalizePub({ willing: ['morning'], weekStart: 5 });
      const days = { [mon]: { s: 'open', w: ['morning'] } };
      const v = m.normalizePriv({ otAfter: 40, pickup: 8, days: {
        [fri]: { s: 'work', hours: 8 }, [m.addDays(fri, 1)]: { s: 'work', hours: 8 },
        [m.addDays(fri, 2)]: { s: 'work', hours: 8 }, [m.addDays(fri, 4)]: { s: 'work', hours: 8 },
        [mon]: { s: 'open' } } });
      const longOt = m.derivePublicOt(p, v, days);
      m.configure(p, days, longOt);
      const longer = m.shiftOt(mon, 'morning', { start: '07:00', end: '19:00' });
      m.configure(p, days, { shift: 8, left: {} });
      const oldLonger = m.shiftOt(mon, 'morning', { start: '07:00', end: '19:00' });
      const oldUsual = m.shiftOt(mon, 'morning', { start: '07:00', end: '15:00' });
      const low = m.normalizePriv({ otAfter: 40, pickup: 8, days: {
        [fri]: { s: 'work', hours: 8 }, [m.addDays(fri, 1)]: { s: 'work', hours: 8 }, [mon]: { s: 'open' } } });
      const lowOt = m.derivePublicOt(p, low, days);
      m.configure(p, days, lowOt);
      const below = m.shiftOt(mon, 'morning', { start: '07:00', end: '19:00' });
      const boundarySchedule = m.normalizePriv({ otAfter: 10, pickup: 8, days: {
        [m.addDays(fri, -1)]: { s: 'work', start: '22:00', end: '06:00', hours: 8 }, [mon]: { s: 'open' } } });
      const actualBoundary = { current: m.hoursInWeek(fri, boundarySchedule),
        previous: m.hoursInWeek(m.addDays(fri, -7), boundarySchedule), publicOt: m.derivePublicOt(p, boundarySchedule, days) };
      const boundaryCases = [];
      for (const booked of [0, 8, 16, 24, 32, 40, 48]) {
        const left = w => w === fri ? 40 - booked : 0;
        const span = m.defaultSpan('overnight', 8);
        boundaryCases.push({ booked, result: m.otIn(thu, span, 5, left),
          kind: m.otKind(thu, ['morning', 'swing', 'overnight'], 8, 5, left),
          stretches: m.otStretches(thu, span, 5, left) });
      }
      const reads = [];
      const oneBalance = m.otIn(thu, m.defaultSpan('overnight', 8), 5, (w, hours) => {
        reads.push({ week: w, hours }); return w === fri ? 8 : null;
      });
      const partial = m.otIn(thu, m.defaultSpan('overnight', 8), 5, w => w === fri ? 7 : 0);
      const longerBoundary = m.otIn(thu, m.defaultSpan('overnight', 12), 5, w => w === fri ? 8 : 0);
      const unknownStart = m.otIn(thu, m.defaultSpan('overnight', 8), 5, w => w === fri ? null : 0);
      // Check the bar against the overtime result across requested lengths and threshold balances.
      // These include shifts crossing midnight and genuine partial overtime, without any next-week spillover.
      const barChecks = [];
      for (const len of [4, 8, 8.5, 12, 24]) for (const remaining of [0, 1, 7, 8, 16, 24]) {
        const span = { start: 1380, len: len * 60 }, left = w => w === fri ? remaining : 0;
        const result = m.otIn(thu, span, 5, left), stretches = m.otStretches(thu, span, 5, left);
        barChecks.push({ len, remaining, result, stretches,
          totalMinutes: stretches.reduce((n, s) => n + s.to - s.from, 0),
          overtimeMinutes: stretches.filter(s => s.ot).reduce((n, s) => n + s.to - s.from, 0) });
      }
      const potDays = { [thu]: { s: 'open', w: ['overnight', 'morning'] } };
      const potOt = { shift: 8, limit: 24, left: { [fri]: 1, [next]: 0 } };
      m.configure({ weekStart: 5, willing: ['overnight'] }, potDays, potOt);
      const overnight = { chosen: m.shiftOt(thu, 'overnight', null),
        typed: m.potShift(thu, 60, 540, 'overnight') };
      m.configure({ weekStart: 5, willing: ['overnight'], potFrom: '19:00', potTo: '00:00', potMax: 8 }, potDays, potOt);
      const limits = { morning: m.potShift(thu, 420, 900, 'morning'),
        longMorning: m.potShift(thu, 420, 1140, 'morning'),
        outsideNight: m.potShift(thu, 60, 540, 'overnight') };
      return { fri, thu, next, mon, longOt, longer, oldLonger, oldUsual, lowOt, below,
        actualBoundary, boundaryCases, oneBalance, reads, partial, longerBoundary, unknownStart, barChecks, overnight, limits };
    });
    assert.equal(model.longOt.limit, 24);
    assert.equal(model.longOt.left[model.fri], 8);
    assert.deepEqual(model.longer, { hours: 12, ot: 4 });
    assert.equal(model.oldLonger, null);
    assert.deepEqual(model.oldUsual, { hours: 8, ot: 0 });
    assert(!(model.fri in model.lowOt.left));
    assert.deepEqual(model.below, { hours: 12, ot: 0 });
    assert.equal(model.actualBoundary.previous, 8);
    assert.equal(model.actualBoundary.current, 0);
    assert.equal(model.actualBoundary.publicOt.left[model.fri], 10);
    for (const { booked, result, kind, stretches } of model.boundaryCases) {
      const expectedOt = booked >= 40 ? 8 : 0;
      assert.deepEqual(result, { hours: 8, ot: expectedOt }, `${booked} scheduled hours: Thursday overnight`);
      assert.equal(kind, booked >= 40 ? 'ot' : 'open');
      assert.deepEqual(stretches, [{ from: 0, to: 480, ot: booked >= 40 }]);
    }
    assert.deepEqual(model.oneBalance, { hours: 8, ot: 0 });
    assert.deepEqual(model.reads, [{ week: model.fri, hours: 8 }]);
    assert.deepEqual(model.partial, { hours: 8, ot: 1 });
    assert.deepEqual(model.longerBoundary, { hours: 12, ot: 4 });
    assert.equal(model.unknownStart, null);
    for (const check of model.barChecks) {
      assert.equal(check.totalMinutes, check.len * 60);
      assert.equal(check.overtimeMinutes, check.result.ot * 60);
      assert.equal(check.result.ot, Math.max(0, check.len - check.remaining));
      for (let i = 1; i < check.stretches.length; i++) assert.equal(check.stretches[i - 1].to, check.stretches[i].from);
    }
    assert.deepEqual(model.overnight.chosen, { hours: 8, ot: 7 });
    assert.equal(model.overnight.typed.span.start, 1500);
    assert.deepEqual(model.overnight.typed.r, { hours: 8, ot: 8 });
    assert.deepEqual(model.limits.morning.no, []);
    assert(model.limits.longMorning.no.some(reason => reason.includes('longer than 8 hours')));
    assert(model.limits.outsideNight.no.some(reason => reason.includes('between')));
    console.log('PASS: full-shift pay-week allocation, no false P-OT at 24/32 hours, overtime-bar agreement, long requests, old-file uncertainty, next-morning placement, and P-OT limits');
    await modelPage.close();

    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 },
        timezoneId: 'America/Denver', reducedMotion: 'reduce', ...(mobile ? { isMobile: true,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } : {}) });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const click = async selector => { await page.locator(selector).click(); await page.waitForTimeout(400); };
      const fixture = { ...base, willing: ['morning', 'overnight'], potFrom: '15:00', potTo: '08:00', potMax: 12,
        days: { [model.thu]: { s: 'open', w: ['morning', 'overnight'] }, [model.mon]: { s: 'open', w: ['morning'] } },
        ot: { shift: 8, limit: 24, left: { [model.fri]: 1, [model.next]: 0 } } };
      await page.route('**/data.json?*', route => route.fulfill({ json: fixture }));
      await page.goto(url);
      await click(`[data-key="${model.thu}"]`);
      await click('[data-type="overnight"]');
      assert.equal(await page.locator('#dayBody input').count(), 0);
      await click('#customize');
      await page.locator('#txWho').fill('Alice');
      await page.locator('#txStart').fill('8am');
      await page.locator('#txEnd').fill('4pm');
      const message = await page.locator('#txMsg').inputValue();
      assert(message.includes('on the day of'));
      assert(message.includes('all 8 hours'));
      const nextLabel = await page.evaluate(k => new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), model.next);
      assert(message.includes(nextLabel));
      await click('.shift-chosen .linkish');
      assert((await page.locator('#qkMsg').textContent()).includes('This is Alice.'));
      if (mobile) assert(decodeURIComponent(await page.locator('#sendNow').getAttribute('href')).includes('This is Alice.'));
      await click('#customize');
      assert.equal(await page.locator('#txStart').inputValue(), '8am');
      await page.locator('#txStart').fill('1am');
      await page.locator('#txEnd').fill('9am');
      assert((await page.locator('#txMsg').inputValue()).includes('all 8 hours'));
      await page.locator('#txStart').fill('7am');
      await page.locator('#txEnd').fill('7pm');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await click(`[data-key="${model.mon}"]`);
      await click('[data-type="morning"]');
      await click('#customize');
      // The morning is on a P-OT day; the overnight-only range must not reject its 7 AM start.
      await page.locator('#txStart').fill('7am');
      await page.locator('#txEnd').fill('3pm');
      assert.equal(await page.locator('.decline').count(), 0);
      assert((await page.locator('#txMsg').inputValue()).includes('7 of the 8 hours'));
      await page.locator('#txEnd').fill('8pm');
      assert((await page.locator('#dayBody .status-line').textContent()).includes('longer than 12 hours'));
      if (mobile) assert.equal(await page.locator('.send-opts a').getAttribute('href'), null);
      else assert(await page.locator('.qr-send').isHidden());
      await page.locator('#txEnd').fill('');
      assert((await page.locator('#dayBody').textContent()).includes('Enter both start and end'));
      await page.locator('#txStart').fill('');
      if (mobile) assert((await page.locator('.send-opts a').getAttribute('href')).startsWith('sms:'));
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? 'phone' : 'desktop'} custom dawn wording, next-morning overtime, Quick Text refresh, remembered times, and P-OT validation`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
