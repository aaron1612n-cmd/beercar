// The driver: a rigged Ready Player Me avatar posed procedurally every frame.
// Legs are IK'd onto the floor, arms are two-bone IK'd so the PALM lands
// on its target (the steering-wheel rim, a bottle neck, a cigar), and every finger
// takes a per-grip pose (three joints + spread each, thumb across the palm)
// instead of one uniform curl.
//
// Beer (right hand): a 650 ml green longneck held by the neck. Drinking tips it
// until the beer (which stays level) reaches your lips; when it runs dry it is
// thrown off the car and lands as litter. With no bottle, ` takes a fresh one
// from the carrier on the fender and twists the cap off (the cap flies too).
// Cigar (left hand): held between index and middle finger while steering;
// Q smokes it; once it's burnt down the butt is flicked away (still glowing);
// with none left in hand, Q takes a new one from the box and lights it.
//
// Poses are authored in the car body's frame (+Z forward, +X = driver's
// LEFT). A hand pose is {p: palm-surface centre, q: hand frame (X = palm
// normal, Z = fingers), fp: finger pose}.
import * as THREE from 'three';
import { canvasTex, rbox } from './car.js';
import { heightAt } from './road.js';
import { makeBottle, bottleMesh, bottleRadius, BOTTLE_H, NECK_Y } from './bottle.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const qx = (a) => Q().setFromAxisAngle(V(1, 0, 0), a);
const qe = (x, y, z) => Q().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
// rotation taking canonical X to x and Z to z (x re-orthogonalised against z)
function frame(x, z) {
  const zz = z.clone().normalize(), xx = x.clone().addScaledVector(zz, -x.dot(zz)).normalize(), yy = V().crossVectors(zz, xx);
  return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
}

// Finger poses: index, middle, ring, pinky = [mcp, pip, dip, spread]; thumb = [across, flex1, flex2, flex3].
// For grips these are curl LIMITS: fingers stop earlier when they touch the object (curlChain).
const FP = {
  open: { f: [[0.12, 0.14, 0.08, 0.1], [0.1, 0.14, 0.08, 0], [0.14, 0.18, 0.1, -0.08], [0.18, 0.2, 0.1, -0.15]], t: [0.1, 0.1, 0.15, 0.1] },
  wheel: { f: [[1.4, 1.7, 1.1, 0.06], [1.4, 1.7, 1.1, 0], [1.4, 1.7, 1.1, -0.06], [1.4, 1.7, 1.1, -0.12]], t: [0.6, 0.6, 0.8, 0.7] },
  wheelCigar: { f: [[0.3, 0.35, 0.18, 0.2], [0.3, 0.38, 0.2, -0.16], [1.4, 1.7, 1.1, -0.06], [1.4, 1.7, 1.1, -0.12]], t: [0.6, 0.6, 0.8, 0.7] },
  neck: { f: [[1.6, 1.8, 1.2, 0.04], [1.6, 1.8, 1.2, 0], [1.6, 1.8, 1.2, -0.04], [1.6, 1.8, 1.2, -0.08]], t: [1.0, 0.9, 1.1, 0.9] },
  smoke: { f: [[0.28, 0.3, 0.18, 0.2], [0.28, 0.34, 0.2, -0.16], [0.95, 1.25, 0.72, -0.04], [1.05, 1.3, 0.78, -0.08]], t: [0.35, 0.2, 0.35, 0.3] },
  lighter: { f: [[1.3, 1.6, 1.0, 0.04], [1.3, 1.6, 1.0, 0], [1.3, 1.6, 1.0, -0.05], [1.3, 1.6, 1.0, -0.1]], t: [0.3, 0.1, 0.1, 0.05] },
  flick: { f: [[0.05, 0.05, 0.02, 0.15], [0.05, 0.08, 0.04, -0.05], [0.3, 0.4, 0.3, -0.1], [0.35, 0.45, 0.3, -0.18]], t: [0.1, 0.05, 0.05, 0.05] },
  knob: { f: [[1.2, 1.4, 0.9, 0.12], [1.2, 1.4, 0.9, 0], [1.2, 1.4, 0.9, -0.12], [1.2, 1.4, 0.9, -0.22]], t: [0.8, 0.5, 0.6, 0.5] },
};
const fpLerp = (a, b, u) => ({ f: a.f.map((r, i) => r.map((v, j) => v + (b.f[i][j] - v) * u)), t: a.t.map((v, i) => v + (b.t[i] - v) * u) });

const SEAT = V(0, 0.99, -0.43);             // hips bone (body frame)
const MOUTH = V(0, -0.095, 0.06);           // relative to the eyes, head frame
const CIG_L = 0.14, CIG_MIN = 0.05;
const CIG_AT_MOUTH = Q().setFromAxisAngle(V(0, 1, 0), 0.35).multiply(Q().setFromAxisAngle(V(1, 0, 0), Math.PI / 2 + 0.05));   // head frame
const FIRST_PERSON_HIDE = ['Wolf3D_Head', 'Wolf3D_Teeth', 'EyeLeft', 'EyeRight', 'Wolf3D_Beard', 'Wolf3D_Headwear'];

export function buildDriver(car, hooks, gltf, scene) {
  const { body, spinner, wheelGroup, RIM, cupholder, sixPack, cigarBox, shifter } = car;
  const maxTilt = car.maxDrinkTilt ?? 9;                    // bottle tip (rad, head frame) the roof allows
  const feet = car.feet ?? { x: 0.29, ankle: V(0, 0.53, 0.3), toe: V(0, 0.47, 0.48) };   // body frame; x = half the stance

  // ---- avatar --------------------------------------------------------------
  const avatar = gltf.scene; body.add(avatar);
  const B = {}, rest = new Map(), headMeshes = [];
  avatar.traverse((o) => {
    if (o.isBone) { B[o.name] = o; rest.set(o, o.quaternion.clone()); }
    if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; }
    if (FIRST_PERSON_HIDE.includes(o.name)) headMeshes.push(o);
  });
  const plaid = canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#7e1c1a'; c.fillRect(0, 0, w, w);
    c.fillStyle = 'rgba(15,8,8,.55)'; for (let i = 0; i < w; i += 64) { c.fillRect(i, 0, 22, w); c.fillRect(0, i, w, 22); }
    c.fillStyle = 'rgba(230,200,120,.22)'; for (let i = 40; i < w; i += 64) { c.fillRect(i, 0, 3, w); c.fillRect(0, i, w, 3); }
  });
  plaid.wrapS = plaid.wrapT = THREE.RepeatWrapping; plaid.repeat.set(3, 3);
  avatar.traverse((o) => {
    if (o.name === 'Wolf3D_Outfit_Top') o.material = new THREE.MeshStandardMaterial({ map: plaid, normalMap: o.material.normalMap, roughness: 0.95 });
    if (o.name === 'Wolf3D_Outfit_Bottom') { o.material = o.material.clone(); o.material.map = null; o.material.color.set(0x2d4568); o.material.roughness = 0.95; }
  });

  body.updateWorldMatrix(true, true);
  avatar.position.sub(body.worldToLocal(B.Hips.getWorldPosition(V()))).add(SEAT);
  body.updateWorldMatrix(true, true);

  const bodyQ = Q(), tq = Q(), tq2 = Q(), t1 = V(), t2 = V(), t3 = V();
  const restRel = new Map();
  body.getWorldQuaternion(bodyQ);
  for (const n of ['Neck', 'Head', 'Spine1', 'Spine2']) restRel.set(n, bodyQ.clone().invert().multiply(B[n].getWorldQuaternion(Q())));
  const len = (a, b) => B[a].getWorldPosition(V()).distanceTo(B[b].getWorldPosition(V()));
  const L = {};
  for (const s of ['Left', 'Right']) {
    L[s + 'Arm'] = [len(s + 'Arm', s + 'ForeArm'), len(s + 'ForeArm', s + 'Hand')];
    L[s + 'Leg'] = [len(s + 'UpLeg', s + 'Leg'), len(s + 'Leg', s + 'Foot')];
  }

  // ---- hand rig: frames, palm offset, per-joint axes ------------------------
  const hand = {};
  for (const [s, side] of [['Left', 1], ['Right', -1]]) {
    const P = (n) => B[s + 'Hand' + n].position.clone();
    const f = P('Middle1').normalize(), lat = P('Index1').sub(P('Pinky1')).normalize();    // lat points to the thumb side
    let n = V().crossVectors(f, lat).normalize();
    if (n.dot(P('Thumb2').add(P('Thumb1'))) < 0) n.negate();           // the thumb sits on the palm side
    const corr = frame(n, f).invert();                                  // hand frame -> bone local
    const sc = len(s + 'Hand', s + 'HandMiddle1') / B[s + 'HandMiddle1'].position.length();
    const toHand = (v) => v.clone().applyQuaternion(corr).multiplyScalar(sc);   // bone-local point -> hand frame (m)
    const palm = toHand(P('Middle1').multiplyScalar(0.5).addScaledVector(n, 0.016 / sc));
    const chain = (name, spread) => {
      let nl = n.clone(), ll = lat.clone();
      return [1, 2, 3].map((k) => {
        const bone = B[s + 'Hand' + name + k], child = B[s + 'Hand' + name + (k + 1)], inv = rest.get(bone).clone().invert();
        nl = nl.clone().applyQuaternion(inv); ll = ll.clone().applyQuaternion(inv);
        const d = child.position.clone().normalize();
        return { bone, flex: V().crossVectors(d, nl).normalize(), side: V().crossVectors(d, spread ? ll : ll.clone().negate()).normalize() };
      });
    };
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((nm) => Object.assign(chain(nm, true), { tip: B[s + 'Hand' + nm + '4'] }));
    const thumb = Object.assign(chain('Thumb', false), { tip: B[s + 'HandThumb4'] });
    // cigar held in the gap between index and middle, ember out the back of the hand
    const gap = toHand(P('Index1').add(P('Middle1')).multiplyScalar(0.5)).add(V(-0.006, 0, 0.028));
    const axis = V(-0.85, 0, 0.5).normalize();
    const cigInHand = { p: gap.clone().addScaledVector(axis, CIG_L / 2 - 0.03), q: Q().setFromUnitVectors(V(0, 1, 0), axis) };
    hand[side] = { s, corr, palm, fingers, thumb, cigInHand, pose: null, track: null };
  }
  const R_ = (axis, a) => Q().setFromAxisAngle(axis, a);
  // Fingers: each joint curls toward its pose angle but stops the moment that segment touches the
  // object (surfaceDist(worldPoint) = distance to its surface), so fingers wrap whatever is really
  // there instead of closing on air. `fixed` fingers (index/middle scissoring the cigar) just take the pose.
  const FINGER_R = [0.009, 0.0085, 0.008, 0.007], THUMB_R = 0.0105;
  const _a = V(), _b = V(), _c = V();
  function curlChain(ch, bases, angles, surfaceDist, radius) {
    for (let k = 0; k < 3; k++) ch[k].bone.quaternion.copy(bases[k]);
    for (let k = 0; k < 3; k++) {
      const b = ch[k].bone, max = angles[k];
      const joints = [...ch.slice(k).map((c) => c.bone), ch.tip];         // this segment and everything beyond it
      const set = (a) => { b.quaternion.copy(bases[k]).multiply(R_(ch[k].flex, a)); b.updateMatrixWorld(true); };
      const touching = () => {
        for (let j = 0; j < joints.length - 1; j++) {
          joints[j].getWorldPosition(_a); joints[j + 1].getWorldPosition(_b);
          for (const t of [0.5, 1]) if (surfaceDist(_c.lerpVectors(_a, _b, t)) < radius) return true;
        }
        return false;
      };
      if (!surfaceDist || max <= 0) { set(max); ch[k].got = max; continue; }
      let lo = 0, hi = max, hit = false;
      for (let a = 0; a <= max + 1e-6; a += 0.15) { set(Math.min(a, max)); if (touching()) { hi = Math.min(a, max); hit = true; break; } lo = Math.min(a, max); }
      if (hit) { for (let i = 0; i < 4; i++) { const m = (lo + hi) / 2; set(m); if (touching()) hi = m; else lo = m; } set(lo); ch[k].got = lo; } else { set(max); ch[k].got = max; }
    }
  }
  function applyFingers(h, fp, surfaceDist, fixed = []) {
    h.fingers.forEach((ch, i) => {
      const [m, p, d, sp] = fp.f[i];
      const bases = [rest.get(ch[0].bone).clone().multiply(R_(ch[0].side, sp)), rest.get(ch[1].bone), rest.get(ch[2].bone)];
      curlChain(ch, bases, [m, p, d], fixed.includes(i) ? null : surfaceDist, FINGER_R[i]);
    });
    const [ac, f1, f2, f3] = fp.t, th = h.thumb;
    curlChain(th, [rest.get(th[0].bone).clone().multiply(R_(th[0].side, ac)), rest.get(th[1].bone), rest.get(th[2].bone)], [f1, f2, f3], surfaceDist, THUMB_R);
  }

  // ---- bone helpers (world space) -------------------------------------------
  function setWorldQ(bone, q) {
    bone.parent.getWorldQuaternion(tq2);
    bone.quaternion.copy(tq2.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }
  function aim(bone, child, target) {
    const bp = bone.getWorldPosition(t1), cp = child.getWorldPosition(t2).sub(bp).normalize();
    const want = t3.copy(target).sub(bp).normalize();
    setWorldQ(bone, Q().setFromUnitVectors(cp, want).multiply(bone.getWorldQuaternion(tq)));
  }
  const toWorld = (v) => v.clone().applyMatrix4(body.matrixWorld);
  function twoBone(upper, lower, end, lengths, targetW, poleBody) {
    const S = upper.getWorldPosition(V()), [a, b] = lengths;
    const d = V().subVectors(targetW, S), dist = Math.min(d.length(), a + b - 0.002); d.normalize();
    const x = (a * a - b * b + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, a * a - x * x));
    const pole = poleBody.clone().applyQuaternion(bodyQ); pole.addScaledVector(d, -pole.dot(d)).normalize();
    aim(upper, lower, V().copy(S).addScaledVector(d, x).addScaledVector(pole, h));
    aim(lower, end, V().copy(S).addScaledVector(d, dist));
  }

  // ---- props -------------------------------------------------------------------
  const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const bottle = makeBottle(); body.add(bottle.group); bottle.cap.visible = false;   // the first one's already open
  // cardboard carrier of longnecks on the right fender
  const pack = new THREE.Group(); pack.position.copy(sixPack); body.add(pack);
  const cardboard = new THREE.MeshStandardMaterial({ color: 0x1d5a2c, roughness: 1 });
  mesh(rbox(0.165, 0.09, 0.245, 0.008), cardboard, pack).position.y = 0.045;
  mesh(new THREE.BoxGeometry(0.004, 0.2, 0.23), cardboard, pack).position.y = 0.12;
  const SLOTS = [];
  for (let i = 0; i < 6; i++) SLOTS.push(V(((i % 2) - 0.5) * 0.078, 0.004, (Math.floor(i / 2) - 1) * 0.078));
  const packBottles = SLOTS.map((p) => { const pb = bottleMesh(true, 1); pb.group.position.copy(p); pack.add(pb.group); return pb; });
  // cigar box on the left fender
  const box = new THREE.Group(); box.position.copy(cigarBox); box.rotation.y = 0.15; body.add(box);
  const cedar = new THREE.MeshStandardMaterial({ color: 0x7a3f22, roughness: 0.55 });
  mesh(rbox(0.19, 0.045, 0.13, 0.006), cedar, box).position.y = 0.0225;
  const lid = new THREE.Group(); lid.position.set(0, 0.045, -0.065); lid.rotation.x = -1.9; box.add(lid);
  const lidMesh = mesh(new THREE.BoxGeometry(0.19, 0.006, 0.13), cedar, lid); lidMesh.position.z = 0.065;
  const lidLabel = canvasTex(128, 96, (c, w, h) => { c.fillStyle = '#e9d9a8'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a1c14'; c.font = 'bold 20px Georgia'; c.textAlign = 'center'; c.fillText('HABANO', w / 2, 55); });
  const ll = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshStandardMaterial({ map: lidLabel })); ll.rotation.x = Math.PI / 2; ll.position.set(0, -0.004, 0.065); lid.add(ll);

  const leafTex = canvasTex(32, 128, (c, w, h) => {
    c.fillStyle = '#6b4226'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 20},10,.5)`; c.beginPath(); c.moveTo(Math.random() * w, 0); c.lineTo(Math.random() * w, h); c.stroke(); }
  });
  const cigMat = new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.85 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.3, metalness: 0.7 });
  const ashMat = new THREE.MeshStandardMaterial({ color: 0x8d8a86, roughness: 1 });
  function makeCigar(parent, emberMat) {
    const g = new THREE.Group(); parent.add(g);
    const bodyM = mesh(new THREE.CylinderGeometry(0.0095, 0.009, 1, 12), cigMat, g);
    mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.012, 12), bandMat, g).position.y = -CIG_L / 2 + 0.03;
    const ash = mesh(new THREE.CylinderGeometry(0.0093, 0.0096, 1, 12), ashMat, g);
    const ember = mesh(new THREE.CylinderGeometry(0.0085, 0.009, 0.004, 12), emberMat, g);
    // Lc = leaf left (mouth end to the burn line), ashL = grey ash column hanging off the burn line
    g.userData.layout = (Lc, ashL = 0.004) => {
      const base = -CIG_L / 2, burn = base + Lc - 0.004;
      bodyM.scale.y = burn - base; bodyM.position.y = (base + burn) / 2;
      ember.position.y = burn + 0.001;
      ash.scale.y = Math.max(0.002, ashL); ash.position.y = burn + 0.003 + ashL / 2;
    };
    g.userData.ash = ash;
    g.userData.ember = ember;
    g.userData.layout(CIG_L);
    return g;
  }
  const emberMat = new THREE.MeshStandardMaterial({ color: 0x331008, emissive: 0xff4a10, emissiveIntensity: 1 });
  const cigar = makeCigar(body, emberMat);
  const boxCigars = [0, 1, 2].map((i) => { const c = makeCigar(box, new THREE.MeshStandardMaterial({ color: 0x5a3a22 })); c.rotation.z = Math.PI / 2; c.position.set(0, 0.052, (i - 1) * 0.025); return c; });
  // zippo for lighting a fresh cigar
  const zippo = new THREE.Group(); body.add(zippo); zippo.visible = false;
  mesh(rbox(0.036, 0.055, 0.014, 0.004), new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.2, metalness: 1 }), zippo);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffb040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 40, 2, 32, 34, 30);
      gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,.8)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })() }));
  flame.scale.set(0.022, 0.045, 1); flame.position.y = 0.05; zippo.add(flame); flame.visible = false;

  // st.fill: beer left in the bottle in play; st.beers: full bottles left in the carrier.
  const st = { beers: 5, fill: 1, cigars: 3, cigLen: CIG_L, ash: 0.006, lit: true, glow: 0, tilt: 0, puffTilt: 0, bottleState: 'holder', cigState: 'hand' };
  const layout = () => { cigar.userData.layout(Math.max(0.02, st.cigLen), st.ash); boxCigars.forEach((c, i) => { c.visible = i < st.cigars; }); packBottles.forEach((pb, i) => { pb.group.visible = i < st.beers; }); };
  layout();

  // ---- litter: thrown bottles, caps and flicked butts ---------------------------------
  const litter = [];
  const _q = Q(), _w = V();
  function throwItem(obj, kind, vel) {
    obj.updateWorldMatrix(true, true);
    let m;
    if (kind === 'bottle') { const lb = bottleMesh(false, 0); lb.update(0); m = lb.group; scene.add(m); }
    else if (kind === 'cap') { m = new THREE.Mesh(obj.geometry, obj.material); m.castShadow = true; scene.add(m); }
    else { m = makeCigar(scene, new THREE.MeshStandardMaterial({ color: 0x331008, emissive: 0xff4a10, emissiveIntensity: 2 })); m.userData.layout(Math.max(0.03, st.cigLen), st.ash); }
    obj.matrixWorld.decompose(m.position, m.quaternion, V());
    const spin = kind === 'bottle' ? 9 : kind === 'cap' ? 30 : 20;
    litter.push({ m, kind, v: vel, w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spin), rest: false, age: 0, glow: 2, bounced: 0 });
    if (litter.length > 40) { const old = litter.shift(); scene.remove(old.m); }
  }
  function updateLitter(dt, deck) {
    for (let i = litter.length - 1; i >= 0; i--) if (litter[i].dead) litter.splice(i, 1);
    for (const l of litter) {
      l.age += dt;
      const r = l.kind === 'bottle' ? 0.0365 : l.kind === 'cap' ? 0.004 : 0.0095;
      const ground = heightAt(l.m.position.x, l.m.position.z) + r;
      if (!l.rest) {
        l.v.y -= 9.81 * dt;
        l.m.position.addScaledVector(l.v, dt);
        const wl = l.w.length();
        if (wl > 1e-4) l.m.quaternion.premultiply(_q.setFromAxisAngle(_w.copy(l.w).divideScalar(wl), wl * dt));
        if (l.m.position.y < ground) {
          l.m.position.y = ground;
          if (l.v.y < -1.2) { hooks.onLitterHit?.(l.kind, -l.v.y, l.m.position); l.v.y *= -0.32; l.bounced++; } else l.v.y = 0;
          l.v.x *= 0.72; l.v.z *= 0.72; l.w.multiplyScalar(0.7);
          // settle lying on its side: axis (local Y) flattened into the ground plane
          const axis = V(0, 1, 0).applyQuaternion(l.m.quaternion), flat = V(axis.x, 0, axis.z);
          if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
          l.m.quaternion.premultiply(_q.setFromUnitVectors(axis, flat.normalize()).slerp(Q(), 0.7));
          if (l.v.length() < 0.25 && Math.abs(l.v.y) < 0.2) { l.rest = true; l.v.set(0, 0, 0); }
        }
      } else l.m.position.y = ground;
      if (l.kind === 'cigar') {                                       // the butt smoulders, then goes out
        l.glow = Math.max(0, l.glow - dt * 0.08);
        l.m.userData.ember.material.emissiveIntensity = l.glow * (0.8 + Math.sin(l.age * 7) * 0.2);
        if (l.glow > 0.2 && Math.random() < dt * 3) hooks.onWisp?.(l.m.userData.ember.getWorldPosition(V()));
      }
      // car runs over it with the blades on: it gets chewed and spat out
      if (deck && deck.on && l.rest && Math.hypot(l.m.position.x - deck.x, l.m.position.z - deck.z) < deck.r) {
        l.rest = false; l.v.set(deck.cx * 7, 2.5 + Math.random() * 2, deck.cz * 7); l.w.set(20, 5, 14);
        hooks.onClang?.(l.kind, l.m.position.clone());
        if (l.kind === 'bottle') { scene.remove(l.m); l.dead = true; }        // glass doesn't survive the blades
      }
    }
  }

  // ---- poses (body frame) ------------------------------------------------------
  const qHead = Q(), eyeLocal = V(), m4 = new THREE.Matrix4(), spinQ = Q();
  const headPt = (local) => local.clone().applyQuaternion(qHead).add(eyeLocal);
  const pose = (p, q, fp) => ({ p, q, fp });
  const compose = (item, g) => pose(g.p.clone().applyQuaternion(item.q).add(item.p), item.q.clone().multiply(g.q), g.fp);
  const decompose = (h, g) => { const q = h.q.clone().multiply(g.q.clone().invert()); return { p: h.p.clone().sub(g.p.clone().applyQuaternion(q)), q }; };
  // right hand round the bottle's neck, palm on its -X side, fingers wrapping forward round it
  const NECK_R = bottleRadius(NECK_Y);
  const BOTTLE_GRIP = { p: V(-(NECK_R + 0.004), NECK_Y, 0), q: frame(V(1, 0, 0), V(0, 0, 1)), fp: FP.neck };
  const bItem = {
    holder: () => ({ p: V(cupholder.x, cupholder.y + 0.004, cupholder.z), q: Q() }),
    slot: (i) => ({ p: SLOTS[i].clone().add(sixPack), q: Q() }),
    chest: () => ({ p: V(-0.14, 0.84, 0.1), q: qe(-0.2, 0.3, 0) }),
    mouth: () => {                                      // lip on the lips, tipped up by st.tilt (0 = upright)
      const tl = st.tilt, axis = V(0, Math.cos(tl), -Math.sin(tl));
      const lip = V(MOUTH.x - 0.008, MOUTH.y + 0.006, MOUTH.z + 0.01);
      return { p: headPt(lip.addScaledVector(axis, -BOTTLE_H)), q: qHead.clone().multiply(qx(-tl)) };
    },
    windup: () => ({ p: V(-0.42, 1.12, -0.62), q: qe(2.2, -0.3, -0.5) }),
    release: () => ({ p: V(-0.78, 1.02, 0.2), q: qe(-1.3, 0.2, -1.2) }),
  };
  const cigItem = {
    mouth: () => {
      // held nearly level, so in first person the lit end sits in the bottom of the view
      // ...and out of the left corner of the mouth, so you see it along its length rather than end-on
      const q = CIG_AT_MOUTH.clone(), dir = V(0, 1, 0).applyQuaternion(q);
      return { p: headPt(V(0.012, -0.07, 0.09).addScaledVector(dir, CIG_L / 2)), q: qHead.clone().multiply(q).multiply(cigRoll) };
    },
    box: () => ({ p: V(0, 0.052, 0).applyEuler(box.rotation).add(cigarBox), q: Q().setFromEuler(box.rotation).multiply(Q().setFromAxisAngle(V(0, 0, 1), Math.PI / 2)) }),
  };
  // A cigar is round, so the hand may turn about it freely: pick the roll that lays the fingers
  // level across the chin (wrist to the left): hanging or raised, the hand crosses the eyeline.
  const cigRoll = (() => {
    let best = Q(), bestDot = -2;
    const want = V(-1, -0.25, 0.3).normalize(), base = CIG_AT_MOUTH;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const r = Q().setFromAxisAngle(V(0, 1, 0), a);
      const f = V(0, 0, 1).applyQuaternion(base.clone().multiply(r).multiply(hand[1].cigInHand.q.clone().invert()));
      if (f.dot(want) > bestDot) { bestDot = f.dot(want); best = r; }
    }
    return best;
  })();
  const handFromCig = (item, h, fp) => { const g = h.cigInHand, q = item.q.clone().multiply(g.q.clone().invert()); return pose(item.p.clone().sub(g.p.clone().applyQuaternion(q)), q, fp); };
  const cigFromHand = (hp, h) => ({ p: h.cigInHand.p.clone().applyQuaternion(hp.q).add(hp.p), q: hp.q.clone().multiply(h.cigInHand.q) });

  // wheel: palm resting on top of the rim (spinner +Y faces the driver), fingers reaching
  // outward over the rim's outer edge and curling down round it
  // at "ten and two": the 9/3 grip turned 55 degrees up the rim, which keeps the hands in first-person view
  const wheelGrip = (side) => {
    const r = Q().setFromAxisAngle(V(0, 1, 0), -side * 0.96);
    return { p: V(side * (RIM - 0.03), 0.019, 0.0).applyQuaternion(r), q: r.multiply(frame(V(0, -1, 0), V(side, 0, 0.3))) };
  };
  function wheelPose(side) {
    wheelGroup.updateMatrix(); spinner.updateMatrix();
    m4.multiplyMatrices(wheelGroup.matrix, spinner.matrix); spinQ.setFromRotationMatrix(m4);
    const g = wheelGrip(side), holdingCig = side === 1 && st.cigState === 'hand';
    return pose(g.p.clone().applyMatrix4(m4), spinQ.clone().multiply(g.q), holdingCig ? FP.wheelCigar : FP.wheel);
  }
  const KEY = {
    wheel: (side) => wheelPose(side),
    bHolder: () => compose(bItem.holder(), BOTTLE_GRIP),
    bSlot: () => compose(bItem.slot(st.beers - 1), BOTTLE_GRIP),
    bChest: () => compose(bItem.chest(), BOTTLE_GRIP),
    bMouth: () => compose(bItem.mouth(), BOTTLE_GRIP),
    bWindup: () => compose(bItem.windup(), BOTTLE_GRIP),
    bRelease: () => ({ ...compose(bItem.release(), BOTTLE_GRIP), fp: FP.flick }),
    cigMouth: () => handFromCig(cigItem.mouth(), hand[1], FP.smoke),
    cigLow: () => pose(V(0.19, 1.1, -0.1), qe(0.3, -0.5, 1.2), FP.smoke),
    cigBox: () => handFromCig(cigItem.box(), hand[1], FP.smoke),
    flickWind: () => pose(V(0.3, 1.25, -0.15), qe(-0.4, 0.8, 1.0), FP.smoke),
    flickRelease: () => pose(V(0.62, 1.2, 0.18), qe(-0.9, 1.3, 1.5), FP.flick),
    // palm cupped over the top of the gear knob, fingers draped down its front; follows the knob as it moves
    shift: () => pose(body.worldToLocal(shifter.knob.getWorldPosition(V())).add(V(0, shifter.knob.userData.r + 0.008, -0.012)), frame(V(0, -1, 0), V(-0.25, -0.35, 1)), FP.knob),
    lighter: () => {                                                      // zippo flame under the cigar tip
      const c = cigItem.mouth(), tip = V(0, CIG_L / 2 + 0.005, 0).applyQuaternion(c.q).add(c.p);
      return pose(tip.add(V(-0.035, -0.09, 0.0)), frame(V(1, 0, 0.3), V(0, 0.3, 1)), FP.lighter);
    },
  };

  // ---- actions: per-hand step lists -------------------------------------------
  // step: {to, dur, ease?, onStart?, during?(t), onEnd?}; each step blends from the pose the hand had when it began.
  const blend = (a, b, u) => pose(a.p.clone().lerp(b.p, u), a.q.clone().slerp(b.q, u), fpLerp(a.fp, b.fp, u));
  function runTrack(h, dt) {
    const tr = h.track, step = tr.steps[tr.i];
    if (!step) { h.track = null; return; }
    if (!step.t) { step.t = 0; step.from = pose(h.pose.p.clone(), h.pose.q.clone(), h.pose.fp); step.onStart?.(); }
    step.t += dt; step.dt = dt;
    const raw = clamp01(step.t / step.dur), u = step.ease === 'hold' ? 1 : step.ease === 'in' ? raw * raw : smooth(raw);
    h.pose = blend(step.from, KEY[step.to](h === hand[1] ? 1 : -1), u);
    step.during?.(step.t);
    if (step.t >= step.dur) { step.onEnd?.(); tr.i++; }
  }
  const later = (tr, steps) => tr.steps.splice(tr.i + 1, 0, ...steps);

  // Chug: the bottle snaps up to the lips and stays there while you keep hitting the key; every press
  // is a big gulp. Stop pressing for a moment and it goes back in the cupholder (out the window if empty).
  const GULP = 0.12, HOLD = 0.75;
  let chug = null;
  function drink() {
    const tr = { i: 0, steps: [] };
    chug = {
      to: 'bMouth', dur: 1e9, ease: 'hold', idle: 0, drain: GULP, total: 0,
      press() { this.drain += GULP; this.idle = 0; },
      during() {
        const dt = this.dt;
        st.tilt += (Math.min(maxTilt, 1.9 + (1 - st.fill) * 0.7) - st.tilt) * Math.min(1, dt * 10);
        const d = Math.min(st.fill, this.drain, 0.55 * dt);                // ~half a bottle a second, flat out
        if (d > 0) { st.fill -= d; this.drain -= d; this.total += d; if (this.total > 0.05) { hooks.onSip(this.total); this.total = 0; } }
        if (this.drain <= 1e-4) this.idle += dt;
        if (st.fill <= 0.002 || this.idle > HOLD) { st.fill = Math.max(0, st.fill); this.t = this.dur; }
      },
      onEnd() {
        chug = null;
        if (this.total > 0) hooks.onSip(this.total);
        setTimeout(() => hooks.onAhh?.(), 250);
        const tilt0 = st.tilt;
        if (st.fill > 0.002) {
          later(tr, [
            { to: 'bMouth', dur: 0.3, during: (t) => { st.tilt = tilt0 * (1 - smooth(t / 0.3)); } },
            { to: 'bHolder', dur: 0.4, onEnd: () => { st.bottleState = 'holder'; } },
            { to: 'wheel', dur: 0.4 },
          ]);
        } else {
          st.fill = 0;
          later(tr, [
            { to: 'bWindup', dur: 0.4, during: (t) => { st.tilt = tilt0 * (1 - smooth(t / 0.3)); } },
            { to: 'bRelease', dur: 0.17, ease: 'in', onEnd: () => {
              const dir = V(-0.85, 0.45, 0.3).normalize().applyQuaternion(bodyQ);
              throwItem(bottle.group, 'bottle', dir.multiplyScalar(6.5).add(hooks.carVel()));
              st.bottleState = 'none'; st.tilt = 0; hooks.onThrow('bottle');
            } },
            { to: 'wheel', dur: 0.5 },
          ]);
        }
      },
    };
    tr.steps.push(
      { to: 'bHolder', dur: 0.3, onEnd: () => { st.bottleState = 'hand'; } },
      { to: 'bMouth', dur: 0.35, during: (t) => { st.tilt = 1.2 * smooth(t / 0.35); } },
      chug,
    );
    hand[-1].track = tr;
  }
  function freshBeer() {
    hand[-1].track = { i: 0, steps: [
      { to: 'bSlot', dur: 0.55, onEnd: () => { st.beers--; st.fill = 1; bottle.cap.visible = true; st.bottleState = 'hand'; layout(); } },
      { to: 'bChest', dur: 0.55 },
      { to: 'bChest', dur: 0.5, during(t) {
        if (t > 0.2 && bottle.cap.visible) {                       // twist the cap off: it pops away
          bottle.cap.visible = false;
          throwItem(bottle.cap, 'cap', V((Math.random() - 0.5) * 1.5, 2.2, 0.8).applyQuaternion(bodyQ).add(hooks.carVel()));
          bottle.foam = 0.016; hooks.onOpen(bottle.group.localToWorld(V(0, BOTTLE_H, 0)));
        }
      } },
      { to: 'bHolder', dur: 0.5, onEnd: () => { st.bottleState = 'holder'; } },
      { to: 'wheel', dur: 0.45 },
    ] };
  }
  function smoke() {
    const tr = { i: 0, steps: [] }, puffAt = [0.25, 0.7, 1.1];
    tr.steps.push(
      { to: 'cigMouth', dur: 0.55 },
      {
        to: 'cigMouth', dur: 1.3, fired: 0,
        during(t) {
          while (this.fired < puffAt.length && t >= puffAt[this.fired]) {
            this.fired++; st.glow = 1; const b = Math.max(0, Math.min(0.013, st.cigLen - 0.03)); st.cigLen -= b; st.ash += b; layout(); hooks.onPuff();
          }
        },
      },
      { to: 'cigLow', dur: 0.55, onStart: () => setTimeout(() => hooks.onExhale(), 150) },
      {
        to: 'cigLow', dur: 0.05,
        onEnd() {
          if (st.cigLen > CIG_MIN) { later(tr, [{ to: 'wheel', dur: 0.5 }]); return; }
          later(tr, [
            { to: 'flickWind', dur: 0.35 },
            { to: 'flickRelease', dur: 0.13, ease: 'in', onEnd: () => {
              const dir = V(0.9, 0.35, 0.35).normalize().applyQuaternion(bodyQ);
              throwItem(cigar, 'cigar', dir.multiplyScalar(5.5).add(hooks.carVel()));
              st.cigState = 'none'; st.cigLen = 0; hooks.onThrow('cigar');
            } },
            { to: 'wheel', dur: 0.5 },
          ]);
        },
      });
    hand[1].track = tr;
  }
  function freshCigar() {
    hand[1].track = { i: 0, steps: [
      { to: 'cigBox', dur: 0.55, onEnd: () => { st.cigars--; st.cigLen = CIG_L; st.ash = 0; st.lit = false; st.cigState = 'hand'; layout(); } },
      { to: 'cigMouth', dur: 0.6 },
      { to: 'cigMouth', dur: 1.5, during(t) { if (t > 0.8 && !st.lit) { st.lit = true; st.glow = 1.5; hooks.onPuff(); } } },
      { to: 'wheel', dur: 0.5 },
    ] };
    hand[-1].track = { i: 0, steps: [
      { to: 'wheel', dur: 0.7 },
      { to: 'lighter', dur: 0.45, onStart: () => { zippo.visible = true; } },
      { to: 'lighter', dur: 1.1, onStart: () => { flame.visible = true; hooks.onLighter(); }, onEnd: () => { flame.visible = false; } },
      { to: 'wheel', dur: 0.5, onEnd: () => { zippo.visible = false; } },
    ] };
  }
  // gear change: the right hand drops to the knob, rides it through the gate, and goes back to the wheel
  // (if that hand is busy with a beer, the stick just moves on its own)
  function shift() {
    if (hand[-1].track) return false;
    hand[-1].track = { i: 0, steps: [{ to: 'shift', dur: 0.14 }, { to: 'shift', dur: 0.3 }, { to: 'wheel', dur: 0.3 }] };
    return true;
  }
  function start(kind) {
    if (kind === 'beer') {
      if (hand[-1].track) { if (chug) { chug.press(); return true; } return false; }
      if (st.bottleState !== 'none' && st.fill > 0.01) drink();
      else if (st.beers > 0) freshBeer();
      else { hooks.say('Out of beer'); return false; }
    } else {
      if (hand[1].track || hand[-1].track && st.cigState === 'none') return false;
      if (st.cigState === 'hand') smoke();
      else if (st.cigars > 0) { if (hand[-1].track) return false; freshCigar(); }
      else { hooks.say('Out of cigars'); return false; }
    }
    return true;
  }

  // ---- per-frame -----------------------------------------------------------------
  const leanQ = Q();
  const prevV = V();
  // ash: breaks off when the car jolts (longer ash = more fragile), or under its own weight
  const ashBits = [];
  function updateAsh(dt, jolt) {
    if (st.cigState === 'hand' && st.lit && st.cigLen > CIG_MIN) { const b = Math.min(0.0004 * dt, st.cigLen - CIG_MIN); st.cigLen -= b; st.ash += b; cigar.userData.layout(st.cigLen, st.ash); }   // idle smoulder
    if (st.cigState === 'hand' && st.ash > 0.008 && (jolt * st.ash > 0.09 || st.ash > 0.045) && !hand[1].track) {
      const a = cigar.userData.ash;
      a.updateWorldMatrix(true, false);
      const m = new THREE.Mesh(a.geometry, ashMat); a.matrixWorld.decompose(m.position, m.quaternion, m.scale); m.castShadow = true; scene.add(m);
      ashBits.push({ m, v: hooks.carVel().add(V((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4)), w: V(Math.random() * 6, 0, Math.random() * 6) });
      st.ash = 0.002; layout(); hooks.onAshDrop?.();
    }
    for (let i = ashBits.length - 1; i >= 0; i--) {
      const b = ashBits[i]; b.v.y -= 9.8 * dt; b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += b.w.x * dt; b.m.rotation.z += b.w.z * dt;
      if (b.m.position.y < heightAt(b.m.position.x, b.m.position.z) + 0.01) { hooks.onAshLand?.(b.m.position.clone()); scene.remove(b.m); ashBits.splice(i, 1); }
    }
  }

  function update(dt, { steerAngle, yaw, pitch, firstPerson, deck, jolt = 0 }) {
    const mv = hooks.carVel(), accel = mv.clone().sub(prevV).divideScalar(Math.max(dt, 1e-3)); prevV.copy(mv);
    spinner.rotation.y = steerAngle;
    const drinking = hand[-1].track && st.bottleState === 'hand';
    if (!drinking) st.tilt = 0;
    // head tips back a little to puff, like it does to drink (and it keeps the hand out of view)
    const lp = hand[1].pose, puffing = hand[1].track && st.cigState === 'hand' && lp ? smooth((lp.p.y - 1.25) / 0.2) : 0;
    st.puffTilt += (puffing - st.puffTilt) * (1 - Math.exp(-dt * 8));
    const headPitch = pitch + st.tilt * 0.07 + st.puffTilt * 0.03;   // barely tips back: the view stays on the road while you chug
    qHead.setFromEuler(new THREE.Euler(-headPitch, yaw, 0, 'YXZ'));
    for (const m of headMeshes) m.visible = !firstPerson;

    for (const [bone, q] of rest) bone.quaternion.copy(q);
    body.updateWorldMatrix(true, true);
    body.getWorldQuaternion(bodyQ);

    // hands: run their action tracks, otherwise hold the wheel (mouth targets use last frame's eyes)
    for (const side of [1, -1]) {
      const h = hand[side];
      if (!h.pose) h.pose = wheelPose(side);
      if (h.track) runTrack(h, dt); else h.pose = wheelPose(side);
    }

    // torso: sat back against the seat, plus leaning toward any hand target beyond arm's reach
    // (grabbing the low cupholder or the cigar box), pivoting at the hips
    setWorldQ(B.Spine1, Q().setFromAxisAngle(V(1, 0, 0).applyQuaternion(bodyQ), -0.12).multiply(bodyQ.clone().multiply(restRel.get('Spine1'))));
    const hipsW = B.Spine.getWorldPosition(V()), lean = Q();
    for (const [s, side] of [['Left', 1], ['Right', -1]]) {
      const hp = hand[side].pose, wristW = toWorld(hp.p.clone().sub(hand[side].palm.clone().applyQuaternion(hp.q)));
      const sh = B[s + 'Arm'].getWorldPosition(V()), deficit = sh.distanceTo(wristW) - 0.94 * (L[s + 'Arm'][0] + L[s + 'Arm'][1]);
      if (deficit <= 0) continue;
      const a = V().subVectors(sh, hipsW), b = V().subVectors(wristW, hipsW);
      const axis = V().crossVectors(a, b); if (axis.lengthSq() < 1e-8) continue;
      lean.premultiply(Q().setFromAxisAngle(axis.normalize(), Math.min(0.75, (deficit / a.length()) * 1.15)));
    }
    leanQ.slerp(lean, 1 - Math.exp(-dt * 10));                        // ease so the torso doesn't snap
    setWorldQ(B.Spine, leanQ.clone().multiply(B.Spine.getWorldQuaternion(Q())));
    setWorldQ(B.Neck, bodyQ.clone().multiply(Q().slerp(qHead, 0.35)).multiply(restRel.get('Neck')));
    setWorldQ(B.Head, bodyQ.clone().multiply(qHead).multiply(restRel.get('Head')));
    eyeLocal.copy(body.worldToLocal(B.LeftEye.getWorldPosition(V()).add(B.RightEye.getWorldPosition(V())).multiplyScalar(0.5)));

    for (const [s, x] of [['Left', 1], ['Right', -1]]) {
      twoBone(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], L[s + 'Leg'], toWorld(V(x * feet.x, feet.ankle.y, feet.ankle.z)), V(x * 0.25, 0.3, 1));
      aim(B[s + 'Foot'], B[s + 'ToeBase'], toWorld(V(x * (feet.x + 0.02), feet.toe.y, feet.toe.z)));
    }
    // Arms first; then every held item is placed from where the hand bone ACTUALLY ended up
    // (so it can't drift off the fingers), then fingers curl until they touch it.
    spinner.updateMatrixWorld(true);
    const invSpin = spinner.matrixWorld.clone().invert(), _l = V();
    const rimDist = (w) => { _l.copy(w).applyMatrix4(invSpin); return Math.hypot(Math.hypot(_l.x, _l.z) - RIM, _l.y) - 0.017; };
    const actualHand = (s, h) => {                                    // the hand frame the bones really reached, body frame
      const q = bodyQ.clone().invert().multiply(B[s + 'Hand'].getWorldQuaternion(Q())).multiply(h.corr.clone().invert());
      return pose(body.worldToLocal(B[s + 'Hand'].getWorldPosition(V())).add(h.palm.clone().applyQuaternion(q)), q, h.pose.fp);
    };
    for (const [s, side] of [['Left', 1], ['Right', -1]]) {
      const h = hand[side], hp = h.pose;
      const wrist = toWorld(hp.p.clone().sub(h.palm.clone().applyQuaternion(hp.q)));
      twoBone(B[s + 'Arm'], B[s + 'ForeArm'], B[s + 'Hand'], L[s + 'Arm'], wrist, V(side * 0.6, -0.8, -0.3));
      setWorldQ(B[s + 'Hand'], bodyQ.clone().multiply(hp.q).multiply(h.corr));
      const real = actualHand(s, h);

      if (side === -1) {
        bottle.group.visible = st.bottleState !== 'none';
        const bp = st.bottleState === 'hand' ? decompose(real, BOTTLE_GRIP) : bItem.holder();
        bottle.group.position.copy(bp.p); bottle.group.quaternion.copy(bp.q);
        bottle.fill = st.fill; bottle.update(dt, accel);
        const bottleDist = (w) => bottle.group.visible ? bottle.surfaceDist(w) : 1;
        if (zippo.visible) {
          zippo.position.copy(real.p).addScaledVector(V(1, 0, 0).applyQuaternion(real.q), 0.012).add(V(0, 0.025, 0));
          zippo.quaternion.copy(real.q).multiply(qx(-Math.PI / 2)); zippo.updateMatrixWorld();
          flame.scale.set(0.02 + Math.random() * 0.004, 0.042 + Math.random() * 0.012, 1);
        }
        const zipDist = (w) => zippo.visible ? w.distanceTo(zippo.getWorldPosition(V())) - 0.02 : 1;
        const knobW = shifter.knob.getWorldPosition(V()), knobDist = (w) => w.distanceTo(knobW) - shifter.knob.userData.r;
        applyFingers(h, hp.fp, (w) => Math.min(rimDist(w), bottleDist(w), zipDist(w), knobDist(w)));
      } else {
        const holding = st.cigState === 'hand';
        applyFingers(h, hp.fp, rimDist, holding ? [0, 1] : []);
        cigar.visible = holding;
        if (holding) {
          // the cigar sits in the gap between the index and middle proximal phalanges, measured off the posed bones
          const mid = (a, b) => B[a].getWorldPosition(V()).add(B[b].getWorldPosition(V())).multiplyScalar(0.5);
          const gapW = mid('LeftHandIndex1', 'LeftHandIndex2').add(mid('LeftHandMiddle1', 'LeftHandMiddle2')).multiplyScalar(0.5);
          const gapH = body.worldToLocal(gapW).sub(real.p).applyQuaternion(real.q.clone().invert());
          h.cigInHand.p.copy(gapH).addScaledVector(V(0, 1, 0).applyQuaternion(h.cigInHand.q), CIG_L / 2 - 0.03);
          const c = cigFromHand(real, h); cigar.position.copy(c.p); cigar.quaternion.copy(c.q);
        }
      }
    }

    st.glow = Math.max(0, st.glow - dt * 1.4);
    emberMat.emissiveIntensity = st.lit ? 0.6 + st.glow * 5 + Math.sin(performance.now() / 180) * 0.15 : 0;
    for (const pb of packBottles) if (pb.group.visible) pb.update(dt);
    updateLitter(dt, deck);
    updateAsh(dt, jolt);
    return { headPitch };
  }

  return {
    st, start, shift, update, litter, hands: hand, bones: B,
    // refills (God): where each empty slot is, and filling it
    beerSlot: (i) => packBottles[Math.min(5, i)].group.getWorldPosition(V()).add(V(0, 0.12, 0)),
    cigarSlot: (i) => boxCigars[Math.min(2, i)].getWorldPosition(V()),
    addBeer() { st.beers = Math.min(6, st.beers + 1); layout(); },
    addCigar() { st.cigars = Math.min(3, st.cigars + 1); layout(); },
    makeBottle: () => bottleMesh(true, 1).group,
    makeCigar: () => makeCigar(scene, new THREE.MeshStandardMaterial({ color: 0x5a3a22 })),
    eyeWorld: (target) => target.copy(eyeLocal).add(V(0, 0, 0.02).applyQuaternion(qHead)).applyMatrix4(body.matrixWorld),
    mouthWorld: (target) => target.copy(headPt(MOUTH.clone().add(V(0, 0, 0.04)))).applyMatrix4(body.matrixWorld),
    headQuatWorld: (target) => body.getWorldQuaternion(target).multiply(qHead),
    emberWorld: (target) => { cigar.userData.ember.getWorldPosition(target); return target; },
    get cigarLit() { return st.cigState === 'hand' && st.lit; },
    get busy() { return !!(hand[1].track || hand[-1].track); },
  };
}
