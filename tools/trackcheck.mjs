// node tools/trackcheck.mjs: the road generator never doubles back on itself, stays pointed down the
// road, and frame() maps world points back to (s, lat). Exits 1 on any failure.
import { makeTrack, STEP } from '../src/track.js';

const D = Math.PI / 180, KM = 200;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; if (fails < 20) console.log('FAIL', msg); } };

for (let seed = 1; seed <= 5; seed++) {
  const t = makeTrack(seed);
  t.ensure(KM * 1000);
  const { xs, zs, hs, i0 } = t.samples;
  const n = xs.length;
  let maxH = 0, minSep = Infinity, hairpins = 0, sharp = 0;
  for (let i = 0; i < n; i++) maxH = Math.max(maxH, Math.abs(hs[i]));
  // separation: brute force over a grid of the samples (cells of 40 m)
  const cell = new Map(), key = (x, z) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
  for (let i = 0; i < n; i++) { const k = key(xs[i], zs[i]); (cell.get(k) || cell.set(k, []).get(k)).push(i); }
  const gap = 120 / STEP;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i] / 40), cz = Math.floor(zs[i] / 40);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of cell.get(`${cx + a},${cz + b}`) || []) {
      if (j >= i - gap) continue;
      minSep = Math.min(minSep, Math.hypot(xs[i] - xs[j], zs[i] - zs[j]));
    }
  }
  for (const b of t.bends) { if (Math.abs(b.a) >= 150 * D) hairpins++; if (Math.abs(b.a) >= 85 * D) sharp++; }
  check(maxH <= 110 * D + 1e-9, `seed ${seed}: heading ${(maxH / D).toFixed(1)} deg > 110`);
  check(minSep >= 40, `seed ${seed}: road came back within ${minSep.toFixed(1)} m of itself`);
  check(hairpins > 0 && sharp > hairpins, `seed ${seed}: ${hairpins} hairpins, ${sharp} sharp bends`);
  check(zs[n - 1] > KM * 1000 * 0.3, `seed ${seed}: only ${(zs[n - 1] / 1000).toFixed(0)} km forward in ${KM} km of road`);
  // signs only on sharp bends, on the outside
  const signs = t.itemsInS(0, KM * 1000, 'sign');
  check(signs.length > 0, `seed ${seed}: no chevron signs`);
  for (const sg of signs) { const b = t.bends.find((q) => sg.s >= q.s0 - 1 && sg.s <= q.s1 + 1); check(b && Math.abs(b.a) >= 85 * D && Math.sign(sg.lat) === -Math.sign(b.a), `seed ${seed}: stray sign at s ${sg.s.toFixed(0)}`); }
  check(t.itemsInS(0, KM * 1000, 'hiker').length > KM * 1000 / 500, `seed ${seed}: too few hitchhikers`);
  // frame round trip
  let hint;
  for (let k = 0; k < 3000; k++) {
    const s = Math.random() * KM * 1000, lat = (Math.random() - 0.5) * 16, p = t.at(s);
    const x = p.x + Math.cos(p.h) * lat, z = p.z - Math.sin(p.h) * lat;
    const f = t.frame(x, z, k % 2 ? hint : undefined); hint = f.i;
    check(Math.abs(f.s - s) < 1.0 && Math.abs(f.lat - lat) < 0.6, `seed ${seed}: frame(${s.toFixed(1)}, ${lat.toFixed(2)}) -> (${f.s.toFixed(1)}, ${f.lat.toFixed(2)})`);
  }
  check(t.roadDist(t.at(5000).x, t.at(5000).z) < 1.1, `seed ${seed}: roadDist on the road`);
  console.log(`seed ${seed}: max heading ${(maxH / D).toFixed(0)} deg, min separation ${minSep.toFixed(0)} m, ${t.bends.length} bends (${sharp} sharp, ${hairpins} hairpins), ${(zs[n - 1] / 1000).toFixed(0)} km forward`);
}
console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
process.exit(fails ? 1 : 0);
