// The self-driving car (G), pure so tools/drivecheck.mjs can run it in Node. Both modes are Stanley
// lane-keeping (the classic self-driving-car controller: the bend's own steering angle, minus the heading
// error, plus the lane offset scaled down with speed) and both slow for the tightest bend coming up.
//   normal: sober and tidy, 0.7 g in bends, 90% of top speed
//   drift:  flat out, full grip in bends, flicks the handbrake into sharp ones and holds the slide with
//           the gas, pointing the nose into the bend by DRIFT.slip
// Cops use 'normal' with top = 1 and a catch-up boost.
import { clamp, angDiff } from './vehicle.js';

// tuned with tools/drivecheck.mjs: 0 crashes on 5 seeds x 3 km, slides peak at 32-36 deg (Normal: 4)
export const DRIFT = { gripUse: 0.85, entryK: 1 / 60, minV: 10, hold: 0.95, kHead: 1.6, minGas: 0.6, verge: 1.5, outside: 0.5 };

// lane to hold: line up with the next hitchhiker still standing in the next 150 m, else 1.7 m left of centre
export function huntLane(track, s) {
  const kid = track.itemsInS(s + 2, s + 150, 'hiker').find((h) => !h.state || h.state.mode === 'stand');
  return kid ? kid.lat : 1.7;
}

// sharpest curvature (1/radius) in the next `ahead` metres
function sharpest(tr, s, ahead) {
  let k = 0;
  for (let d = 0; d < ahead; d += 4) k = Math.max(k, Math.abs(tr.at(s + d + 4).h - tr.at(s + d).h) / 4);
  return k;
}

export function autopilot(tr, v, f, T, dt, { mode = 'normal', lane = 1.7, boost = 0, top = 0.9, laneK = 1.5 } = {}) {
  const vf = v.vx * Math.sin(v.th) + v.vz * Math.cos(v.th), sp = Math.abs(vf), sF = f.s + 1.4;   // measured at the front axle
  const kRoad = (tr.at(sF + sp * 0.15 + 2).h - tr.at(sF + sp * 0.15 - 2).h) / 4;                // signed curvature, + = bends left
  const front = tr.at(sF), lock = T.steerMax / (1 + sp * T.steerFalloff);
  const laneTerm = Math.atan((laneK * (lane - f.lat)) / (sp + 1));       // laneK: how hard it chases the lane (cops ramming: more)
  if (mode !== 'drift') {
    const psi = angDiff(v.th, front.h);
    const steer = clamp((Math.atan(T.wheelbase * kRoad) - psi + laneTerm) / lock, -1, 1);
    const k = sharpest(tr, f.s, 30 + sp * 3);
    const vWant = Math.min(T.maxFwd * top, Math.sqrt((T.latG * 0.7) / Math.max(k, 1e-4)) + boost);
    return { throttle: clamp((vWant - vf) * 0.5, -1, 1), steer, handbrake: false };
  }
  // ---- drift ----
  // The gas alone only holds a slide at a few degrees (the tyres keep scrubbing the sideways speed off), so
  // through a bend it feathers the handbrake to keep the slide near DRIFT.hold, like holding it sideways
  // by hand. It steers by where the car is actually GOING (the velocity), not where the nose points, and
  // eases the bend's steering by how much harder a sliding car turns (1 + 1.7 drift, see vehicle.js).
  const D = DRIFT, inBend = sharpest(tr, f.s, Math.max(25, sp * 1.2)) > D.entryK;
  const amp = 1 + 1.7 * v.drift;
  const vh = Math.hypot(v.vx, v.vz) > 2 ? Math.atan2(v.vx, v.vz) : v.th;
  const psi = angDiff(vh, front.h);
  const steer = clamp((Math.atan((T.wheelbase * kRoad) / amp) - psi * D.kHead + laneTerm) / lock, -1, 1);
  const vWant = Math.min(T.maxFwd, Math.sqrt((T.latG * D.gripUse) / Math.max(sharpest(tr, f.s, 30 + sp * 3), 1e-4)) + boost);
  let throttle = clamp((vWant - vf) * 0.5, -1, 1);
  const out = (lane - f.lat) * Math.sign(kRoad);                           // metres toward the outside of the bend
  const wide = Math.abs(f.lat - lane) > D.verge || out > D.outside;        // sliding off line: let it grip again
  const handbrake = inBend && !wide && vf > D.minV && v.drift < D.hold;
  if (inBend && v.drift > 0.15 && !wide) throttle = Math.max(D.minGas, throttle);   // the gas keeps the slide going
  if (!inBend && v.drift > 0.15) throttle = Math.min(throttle, 0);       // bend's done: lift so the slide dies
  return { throttle, steer, handbrake };
}
