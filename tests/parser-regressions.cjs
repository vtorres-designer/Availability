// Pure parser regressions: availability must not erase a permanent scheduled shift.
const assert = require('node:assert/strict');
const parser = require('../parser.js');
const anchor = '2026-10-12';

function one(text) {
  const parsed = parser.parse(text, anchor);
  assert.deepEqual(parsed.errors, [], text);
  assert.equal(parsed.items.length, 1, text);
  return parsed.items[0];
}

for (const wording of ['no shift', 'no shifts scheduled', 'not scheduled', 'nothing scheduled', 'no work', 'none', 'unscheduled']) {
  const item = one(`Sat 10/17 ${wording}`);
  assert.deepEqual(item.keys, ['2026-10-17']);
  assert.equal(item.rec.s, 'open');
  assert.equal(item.rec.scheduleOff, true, wording);
}

for (const wording of ['available', 'avail', 'open', 'free']) {
  const item = one(`10/17 ${wording} morning`);
  assert.deepEqual(item.rec, {s: 'open', w: ['morning']}, wording);
}

for (const wording of ['busy', 'blocked', 'vacation', 'clear', 'work 8h']) {
  assert.equal(Object.hasOwn(one(`10/17 ${wording}`).rec, 'scheduleOff'), false, wording);
}

const canceledRange = one('10/16-10/25 weekends no shift morning');
assert.deepEqual(canceledRange.keys, ['2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25']);
assert.deepEqual(canceledRange.rec, {s: 'open', scheduleOff: true, w: ['morning']});
const availableRange = one('10/16-10/25 Sat-Sun available swing');
assert.deepEqual(availableRange.keys, canceledRange.keys);
assert.deepEqual(availableRange.rec, {s: 'open', w: ['swing']});

const quotedAvailability = one('10/17 available morning "No shift; not scheduled; none; unscheduled"');
assert.deepEqual(quotedAvailability.rec, {s: 'open', w: ['morning']});
assert.equal(quotedAvailability.ignored, 'No shift; not scheduled; none; unscheduled');
const quotedWork = one('10/17 2300-0700 “No shift at the other site”');
assert.deepEqual(quotedWork.rec, {s: 'work', start: '23:00', end: '07:00', hours: 8, note: 'No shift at the other site'});
const quotedCancellation = one('10/17 no shift "Site B; gate code 4471"');
assert.equal(quotedCancellation.rec.scheduleOff, true);
assert.equal(quotedCancellation.ignored, 'Site B; gate code 4471');

const mixed = parser.parse('10/17 no shift; 10/18 available\n10/24 unscheduled\n10/25 free', anchor);
assert.deepEqual(mixed.errors, []);
assert.deepEqual(mixed.items.map(item => item.rec.scheduleOff === true), [true, false, true, false]);

for (const text of ['10/17 off', '10/17 not available', '10/17 2300-0700 no shift']) {
  const parsed = parser.parse(text, anchor);
  assert.equal(parsed.items.length, 0, text);
  assert.equal(parsed.errors.length, 1, text);
}

console.log('PASS: explicit schedule cancellations, independent availability, date ranges, weekday filters, quoted notes, mixed entries, and ambiguous-input safeguards');
