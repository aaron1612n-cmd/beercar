// node tools/chasecheck.mjs: wanted levels, escape and bust rules (src/chase.js). Exits 1 on any failure.
import { makeChase } from '../src/chase.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const far = { gap: 400, dist: 400, contact: false }, close = { gap: 2, dist: 3, contact: false };
const run = (c, secs, speed, cops) => { let ev = null; for (let t = 0; t < secs && !ev; t += 0.1) ev = c.update(0.1, speed, cops); return ev; };

{ // thresholds 3/6/9 -> 1/2/3 cars, helicopter at 9
  const c = makeChase(), evs = [];
  for (let k = 1; k <= 10; k++) evs.push(c.hitKid());
  check(evs[0].length === 0 && evs[1].length === 0, 'no cops before 3 kids');
  check(evs[2].join() === 'spawn', `3rd kid -> one spawn, got ${evs[2]}`);
  check(evs[5].join() === 'spawn' && evs[8].join() === 'spawn,heli', `6th/9th: ${evs[5]} / ${evs[8]}`);
  check(evs[9].length === 0 && c.st.cars === 3 && c.st.kids === 10, 'caps at 3 cars');
}
{ // no cops -> update never fires
  const c = makeChase(); c.hitKid(); check(run(c, 30, 0, []) === null, 'nothing happens without cops');
}
{ // escape: every cop > 300 m behind for 10 s, then everything resets
  const c = makeChase(); for (let k = 0; k < 3; k++) c.hitKid();
  check(run(c, 9.5, 30, [far]) === null, 'escaped too early');
  check(c.update(0.6, 30, [far]) === 'escape', 'no escape after 10 s');
  check(c.st.kids === 0 && c.st.cars === 0 && !c.st.heli, 'escape resets');
}
{ // a close cop resets the escape timer
  const c = makeChase(); for (let k = 0; k < 3; k++) c.hitKid();
  run(c, 8, 30, [far]); c.update(0.1, 30, [{ gap: 100, dist: 100, contact: false }]);
  check(run(c, 9.5, 30, [far]) === null, 'escape timer did not reset');
}
{ // bust on contact, at once
  const c = makeChase(); for (let k = 0; k < 3; k++) c.hitKid();
  check(c.update(0.016, 30, [{ gap: 1, dist: 1, contact: true }]) === 'bust', 'contact should bust');
  check(c.st.kids === 0 && c.st.cars === 0, 'bust resets');
}
{ // bust when stopped next to a cop for 1 s, but not while moving
  const c = makeChase(); for (let k = 0; k < 3; k++) c.hitKid();
  check(run(c, 5, 10, [close]) === null, 'moving next to a cop should not bust');
  check(run(c, 0.85, 1, [close]) === null, 'busted before 1 s stopped');
  check(run(c, 0.3, 1, [close]) === 'bust', 'not busted after 1 s stopped');
}
{ // all cops wrecked (empty list) counts as lost
  const c = makeChase(); for (let k = 0; k < 3; k++) c.hitKid();
  check(run(c, 10.5, 30, []) === 'escape', 'wrecking every cop should let you escape');
}
console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
process.exit(fails ? 1 : 0);
