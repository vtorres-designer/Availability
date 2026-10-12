// Run with `node tests/shift-availability.cjs` where Playwright and Chromium are installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('app.js').replace('  boot();', '  window.testModel = {normalizePub, normalizePriv, derivePublic, derivePublicOt, pickupTypes, dayRec, hoursInWeek, todayKey, addDays, dateOf};\n  boot();');
const fixture = {...JSON.parse(read('data.json')), weekendWilling: ['morning', 'swing']};
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://local').pathname).slice(1) || 'index.html';
  if (!['index.html', 'app.js', 'app.css', 'parser.js', 'vendor/qrcode.js', 'data.json', 'credentials.pdf'].includes(name)) {res.writeHead(404).end(); return;}
  const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.pdf') ? 'application/pdf' : 'text/html';
  res.setHeader('Content-Type', mime); res.end(name === 'app.js' ? source : fs.readFileSync(path.join(root, name)));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const modelPage = await browser.newPage({timezoneId: 'America/Denver', reducedMotion: 'reduce'});
    await modelPage.goto(url);
    await modelPage.waitForFunction(() => window.testModel);
    const model = await modelPage.evaluate(() => {
      const m = testModel, today = m.todayKey();
      let sat = m.addDays(today, 2); while (m.dateOf(sat).getDay() !== 6) sat = m.addDays(sat, 1);
      const fri = m.addDays(sat, -1), sun = m.addDays(sat, 1), mon = m.addDays(sat, 2);
      const p = m.normalizePub({willing: ['overnight'], weekendWilling: ['morning', 'swing'], weekStart: 5});
      const v = m.normalizePriv({otAfter: 40, pickup: 8, weekly: [{d: 5, s: 'work', start: '23:00', end: '07:00', hours: 8}, {d: 6, s: 'work', start: '23:00', end: '07:00', hours: 8}, {d: 0, s: 'work', start: '23:00', end: '07:00', hours: 8}], days: {[mon]: {s: 'open'}}});
      const out = m.derivePublic(p, v);
      const normal = m.pickupTypes(sat, p, v);
      const weeklyPublished = out[sat];
      const hours = m.hoursInWeek(fri, v);
      v.days[fri] = {s: 'work', start: '23:00', end: '09:00', hours: 10};
      const overlap = m.pickupTypes(sat, p, v);
      v.days[fri] = {s: 'work', hours: 8}; const unknownAdjacent = m.pickupTypes(sat, p, v);
      v.days[fri] = {s: 'work', start: '23:00', end: '07:00', hours: 8};
      v.days[sat] = {s: 'busy'}; const busy = m.pickupTypes(sat, p, v);
      v.days[sat] = {s: 'work', hours: 8}; const unknown = m.pickupTypes(sat, p, v);
      v.days[sat] = {s: 'work', start: '23:00', end: '07:00', hours: 8, w: []}; const noPickup = m.pickupTypes(sat, p, v);
      v.days[sat] = {s: 'work', start: '23:00', end: '07:00', hours: 8, w: ['swing']}; const override = m.pickupTypes(sat, p, v);
      return {sat, fri, mon, normal, weeklyPublished, hours, overlap, unknownAdjacent, busy, unknown, noPickup, override, weekday: out[mon], publicJSON: JSON.stringify(out), clean: m.normalizePriv(v).days[sat]};
    });
    assert.deepEqual(model.normal.sort(), ['morning', 'swing']);
    assert.deepEqual(model.weeklyPublished.w.sort(), ['morning', 'swing']);
    assert.equal(model.hours, 24);
    assert.deepEqual(model.overlap, ['swing']);
    for (const key of ['busy', 'unknown', 'unknownAdjacent', 'noPickup']) assert.deepEqual(model[key], []);
    assert.deepEqual(model.override, ['swing']);
    assert.deepEqual(model.clean.w, ['swing']);
    assert.deepEqual(model.weekday.w, ['overnight']);
    assert(!/start|end|hours|note/.test(model.publicJSON));
    console.log('PASS: weekends, working-day availability, adjacent overlaps, weekly rules, daily overrides, overtime hours, and public privacy');
    await modelPage.close();

    for (const mobile of [false, true]) {
      const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1200, height: 900}, timezoneId: 'America/Denver', reducedMotion: 'no-preference', ...(mobile ? {isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'} : {})});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const data = {...fixture, days: {[model.sat]: {s: 'open', w: ['morning', 'swing']}, [model.mon]: {s: 'open', w: ['overnight']}}, weekly: [], ot: null, callHours: 0};
      await page.route('**/data.json?*', route => route.fulfill({json: data}));
      await page.goto(url);
      await page.locator(`[data-key="${model.sat}"]`).click();
      await page.waitForTimeout(400);
      const available = page.locator('[data-type="morning"]'), unavailable = page.locator('[data-type="overnight"]');
      assert.deepEqual(await page.locator('.shift-button').allTextContents(), ['Morning', 'Swing', 'Overnight']);
      assert(await unavailable.isDisabled());
      const fixed = () => available.evaluate(e => ({base: e.getBoundingClientRect().top, shadow: getComputedStyle(e).boxShadow, face: e.querySelector('.shift-face').getBoundingClientRect().top}));
      const before = await fixed(); await page.waitForTimeout(1000); const after = await fixed();
      assert.equal(before.base, after.base); assert.equal(before.shadow, after.shadow); assert(Math.abs(before.face - after.face) > .2);
      const disabledStyle = await unavailable.evaluate(e => ({bg: getComputedStyle(e).backgroundColor, animation: getComputedStyle(e.querySelector('.shift-face')).animationName, strike: getComputedStyle(e.querySelector('.shift-name')).textDecorationLine, weight: getComputedStyle(e.querySelector('.shift-name')).fontWeight}));
      assert.equal(disabledStyle.bg, 'rgba(0, 0, 0, 0)'); assert.equal(disabledStyle.animation, 'none'); assert.equal(disabledStyle.strike, 'line-through'); assert.equal(disabledStyle.weight, '400');
      await unavailable.evaluate(e => e.click()); assert.equal(await page.locator('#sendNow').count(), 0);
      await available.click({force: true}); await page.waitForTimeout(400);
      assert.equal(await page.locator('#dayBody input').count(), 0);
      if (mobile) assert((await page.locator('#sendNow').getAttribute('href')).startsWith('sms:')); else { await page.locator('#sendNow').click(); await page.waitForSelector('.qr-send svg'); }
      await page.locator('#customize').click(); await page.waitForTimeout(400);
      await page.locator('#txStart').fill('7am'); await page.locator('#txEnd').fill('3pm');
      assert((await page.locator('#txMsg').inputValue()).includes('7:00 AM to 3:00 PM'));
      await page.locator('#dayBack').click(); await page.waitForTimeout(400);
      await page.locator('#dayBack').click(); await page.waitForTimeout(400);
      await page.emulateMedia({reducedMotion: 'reduce'});
      assert.equal(await available.locator('.shift-face').evaluate(e => getComputedStyle(e).animationName), 'none');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (!mobile) await page.screenshot({path: '/tmp/availability-shift-buttons.png', fullPage: true});
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? 'phone' : 'desktop'} buttons, anchored animation, disabled semantics, quick sending, custom times, back navigation, and reduced motion`);
      await page.close();
    }
    const potPage = await browser.newPage({reducedMotion: 'reduce', timezoneId: 'America/Denver'});
    await potPage.route('**/data.json?*', route => route.fulfill({json: {...fixture, weekStart: 5, days: {[model.sat]: {s: 'open', w: ['morning', 'swing']}}, weekly: [], ot: {shift: 8, left: {[model.fri]: 3}}, callHours: 0}}));
    await potPage.goto(url); await potPage.locator(`[data-key="${model.sat}"]`).click(); await potPage.waitForTimeout(400);
    assert.equal(await potPage.locator('.shift-button').count(), 3);
    await potPage.locator('[data-type="morning"]').click(); await potPage.waitForTimeout(400);
    assert(await potPage.locator('#sendNow').isEnabled());
    await potPage.locator('#customize').click(); await potPage.waitForTimeout(400);
    await potPage.locator('#txStart').fill('7am'); await potPage.locator('#txEnd').fill('3pm');
    assert((await potPage.locator('#txMsg').inputValue()).includes('5 of the 8 hours'));
    assert.equal(await potPage.locator('.decline').count(), 0);
    console.log('PASS: partly-overtime days show shift choices and daytime custom times retain correct overtime');
    await potPage.close();

    // All GitHub operations below are intercepted locally; no real credentials or writes are used.
    const ownerPage = await browser.newPage({reducedMotion: 'reduce', timezoneId: 'America/Denver'});
    const ownerErrors = []; ownerPage.on('pageerror', e => ownerErrors.push(e.message));
    let remoteData = {...fixture, days: {[model.sat]: {s: 'busy'}}, weekly: [], ot: null};
    let remotePrivate = {otAfter: 40, pickup: 8, weekly: [], days: {[model.sat]: {s: 'work', start: '23:00', end: '07:00', hours: 8, note: 'Private site'}}};
    let sha = 'test-sha', updated = '2026-01-01T00:00:00Z', writes = 0;
    await ownerPage.addInitScript(() => localStorage.setItem('sa.token', 'test-only-placeholder'));
    await ownerPage.route('**/data.json?*', route => route.fulfill({json: remoteData}));
    await ownerPage.route('https://api.github.com/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname, method = request.method();
      if ((pathname.endsWith('/actions/variables') && method === 'POST') || pathname.endsWith('/actions/variables/AVAILABILITY_KEY_CHECK')) return route.fulfill({status: 204});
      if (pathname.endsWith('/contents/data.json')) {
        if (method === 'GET') return route.fulfill({json: {content: Buffer.from(JSON.stringify(remoteData)).toString('base64'), sha}});
        assert.equal(method, 'PUT'); remoteData = JSON.parse(Buffer.from(request.postDataJSON().content, 'base64').toString()); sha = 'saved-test-sha'; writes++; return route.fulfill({json: {content: {sha}}});
      }
      if (pathname.endsWith('/actions/variables/AVAILABILITY_PRIVATE')) {
        if (method === 'GET') return route.fulfill({json: {value: JSON.stringify(remotePrivate), updated_at: updated}});
        assert.equal(method, 'PATCH'); remotePrivate = JSON.parse(request.postDataJSON().value); updated = '2026-01-02T00:00:00Z'; return route.fulfill({status: 204});
      }
      return route.fulfill({status: 404, json: {message: 'Not Found'}});
    });
    await ownerPage.goto(url); await ownerPage.waitForSelector('#ownerBanner', {state: 'visible'});
    assert(await ownerPage.locator('#saveBtn').isEnabled());
    await ownerPage.locator('#settingsBtn').click(); await ownerPage.waitForTimeout(400);
    assert.equal(await ownerPage.locator('#setWilling').count(), 0);
    assert.equal(await ownerPage.locator('#setWeekendWilling').count(), 0);
    await ownerPage.keyboard.press('Escape'); await ownerPage.waitForTimeout(400);
    await ownerPage.locator(`[data-key="${model.sat}"]`).click(); await ownerPage.waitForTimeout(400);
    assert(await ownerPage.locator('#editPickup').isVisible());
    await ownerPage.locator('#ew-morning').uncheck();
    await ownerPage.keyboard.press('Escape'); await ownerPage.waitForTimeout(400);
    await ownerPage.locator('#previewBtn').click(); await ownerPage.waitForTimeout(400);
    await ownerPage.locator(`[data-key="${model.sat}"]`).click(); await ownerPage.waitForTimeout(400);
    assert(await ownerPage.locator('[data-type="morning"]').isDisabled()); assert(await ownerPage.locator('[data-type="overnight"]').isDisabled()); assert(await ownerPage.locator('[data-type="swing"]').isEnabled());
    await ownerPage.keyboard.press('Escape'); await ownerPage.locator('#previewExit').click(); await ownerPage.waitForTimeout(400);
    await ownerPage.locator('#saveBtn').click(); await ownerPage.waitForFunction(() => document.querySelector('#saveBtn').textContent === 'Saved');
    assert.equal(writes, 1); assert.deepEqual(remoteData.days[model.sat].w, ['swing']);
    assert.equal(remotePrivate.days[model.sat].start, '23:00'); assert.equal(remotePrivate.days[model.sat].end, '07:00'); assert.equal(remotePrivate.days[model.sat].hours, 8); assert.equal(remotePrivate.days[model.sat].note, 'Private site');
    assert.deepEqual(ownerErrors, []);
    console.log('PASS: Settings, working-day pickup overrides, preview, and mocked save preserve private times, hours, and notes');
    await ownerPage.close();
  } finally {await browser.close(); server.close();}
})().catch(e => {console.error(e); server.close(); process.exitCode = 1;});
