// Alt+F+4 (or, in BEERMOWER, running dry): God appears in front of the car in a
// blinding square of light, arms spread, and hurls fresh bottles and cigars
// into the empty carrier and cigar box. Built from a white-robed clone of the
// driver's rig with a golden halo.
import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,250,215,.6)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildGod(scene, gltf, light, hooks) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const HOLY = new THREE.Color(14, 14, 11);                      // far past white: the tone mapper blows it out
  const square = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ color: HOLY, side: THREE.DoubleSide, fog: false }));
  square.position.set(0, 2.7, -0.4); root.add(square);
  const glowTex = glowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(5, 5, 4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  glow.scale.set(18, 18, 1); glow.position.copy(square.position); root.add(glow);
  const rays = [];
  for (let i = 0; i < 10; i++) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 22), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.4), transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    r.position.copy(square.position); r.rotation.z = (i / 10) * Math.PI; root.add(r); rays.push(r);
  }

  // God: the driver's rig, robed in white, bearded, haloed, twice life size
  const god = skClone(gltf.scene); god.scale.setScalar(1.7); god.position.set(0, 0.35, 0.25); root.add(god);
  const robe = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d8, emissiveIntensity: 1.6, roughness: 0.6 });
  const skinGlow = new THREE.MeshStandardMaterial({ color: 0xf2d2b8, emissive: 0xffe8c8, emissiveIntensity: 0.9, roughness: 0.5 });
  const B = {};
  god.traverse((o) => {
    if (o.isBone) B[o.name] = o;
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = false;
    if (o.name === 'Wolf3D_Headwear') o.visible = false;
    else if (/Outfit|Beard/.test(o.name)) o.material = robe;
    else if (/Body|Head/.test(o.name)) o.material = skinGlow;
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 12, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 1.2), fog: false }));
  root.add(halo);

  const projectiles = [];
  let t = -1, spawned = 0, landed = 0, order = [], hand = 0;

  function spreadArms() {
    root.updateMatrixWorld(true);
    const fwd = V(0, 0, 1).transformDirection(root.matrixWorld);
    for (const [name, a] of [['LeftArm', 0.9], ['RightArm', -0.9], ['LeftForeArm', 0.25], ['RightForeArm', -0.25]]) {
      const b = B[name]; if (!b) continue;
      const w = b.getWorldQuaternion(new THREE.Quaternion()), pw = b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pw.invert().multiply(new THREE.Quaternion().setFromAxisAngle(fwd, a).multiply(w)));
      b.updateMatrixWorld(true);
    }
  }

  // start: stand him 7 m in front of the tractor, facing it
  // follow() -> {x, z, th}: when given, He keeps pace 7 m ahead of a moving car
  let follow = null;
  function place(px, pz, heading, groundAt) {
    const x = px + Math.sin(heading) * 7, z = pz + Math.cos(heading) * 7;
    root.position.set(x, groundAt(x, z), z); root.rotation.set(0, heading + Math.PI, 0);
  }
  function summon(pos, heading, groundAt, followFn = null) {
    if (t >= 0) return;
    follow = followFn ? () => { const f = followFn(); place(f.x, f.z, f.th, groundAt); } : null;
    place(pos.x, pos.z, heading, groundAt);
    root.visible = true; god.visible = false; t = 0; spawned = 0; landed = 0; hand = 0;
    order = [];
    for (let i = 0; i < 9; i++) order.push(i % 3 === 2 ? 'cigar' : 'beer');       // 6 beers, 3 cigars interleaved
    spreadArms();
    hooks.onSummon();
  }

  const _p = V();
  function update(dt, flash) {
    if (t < 0) return false;
    t += dt;
    if (follow) { follow(); root.updateMatrixWorld(true); }
    const appear = smooth(t / 1.2), leave = smooth((t - (2.6 + order.length * 0.32 + 2.2)) / 1.6);
    const s = appear * (1 - leave);
    square.scale.setScalar(Math.max(0.001, s));
    glow.material.opacity = s; glow.scale.setScalar(18 * (0.6 + 0.4 * s) + Math.sin(t * 7) * 0.4);
    rays.forEach((r, i) => { r.rotation.z = (i / rays.length) * Math.PI + t * 0.15; r.material.opacity = 0.25 * s; });
    god.visible = t > 0.7 && leave < 0.95;
    god.position.y = 0.35 + Math.sin(t * 1.3) * 0.08 + leave * 6;     // hovers, then ascends
    B.Head?.getWorldPosition(_p); halo.position.copy(root.worldToLocal(_p)).add(V(0, 0.42, -0.05)); halo.rotation.set(Math.PI / 2 + 0.25, 0, 0);
    halo.visible = god.visible;
    light.intensity = 250 * s; light.position.copy(root.localToWorld(V(0, 2.4, 1.5)));
    // blinding flash: white-out on arrival, settling to a strong glare
    flash(Math.min(1, t < 1.2 ? t / 0.5 : 1) * (t < 1.2 ? 1 : 0.35 + 0.65 * (1 - smooth((t - 1.2) / 1.0))) * (1 - leave));

    if (t > 1.3 && !hooks.said1) { hooks.said1 = true; hooks.say('THOU HAST RUN DRY, MY CHILD.', 2.2); }
    if (t > 2.6 && spawned === 0) hooks.say('RECEIVE!', 2);
    while (spawned < order.length && t > 2.6 + spawned * 0.32) {
      const kind = order[spawned++];
      const m = kind === 'beer' ? hooks.makeBottle() : hooks.makeCigar();
      const handBone = B[(hand++ % 2) ? 'RightHand' : 'LeftHand'];
      const from = handBone ? handBone.getWorldPosition(V()) : root.localToWorld(V(0, 2.5, 0));
      scene.add(m);
      const slot = kind === 'beer' ? hooks.beerSlotsFilled() + projectiles.filter((p) => p.kind === 'beer').length : hooks.cigarSlotsFilled() + projectiles.filter((p) => p.kind === 'cigar').length;
      projectiles.push({ m, kind, from, slot, t: 0, dur: 0.85, spin: V(Math.random() * 14, Math.random() * 14, Math.random() * 14) });
      hooks.onThrow();
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.t += dt;
      const u = Math.min(1, p.t / p.dur), to = p.kind === 'beer' ? hooks.beerSlot(p.slot) : hooks.cigarSlot(p.slot);
      p.m.position.lerpVectors(p.from, to, u).add(V(0, Math.sin(u * Math.PI) * 1.6, 0));
      p.m.rotation.set(p.spin.x * p.t, p.spin.y * p.t, p.spin.z * p.t);
      if (u >= 1) {
        scene.remove(p.m); projectiles.splice(i, 1); landed++;
        if (p.kind === 'beer') hooks.addBeer(); else hooks.addCigar();
        hooks.onLand(to);
      }
    }
    if (landed === order.length && !hooks.said2) { hooks.said2 = true; hooks.say('GO FORTH AND DRIVE.', 2.5); }
    if (leave >= 1) {
      root.visible = false; light.intensity = 0; flash(0); t = -1; hooks.said1 = hooks.said2 = false; hooks.onLeave();
      return false;
    }
    return true;
  }
  return { summon, update, get active() { return t >= 0; } };
}
