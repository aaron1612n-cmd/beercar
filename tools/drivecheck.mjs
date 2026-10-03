// node tools/drivecheck.mjs: (1) drive() is a bit-for-bit match for the physics that used to live in
// main.js step(); (2) the autopilot (Normal and Drift) gets round real track without hitting anything.
// Exits 1 on any failure.
import { drive, T, clamp } from '../src/vehicle.js';
import { autopilot, huntLane } from '../src/autopilot.js';
import { makeTrack } from '../src/track.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; if (fails < 20) console.log('FAIL', msg); } };

// ---- 1. replay guard ---------------------------------------------------------------------------
function legacy(S, throttle, steerIn, handbrake, power, auto, dt) {
  let vf = S.vx * Math.sin(S.th) + S.vz * Math.cos(S.th);
  let dWant = 0;
  if (handbrake && Math.abs(vf) > 6) dWant = 1;
  else if (!auto && throttle < 0 && vf > 12 && Math.abs(steerIn) > 0.5) dWant = 0.8;
  else if (S.drift > 0.15 && throttle > 0 && steerIn && Math.abs(vf) > 6) dWant = 0.7;
  S.drift += (dWant - S.drift) * Math.min(1, (dWant > S.drift ? 6 : 1.8) * dt);
  const lock = T.steerMax / (1 + Math.abs(vf) * T.steerFalloff);
  const want = steerIn * lock, dSt = T.steerRate * dt;
  S.steer += clamp(want - S.steer, -dSt, dSt);
  if (!steerIn) S.steer *= Math.exp(-5 * dt);
  const kick = handbrake ? steerIn * 1.3 * Math.sign(vf) : 0;
  const kin = ((vf * Math.tan(S.steer)) / T.wheelbase) * (1 + 1.7 * S.drift) + kick;
  const cap = (T.latG * (1 + 2.2 * S.drift)) / Math.max(1, Math.abs(vf)) + Math.abs(kick);
  S.yawRate = (S.yawRate || 0) + (clamp(kin, -cap, cap) - (S.yawRate || 0)) * Math.min(1, T.yawResp * dt);
  S.th += S.yawRate * dt;
  const nx = Math.sin(S.th), nz = Math.cos(S.th);
  vf = S.vx * nx + S.vz * nz;
  let latx = S.vx - nx * vf, latz = S.vz - nz * vf;
  const slip = Math.atan2(Math.hypot(latx, latz), Math.abs(vf) + 0.01);
  if (slip > 0.96) S.yawRate *= Math.exp(-6 * dt);
  if (throttle) {
    const opposing = throttle * vf < -0.05;
    vf += throttle * (opposing ? T.brake : T.accel * power * Math.max(0.1, 1 - Math.abs(vf) / T.maxFwd)) * dt;
  } else {
    const f2 = (T.coast + T.drag * vf * vf) * dt;
    vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2;
  }
  if (handbrake) { const f2 = 7 * dt; vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2; }
  const lat0 = Math.hypot(latx, latz), g = Math.exp(-T.grip * (1 - 0.85 * S.drift) * dt);
  latx *= g; latz *= g;
  if (S.drift > 0 && vf) vf += Math.sign(vf) * lat0 * (1 - g) * 0.7 * S.drift;
  vf = clamp(vf, -T.maxRev, T.maxFwd);
  S.vx = nx * vf + latx; S.vz = nz * vf + latz;
  S.x += S.vx * dt; S.z += S.vz * dt;
}

{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const fresh = () => ({ x: 1.7, z: 0, th: 0, vx: 0, vz: 0, steer: 0, yawRate: 0, drift: 0 });
  const A = fresh(), B = fresh(), dt = 1 / 60;
  let inp = { throttle: 1, steer: 0, handbrake: false, power: 1, auto: false }, odo = 0, maxDrift = 0;
  for (let i = 0; i < 3600; i++) {
    odo += Math.hypot(A.vx, A.vz) * dt; maxDrift = Math.max(maxDrift, A.drift);                                         // 60 s: a new random input every 0.5 s
    if (i % 30 === 0) inp = { throttle: [1, 1, 0, -1][(rnd() * 4) | 0], steer: [0, 1, -1, 0.4][(rnd() * 4) | 0],
      handbrake: rnd() < 0.15, power: rnd() < 0.1 ? 0 : 1, auto: rnd() < 0.3 };
    legacy(A, inp.throttle, inp.steer, inp.handbrake, inp.power, inp.auto, dt);
    drive(B, { throttle: inp.throttle, steer: inp.steer, handbrake: inp.handbrake, power: inp.power, brakeDrift: !inp.auto }, dt, T);
  }
  const d = Math.max(...['x', 'z', 'th', 'vx', 'vz', 'drift'].map((k) => Math.abs(A[k] - B[k])));
  check(d < 1e-9, `replay: drive() drifted ${d} from legacy`);
  check(odo > 150 && maxDrift > 0.5, `replay: the scripted run didn't exercise much (${odo.toFixed(0)} m, max drift ${maxDrift.toFixed(2)})`);
  console.log(`replay: max diff ${d} over ${odo.toFixed(0)} m driven, max drift ${maxDrift.toFixed(2)}`);
}

// ---- 2. autopilot round real track: 5 seeds x 3 km, Normal and Drift ---------------------------
// "crash" = nose/tail circle (r 0.8) touching a post/pole/sign above 4.47 m/s (same rule as the game;
// trees are cleared 11 m back from the road, so leaving the road (|lat| > 9) also counts)
const SIZE = { post: 0.08, pole: 0.15, sign: 0.06 }, D = Math.PI / 180;
function run(seed, mode) {
  const tr = makeTrack(seed), p = tr.at(0), dt = 1 / 60;
  const v = { x: p.x + Math.cos(p.h) * 1.7, z: p.z - Math.sin(p.h) * 1.7, th: p.h, vx: 0, vz: 0, steer: 0, yawRate: 0, drift: 0, ri: undefined };
  let t = 0, crashes = 0, slipSum = 0, slipN = 0, peak = 0, f = tr.frame(v.x, v.z);
  while (f.s < 3000 && t < 600) {
    f = tr.frame(v.x, v.z, v.ri); v.ri = f.i;
    const a = autopilot(tr, v, f, T, dt, { mode, lane: huntLane(tr, f.s) });
    const r = drive(v, { ...a, power: 1, brakeDrift: false }, dt, T);
    t += dt;
    const nx = Math.sin(v.th), nz = Math.cos(v.th), sp = Math.hypot(v.vx, v.vz);
    for (const d of [1.3, -1.2]) {
      const x = v.x + nx * d, z = v.z + nz * d;
      if (sp > 4.47 && tr.itemsNear(x, z, 1.3).some((it) => SIZE[it.kind] && Math.hypot(it.x - x, it.z - z) < 0.8 + SIZE[it.kind])) { crashes++; v.vx *= 0.2; v.vz *= 0.2; }
    }
    if (Math.abs(f.lat) > 9) { crashes++; break; }
    const b = tr.bends.find((q) => f.s >= q.s0 && f.s <= q.s1);
    if (b && Math.abs(b.a) >= 45 * D && sp > 8) { slipSum += r.slip; slipN++; peak = Math.max(peak, r.slip); }
  }
  return { t, crashes, slip: slipN ? slipSum / slipN / D : 0, peak: peak / D, done: f.s >= 3000 };
}
for (let seed = 1; seed <= 5; seed++) {
  const n = run(seed, 'normal'), d = run(seed, 'drift');
  check(n.done && n.crashes === 0, `seed ${seed} normal: ${n.crashes} crashes, finished ${n.done}`);
  check(d.done && d.crashes === 0, `seed ${seed} drift: ${d.crashes} crashes, finished ${d.done}`);
  // really sideways: the slides peak past 25 deg, and on average it's 2.5x as sideways as Normal through bends
  // (a mean over whole bends includes the turn-in and straighten-up, so it reads far lower than the peaks)
  check(d.peak > 25 && d.slip > 2.5 * n.slip, `seed ${seed} drift: slip peak ${d.peak.toFixed(0)} deg, mean ${d.slip.toFixed(1)} vs normal ${n.slip.toFixed(1)}`);
  check(d.t < n.t, `seed ${seed} drift ${d.t.toFixed(1)} s is not faster than normal ${n.t.toFixed(1)} s`);
  console.log(`seed ${seed}: normal ${n.t.toFixed(1)} s slip ${n.slip.toFixed(1)}° (peak ${n.peak.toFixed(0)}°), drift ${d.t.toFixed(1)} s slip ${d.slip.toFixed(1)}° (peak ${d.peak.toFixed(0)}°), crashes ${n.crashes}/${d.crashes}`);
}

console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
process.exit(fails ? 1 : 0);
