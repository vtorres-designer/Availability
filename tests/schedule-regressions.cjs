// Synthetic regression checks; GitHub requests are intercepted, and no real private data is read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace('  boot();', `
  window.scheduleTest = {normalizePriv, normalizePub, scheduledRec, pickupTypes, hoursInWeek, derivePublic, derivePublicOt, privatePayload, diffOf, applyDiff, changes, loadOwnerState, todayKey, addDays, weekStartOf,
    seed(p, v) {pub=normalizePub(p); priv=normalizePriv(v); saved={pub:clone(pub),priv:clone(priv)};owner=true;dataIn=true;busy=false;pubSha='test-sha';privAt='test-time';privExists=true;brush='edit';forgetAutoCopies();render();},
    read() {return {pub:clone(pub),priv:clone(priv),diff:diffOf()};}
  }; boot();`);
const server = http.createServer((req,res) => {
  const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
  if (!['index.html','app.js','app.css','parser.js','data.json','credentials.pdf','vendor/qrcode.js'].includes(name)) {res.writeHead(404).end();return;}
  res.setHeader('Content-Type', name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');
  res.end(name==='app.js'?source:fs.readFileSync(path.join(root,name)));
});
const publicFixture = {v:2,name:'Test',phone:'5551234567',willing:['overnight'],weekendWilling:['morning','swing'],weekStart:5,days:{},weekly:[0,5,6],ot:{shift:8,left:{}},nightAuto:true};
const weekly = [{d:5,s:'work',start:'22:00',end:'06:00',hours:8},{d:6,s:'work',start:'23:00',end:'07:00',hours:8},{d:0,s:'work',start:'23:00',end:'07:00',hours:8}].sort((a,b)=>a.d-b.d);
const fixture = {otAfter:40,pickup:8,weekly,days:{'2026-10-08':{s:'work',start:'23:00',end:'07:00',hours:8},'2026-10-17':{s:'open',w:['morning','swing','overnight']},'2026-10-18':{s:'open',w:['morning','swing','overnight']},'2026-10-22':{s:'work',start:'21:00',end:'07:00',hours:8},'2026-10-24':{s:'open',w:['morning','swing','overnight']},'2026-10-25':{s:'open',w:['morning','swing','overnight']}},pickups:{}};
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page=await browser.newPage({timezoneId:'America/Denver',reducedMotion:'reduce'});
    await page.addInitScript(() => {
      const NativeDate=Date, now=NativeDate.now.bind(NativeDate), offset=NativeDate.parse('2026-10-12T18:00:00Z')-now();
      window.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[now()+offset]));}static now(){return now()+offset;}};
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/data.json?*',route=>route.fulfill({json:publicFixture}));
    let remotePublic={...publicFixture},remotePrivate=structuredClone(fixture),rawPrivate=null,writes=0;
    await page.route('https://api.github.com/**',async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(url.pathname.endsWith('/contents/data.json')){
        if(method==='GET')return route.fulfill({json:{sha:'test-sha',content:Buffer.from(JSON.stringify(remotePublic)).toString('base64')}});
        assert.equal(method,'PUT');remotePublic=JSON.parse(Buffer.from(req.postDataJSON().content,'base64').toString());writes++;return route.fulfill({json:{content:{sha:'test-sha'}}});
      }
      if(url.pathname.endsWith('/actions/variables/AVAILABILITY_PRIVATE')){
        if(method==='GET')return route.fulfill({json:{value:rawPrivate===null?JSON.stringify(remotePrivate):rawPrivate,updated_at:'test-time'}});
        assert.equal(method,'PATCH');remotePrivate=JSON.parse(req.postDataJSON().value);return route.fulfill({status:204});
      }
      return route.fulfill({status:404,json:{message:'Not Found'}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>window.scheduleTest);
    const result=await page.evaluate(({p,v})=>{
      const m=scheduleTest,state=m.normalizePriv(v),pub=m.normalizePub(p);
      const weeks=['2026-10-09','2026-10-16','2026-10-23','2026-10-30'];
      const totals=weeks.map(w=>m.hoursInWeek(w,state));
      const choices=m.pickupTypes('2026-10-17',pub,state);
      state.pickups['2026-10-17']={s:'busy'};const busyHours=m.hoursInWeek('2026-10-16',state);
      state.pickups['2026-10-17']={s:'open',w:[]};const emptyHours=m.hoursInWeek('2026-10-16',state);
      state.pickups['2026-10-17']={s:'open',w:['swing']};state.weekly.find(r=>r.d===6).hours=9;const changedRuleHours=m.hoursInWeek('2026-10-16',state);
      const cancel=m.normalizePriv({weekly:v.weekly,days:{'2026-10-17':{s:'open',scheduleOff:true}},pickups:{}});
      return {totals,choices,busyHours,emptyHours,changedRuleHours,cancelHours:m.hoursInWeek('2026-10-16',cancel)};
    },{p:publicFixture,v:fixture});
    assert.deepEqual(result.totals,[31,26.4,29.6,24]);assert.deepEqual(result.choices.sort(),['morning','swing']);assert.equal(result.busyHours,26.4);assert.equal(result.emptyHours,26.4);assert.equal(result.changedRuleHours,27.4);assert.equal(result.cancelHours,16);
    console.log('PASS: Friday–Thursday clock-week totals, prorated paid hours across midnight, scheduled overnight disabled, availability-independent hours, weekly changes, explicit cancellation');

    const boundary=await page.evaluate(({v})=>{
      const m=scheduleTest,onlyThursday=m.normalizePriv({weekly:[],days:{'2026-10-22':{s:'work',start:'23:00',end:'07:00',hours:8}},pickups:{}});
      const baseline=m.normalizePriv({...v,days:{}});
      const totals=['2026-10-16','2026-10-23'].map(w=>m.hoursInWeek(w,onlyThursday));
      return {totals,baseline:['2026-10-09','2026-10-16','2026-10-23'].map(w=>m.hoursInWeek(w,baseline))};
    },{v:fixture});
    assert.deepEqual(boundary.totals,[1,7]);assert.equal(boundary.totals.reduce((a,b)=>a+b,0),8);assert.deepEqual(boundary.baseline,[24,24,24]);
    const corrected42={...fixture,days:{'2026-10-21':{s:'work',start:'23:00',end:'07:00',hours:8},'2026-10-22':{s:'work',start:'21:00',end:'07:00',hours:10},'2026-10-28':{s:'work',start:'23:00',end:'07:00',hours:8}}};
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:corrected42});
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),35);
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-23',scheduleTest.read().priv)),39);
    console.log('PASS: eight-hour Thursday overnight splits1+7 without lost hours; former42-hour whole-shift total splits into35 and39 for adjacent weeks');

    const forty={...fixture,days:{'2026-10-20':{s:'work',start:'23:00',end:'07:00',hours:8},'2026-10-21':{s:'work',start:'23:00',end:'07:00',hours:8}}};
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:forty});
    const head=page.locator('.week-head').filter({hasText:'Oct 16'});assert((await head.innerText()).includes('40 hrs scheduled'));assert(!(await head.innerText()).includes('overtime'));
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-23',scheduleTest.read().priv)),24);
    console.log('PASS: five eight-hour shifts entirely inside a pay week total40 exactly, with no worked-overtime label');
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:fixture});
    await page.locator('[data-key="2026-10-17"]').click();await page.waitForTimeout(400);
    await page.locator('#stWork').check();await page.locator('#workStart').fill('21:00');await page.locator('#workStart').dispatchEvent('change');assert.equal(await page.locator('#workHours').inputValue(),'8');
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:fixture});await page.keyboard.press('Escape');await page.waitForTimeout(400);await page.locator('[data-key="2026-10-17"]').click();await page.waitForTimeout(400);
    await page.locator('#ew-morning').uncheck();
    let state=await page.evaluate(()=>scheduleTest.read());assert.deepEqual(state.priv.weekly,weekly);assert.equal(state.priv.days['2026-10-17'].s,'open');assert.deepEqual(state.priv.pickups['2026-10-17'].w,['overnight','swing']);assert.deepEqual(state.diff.days,{});assert(state.diff.pickups['2026-10-17']);
    await page.locator('#stBusy').check();state=await page.evaluate(()=>scheduleTest.read());assert.equal(state.priv.pickups['2026-10-17'].s,'busy');assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),26.4);
    await page.locator('#stOpen').check();assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),26.4);
    await page.keyboard.press('Escape');await page.waitForTimeout(400);
    await page.locator('#settingsBtn').click();await page.waitForTimeout(400);assert.equal(await page.locator('#setWilling').count(),0);assert.equal(await page.locator('#setWeekendWilling').count(),0);await page.keyboard.press('Escape');await page.waitForTimeout(400);
    await page.locator('[data-brush=work]').click();await page.locator('[data-key="2026-10-18"]').click();
    assert.equal(await page.evaluate(()=>scheduleTest.scheduledRec('2026-10-18',scheduleTest.read().priv).start),'23:00');
    await page.locator('[data-brush=open]').click();await page.locator('[data-key="2026-10-18"]').click();
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),26.4);
    await page.locator('[data-brush=busy]').click();await page.locator('[data-key="2026-10-18"]').click();
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),26.4);
    await page.locator('[data-brush=edit]').click();
    await page.locator('#saveBtn').click();await page.waitForFunction(()=>document.querySelector('#saveBtn').textContent==='Saved');assert.equal(writes,1);assert.deepEqual(remotePrivate.weekly,weekly);assert.equal(remotePrivate.days['2026-10-22'].hours,8);assert.equal(remotePrivate.days['2026-10-22'].start,'21:00');assert(remotePrivate.pickups['2026-10-17']);assert(!remotePublic.days['2026-10-17'].w.includes('overnight'));

    console.log('PASS: recurring-date checkboxes/radios, removed settings, draft isolation, and mocked save preserve scheduled work');
    const persisted=await page.evaluate(({p,v})=>{scheduleTest.seed(p,v);return {hours:scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv),picked:scheduleTest.read().priv.pickups['2026-10-17']};},{p:remotePublic,v:remotePrivate});assert.equal(persisted.hours,26.4);assert(persisted.picked);
    for(const bad of ['not json','null','[]','{"days":"bad","weekly":[]}','{"days":{},"weekly":{}}']){rawPrivate=bad;assert.equal(await page.evaluate(async()=>{try{await scheduleTest.loadOwnerState('test-only');return false}catch(e){return e.privateUnreadable===true}}),true);}
    rawPrivate='not json';await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:fixture});await page.locator('[data-brush=open]').click();await page.locator('[data-key="2026-10-19"]').click();await page.locator('#saveBtn').click();await page.waitForTimeout(300);assert.equal(writes,1);
    assert.equal(writes,1);rawPrivate=null;
    console.log('PASS: saved pickup choices reload independently; malformed private schedules cannot be silently replaced');
    const historyFixture={...fixture,days:{...fixture.days,'2026-10-10':{s:'open',w:['morning']}}};
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:historyFixture});
    await page.locator('#settingsBtn').click();await page.waitForTimeout(400);
    const fridayStart=page.locator('.wk-row[data-d="5"] [data-f=start]');await fridayStart.fill('21:00');assert.equal(await page.locator('.wk-row[data-d="5"] [data-f=hours]').inputValue(),'8');await fridayStart.fill('22:00');
    const saturdayHours=page.locator('.wk-row[data-d="6"] [data-f=hours]');await saturdayHours.fill('9');
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-09',scheduleTest.read().priv)),31);
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-16',scheduleTest.read().priv)),27.4);
    assert.deepEqual(await page.evaluate(()=>scheduleTest.read().priv.pickups['2026-10-10'].w),['morning']);
    await saturdayHours.fill('8');assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-09',scheduleTest.read().priv)),31);
    assert.deepEqual(await page.evaluate(()=>scheduleTest.read().priv.days['2026-10-10']),{s:'open',w:['morning']});
    await page.keyboard.press('Escape');await page.waitForTimeout(400);
    const crossHistory={...fixture,days:{},weekly:[...weekly,{d:4,s:'work',start:'23:00',end:'07:00',hours:8}]};
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:crossHistory});
    await page.locator('#settingsBtn').click();await page.waitForTimeout(400);
    const thursdayStart=page.locator('.wk-row[data-d="4"] [data-f=start]');await thursdayStart.fill('22:00');
    assert.deepEqual(await page.evaluate(()=>scheduleTest.scheduledRec('2026-10-08',scheduleTest.read().priv)),{s:'work',start:'23:00',end:'07:00',hours:8});
    assert.equal(await page.locator('.wk-row[data-d="4"] [data-f=hours]').inputValue(),'8');
    await thursdayStart.fill('23:00');
    assert.equal(await page.evaluate(()=>Object.prototype.hasOwnProperty.call(scheduleTest.read().priv.days,'2026-10-08')),false);
    assert.equal(await page.evaluate(()=>scheduleTest.hoursInWeek('2026-10-09',scheduleTest.read().priv)),32);
    await page.keyboard.press('Escape');await page.waitForTimeout(400);
    await page.evaluate(({p,v})=>scheduleTest.seed(p,v),{p:publicFixture,v:{...fixture,days:{},pickups:{'2026-10-15':{s:'open',w:['morning']}}}});
    await page.locator('[data-key="2026-10-15"]').click();await page.waitForTimeout(400);await page.locator('#useUsual').click();
    assert.deepEqual(await page.evaluate(()=>scheduleTest.pickupTypes('2026-10-15',scheduleTest.read().pub,scheduleTest.read().priv)),['overnight']);await page.keyboard.press('Escape');
    console.log('PASS: paint tools, corrupt-save guard, prior-Thursday cross-boundary history preservation/undo, and Use Usual without schedule changes');
    const pruning=await page.evaluate(()=>{
      const m=scheduleTest,today=m.todayKey(),ws=m.weekStartOf(today,5),prev=m.addDays(ws,-1);
      const v=m.normalizePriv({weekly:[],days:{},pickups:{},padding:'x'.repeat(45900)});
      for(let k=m.addDays(today,-50);k<=today;k=m.addDays(k,1)){v.days[k]={s:'work',start:'23:00',end:'07:00',hours:8,note:'n'.repeat(100)};v.pickups[k]={s:'open',w:['morning','swing','overnight'],note:'n'.repeat(100)}}
      const payload=m.privatePayload(v,5);return {exists:!!payload,cutoff:payload&&payload.cutoff,prev,kept:!!(payload&&payload.priv.days[prev]),keptPickups:!!(payload&&payload.priv.pickups[prev])};
    });assert(pruning.exists);assert(pruning.cutoff<=pruning.prev);assert(pruning.kept);assert(pruning.keptPickups);
    assert.deepEqual(errors,[]);
    console.log('PASS: private-size pruning retains older records and matching pickup records');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
