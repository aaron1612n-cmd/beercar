// The fly's hands on the wheel. The connectome is fixed; what learns is the last link, from cells of the
// brain's visual system to the steering wheel. (Measured with tools/flytrain.mjs: reading only the visual
// projection neurons, it stayed within 1 m of the lane 40% of the time; picking from the whole visual
// system, 89%. The road barely reaches the descending neurons in this spiking model.)
//   1. Watching: the first lessons only measure which cells' firing tracks the instructor's steering;
//      the K best become the wheel's inputs.
//   2. Learning: each input is heard at two speeds (fast ~50 ms, slow ~300 ms smoothing; the gap between
//      them tells drift, not just position), and recursive least squares fits
//          steer = sum(W * features) + b      to every lesson as it happens.
// Shared by the game (fly.js) and tools/flytrain.mjs.
const WATCH = 150, FAST = 50, SLOW = 300;

export function makePilot(nPool, saved, { K = 400 } = {}) {
  const fast = new Float32Array(nPool), slow = new Float32Array(nPool);
  const D = 2 * K + 1, x = new Float64Array(D), Px = new Float64Array(D);
  let W = new Float64Array(D), P, sel = null, lessons = 0, err = 0.5;
  // watching stats: sums for the correlation of each cell's fast rate with the target
  let n = 0, st = 0, st2 = 0, sx = new Float64Array(nPool), sx2 = new Float64Array(nPool), sxt = new Float64Array(nPool);
  const resetP = (p0) => { P = new Float64Array(D * D); for (let i = 0; i < D; i++) P[i * D + i] = p0; };
  if (saved && saved.sel && saved.sel.length === K && saved.W.length === D && saved.nPool === nPool) {
    sel = Uint32Array.from(saved.sel); W.set(saved.W); lessons = saved.lessons; err = saved.err ?? err; resetP(0.05);
  }

  function features() {
    for (let k = 0; k < K; k++) { x[k] = fast[sel[k]]; x[K + k] = slow[sel[k]]; }
    x[2 * K] = 1;
    return x;
  }
  const p = {
    get lessons() { return lessons; }, get err() { return err; }, get watching() { return !sel; }, get watchLeft() { return WATCH - n; },
    // counts = spikes per pool cell over the last `ms` of brain time -> smoothed rates (fraction of 50 Hz)
    feed(counts, ms) {
      const kf = Math.min(1, ms / FAST), ks = Math.min(1, ms / SLOW), s = 1000 / ms / 50;
      for (let i = 0; i < nPool; i++) { const r = counts[i] * s; fast[i] += (r - fast[i]) * kf; slow[i] += (r - slow[i]) * ks; }
    },
    steer() {
      if (!sel) return 0;
      features(); let y = 0; for (let i = 0; i < D; i++) y += W[i] * x[i]; return y;
    },
    learn(target) {
      lessons++;
      if (!sel) {                                                     // still watching: gather correlations
        n++; st += target; st2 += target * target;
        for (let i = 0; i < nPool; i++) { const f = fast[i]; sx[i] += f; sx2[i] += f * f; sxt[i] += f * target; }
        if (n >= WATCH) {
          const vt = st2 / n - (st / n) ** 2, score = new Float64Array(nPool);
          for (let i = 0; i < nPool; i++) {
            const vx = sx2[i] / n - (sx[i] / n) ** 2;
            score[i] = vx > 1e-6 && vt > 1e-6 ? Math.abs(sxt[i] / n - (sx[i] / n) * (st / n)) / Math.sqrt(vx * vt) : 0;
          }
          sel = Uint32Array.from([...score.keys()].sort((a, b) => score[b] - score[a]).slice(0, K));
          resetP(1); sx = sx2 = sxt = null;
        }
        return 0;
      }
      features();
      let y = 0; for (let i = 0; i < D; i++) y += W[i] * x[i];
      const e = target - y;
      // RLS with forgetting 0.9995 (~2000-lesson memory, so it keeps adapting, e.g. to being drunk)
      const lam = 0.9995;
      let den = lam;
      for (let i = 0; i < D; i++) { let s = 0; const row = i * D; for (let j = 0; j < D; j++) s += P[row + j] * x[j]; Px[i] = s; den += x[i] * s; }
      for (let i = 0; i < D; i++) W[i] += (Px[i] / den) * e;
      for (let i = 0; i < D; i++) { const ki = Px[i] / den, row = i * D; for (let j = 0; j < D; j++) P[row + j] = (P[row + j] - ki * Px[j]) / lam; }
      err += (Math.abs(e) - err) * 0.01;
      return y;
    },
    forget() { W = new Float64Array(D); sel = null; lessons = 0; err = 0.5; n = st = st2 = 0; sx = new Float64Array(nPool); sx2 = new Float64Array(nPool); sxt = new Float64Array(nPool); },
    save: () => (sel ? { nPool, sel: Array.from(sel), W: Array.from(W, (v) => +v.toFixed(6)), lessons, err } : null),
  };
  return p;
}

// The fly's thirst, learned by reward like a fly's dopamine system does. Every few seconds it decides
// whether to go for the beer: p(drink) = sigmoid(w . f), f = [1, how its brain feels, buzz].
// "How its brain feels" is its own overall firing: alcohol damps every synapse, so a drunk brain runs
// quieter and the fly can sense that. Reward: buzz went up = +1, buzz slipped = -0.5. REINFORCE update:
//   w += lr * (reward - average reward) * (did it drink - p) * f
// Drinking itself still needs MN9 to fire (taste -> proboscis is innate wiring); this only learns *wanting*.
export function makeCraving(saved) {
  const w = saved && saved.w && saved.w.length === 3 ? saved.w.slice() : [-0.85, 0, 0];   // starts ~30% keen
  let base = 0, tries = saved?.tries ?? 0, last = null;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  return {
    get w() { return w; }, get tries() { return tries; },
    chance: (f) => sig(w[0] * f[0] + w[1] * f[1] + w[2] * f[2]),
    decide(f) { const p = this.chance(f), a = Math.random() < p ? 1 : 0; last = { f, a, p }; return !!a; },
    reward(r, lr = 0.3) {
      if (!last) return;
      base += (r - base) * 0.1;
      const k = lr * (r - base) * (last.a - last.p);
      for (let i = 0; i < 3; i++) w[i] = Math.max(-6, Math.min(6, w[i] + k * last.f[i]));
      tries += last.a; last = null;
    },
    save: () => ({ w: w.map((v) => +v.toFixed(4)), tries }),
  };
}

// Where each lamina cell looks: u (0 front -> 1 side/back) and v (0 down -> 1 up) from the cell's place
// in the eye (see tools/build-flybrain.py) -> azimuth (+ = left) and elevation, radians.
// ponytail: a fly eye spans ~0-160 deg out to its side and ~+-60 deg up/down; the mapping is linear.
export function eyeDir(side, u, v) {
  const az = (5 + u * 140) * (Math.PI / 180);
  return { az: side === 'left' ? az : -az, el: (v - 0.5) * 120 * (Math.PI / 180) };
}

// Darkness seen by each lamina cell -> its firing rate (Hz). Like a real eye it adapts to the scene's
// average and reports contrast; L1-L3 fire for darker-than-average (they depolarise when light dims).
export function eyeRates(dark, out) {
  let m = 0, s = 0; for (const d of dark) m += d; m /= dark.length;
  for (const d of dark) s += (d - m) ** 2; s = Math.sqrt(s / dark.length) || 1;
  for (let k = 0; k < dark.length; k++) out[k] = Math.max(0, Math.min(250, 40 + 80 * (dark[k] - m) / s));
  return out;
}

// The instructor: the steering a sober driver would use to hold `laneX` (x = metres left of the road
// centre, th = heading, 0 = straight down the road, positive = turned left). Output in [-1, 1], + = left.
export function instructor(x, th, laneX, speed) {
  const look = Math.max(6, speed * 1.2);                      // aim at a point on the lane ahead
  const want = Math.atan2(laneX - x, look);
  return Math.max(-1, Math.min(1, (want - th) * 2.5));
}
