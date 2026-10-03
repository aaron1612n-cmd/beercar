// The self-driving car (G), pure so tools/drivecheck.mjs can run it in Node: Stanley lane-keeping (the
// classic self-driving-car controller: the bend's own steering angle, minus the heading error, plus the lane
// offset scaled down with speed), slowing to 0.7 g for the tightest bend coming up, 90% of top speed.
// Cops use it too, with top = 1, a catch-up boost and a harder pull toward your lane (laneK) to ram you.
import { clamp, angDiff } from './vehicle.js';

// lane to hold: line up with the next hitchhiker still standing in the next 150 m, else 1.7 m left of centre
export function huntLane(track, s) {
  const kid = track.itemsInS(s + 2, s + 150, 'hiker').find((h) => !h.state || h.state.mode === 'stand');
  return kid ? kid.lat : 1.7;
}

// opts: lane to hold; top = share of top speed; boost = m/s over the safe bend speed; laneK = how hard it
// pulls to the lane; grip = share of latG it uses in bends; brakeA (m/s^2) = plan braking for each bend by
// distance (flat out until it has to brake) instead of crawling for the sharpest bend in sight (0 = off)
export function autopilot(tr, v, f, T, { lane = 1.7, boost = 0, top = 0.9, laneK = 1.5, grip = 0.7, brakeA = 0 } = {}) {
  const vf = v.vx * Math.sin(v.th) + v.vz * Math.cos(v.th), sp = Math.abs(vf), sF = f.s + 1.4;   // measured at the front axle
  const kRoad = (tr.at(sF + sp * 0.15 + 2).h - tr.at(sF + sp * 0.15 - 2).h) / 4;                // signed curvature, + = bends left
  const front = tr.at(sF), psi = angDiff(v.th, front.h);
  const delta = Math.atan(T.wheelbase * kRoad) - psi + Math.atan((laneK * (lane - f.lat)) / (sp + 1));
  const steer = clamp(delta / (T.steerMax / (1 + sp * T.steerFalloff)), -1, 1);
  let k = 0, vPlan = Infinity;                                              // sharpest curvature (1/radius) in the next few seconds
  for (let d = 0; d < 30 + sp * 3; d += 4) {
    const kd = Math.abs(tr.at(f.s + d + 4).h - tr.at(f.s + d).h) / 4;
    k = Math.max(k, kd);
    if (brakeA) vPlan = Math.min(vPlan, Math.sqrt((T.latG * grip) / Math.max(kd, 1e-4) + 2 * brakeA * d));   // still able to slow down in time
  }
  const vBend = brakeA ? vPlan : Math.sqrt((T.latG * grip) / Math.max(k, 1e-4));
  const vWant = Math.min(T.maxFwd * top, vBend + boost);
  return { throttle: clamp((vWant - vf) * 0.5, -1, 1), steer, handbrake: false };
}
