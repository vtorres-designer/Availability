const E = require('./Engine.gs');
const assert = require('assert');
// Example calendar: Mon 10/12 open, Wed 10/14 busy, Fri-Sun 10/16-18 work overnights 2300-0700, Thu 10/15 open, Tue 10/13 OT
const cal = {
  pub: { days: { '2026-10-12': {s:'open'}, '2026-10-13': {s:'ot'}, '2026-10-14': {s:'busy'}, '2026-10-15': {s:'open'}, '2026-10-16': {s:'busy'}, '2026-10-17': {s:'busy'}, '2026-10-19': {s:'open'} } },
  priv: { days: { '2026-10-12': {s:'open'}, '2026-10-13': {s:'open'}, '2026-10-14': {s:'busy'}, '2026-10-15': {s:'open'}, '2026-10-19': {s:'open'}, '2026-10-20': {s:'work', start:'07:00', end:'15:00', hours:8} },
          weekly: [{d:5, s:'work', start:'23:00', end:'07:00', hours:8}, {d:6, s:'work', start:'23:00', end:'07:00', hours:8}, {d:0, s:'work', start:'23:00', end:'07:00', hours:8}] },
  booked: [] };
const sites = [{name:'Triangle Building', aliases:['triangle'], address:'1550 Wewatta St'}, {name:'Millennium Financial', aliases:['millenium financial'], address:'1550 17th St'}, {name:'The Hub', address:'3601 Walnut St'}, {name:'KCNC', address:'1044 Lincoln St'}];
const sup = {name:'Adrian Martin', allied:true};
const run = (now, facts, sender=sup, c=cal) => E.decide({ now, sender, facts, cal: c, sites });
const show = (n, r) => console.log(n.padEnd(34), r.level.padEnd(9), '|', r.reply, '\n   ', r.path.map(p=>p[0]+':'+p[1]).join(' / '));
let r;
r = run({date:'2026-10-12', time:'18:05'}, {kind:'offer', offers:[{date:'2026-10-12', start:'23:00', end:'07:00', siteName:'triangle building', address:'1550 Wewatta St'}]}); show('1 Triangle tonight', r); assert.equal(r.level,'urgent');
r = run({date:'2026-10-12', time:'17:48'}, {kind:'availability_question', questionDate:'2026-10-12', usesTonightOrToday:true}); show('2 Available tonight?', r); assert.equal(r.level,'question');
r = run({date:'2026-10-14', time:'19:02'}, {kind:'offer', offers:[{date:'2026-10-14', start:'23:00', end:'07:00', siteName:'Millenium financial', address:'1550 17th st'}]}); show('3 Millennium busy day', r); assert.equal(r.level,'decline');
r = run({date:'2026-10-15', time:'15:00'}, {kind:'offer', offers:[{date:'2026-10-15', start:'23:00', end:'07:00', siteName:'The Hub', address:'3601 Walnut St'}]}); show('4 The Hub Thu', r); assert.equal(r.level,'urgent');
r = run({date:'2026-10-16', time:'15:00'}, {kind:'working_question', questionDate:'2026-10-16', usesTonightOrToday:true}, {name:'Kelsey', allied:true}); show('5 Working tonight? (Fri)', r); assert.equal(r.reply,"Yes, I'm working tonight.");
r = run({date:'2026-10-12', time:'15:00'}, {kind:'working_question', questionDate:'2026-10-12', usesTonightOrToday:true}, {name:'Kelsey', allied:true}); show('5b Working tonight? (Mon)', r); assert.ok(r.reply.startsWith('No, I'));
r = run({date:'2026-10-13', time:'00:40'}, {kind:'offer', usesTonightOrToday:true, offers:[{date:'2026-10-13', start:'23:00', end:'07:00', siteName:'triangle'}]}, {name:'Kelsey', allied:true}); show('6 tonight after midnight', r); assert.equal(r.level,'ask');
r = run({date:'2026-10-12', time:'15:20'}, {kind:'offer', overtimeMentioned:true, offers:[{date:'2026-10-12', start:null, end:null, siteName:'KCNC'}]}, {name:'Kelsey', allied:true}); show('7 KCNC no hours', r); assert.equal(r.level,'ask');
r = run({date:'2026-10-15', time:'18:30'}, {kind:'offer', withdrawsEarlier:true, offers:[{date:'2026-10-15', start:'20:00', end:'09:00', siteName:'Louis Vuitton'}]}, {name:'Kelsey', allied:true}); show('8 Louis Vuitton', r); assert.equal(r.level,'special');
r = run({date:'2026-10-12', time:'09:15'}, {kind:'offer', training:true, offers:[{date:'2026-10-12', start:null, end:null, siteName:null}, {date:'2026-10-13', start:'07:00', end:'15:00', siteName:null}]}, {name:'Kelsey', allied:true}); show('9 Training', r); assert.equal(r.level,'accept');
// Rules
r = run({date:'2026-10-16', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-17', start:'15:00', end:'23:00', siteName:'The Hub'}]}); show('Sat swing + his overnights (16h)', r); assert.equal(r.level,'decline');
r = run({date:'2026-10-16', time:'10:00'}, {kind:'offer', offers:[{date:'2026-10-16', start:'15:00', end:'23:00', siteName:'The Hub'}]}); show('Fri swing + his overnight', r); assert.equal(r.level,'top');
r = run({date:'2026-10-16', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-18', start:'07:00', end:'15:00', siteName:'The Hub'}]}); show('Sun morning after Sat overnight', r); assert.equal(r.level,'decline');
r = run({date:'2026-10-19', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-19', start:'23:00', end:'07:00', siteName:'The Hub'}]}); show('Mon night then Tue morning work', r); assert.equal(r.level,'decline');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-13', start:'15:00', end:'23:00', siteName:'The Hub'}]}); show('Tue swing on OT day', r); assert.equal(r.level,'alert');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-15', start:'15:00', end:'23:00', siteName:'The Hub'}]}); show('Thu swing no OT', r); assert.equal(r.level,'decline');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-25', start:'23:00', end:'07:00', siteName:'The Hub'}]}); show('Gray day... (Sun weekly work)', r);
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-21', start:'23:00', end:'07:00', siteName:'The Hub'}]}); show('Gray Wed', r); assert.equal(r.level,'alert');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'guard_cover_request'}, {name:'Marcus', allied:true}); show('Guard swap', r); assert.equal(r.level,'ignore');
r = run({date:'2026-10-12', time:'14:10'}, {kind:'guard_team_short', questionDate:'2026-10-12', offers:[{siteName:'Cherry Creek'}]}, {name:'Marcus', allied:true}); show('Team short, free', r); assert.equal(r.level,'network');
r = run({date:'2026-10-14', time:'14:10'}, {kind:'guard_team_short', questionDate:'2026-10-14'}, {name:'Marcus', allied:true}); show('Team short, busy', r); assert.equal(r.level,'ignore');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-12', start:'23:00', end:'07:00', siteName:'The Hub'}]}, {name:'+17205551234', allied:false}); show('Unknown number offer', r); assert.equal(r.level,'alert');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'other'}, {name:'+17205551234', allied:false}); show('Unknown spam', r); assert.equal(r.level,'ignore');
r = run({date:'2026-10-12', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-14', start:null, end:null, siteName:'The Hub'}]}); show('Busy day, no hours', r); assert.equal(r.level,'decline');
// Offered pair in one text on Fri 10/23 (public busy, but no private record => gray?) use 10/30 with weekly work? use an open Sat: make cal copy
const cal2 = JSON.parse(JSON.stringify(cal)); cal2.priv.weekly = []; cal2.priv.days['2026-10-24'] = {s:'open'};
r = run({date:'2026-10-20', time:'16:00'}, {kind:'offer', offers:[{date:'2026-10-24', start:'15:00', end:'23:00', siteName:'The Hub'},{date:'2026-10-24', start:'23:00', end:'07:00', siteName:'The Hub'}]}, sup, cal2); show('Offered Sat swing+overnight pair', r); assert.equal(r.level,'top');
console.log(E.alertText(r, {sender: sup, now:{date:'2026-10-20', time:'16:00'}}));
console.log('ALL PASS');
