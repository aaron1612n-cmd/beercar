// Car physics shared by the Camaro and the cop cars: arcade grip with a drift mode. Pure (no three.js),
// so tools/drivecheck.mjs can run it in Node. drive() mutates the vehicle state in place.

// ---- tuning: top speed ~90 mph. Turning is limited by tyre grip (latG), not just the steering lock,
// so it's quick in town and calm on the highway; the heading follows with a little yaw inertia. --------
export const T = { maxFwd: 40, maxRev: 8, accel: 7, brake: 16, coast: 1.4, drag: 0.0012, steerMax: 0.55, steerRate: 1.8, steerFalloff: 0.035,
  wheelbase: 2.76, grip: 14, latG: 8.5, yawResp: 7, fov: 72, sens: 0.0022, camDist: 7.5, camHeight: 2.8, camLag: 4 };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// v = { x, z, th, vx, vz, steer, yawRate, drift }; inp = { throttle -1..1, steer -1..1 (+ = left), handbrake,
// power 0..1 (0 while a gear goes in), brakeDrift (stamping on the brake into a bend starts a slide),
// slide (0, or how hard to kick the tail: breaks the rears loose like the handbrake but without braking,
// a clutch kick, for the Drift autopilot) }.
// Returns forward speed after (vf) and before (vf0) the longitudinal forces, the slip angle, and the drift
// amount coming in (drift0) so the caller can play a chirp when a slide starts.
export function drive(v, { throttle, steer: steerIn, handbrake, power = 1, brakeDrift = true, slide = 0 }, dt, T) {
  let vf = v.vx * Math.sin(v.th) + v.vz * Math.cos(v.th);
  // drift (arcade): the handbrake, or stamping on the brake into a bend, lets the back end go; it then
  // holds for as long as you stay on the gas and keep steering, and tidies itself up when you stop
  let dWant = 0;
  if ((handbrake || slide) && Math.abs(vf) > 6) dWant = 1;
  else if (brakeDrift && throttle < 0 && vf > 12 && Math.abs(steerIn) > 0.5) dWant = 0.8;
  else if (v.drift > 0.15 && throttle > 0 && steerIn && Math.abs(vf) > 6) dWant = 0.7;
  const drift0 = v.drift;
  v.drift += (dWant - v.drift) * Math.min(1, (dWant > v.drift ? 6 : 1.8) * dt);

  // steering: the body yaws first, then the tyres drag the velocity round after it (less so in a drift)
  const lock = T.steerMax / (1 + Math.abs(vf) * T.steerFalloff);
  const want = steerIn * lock, dSt = T.steerRate * dt;
  v.steer += clamp(want - v.steer, -dSt, dSt);
  if (!steerIn) v.steer *= Math.exp(-5 * dt);
  const kick = (handbrake ? 1.3 : slide) * steerIn * Math.sign(vf);         // a yanked handbrake (or a clutch kick) swings the tail
  const kin = ((vf * Math.tan(v.steer)) / T.wheelbase) * (1 + 1.7 * v.drift) + kick;
  const cap = (T.latG * (1 + 2.2 * v.drift)) / Math.max(1, Math.abs(vf)) + Math.abs(kick);
  v.yawRate = (v.yawRate || 0) + (clamp(kin, -cap, cap) - (v.yawRate || 0)) * Math.min(1, T.yawResp * dt);
  v.th += v.yawRate * dt;
  const nx = Math.sin(v.th), nz = Math.cos(v.th);
  vf = v.vx * nx + v.vz * nz;
  let latx = v.vx - nx * vf, latz = v.vz - nz * vf;
  const vf0 = vf, slip = Math.atan2(Math.hypot(latx, latz), Math.abs(vf) + 0.01);
  if (slip > 0.96) v.yawRate *= Math.exp(-6 * dt);                          // ~55 deg is as sideways as it gets

  // longitudinal: power fades toward top speed; coast = rolling + air drag; no drive while a gear goes in
  if (throttle) {
    const opposing = throttle * vf < -0.05;
    vf += throttle * (opposing ? T.brake : T.accel * power * Math.max(0.1, 1 - Math.abs(vf) / T.maxFwd)) * dt;
  } else {
    const f2 = (T.coast + T.drag * vf * vf) * dt;
    vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2;
  }
  if (handbrake) { const f2 = 7 * dt; vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2; }
  // lateral grip; in a drift most of the sideways speed the tyres scrub off is handed back as forward speed
  const lat0 = Math.hypot(latx, latz), g = Math.exp(-T.grip * (1 - 0.85 * v.drift) * dt);
  latx *= g; latz *= g;
  if (v.drift > 0 && vf) vf += Math.sign(vf) * lat0 * (1 - g) * 0.7 * v.drift;
  vf = clamp(vf, -T.maxRev, T.maxFwd);

  v.vx = nx * vf + latx; v.vz = nz * vf + latz;
  v.x += v.vx * dt; v.z += v.vz * dt;
  return { vf, vf0, slip, drift0 };
}
