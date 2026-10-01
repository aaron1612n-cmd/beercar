// FLY MODE: a giant fruit fly drives, with a real fly brain.
// - Brain: all 138,639 neurons of the FlyWire connectome, spiking (flycore.js, in flybrain.worker.js).
// - Eyes: two little cameras in its head render the actual game; each of its ~4,700 lamina cells
//   (L1-L3) is driven by the darkness of the pixel it looks at (flypilot.js eyeDir / eyeRates).
// - Hands: the wheel listens to 150 cells it picks from its visual system (optic lobes + projection
//   neurons, ~2/3 of the brain) through weights that learn (flypilot.js).
//   An instructor teaches in LESSON mode; holding A/D teaches it yourself; SOLO = it drives alone.
// - Mouth: beer on its taste hairs drives its sugar neurons; MN9 (proboscis motor neuron) decides whether
//   it drinks. That pathway is the one Shiu et al. 2024 showed in this exact model.
// - Thirst: whether it *goes for* the beer is learned by reward (makeCraving): buzz up = good, buzz down = bad.
import * as THREE from 'three';
import { makePilot, makeCraving, instructor, eyeDir, eyeRates } from './flypilot.js';
import FlyWorker from './flybrain.worker.js?worker';

const FILES = import.meta.glob('./assets/flybrain.*', { query: '?url', import: 'default', eager: true });
const SAVE_KEY = 'beercar.flypilot.v1', CRAVE_KEY = 'beercar.flycraving.v1';
const TONE = 4;   // mV of resting tone on the visual system: the road reaches the projection neurons far better (tools/flyprobe.mjs)
const EW = 48, EH = 32, EYE_AZ = 65 * Math.PI / 180, EYE_VFOV = 100;
export const LANE = 1.7;

// ---- the fly itself: Drosophila colours, built from primitives, sitting in the driver's seat (cabin coords) ----
function buildFlyModel() {
  const g = new THREE.Group();
  const tan = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc0201a, roughness: 0.35, metalness: 0.1 });
  const wingM = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const blob = (r, sx, sy, sz, m, x, y, z) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const stick = (a, b, r, m) => {
    const d = new THREE.Vector3().subVectors(b, a), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, d.length(), 8), m);
    o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); o.castShadow = true; g.add(o); return o;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  blob(0.15, 1, 1.15, 1, tan, 0, 1.22, -0.36);                       // thorax, sitting up
  const abd = blob(0.16, 1, 1.3, 0.95, tan, 0, 1.0, -0.47);           // abdomen with dark bands
  for (let k = 0; k < 4; k++) { const b = blob(0.162, 1.0, 0.13, 0.96, dark, 0, 0.86 + k * 0.08, -0.47); b.scale.y = 0.13 - k * 0.01; }
  abd.rotation.x = -0.25;
  const head = new THREE.Group(); head.position.set(0, 1.45, -0.27); g.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), tan); hm.scale.set(1.15, 0.9, 0.85); hm.castShadow = true; head.add(hm);
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), red); e.scale.set(0.7, 1.05, 0.95); e.position.set(s * 0.085, 0.01, 0.025); head.add(e);
    const ant = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 6), dark); ant.position.set(s * 0.03, 0.06, 0.08); ant.rotation.x = 0.6; head.add(ant);
  }
  const prob = new THREE.Group(); prob.position.set(0, -0.06, 0.05); head.add(prob);   // proboscis: MN9 extends it
  const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.12, 8), tan); pm.position.y = -0.06; prob.add(pm);
  const lab = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), dark); lab.position.y = -0.12; lab.scale.set(1.3, 0.6, 1); prob.add(lab);
  prob.rotation.x = 0.5;
  const wings = [1, -1].map((s) => {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), wingM); w.scale.set(0.42, 1, 1);
    const p = new THREE.Group(); p.position.set(s * 0.06, 1.3, -0.48); p.add(w); w.position.y = -0.18; p.rotation.set(-0.5, s * 0.3, s * 0.35); g.add(p); return p;
  });
  // legs: front pair on the wheel, middle on the seat, hind braced on the floor (wheel rim ~ y 1.35, z 0)
  for (const s of [1, -1]) {
    stick(V(s * 0.09, 1.2, -0.25), V(s * 0.2, 1.15, -0.05), 0.016, dark); stick(V(s * 0.2, 1.15, -0.05), V(s * 0.15, 1.35, -0.01), 0.013, dark);
    stick(V(s * 0.12, 1.12, -0.33), V(s * 0.3, 1.0, -0.2), 0.016, dark); stick(V(s * 0.3, 1.0, -0.2), V(s * 0.32, 0.88, -0.25), 0.013, dark);
    stick(V(s * 0.1, 1.05, -0.4), V(s * 0.22, 0.9, 0.05), 0.016, dark); stick(V(s * 0.22, 0.9, 0.05), V(s * 0.18, 0.62, 0.35), 0.013, dark);
  }
  g.position.y = 0.12;                                                  // up out of the seat well, eyes at window height
  return { group: g, head, prob, wings };
}

export function buildFly({ scene, renderer, car, say }) {
  const model = buildFlyModel(); model.group.visible = false; car.cabin.add(model.group);
  // eyes: one camera per eye, each turned 65 deg out to its side (the head faces +Z, the car's forward)
  const eyes = ['left', 'right'].map((side) => {
    const cam = new THREE.PerspectiveCamera(EYE_VFOV, EW / EH, 0.12, 400);
    cam.rotation.y = Math.PI + (side === 'left' ? EYE_AZ : -EYE_AZ);
    model.head.add(cam);
    return { side, cam, rt: new THREE.WebGLRenderTarget(EW, EH), px: new Uint8Array(EW * EH * 4) };
  });

  const st = { on: false, ready: false, loading: false, mode: 'lesson', steer: 0, target: null, teacher: 'instructor',
    speed: 0, mn9: 0, pour: 0, drank: 0, feel: 0, craveT: 3, buzz0: 0, chance: 0, goes: 0, wander: 0, wanderT: 0, lookAt: 0, crashes: 0, solo: { t: 0, err: 0 } };
  let worker, meta, pilot, craving, cellPix, dark, rates, ctx, eyeCtx, imgData, eyeImg, saveT = 0;

  async function load() {
    st.loading = true; say('Loading the fly brain (11 MB, 138,639 neurons)...', 30);
    const [buf, m] = await Promise.all([fetch(FILES['./assets/flybrain.bin']).then((r) => r.arrayBuffer()), fetch(FILES['./assets/flybrain.json']).then((r) => r.json())]);
    meta = m;
    // which pixel of which eye each lamina cell looks at
    const cells = [];
    for (const side of ['left', 'right']) { const e = meta.eyes[side]; e.idx.forEach((i, k) => cells.push({ i, side, ...eyeDir(side, e.u[k], e.v[k]) })); }
    const tanH = Math.tan((EYE_VFOV / 2) * Math.PI / 180), tanW = tanH * (EW / EH);
    cellPix = Int32Array.from(cells, (c) => {
      const rel = c.az - (c.side === 'left' ? EYE_AZ : -EYE_AZ);           // azimuth relative to that eye's camera axis
      const fx = Math.tan(Math.max(-1.4, Math.min(1.4, rel))) / tanW, fy = Math.tan(c.el) / Math.cos(rel) / tanH;
      const px = Math.round((0.5 - fx / 2) * (EW - 1)), py = Math.round((0.5 - fy / 2) * (EH - 1));   // + az = left = image left, + el = up = row 0
      const eyeOff = c.side === 'left' ? 0 : EW * EH;
      return eyeOff + Math.max(0, Math.min(EH - 1, py)) * EW + Math.max(0, Math.min(EW - 1, px));
    });
    dark = new Float32Array(cells.length); rates = new Float32Array(cells.length);
    let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* private mode etc. */ }
    pilot = makePilot(meta.visual.length, saved, { K: 150 });
    let sc = null; try { sc = JSON.parse(localStorage.getItem(CRAVE_KEY)); } catch { /* ignore */ }
    craving = makeCraving(sc);
    worker = new FlyWorker();
    worker.onmessage = ({ data }) => onTick(data);
    worker.postMessage({ type: 'init', buf, tone: TONE, meta: { toneCells: meta.visual, eyeIdx: cells.map((c) => c.i), sugar: meta.sugar, mn9: meta.mn9, pool: meta.visual, pixW: meta.pixW, pixH: meta.pixH } }, [buf]);
    buildHud();
    st.ready = true; st.loading = false; say(pilot.lessons ? `The fly remembers ${pilot.lessons} lessons` : 'Fly brain online. Lesson 1: the instructor drives, the fly watches', 3);
  }

  // ---- HUD: brain activity map (front view of the real cell positions), the eyes' view, the numbers ----
  function buildHud() {
    const el = document.getElementById('flyHud');
    const c = el.querySelector('#brainMap'); c.width = meta.pixW; c.height = meta.pixH;
    ctx = c.getContext('2d'); imgData = ctx.createImageData(meta.pixW, meta.pixH);
    const e = el.querySelector('#eyeView'); e.width = EW * 2; e.height = EH;
    eyeCtx = e.getContext('2d'); eyeImg = eyeCtx.createImageData(EW * 2, EH);
  }
  const $ = (id) => document.getElementById(id);
  function drawBrain(img) {
    const d = imgData.data;
    for (let k = 0; k < img.length; k++) { const v = img[k]; d[k * 4] = 20 + v; d[k * 4 + 1] = 16 + v * 0.7; d[k * 4 + 2] = 40 + v * 0.2; d[k * 4 + 3] = 255; }
    ctx.putImageData(imgData, 0, 0);
  }

  // one brain window done: read the wheel, maybe learn, drink if MN9 says so
  let ctxS = null;
  function onTick(m) {
    pilot.feed(m.counts, m.ms);
    let sum = 0; for (const c of m.counts) sum += c;
    st.feel += (sum / m.counts.length * (1000 / m.ms) / 5 - st.feel) * 0.1;   // its overall vision-cell firing, ~1 sober
    st.speed += (m.ms / m.wall - st.speed) * 0.1;
    st.mn9 += (m.mn9 * (1000 / m.ms) - st.mn9) * 0.3;
    if (st.target !== null) pilot.learn(st.target);
    st.steer = Math.max(-1, Math.min(1, pilot.steer()));
    if (st.on) drawBrain(m.img);
  }

  // render what each eye sees, convert to lamina rates, send to the brain (~15 Hz)
  function look(drunk) {
    const sa = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    const prev = renderer.getRenderTarget();
    const carVis = car.root.visible; car.root.visible = false;            // ponytail: the fly sees through the car (roof,
                                                                          // pillars and doors would fill most of its view)
    for (const e of eyes) {
      if (drunk > 0.1) e.cam.rotation.z = Math.sin(performance.now() / 300 + (e.side === 'left' ? 0 : 2)) * 0.06 * drunk;   // eyes swim
      renderer.setRenderTarget(e.rt); renderer.render(scene, e.cam);
      renderer.readRenderTargetPixels(e.rt, 0, 0, EW, EH, e.px);
    }
    renderer.setRenderTarget(prev); renderer.shadowMap.autoUpdate = sa; car.root.visible = carVis;
    // render targets come out bottom-up: flip rows so py = 0 is the top of the view
    const lum = (eye, k) => { const y = Math.floor(k / EW), x = k % EW, j = ((EH - 1 - y) * EW + x) * 4, p = eye.px; return (0.2126 * p[j] + 0.7152 * p[j + 1] + 0.0722 * p[j + 2]) / 255; };
    for (let c = 0; c < cellPix.length; c++) { const k = cellPix[c], eye = k < EW * EH ? eyes[0] : eyes[1]; dark[c] = 1 - lum(eye, k % (EW * EH)); }
    worker.postMessage({ type: 'eyes', rates: eyeRates(dark, rates) });
    if (eyeCtx) {
      const d = eyeImg.data;
      for (let y = 0; y < EH; y++) for (let x = 0; x < EW * 2; x++) {
        const eye = x < EW ? eyes[0] : eyes[1], ex = x < EW ? x : x - EW, j = ((EH - 1 - y) * EW + ex) * 4, o = (y * EW * 2 + x) * 4;
        d[o] = eye.px[j]; d[o + 1] = eye.px[j + 1]; d[o + 2] = eye.px[j + 2]; d[o + 3] = 255;
      }
      eyeCtx.putImageData(eyeImg, 0, 0);
    }
  }

  // called every game frame in fly mode. S = game state; keySteer = the player's A/D (null if not held).
  function update(dt, S, keySteer) {
    if (!st.ready) return { steer: 0 };
    const t = performance.now() / 1000;
    if (performance.now() - st.lookAt > 66) {                           // ~15 Hz of real time, whatever the game speed
      st.lookAt = performance.now();
      look(S.drunk);
      worker.postMessage({ type: 'drunk', scale: 1 - Math.min(S.drunk, 4) * 0.08 });   // alcohol damps every synapse a little
    }
    const vf = Math.hypot(S.vx, S.vz);
    if ((st.wanderT -= dt) <= 0) { st.wanderT = 2 + Math.random() * 3; st.wander = (Math.random() - 0.5) * 3.5; }
    const correct = instructor(S.x, S.th, LANE, vf);
    let drive;
    if (keySteer !== null) { st.teacher = 'you'; st.target = keySteer; drive = keySteer; }
    else if (st.mode === 'lesson') { st.teacher = 'instructor'; st.target = correct; drive = instructor(S.x, S.th, LANE + st.wander, vf); }
    else { st.teacher = 'nobody'; st.target = null; drive = st.steer; st.solo.t += dt; st.solo.err += Math.abs(S.x - LANE) * dt; }

    // thirst: every 3 s, score the last choice by what happened to its buzz, then choose again
    if ((st.craveT -= dt) <= 0) {
      st.craveT = 3;
      const dB = S.drunk - st.buzz0;
      craving.reward(dB > 0.02 ? 1 : dB < 0 ? -0.5 : 0);
      const f = [1, st.feel, S.drunk / 4];
      st.chance = craving.chance(f);
      if (craving.decide(f)) { st.pour = Math.max(st.pour, 2.5); st.goes++; if (st.goes % 3 === 1) say('The fly goes for the beer', 1.2); }
      st.buzz0 = S.drunk;
    }
    // beer: on its taste hairs it drives the 20 sugar neurons; the fly drinks only while its MN9 fires
    if (st.pour > 0) st.pour -= dt;
    worker.postMessage({ type: 'taste', hz: st.pour > 0 ? 150 : 0 });
    const sip = Math.max(0, Math.min(1, (st.mn9 - 5) / 40));             // MN9 Hz -> proboscis out 0..1
    model.prob.rotation.x = 0.5 - sip * 0.9; model.prob.scale.y = 1 + sip * 0.8;
    let drank = 0; if (st.pour > 0 && sip > 0.05) { drank = sip * 0.12 * dt; st.drank += drank; }
    for (const [k, w] of model.wings.entries()) w.rotation.z = (k ? -1 : 1) * (0.35 + (sip > 0.3 ? Math.sin(t * 90) * 0.15 : 0));
    model.head.rotation.y = -drive * 0.25;

    if ((saveT += dt) > 10) { saveT = 0; persist(); }
    hud(S);
    return { steer: drive, drank, instructor: st.teacher === 'instructor' };
  }
  function persist() { try { localStorage.setItem(CRAVE_KEY, JSON.stringify(craving.save())); } catch { /* ignore */ } const s = pilot.save(); try { if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s)); else localStorage.removeItem(SAVE_KEY); } catch { /* storage full / blocked */ } }

  function hud(S) {
    $('flyMode').textContent = st.mode === 'lesson' ? 'LESSON' : 'SOLO';
    $('flyTeacher').textContent = st.teacher;
    $('flyLessons').textContent = pilot.watching ? `watching (${pilot.watchLeft} to go)` : pilot.lessons.toLocaleString();
    $('flySpeed').textContent = `${st.speed.toFixed(2)}x real time`;
    $('flySaves').textContent = `${st.crashes}`;
    $('flyErr').textContent = st.solo.t > 3 ? `${(st.solo.err / st.solo.t).toFixed(2)} m` : '-';
    $('flyMn9').firstElementChild.style.width = Math.min(100, st.mn9) + '%';
    $('flyCrave').textContent = `${Math.round(st.chance * 100)}% per go, ${craving.tries} beers sought`;
    $('flySteer').style.left = `${50 - st.steer * 48}%`;
  }

  return {
    st,
    async setActive(on) {
      st.on = on; model.group.visible = on;
      document.getElementById('flyHud').style.display = on ? 'block' : 'none';
      if (on && !st.ready && !st.loading) await load();
      if (worker) worker.postMessage({ type: 'pause', on: !on });
      if (!on && pilot) persist();
    },
    update,
    // first-person camera: just above the fly's face (peeking over the wheel), looking where its head looks
    viewFrom(pos, quat) { model.head.localToWorld(pos.set(0, 0.17, 0.13)); model.head.getWorldQuaternion(quat); },
    toggleMode() { st.mode = st.mode === 'lesson' ? 'solo' : 'lesson'; st.solo = { t: 0, err: 0 }; say(st.mode === 'solo' ? 'SOLO: the fly is driving' : 'LESSON: the instructor drives, the fly learns', 2); },
    crashed() { if (st.ready) { st.crashes++; if (st.mode === 'solo') { st.solo.err += 5; } } },
    pour() { if (st.ready) { st.pour = 4; say('Beer poured on its taste hairs...', 1.5); } },
    forget() { if (pilot) { pilot.forget(); craving = makeCraving(null); persist(); say('The fly forgot how to drive, and that it likes beer', 2); } },
  };
}
