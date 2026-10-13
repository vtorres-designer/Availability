const load = require('./mock.js'), assert = require('assert');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
const FACTS = {
  triangle: { kind: 'offer', withdrawsEarlier: false, training: false, overtimeMentioned: false, usesTonightOrToday: false, offers: [{ date: today, start: '23:00', end: '07:00', siteName: 'triangle building', address: '1550 Wewatta St' }], summary: 'Triangle tonight 2300-0700' },
  kcnc: { kind: 'offer', withdrawsEarlier: false, training: false, overtimeMentioned: true, usesTonightOrToday: false, offers: [{ date: today, start: null, end: null, siteName: 'KCNC' }], summary: 'Overnight at KCNC, hours missing' },
  lv: { kind: 'offer', withdrawsEarlier: true, training: false, overtimeMentioned: false, usesTonightOrToday: false, offers: [{ date: today, start: '20:00', end: '09:00', siteName: 'Louis Vuitton' }], summary: 'Earlier filled; Louis Vuitton 8pm-9am' },
  spam: { kind: 'other', withdrawsEarlier: false, training: false, overtimeMentioned: false, usesTonightOrToday: false, offers: [], summary: 'Spam' },
};
let geminiCalls = 0;
const x = load({
  props: { SECRET: 'sek', GEMINI_KEY: 'g', NTFY_TOPIC: 'shift-abc', GH_TOKEN: 'ghp' },
  fetch: (url, o) => {
    if (url.includes('data.json')) return { body: { days: { [today]: { s: 'open' } } } };
    if (url.includes('api.github.com')) return { body: { value: JSON.stringify({ days: { [today]: { s: 'open' } }, weekly: [] }) } };
    if (url.includes('ntfy.sh')) return { body: '{}' };
    if (url.includes('generativelanguage')) {
      geminiCalls++;
      const b = JSON.parse(o.payload), t = b.contents[0].parts[0].text;
      if (!b.generationConfig.responseSchema) return { body: { candidates: [{ content: { parts: [{ text: 'Sure! What are the hours for KCNC tonight?' }] } }] } };
      const key = /Louis/.test(t.split('The text:')[1]) ? 'lv' : /KCNC/.test(t.split('The text:')[1]) ? 'kcnc' : /triangle/.test(t.split('The text:')[1]) ? 'triangle' : 'spam';
      return { body: { candidates: [{ content: { parts: [{ text: JSON.stringify(FACTS[key]) }] } }] } };
    }
    throw new Error('unexpected ' + url);
  },
});
x.ensureSheets();
const post = (b) => JSON.parse(x.doPost({ postData: { contents: JSON.stringify(Object.assign({ key: 'sek' }, b)) } }).text);
assert.equal(post({ key: 'bad', text: 'x' }).error, 'wrong key');
let r = post({ text: 'Hi! I have a shift tonight at the triangle building 1550 Wewatta St 2300-0700', from: 'Adrian Martin', phone: '+1 (720) 555-0101', company: 'Allied Universal' });
console.log(r); assert.equal(r.level, 'urgent'); assert.equal(r.loud,'yes'); assert.ok(r.url.includes('?id=1&t='));
assert.ok(!x.fetches.some(f => f.url.includes('ntfy')));
r = post({ text: 'Are you available for an overnight at KCNC tonight? It would be a little overtime.', from: 'Kelsey', phone: '7205550102', company: 'Allied Universal' });
console.log(r.level, r.body); assert.equal(r.level, 'ask'); assert.ok(r.body.includes('Sure! What are the hours'));
r = post({ text: 'Oh well I guess it just got filled... Louis Vuitton 8pm-9am tonight.', from: 'Kelsey', phone: '7205550102', company: 'Allied Universal' });
console.log(r.level, r.title); assert.equal(r.level, 'special');
r = post({ text: 'WIN A PRIZE', from: '+1 303 555 9999', phone: '+1 303 555 9999', company: '' });
assert.equal(r.level, 'ignore'); assert.equal(r.show, 'no');
r = post({ text: 'Dinner at 7?', from: 'Mom', phone: '3035550000', company: '' }); assert.ok(r.personal); 
const log = x.sheets['Log'].rows; const C = x.COL;
assert.equal(log.length, 5);
assert.equal(log[2][C.Outcome - 1], 'Withdrawn', 'KCNC withdrawn by LV text');
assert.equal(log[1][C.Outcome - 1], '', 'Adrian text not withdrawn');
console.log('People:', x.sheets['People'].rows);
// Review page API
const tok = log[1][C.Token - 1];
assert.throws(() => x.apiEntry({ t: 'wrong' }, 1));
let e = x.apiEntry({ t: tok }, 1); assert.equal(e.level, 'urgent'); assert.equal(e.master, false);
assert.throws(() => x.apiList({ t: tok }));
assert.throws(() => x.apiEntry({ t: tok }, 2), 'token for entry 1 cannot open entry 2');
x.apiAct({ t: tok }, 1, 'sent', 'Yes, I can take Triangle tonight 2300-0700. Thanks!');
assert.equal(log[1][C['Edited?'] - 1], 'Yes'); assert.equal(log[1][C.Action - 1], 'Sent');
x.apiOutcome({ k: 'sek' }, 1, 'Got the shift', 'easy');
assert.equal(log[1][C.Outcome - 1], 'Got the shift');
assert.equal(x.apiList({ k: 'sek' }).length, 4);
// The accepted Triangle shift now counts: a morning shift tomorrow would make tomorrow 15 hours.
const tmr = new Date(Date.parse(today + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
FACTS.spam = { kind: 'offer', withdrawsEarlier: false, training: false, overtimeMentioned: true, usesTonightOrToday: false, offers: [{ date: tmr, start: '07:00', end: '15:00', siteName: 'The Hub' }], summary: 'Hub morning' };
r = post({ text: 'Hub tomorrow 0700-1500?', from: 'Adrian Martin', phone: '7205550101', company: 'Allied Universal' });
console.log(r.level, x.sheets['Log'].rows[5][C.Why - 1]); assert.equal(r.level, 'decline');
// Sites
let sites = x.apiSaveSite({ t: x.sheets['Log'].rows[3][C.Token - 1] }, { name: 'Louis Vuitton', supervisor: 'Kelsey', phone: '7205550102' }, 3);
assert.ok(sites.some(s => s.name === 'Louis Vuitton' && s.phone === '7205550102'));
assert.throws(() => x.apiSites({ t: 'x' }));
sites = x.apiSaveSite({ k: 'sek' }, { row: 2, name: 'Triangle Building', aliases: ['Triangle', 'the triangle'], address: '1550 Wewatta St', supervisor: 'Adrian Martin', phone: '7205550101' });
assert.equal(sites[0].supervisor, 'Adrian Martin');
console.log('Setup:', x.setupState());
console.log('gemini calls', geminiCalls, 'ALL PASS');
