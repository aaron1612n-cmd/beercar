// The road's shape: a centreline of straights and bends (gentle kinks up to hairpins), generated from a
// seed in pieces as the car needs it, sampled every STEP metres. Pure maths (no three.js) so
// tools/trackcheck.mjs can drive it in node.
// Heading h: 0 = +z; the road points along (sin h, cos h); its LEFT is (cos h, -sin h) = +lat
// (the same convention as the car's S.th, where +X is the driver's left).
// Rules: heading stays within +-110 deg of +z, so the road always trends forward; and every new sample
// keeps 40 m clear of all road more than 120 m back, so legs of a hairpin never touch.
// Roadside items (posts, poles, chevron signs, hitchhiker spots) are laid down with the road.
export const STEP = 2;
const D = Math.PI / 180, MAXH = 110 * D, SEP = 40, GAP = 120 / STEP, BACK = 300, CELL = 16;
const POST_GAP = 32, POLE_GAP = 48, SIGN_GAP = 8;
// bend classes: [min deg, max deg, min radius, max radius, odds]
const BENDS = [[15, 35, 120, 250, 0.4], [45, 70, 50, 90, 0.3], [85, 95, 25, 40, 0.18], [150, 180, 12, 16, 0.12]];
const rng = (seed) => { let s = ((seed >>> 0) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const ckey = (cx, cz) => cx * 65536 + cz;

export function makeTrack(seed = 1) {
  const rnd = rng(seed * 7717 + 3);
  const xs = [], zs = [], hs = [], i0 = BACK / STEP;
  const grid = new Map(), itemGrid = new Map(), items = [], bends = [];
  const put = (map, x, z, v) => { const k = ckey(Math.floor(x / CELL), Math.floor(z / CELL)); let a = map.get(k); if (!a) map.set(k, a = []); a.push(v); };
  const sOf = (i) => (i - i0) * STEP;
  let nextHiker = 120, seen = -Infinity, stuck = 0;
  const pieces = [];                                                     // what each grow() added, so it can be undone

  function addItem(kind, i, lat, side = Math.sign(lat)) {
    const h = hs[i], it = { kind, s: sOf(i), lat, side, h, x: xs[i] + Math.cos(h) * lat, z: zs[i] - Math.sin(h) * lat };
    items.push(it); put(itemGrid, it.x, it.z, it);
  }
  function push(x, z, h, bend) {
    const i = xs.length; xs.push(x); zs.push(z); hs.push(h); put(grid, x, z, i);
    const s = sOf(i);
    if (s < 0) return;
    const sharp = bend && Math.abs(bend.a) >= 85 * D, out = bend ? -Math.sign(bend.a) : 0;
    if (s % POST_GAP === 0) for (const side of [-1, 1]) if (!(sharp && side === out)) addItem('post', i, side * 5.5);
    if (s % POLE_GAP === 0) addItem('pole', i, -7);
    if (sharp && s % SIGN_GAP === 0) addItem('sign', i, out * 6.3);
    if (!bend && s >= nextHiker && s % POST_GAP === POST_GAP / 2) { addItem('hiker', i, (rnd() - 0.5) * 3 || 0.1); nextHiker = s + 250 + rnd() * 200; }
  }
  for (let i = 0; i <= i0; i++) push(0, sOf(i), 0, null);

  // would a sample at (x, z), index i, come within SEP of older road?
  function clash(x, z, i) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), R = Math.ceil(SEP / CELL);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const j of grid.get(ckey(cx + a, cz + b)) || []) {
      if (j < i - GAP && Math.hypot(xs[j] - x, zs[j] - z) < SEP) return true;
    }
    return false;
  }
  // one piece = a straight then a bend; returns the samples, or null if they'd crowd older road
  function trace(L, a, r) {
    const pts = [], n = xs.length;
    let x = xs[n - 1], z = zs[n - 1], h = hs[n - 1];
    const ns = Math.round(L / STEP), nb = Math.max(1, Math.round(Math.abs(a) * r / STEP)), dh = a / nb;
    for (let k = 0; k < ns + nb; k++) {
      if (k >= ns) h += dh;
      x += Math.sin(h) * STEP; z += Math.cos(h) * STEP;
      if (clash(x, z, n + k)) return null;
      pts.push([x, z, h, k >= ns]);
    }
    return pts;
  }
  function plan(h) {
    let u = rnd(), c = 0; while (c < 3 && (u -= BENDS[c][4]) > 0) c++;
    const B = BENDS[c];
    let a = (B[0] + rnd() * (B[1] - B[0])) * D, sign = rnd() < 0.5 ? -1 : 1;
    if (Math.abs(h) > 60 * D && rnd() < 0.75) sign = -Math.sign(h);      // lean back toward straight ahead
    if (Math.abs(h + sign * a) > MAXH) sign = -sign;
    if (Math.abs(h + sign * a) > MAXH) a = MAXH - sign * h;               // even toward 0 it overshoots: trim it
    return { L: 40 + rnd() * 160, a: sign * a, r: B[2] + rnd() * (B[3] - B[2]) };
  }
  // undo the newest piece (only if nobody has looked at that stretch of road yet)
  function unGrow() {
    const pc = pieces[pieces.length - 1];
    if (!pc || sOf(pc.n) <= seen + 1) return false;
    pieces.pop(); bends.pop(); nextHiker = pc.nextHiker;
    while (xs.length > pc.n) { const i = xs.length - 1; grid.get(ckey(Math.floor(xs[i] / CELL), Math.floor(zs[i] / CELL))).pop(); xs.pop(); zs.pop(); hs.pop(); }
    while (items.length > pc.items) { const it = items.pop(); itemGrid.get(ckey(Math.floor(it.x / CELL), Math.floor(it.z / CELL))).pop(); }
    return true;
  }
  function grow() {
    const h = hs[hs.length - 1];
    let p, pts = null;
    for (let tries = 0; tries < 12 && !pts; tries++) { p = plan(h); pts = trace(p.L, p.a, p.r); }
    for (const r of [40, 90, 180]) for (const L of [10, 60]) if (!pts) { p = { L, a: -h, r }; pts = trace(p.L, p.a, p.r); }   // ease back toward +z
    if (!pts && stuck < 8 && unGrow() && unGrow()) { stuck++; return; }   // boxed in: back up two pieces and roll again
    if (!pts) { p = { L: 2, a: -h, r: 60 }; pts = []; let x = xs[xs.length - 1], z = zs[zs.length - 1], hh = h;   // last resort, unchecked
      const nb = Math.max(1, Math.round(Math.abs(p.a) * p.r / STEP)); for (let k = 0; k < nb; k++) { hh += p.a / nb; x += Math.sin(hh) * STEP; z += Math.cos(hh) * STEP; pts.push([x, z, hh, true]); } }
    stuck = 0;
    pieces.push({ n: xs.length, items: items.length, nextHiker });
    const ns = pts.findIndex((q) => q[3]), bend = { a: p.a, r: p.r, s0: sOf(xs.length + (ns < 0 ? pts.length : ns)), s1: sOf(xs.length + pts.length - 1) };
    bends.push(bend);
    for (const [x, z, hh, inBend] of pts) push(x, z, hh, inBend ? bend : null);
  }
  const ensure = (s) => { while (sOf(xs.length - 1) < s) grow(); };

  function at(s) {
    ensure(s + STEP); seen = Math.max(seen, s);
    const f = Math.max(0, i0 + s / STEP), i = Math.min(xs.length - 2, Math.floor(f)), u = f - i;
    return { x: xs[i] + (xs[i + 1] - xs[i]) * u, z: zs[i] + (zs[i + 1] - zs[i]) * u, h: hs[i] + (hs[i + 1] - hs[i]) * u };
  }
  function nearest(x, z, lo, hi) {
    let best = -1, bd = Infinity;
    for (let i = Math.max(0, lo); i <= Math.min(xs.length - 1, hi); i++) { const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return [best, bd];
  }
  // world point -> where it is relative to the road: s along it, lat metres left of the centre
  function frame(x, z, hint) {
    let i = -1, bd = Infinity;
    if (hint !== undefined) [i, bd] = nearest(x, z, hint - 40, hint + 40);
    if (i < 0 || bd > 400) {
      i = -1; bd = Infinity;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let R = 1; R <= 8 && i < 0; R *= 2) {
        for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const j of grid.get(ckey(cx + a, cz + b)) || []) {
          const d = (xs[j] - x) ** 2 + (zs[j] - z) ** 2; if (d < bd) { bd = d; i = j; }
        }
      }
      if (i < 0) [i, bd] = nearest(x, z, 0, xs.length - 1);             // miles off: scan it all
    }
    seen = Math.max(seen, sOf(i) + 50);
    const h = hs[i], dx = x - xs[i], dz = z - zs[i];
    const along = dx * Math.sin(h) + dz * Math.cos(h), lat = dx * Math.cos(h) - dz * Math.sin(h);
    const k = (hs[Math.min(i + 1, hs.length - 1)] - hs[Math.max(i - 1, 0)]) / (2 * STEP);   // curvature: off-centre arcs are longer/shorter
    return { s: sOf(i) + along / Math.max(0.2, 1 - lat * k), lat, h: h + along * k, i };
  }
  function roadDist(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(ckey(cx + a, cz + b)) || []) bd = Math.min(bd, (xs[j] - x) ** 2 + (zs[j] - z) ** 2);
    return Math.sqrt(bd);
  }
  function itemsNear(x, z, r) {
    const out = [], R = Math.ceil(r / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const it of itemGrid.get(ckey(cx + a, cz + b)) || []) if (Math.hypot(it.x - x, it.z - z) < r) out.push(it);
    return out;
  }
  // items are pushed in s order, so a binary search finds the range
  function itemsInS(s0, s1, kind) {
    ensure(s1); seen = Math.max(seen, s1);
    let lo = 0, hi = items.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (items[m].s < s0) lo = m + 1; else hi = m; }
    const out = [];
    for (let k = lo; k < items.length && items[k].s <= s1; k++) if (!kind || items[k].kind === kind) out.push(items[k]);
    return out;
  }
  return { ensure, at, frame, roadDist, itemsNear, itemsInS, bends, samples: { xs, zs, hs, i0 } };
}
