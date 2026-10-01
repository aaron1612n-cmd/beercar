// Node check of the fly brain: speed, overall activity, and whether the descending neurons (the wheel's
// inputs) tell a brighter-left scene from a brighter-right one. node tools/flycheck.mjs [ms] [dt] [gain]
import { readFileSync } from 'node:fs';
import { parseBrain, makeBrain } from '../src/flycore.js';

const ms = +(process.argv[2] || 300), dt = +(process.argv[3] || 0.5), gain = +(process.argv[4] || 1.6);
const file = readFileSync(new URL('../src/assets/flybrain.bin', import.meta.url));
const B = parseBrain(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const meta = JSON.parse(readFileSync(new URL('../src/assets/flybrain.json', import.meta.url), 'utf8'));
const L = meta.eyes.left.idx, R = meta.eyes.right.idx, inIdx = Uint32Array.from([...L, ...R]);

function run(hzL, hzR) {
  const b = makeBrain(B, { dt, gain }), inP = new Float32Array(inIdx.length);
  inP.fill(hzL * dt / 1000, 0, L.length); inP.fill(hzR * dt / 1000, L.length);
  const t0 = performance.now(); let tot = 0;
  for (let s = 0; s < ms / dt; s++) tot += b.step(inIdx, inP);
  const wall = performance.now() - t0;
  const dn = meta.dn.idx.map((i) => b.spikes[i] / (ms / 1000));
  let active = 0; for (let i = 0; i < b.N; i++) if (b.spikes[i]) active++;
  return { wall, rate: tot / b.N / (ms / 1000), active, dn };
}
const A = run(60, 60), BL = run(100, 20), BR = run(20, 100);
console.log(`dt ${dt} ms, gain ${gain}: ${ms} ms of brain took ${A.wall.toFixed(0)} ms (${(ms / A.wall).toFixed(2)}x real time)`);
for (const [name, r] of [['even', A], ['left bright', BL], ['right bright', BR]]) {
  const on = r.dn.filter((x) => x > 0).length;
  console.log(`${name}: mean ${r.rate.toFixed(1)} Hz, ${r.active} neurons spiked, ${on}/${r.dn.length} DNs active, DN mean ${(r.dn.reduce((a, b) => a + b, 0) / r.dn.length).toFixed(1)} Hz`);
}
// left/right DN asymmetry under the two lopsided scenes
const diff = BL.dn.map((x, k) => x - BR.dn[k]);
const top = diff.map((d, k) => [d, meta.dn.type[k], meta.dn.side[k]]).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 12);
console.log('biggest DN differences (left-bright minus right-bright, Hz):'); for (const t of top) console.log(' ', t[0].toFixed(0), t[1], t[2]);
for (const ty of ['DNa01', 'DNa02', 'DNb05', 'MDN', 'DNp09']) {
  const ks = meta.dn.type.map((t, k) => (t === ty ? k : -1)).filter((k) => k >= 0);
  console.log(ty, ks.map((k) => `${meta.dn.side[k]} ${BL.dn[k].toFixed(0)}/${BR.dn[k].toFixed(0)}`).join('  '));
}
