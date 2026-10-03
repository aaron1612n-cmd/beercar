// Cop cars: a pool of three Crown Vics ("Police car" by Mateusz Woliński, CC-BY-4.0:
// https://sketchfab.com/3d-models/police-car-9166b13b6ae341f4bfc093edb71d74f4) with a kid at the wheel and
// a kid riding shotgun. They drive on the same physics as the Camaro (vehicle.js), pursuit-tuned, under the
// autopilot with braking planned per bend. They set off 450 m back and reel you in. Hit something solid over
// 10 mph and they wreck; the slot refills 20 s later if you're still wanted.
// Origin = ground under the middle of the car, +Z = forward, +X = the driver's LEFT (as car.js).
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { drive, T } from './vehicle.js';
import { autopilot } from './autopilot.js';
import { makeKid } from './hitchhikers.js';

// Measured off the glb: the body is 6.7 units long (a Crown Vic is ~5.4 m), nose +Z, left +X, its middle at
// x -0.44 / z +0.075, tyres touching y 0.02. 0.82 makes it 5.5 m with 0.32 m wheels 2.94 m apart.
const SCALE = 0.82, OFFSET = [0.36, -0.02, -0.06], WHEEL_R = 0.324;
const SEAT = [0.38, 0.62, -0.2];                       // driver's hips (passenger mirrors x)
// pursuit-tuned: quicker than the Camaro everywhere (top speed, pull, grip), so once they're out they reel
// you in; they start BACK m behind, so there's a spell of hearing them coming first
// (from 450 m back they catch the autopilot in ~30-65 s with no wrecks: scratch sim over 5 tracks)
const TC = { ...T, maxFwd: 58, accel: 12, latG: 12.5, wheelbase: 2.94 };
const POOL = 3, BACK = 450, REFILL = 20, CRASH_V = 4.47, R = 0.9;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// navy uniform shirt, police cap with a black peak and a gold badge
const navy = (old) => new THREE.MeshStandardMaterial({ color: 0x1d2b4f, roughness: 0.85, normalMap: old.normalMap });
function policeCap() {
  const cap = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0x1a2340, roughness: 0.6 }));
  crown.position.y = 0.03;
  const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.3 }));
  peak.position.set(0, -0.002, 0.06); peak.scale.set(1, 1, 0.9);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshStandardMaterial({ color: 0xd8b040, metalness: 1, roughness: 0.3 }));
  badge.position.set(0, 0.035, 0.112);
  cap.add(crown, peak, badge);
  cap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return cap;
}

// sitting: thighs forward, shins down, hands out to the wheel/dash (person frame, before placing)
function sit(kid) {
  for (const [bone, q] of kid.rest) bone.quaternion.copy(q);
  const g = kid.g, p = g.parent, pos = g.position.clone(), q0 = g.quaternion.clone();
  if (p) p.remove(g);
  g.position.set(0, 0, 0); g.quaternion.identity();
  const aim = (bone, child, dir) => {
    const b = kid.B[bone], c = kid.B[child]; if (!b || !c) return;
    g.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromUnitVectors(c.getWorldPosition(V()).sub(b.getWorldPosition(V())).normalize(), dir.clone().normalize());
    const pw = b.parent.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));
  };
  for (const s of ['Left', 'Right']) {
    aim(s + 'UpLeg', s + 'Leg', V(0, -0.05, 1));
    aim(s + 'Leg', s + 'Foot', V(0, -1, 0.15));
    aim(s + 'Arm', s + 'ForeArm', V(0, -0.5, 1));
    aim(s + 'ForeArm', s + 'Hand', V(0, 0.1, 1));
  }
  g.position.copy(pos); g.quaternion.copy(q0);
  if (p) p.add(g);
}

export function buildPolice(scene, assets, world, hooks = {}) {
  const tr = world.track, cars = [];
  for (let k = 0; k < POOL; k++) {
    const root = new THREE.Group(); scene.add(root);
    const model = clone(assets.police.scene);
    model.scale.setScalar(SCALE); model.position.set(...OFFSET);
    root.add(model);
    let bar = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = o.name === 'CrownVicBody_0';                         // 256k tris x3: only the body's shadow is worth drawing
      if (o.material.name === 'roof_lights') bar = o.material = o.material.clone();
    });
    // wheels: pivot (steers) > spin (rolls) at each tyre's centre, as car.js does for the Camaro
    root.updateMatrixWorld(true);
    const wheels = [];
    for (const key of ['FtL', 'FtR', 'BkL', 'BkR']) {
      const tyre = model.getObjectByName(`CrownVicWheel${key}_0`); if (!tyre) continue;
      const c = new THREE.Box3().setFromObject(tyre).getCenter(V()); root.worldToLocal(c);
      const pivot = new THREE.Group(); pivot.position.copy(c); root.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      spin.attach(tyre);
      const brake = model.getObjectByName(`CrownVicWheelBrake${key}_0`); if (brake) pivot.attach(brake);
      wheels.push({ pivot, spin, front: key.startsWith('Ft') });
    }
    // kid cops: driver on the left (+X), passenger on the right
    const kids = [1, -1].map((side) => {
      const kid = makeKid(assets.avatar, { top: navy, bottom: 0x1a1a22, hat: policeCap() });
      kid.g.visible = true; kid.g.position.set(side * SEAT[0], SEAT[1], SEAT[2]);
      root.add(kid.g); sit(kid);
      return kid;
    });
    root.visible = false;
    cars.push({ root, wheels, bar, kids, active: false, wreckT: 0, s: 0, lat: 0,
      v: { x: 0, z: 0, th: 0, vx: 0, vz: 0, steer: 0, yawRate: 0, drift: 0, ri: undefined } });
  }
  // the light bars glow on their own; one red + one blue light (made up front, so nothing recompiles
  // mid-chase) ride on whichever cop is nearest: a light per car would cost every pixel on screen
  const red = new THREE.PointLight(0xff2020, 0, 30, 1.5), blue = new THREE.PointLight(0x2050ff, 0, 30, 1.5);
  scene.add(red, blue);

  function place(c, s, speed) {
    s = Math.max(-290, s);                                                  // track.js lays 300 m of road behind the start
    const p = tr.at(s), lat = 1.7;
    c.s = s; c.lat = lat;
    Object.assign(c.v, { x: p.x + Math.cos(p.h) * lat, z: p.z - Math.sin(p.h) * lat, th: p.h, vx: Math.sin(p.h) * speed, vz: Math.cos(p.h) * speed, steer: 0, yawRate: 0, drift: 0, ri: undefined });
    c.active = true; c.wreckT = 0; c.root.visible = true;
    c.root.position.set(c.v.x, 0, c.v.z); c.root.rotation.y = c.v.th;
  }
  const speedOf = (P) => Math.hypot(P.vx, P.vz);
  // bring the cars on the road (or due back from a wreck) up to n, new ones BACK m behind; n = 0 parks them all
  function setCount(n, P) {
    if (n === 0) { clearPopOut(); for (const c of cars) { c.active = false; c.wreckT = 0; c.root.visible = false; } red.intensity = blue.intensity = 0; return; }
    let have = cars.filter((c) => c.active || c.wreckT > 0).length;
    for (const c of cars) if (have < n && !c.active && !(c.wreckT > 0)) { place(c, P.s - BACK, speedOf(P) + 5); have++; }
  }
  function replace(P) { for (const c of cars) if (c.active) place(c, P.s - BACK, speedOf(P) + 5); }

  function wreck(c) {
    hooks.onWreck?.(V(c.v.x, 0.6, c.v.z));
    c.active = false; c.root.visible = false; c.wreckT = REFILL;
  }

  function update(dt, P, flashT) {
    let near = null, nd = Infinity;
    const on = Math.sin(flashT * Math.PI * 6) > 0;                         // red/blue, 3 Hz
    for (const c of cars) {
      if (c.wreckT > 0) { if ((c.wreckT -= dt) <= 0) place(c, P.s - BACK, speedOf(P) + 5); continue; }
      if (!c.active) continue;
      const f = tr.frame(c.v.x, c.v.z, c.v.ri); c.v.ri = f.i; c.s = f.s; c.lat = f.lat;
      const gap = P.s - f.s, dist = Math.hypot(P.x - c.v.x, P.z - c.v.z);
      // flat out until they have to brake for a bend (brakeA), using most of their grip; on your bumper they
      // push 2 m/s past that; within 60 m they line up on your lane, and inside 20 m they swerve hard into you
      const a = P.bustT > 0 ? { throttle: speedOf(c.v) > 0.5 ? -1 : 0, steer: 0, handbrake: false }   // got you: pull up
        : autopilot(tr, c.v, f, TC, { lane: dist < 60 ? P.lat : 1.7, top: 1, boost: gap > -2 && gap < 25 ? 2 : 0, laneK: dist < 20 ? 6 : 1.5, grip: 0.9, brakeA: 9 });
      const r = drive(c.v, { ...a, power: 1, brakeDrift: false }, dt, TC);
      // trees / posts / poles: wreck above 10 mph, bounce off below
      const nx = Math.sin(c.v.th), nz = Math.cos(c.v.th);
      for (const d of [1.3, -1.2]) {
        if (!world.obstacleAt(c.v.x + nx * d, c.v.z + nz * d, 0.8)) continue;
        if (speedOf(c.v) > CRASH_V) { wreck(c); break; }
        c.v.x -= c.v.vx * dt; c.v.z -= c.v.vz * dt; c.v.vx *= -0.3; c.v.vz *= -0.3; hooks.onBump?.(V(c.v.x, 0.5, c.v.z), 2);
        break;
      }
      if (!c.active) continue;
      c.root.position.set(c.v.x, 0, c.v.z); c.root.rotation.y = c.v.th;
      for (const k of c.kids) if (k.g.parent === c.root) k.g.visible = dist < 40;   // only seen through the windows up close
      for (const w of c.wheels) { w.spin.rotation.x += (r.vf * dt) / WHEEL_R; if (w.front) w.pivot.rotation.y = c.v.steer; }
      if (c.bar) { c.bar.emissive.set(on ? 0xff2020 : 0x2050ff); c.bar.emissiveIntensity = 4; }
      if (dist < nd) { nd = dist; near = c; }
    }
    // cop vs cop: push apart
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      if (!cars[i].active || !cars[j].active) continue;
      const a = cars[i].v, b = cars[j].v, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 2.4) { const p = (2.4 - d) / 2 / d; a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p; }
    }
    if (near) {
      const lx = Math.cos(near.v.th), lz = -Math.sin(near.v.th);           // the car's left
      red.position.set(near.v.x + lx * 0.45, 1.7, near.v.z + lz * 0.45); blue.position.set(near.v.x - lx * 0.45, 1.7, near.v.z - lz * 0.45);
      red.intensity = on ? 25 : 0; blue.intensity = on ? 0 : 25;
    } else red.intensity = blue.intensity = 0;
  }

  // for chase.js: how far back each live cop is, and whether its nose/tail circles touch the player's
  function status(P) {
    const pn = [Math.sin(P.th), Math.cos(P.th)];
    return cars.filter((c) => c.active).map((c) => {
      const cn = [Math.sin(c.v.th), Math.cos(c.v.th)];
      let contact = false;
      for (const a of [1.3, -1.2]) for (const b of [1.3, -1.2])
        if (Math.hypot(P.x + pn[0] * a - (c.v.x + cn[0] * b), P.z + pn[1] * a - (c.v.z + cn[1] * b)) < R * 2) contact = true;
      return { gap: P.s - c.s, dist: Math.hypot(P.x - c.v.x, P.z - c.v.z), contact };
    });
  }

  // BUSTED: the nearest cop's driver gets out and stands by his door, facing you
  let popped = null;
  function popOut(P) {
    let best = null, bd = Infinity;
    for (const c of cars) if (c.active) { const d = Math.hypot(P.x - c.v.x, P.z - c.v.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    best.v.vx = best.v.vz = best.v.yawRate = 0;                             // it rammed you: it stops right there
    const kid = best.kids[0];
    for (const [bone, q] of kid.rest) bone.quaternion.copy(q);
    scene.attach(kid.g);
    const lx = Math.cos(best.v.th), lz = -Math.sin(best.v.th);             // out of the driver's door
    kid.g.position.set(best.v.x + lx * 1.4, kid.standH, best.v.z + lz * 1.4);
    kid.g.rotation.set(0, Math.atan2(P.x - kid.g.position.x, P.z - kid.g.position.z), 0);
    popped = { car: best, kid };
    return best;
  }
  function clearPopOut() {
    if (!popped) return;
    const { car, kid } = popped; popped = null;
    car.root.add(kid.g); kid.g.position.set(SEAT[0], SEAT[1], SEAT[2]); kid.g.rotation.set(0, 0, 0); sit(kid);
  }

  return { cars, setCount, update, replace, status, popOut, clearPopOut };
}
