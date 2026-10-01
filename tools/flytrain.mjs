// Closed-loop check, no browser: the fly brain sees a simple drawn road, an instructor teaches it, then
// it has to hold the lane alone. Pass = solo does clearly better than a pilot that never steers.
//   node tools/flytrain.mjs [teachSecs] [soloSecs]      env POP=vpn|visual|dn, TONE=mV, LAG=game s per brain s
import { readFileSync } from 'node:fs';
import { parseBrain, makeBrain } from '../src/flycore.js';
import { makePilot, instructor, eyeDir, eyeRates } from '../src/flypilot.js';

const TEACH = +(process.argv[2] || 60), SOLO = +(process.argv[3] || 30);
const file = readFileSync(new URL('../src/assets/flybrain.bin', import.meta.url));
const B = parseBrain(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const meta = JSON.parse(readFileSync(new URL('../src/assets/flybrain.json', import.meta.url), 'utf8'));
const cells = [];
for (const side of ['left', 'right']) { const e = meta.eyes[side]; e.idx.forEach((i, k) => cells.push({ i, ...eyeDir(side, e.u[k], e.v[k]) })); }
const inIdx = Uint32Array.from(cells, (c) => c.i), inP = new Float32Array(cells.length), dk = new Float32Array(cells.length);
const pool = { dn: meta.dn.idx, vpn: meta.vpn, visual: meta.visual }[process.env.POP || 'vpn'];
const DT = 1, WIN = 25, LAG = +(process.env.LAG || 2.5);      // brain ms per step, brain ms per control tick
const LANE = 1.7, SPEED = +(process.env.SPEED || 15), H = 1.1, MIX = +(process.env.MIX ?? 0.5);

// what a cell sees: darkness 0..1 of road / paint / gravel / grass / sky
function dark(x, th, az, el) {
  if (el >= -0.002) return 0.15;                               // sky
  const d = H / Math.tan(-el), a = th + az;
  if (Math.cos(a) * d > 300 || Math.cos(a) <= 0 && d > 30) return 0.45;   // haze / far behind
  const X = Math.abs(x + Math.sin(a) * d);
  return X < 0.06 ? 0.3 : X < 3.75 ? 0.82 : X < 3.85 ? 0.1 : X < 4.75 ? 0.55 : 0.68;
}

const brain = makeBrain(B, { dt: DT, tone: +(process.env.TONE || 0) }), pilot = makePilot(pool.length, null, { K: +(process.env.K || 400) });
const counts = new Float32Array(pool.length);
let x = LANE, th = 0, t = 0, wander = 0, wanderT = 0;
function tick(mode) {
  for (let k = 0; k < cells.length; k++) dk[k] = dark(x, th, cells[k].az, cells[k].el);
  eyeRates(dk, inP); for (let k = 0; k < inP.length; k++) inP[k] *= DT / 1000;
  for (let s = 0; s < WIN / DT; s++) brain.step(inIdx, inP);
  for (let k = 0; k < pool.length; k++) { counts[k] = brain.spikes[pool[k]]; brain.spikes[pool[k]] = 0; }
  pilot.feed(counts, WIN);
  const gdt = (WIN / 1000) * LAG; t += gdt;
  if ((wanderT -= gdt) <= 0) { wanderT = 2 + Math.random() * 3; wander = (Math.random() - 0.5) * 4; }   // lessons cover off-centre views
  let steer;
  if (mode === 'teach') {                                      // the fly's hands share the wheel once it's past watching
    const own = pilot.steer(); pilot.learn(instructor(x, th, LANE, SPEED));
    steer = instructor(x, th, LANE + wander, SPEED) * (pilot.watching ? 1 : MIX) + own * (pilot.watching ? 0 : 1 - MIX);
  }
  else steer = mode === 'solo' ? pilot.steer() : 0;
  th += Math.max(-1, Math.min(1, steer)) * 0.35 * gdt; x += Math.sin(th) * SPEED * gdt;
  return Math.abs(x - LANE);
}
const t0 = performance.now();
for (let s = 0; s < 4; s++) tick('none');
while (t < TEACH) tick('teach');
console.log(`pool ${pool.length}, taught ${TEACH}s (${pilot.lessons} lessons, running |error| ${pilot.err.toFixed(3)}) in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
function solo(mode) {
  const start = () => { x = LANE + (Math.random() < 0.5 ? -1.5 : 1.5); th = (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.05); };
  start(); t = 0; let e = 0, n = 0, off = 0, near = 0;
  while (t < SOLO) { const d = tick(mode); e += d; n++; if (d < 1) near++; if (Math.abs(x) > 4.75) { off++; start(); } }
  return `${mode}: mean lane error ${(e / n).toFixed(2)} m, within 1 m of the lane ${(100 * near / n).toFixed(0)}% of the time, left the road ${off}x`;
}
console.log(solo('solo'));
console.log(solo('none'));
