// Hitchhikers: people standing on the shoulder with a thumb out (spots come from track.js). Hit one and
// they go flying: a rigid tumble about the hips, a couple of bounces, then they lie where they land.
// A small pool of avatar clones is moved to whichever spots are near the car; each spot remembers its
// person's fate, so someone you flattened is still lying there if you come back.
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const POOL = 8, JEANS = [0x2d4568, 0x3b3b3b, 0x5a4a32];
// striped tees: [stripe, base] colours
const TEES = [[0xc8261c, 0xf2ede0], [0x1f4fa8, 0xf2d43a], [0x2d8a3a, 0xf2ede0], [0xe0782a, 0x23233a], [0x7a2d9a, 0x9fd8e8]];
const CAP = ['#d8261c', '#f2c414', '#1f5fc8', '#2d9a3a'];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const UP = V(0, 1, 0);
export const SIZE = 0.62;                // they're kids: ~1.1 m tall
const BODY_R = 0.8;                      // generous hit radius, so clipping one with a corner counts

// a t-shirt with horizontal stripes, keyed off height in the mesh's own (bind-pose, metres, y-up) space
function stripedTee(old, [a, b]) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, normalMap: old.normalMap });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uA = { value: new THREE.Color(a) }; sh.uniforms.uB = { value: new THREE.Color(b) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vStripeY;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvStripeY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vStripeY; uniform vec3 uA, uB;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = fract(vStripeY / 0.09) < 0.45 ? uA : uB;');
  };
  return m;
}

// kid's propeller beanie: four-colour dome, little peak, a propeller on a stalk (spun every frame)
function propellerCap() {
  const cap = new THREE.Group();
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 8; const g = c.getContext('2d');
    CAP.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 64, 0, 64, 8); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
  dome.scale.y = 0.75;
  const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: CAP[2], roughness: 0.7 }));
  peak.position.set(0, 0.004, 0.06); peak.scale.set(1, 1, 0.9);
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.25 });
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8), metal); stalk.position.y = 0.1;
  const prop = new THREE.Group(); prop.position.y = 0.126;
  for (const s of [1, -1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.004, 0.022), new THREE.MeshStandardMaterial({ color: s > 0 ? CAP[0] : CAP[1], roughness: 0.5 }));
    blade.position.x = s * 0.04; blade.rotation.x = s * 0.35; prop.add(blade);
  }
  prop.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), metal));
  cap.add(dome, peak, stalk, prop);
  cap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  cap.userData.prop = prop;
  return cap;
}

// One kid cloned from the avatar: `top(oldMaterial)` dresses the shirt, `bottom` colours the trousers and
// `hat` goes on the crown. The group isn't in the scene yet; it's hung off the hips and scaled to SIZE.
// (Cop cars reuse this for their kid cops.)
export function makeKid(gltf, { top, bottom, hat }) {
  const body = clone(gltf.scene);
  body.position.set(0, 0, 0); body.quaternion.identity(); body.scale.setScalar(1);
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.visible = true; o.castShadow = true; o.frustumCulled = false;
    if (o.name === 'Wolf3D_Outfit_Top') o.material = top(o.material);
    else if (o.name === 'Wolf3D_Outfit_Bottom') { o.material = o.material.clone(); o.material.map = null; o.material.color.set(bottom); }
    else if (o.name === 'Wolf3D_Hair' || o.name === 'Wolf3D_Headwear') o.visible = false;   // the hat goes on instead
    else o.material = o.material.clone();
    o.material.clippingPlanes = null;
  });
  const B = {}, rest = new Map();
  body.traverse((o) => { if (o.isBone) { B[o.name] = o; rest.set(o, o.quaternion.clone()); } });
  const g = new THREE.Group(); g.add(body); g.visible = false;
  // hang the body off its hips so it tumbles about its middle
  g.updateMatrixWorld(true);
  const hips = B.Hips.getWorldPosition(V()), toe = B.LeftToeBase.getWorldPosition(V());
  body.position.sub(hips);
  // the hat sits on the crown: up = toward HeadTop_End, peak = the way the face points (+z in the rest pose)
  g.updateMatrixWorld(true);
  const headQ = B.Head.getWorldQuaternion(Q()).invert();
  const up = B.HeadTop_End.position.clone().normalize(), fwd = V(0, 0, 1).applyQuaternion(headQ);
  const right = V().crossVectors(up, fwd).normalize(); fwd.crossVectors(right, up);
  hat.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  hat.position.copy(B.HeadTop_End.position).multiplyScalar(0.7);
  B.Head.add(hat);
  g.scale.setScalar(SIZE);
  return { g, body, B, rest, hat, standH: (hips.y - toe.y + 0.04) * SIZE };
}

export function buildHitchhikers(scene, gltf, track, hooks) {
  const pool = [];
  for (let k = 0; k < POOL; k++) {
    const kid = makeKid(gltf, { top: (m) => stripedTee(m, TEES[k % TEES.length]), bottom: JEANS[k % JEANS.length], hat: propellerCap() });
    scene.add(kid.g);
    pool.push({ ...kid, cap: kid.hat, spot: null });
  }

  // turn `bone` so the direction to `child` points along `dir` (person frame, before g is placed)
  function aim(p, bone, child, dir) {
    if (!p.B[bone] || !p.B[child]) return;
    p.g.updateMatrixWorld(true);
    const a = p.B[bone].getWorldPosition(V()), b = p.B[child].getWorldPosition(V());
    const q = Q().setFromUnitVectors(b.sub(a).normalize(), dir.clone().normalize());
    const pw = p.B[bone].parent.getWorldQuaternion(Q());
    p.B[bone].quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));
  }
  function turn(p, bone, axis, ang) {                                   // rotate a bone about a world axis
    p.g.updateMatrixWorld(true);
    const pw = p.B[bone].parent.getWorldQuaternion(Q()), q = Q().setFromAxisAngle(axis, ang);
    p.B[bone].quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));
  }
  // thumbs-up stance: arms down, one arm out toward the road. side 'Right' = their right arm (-x).
  function pose(p, arm) {
    for (const [bone, q] of p.rest) bone.quaternion.copy(q);
    p.g.position.set(0, 0, 0); p.g.quaternion.identity();
    const out = arm === 'Right' ? -1 : 1, other = arm === 'Right' ? 'Left' : 'Right';
    aim(p, other + 'Arm', other + 'ForeArm', V(-out * 0.18, -1, 0.02));
    aim(p, other + 'ForeArm', other + 'Hand', V(-out * 0.12, -1, 0.12));
    aim(p, arm + 'Arm', arm + 'ForeArm', V(out, -0.12, 0.35));
    aim(p, arm + 'ForeArm', arm + 'Hand', V(out, 0.02, 0.4));
    aim(p, arm + 'Hand', arm + 'HandMiddle1', V(out, 0.02, 0.4));
    // roll the hand about the forearm so the thumb points up, then close the fingers into a fist
    p.g.updateMatrixWorld(true);
    const d = p.B[arm + 'HandMiddle1'].getWorldPosition(V()).sub(p.B[arm + 'Hand'].getWorldPosition(V())).normalize();
    const th = p.B[arm + 'HandThumb2'].getWorldPosition(V()).sub(p.B[arm + 'Hand'].getWorldPosition(V()));
    const thPerp = th.addScaledVector(d, -th.dot(d)).normalize(), upPerp = UP.clone().addScaledVector(d, -UP.dot(d)).normalize();
    turn(p, arm + 'Hand', d, Math.atan2(V().crossVectors(thPerp, upPerp).dot(d), thPerp.dot(upPerp)));
    p.g.updateMatrixWorld(true);
    const palmN = V().crossVectors(d, UP).multiplyScalar(out);           // the way the fingers curl
    const curlAxis = V().crossVectors(d, palmN).normalize();
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const k of [1, 2, 3]) turn(p, arm + 'Hand' + f + k, curlAxis, 1.25);
    aim(p, arm + 'HandThumb2', arm + 'HandThumb3', UP);
    aim(p, arm + 'HandThumb3', arm + 'HandThumb4', UP);
    aim(p, 'Head', 'HeadTop_End', V(out * 0.25, 1, 0.1));                // glancing up the road
  }

  function place(p, spot) {
    p.spot = spot; p.g.visible = true;
    const st = spot.state || (spot.state = { mode: 'stand' });
    pose(p, spot.side < 0 ? 'Right' : 'Left');
    if (st.mode === 'stand') {
      // face the oncoming car, turned a little toward the road; the thumb arm is the road-side one
      const t = V(Math.sin(spot.h), 0, Math.cos(spot.h)), n = V(Math.cos(spot.h), 0, -Math.sin(spot.h));
      const face = t.negate().addScaledVector(n, -spot.side * 0.6).normalize();
      p.g.position.set(spot.x, p.standH, spot.z);
      p.g.quaternion.setFromAxisAngle(UP, Math.atan2(face.x, face.z));
    } else { p.g.position.copy(st.pos); p.g.quaternion.copy(st.q); }
  }

  // nearby spots get a person; people whose spot is out of range go back to the pool
  function update(dt, sCar) {
    const near = track.itemsInS(sCar - 120, sCar + 420, 'hiker');
    for (const p of pool) if (p.spot && !near.includes(p.spot)) { p.spot = null; p.g.visible = false; }
    for (const spot of near) {
      if (pool.some((p) => p.spot === spot)) continue;
      const p = pool.find((q) => !q.spot); if (!p) break;
      place(p, spot);
    }
    for (const p of pool) if (p.spot) {
      tumble(p, dt);
      const st = p.spot.state;
      p.cap.userData.prop.rotation.y += dt * (st.mode === 'fly' ? 40 : st.mode === 'stand' ? 9 : 0);
    }
  }

  function tumble(p, dt) {
    const st = p.spot.state;
    if (st.mode === 'fly') {
      st.v.y -= 9.8 * dt;
      st.pos.addScaledVector(st.v, dt);
      const w = st.w.length();
      if (w > 1e-4) st.q.premultiply(Q().setFromAxisAngle(st.w.clone().divideScalar(w), w * dt));
      const up = UP.clone().applyQuaternion(st.q), low = st.pos.y - (Math.abs(up.y) * 0.9 + 0.15) * SIZE;   // lowest point of the body
      if (low < 0 && st.v.y < 0) {
        st.pos.y -= low;
        if (st.v.y < -2.5) { st.v.y *= -0.35; st.v.x *= 0.6; st.v.z *= 0.6; st.w.multiplyScalar(0.55); hooks.onBounce?.(st.pos, -st.v.y); }
        else {                                                             // done bouncing: flop down flat
          const flat = V(up.x, 0, up.z); if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
          st.lieQ = Q().setFromUnitVectors(up, flat.normalize()).multiply(st.q);
          st.mode = 'settle'; st.t = 0; st.q0 = st.q.clone(); st.y0 = st.pos.y;
        }
      }
    } else if (st.mode === 'settle') {
      st.t = Math.min(1, st.t + dt / 0.35);
      st.v.multiplyScalar(Math.exp(-5 * dt)); st.pos.x += st.v.x * dt; st.pos.z += st.v.z * dt;   // skid to a stop
      st.q.slerpQuaternions(st.q0, st.lieQ, st.t * st.t);
      st.pos.y = st.y0 + (0.14 * SIZE - st.y0) * st.t;
      if (st.t >= 1) st.mode = 'lie';
    }
    if (st.mode !== 'stand') { p.g.position.copy(st.pos); p.g.quaternion.copy(st.q); }
  }

  // the car's nose/tail circles (centre x/z, radius) at velocity (vx, vz): returns true if someone got hit
  function hit(circles, vx, vz) {
    const speed = Math.hypot(vx, vz);
    if (speed < 3) return false;
    for (const p of pool) {
      const st = p.spot?.state;
      if (!st || st.mode !== 'stand') continue;
      if (!circles.some(([x, z, r]) => Math.hypot(p.g.position.x - x, p.g.position.z - z) < r + BODY_R)) continue;
      const side = V(-vz, 0, vx).normalize().multiplyScalar((Math.random() - 0.5) * speed * 0.4);
      Object.assign(st, {
        mode: 'fly', pos: p.g.position.clone(), q: p.g.quaternion.clone(),
        v: V(vx * 1.15, 4 + Math.random() * 3 + speed * 0.12, vz * 1.15).add(side),
        w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 5 + speed * 0.15),
      });
      hooks.onHit?.(st.pos.clone(), speed);
      return true;
    }
    return false;
  }
  return { update, hit, pool };
}
