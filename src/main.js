import * as THREE from 'three';
import { heightAt, buildWorld } from './road.js';
import { buildCar } from './car.js';
import { buildDriver } from './driver.js';
import { loadAssets } from './assets.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---- tuning: top speed ~90 mph. Turning is limited by tyre grip (latG), not just the steering lock,
// so it's quick in town and calm on the highway; the heading follows with a little yaw inertia. --------
const T = { maxFwd: 40, maxRev: 8, accel: 7, brake: 16, coast: 1.4, drag: 0.0012, steerMax: 0.55, steerRate: 1.8, steerFalloff: 0.035,
  wheelbase: 2.76, grip: 14, latG: 8.5, yawResp: 7, fov: 72, sens: 0.0022, camDist: 7.5, camHeight: 2.8, camLag: 4 };

// ---- scene ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const MAX_RES = Math.min(devicePixelRatio, 1.25);
let resScale = Math.min(1, MAX_RES);
renderer.setPixelRatio(resScale);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(T.fov, innerWidth / innerHeight, 0.03, 1500);
const goEl = document.querySelector('#overlay .go'), goText = goEl.textContent;
goEl.textContent = 'Loading... 0%';
const assets = await loadAssets(renderer, (f) => { goEl.textContent = `Loading... ${Math.round(f * 100)}%`; });
goEl.textContent = goText;
const world = buildWorld(scene, renderer, assets);

// ---- drunk vision: wobble, double vision, tunnel vignette (only runs while drunk) ----
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const drunkPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmt, uTime; varying vec2 vUv;
    void main() {
      float a = uAmt;
      vec2 uv = vUv + vec2(sin(vUv.y * 7.0 + uTime * 1.3), cos(vUv.x * 5.0 + uTime * 1.1)) * 0.009 * a;
      vec2 off = vec2(sin(uTime * 0.7), cos(uTime * 0.93) * 0.4) * 0.035 * a;          // the world splits in two
      vec4 c = mix(texture2D(tDiffuse, uv), texture2D(tDiffuse, uv + off), 0.45 * clamp(a * 1.6, 0.0, 1.0));
      vec2 d = vUv - 0.5;                                                                // smear toward the edges
      c = mix(c, (texture2D(tDiffuse, uv - d * 0.03 * a) + texture2D(tDiffuse, uv - d * 0.06 * a)) * 0.5, 0.5 * a);
      c.rgb *= mix(1.0, smoothstep(0.85, 0.2, length(d)), 0.75 * a);                    // tunnel vision
      gl_FragColor = c;
    }`,
});
composer.addPass(drunkPass);
composer.addPass(new OutputPass());
composer.setPixelRatio(resScale); composer.setSize(innerWidth, innerHeight);

const car = buildCar(assets.camaro);
scene.add(car.root);

// ---- HUD helpers ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function say(text, secs = 2.2) { const m = $('msg'); m.textContent = text; m.style.opacity = 1; S.msgT = secs; }

// ---- audio ------------------------------------------------------------------
let actx, master, engA, engB, engG, bladeG, noiseBuf, muted = false;
function startAudio() {
  try {
    actx = new AudioContext(); master = actx.createGain(); master.connect(actx.destination);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    engG = actx.createGain(); engG.gain.value = 0.06;
    engA = actx.createOscillator(); engA.type = 'sawtooth';
    engB = actx.createOscillator(); engB.type = 'square';
    const bG = actx.createGain(); bG.gain.value = 0.5;
    engA.connect(lp); engB.connect(bG).connect(lp); lp.connect(engG).connect(master);
    engA.start(); engB.start();
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = actx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.6;
    bladeG = actx.createGain(); bladeG.gain.value = 0;
    noise.connect(bp).connect(bladeG).connect(master); noise.start();
  } catch { actx = null; }
}
// one-shot filtered noise burst
function burst(type, freq, gain, secs, q = 1) {
  if (!actx || muted) return;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(), t = actx.currentTime;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.05, secs * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  src.connect(f).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + secs + 0.05);
}
function tone(f0, f1, gain, secs) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + secs);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  o.connect(g).connect(master); o.start(t); o.stop(t + secs + 0.02);
}
const SFX = {
  gulp: () => { burst('lowpass', 380, 0.35, 0.22, 4); tone(170, 85, 0.18, 0.18); },
  psst: () => burst('highpass', 3500, 0.12, 0.45),
  puff: () => burst('lowpass', 700, 0.12, 0.35),
  exhale: () => burst('bandpass', 650, 0.14, 1.3, 0.5),
  thump: (v) => tone(90, 45, Math.min(0.5, v * 0.08), 0.3),
  whoosh: () => burst('bandpass', 900, 0.1, 0.3, 0.8),
  tink: (v) => { tone(2100 + Math.random() * 500, 1700, Math.min(0.12, v * 0.03), 0.18); burst('highpass', 5000, Math.min(0.05, v * 0.012), 0.08); },
  clonk: (v) => { tone(520, 380, Math.min(0.25, v * 0.05), 0.22); tone(1300, 1150, Math.min(0.08, v * 0.02), 0.3); },
  capPop: () => { tone(1500, 700, 0.12, 0.08); burst('highpass', 3000, 0.1, 0.06); },
  smash: () => { burst('highpass', 2500, 0.45, 0.5, 0.7); for (let i = 0; i < 6; i++) setTimeout(() => tone(2500 + Math.random() * 3000, 2000, 0.08, 0.15), i * 35); },
  hic: () => { tone(420, 900, 0.18, 0.09); burst('lowpass', 900, 0.12, 0.08, 3); },
  choir() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    for (const f of [220, 277.2, 329.6, 440, 554.4, 659.3, 880]) {
      for (const det of [-4, 4]) {
        const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 1.2); g.gain.setValueAtTime(0.03, t + 6.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 9);
        o.connect(g).connect(master); o.start(t); o.stop(t + 9.1);
      }
    }
    burst('highpass', 6000, 0.08, 3, 0.5);
  },
  clang: () => { tone(620, 480, 0.35, 0.5); tone(1450, 1100, 0.2, 0.35); tone(2900, 2300, 0.1, 0.25); burst('bandpass', 2500, 0.3, 0.25, 0.8); },
  lighter: () => { burst('highpass', 4000, 0.15, 0.05); setTimeout(() => burst('bandpass', 400, 0.08, 0.9, 0.6), 60); },
  // voice bits: a buzzy source through vowel formants
  voice(f0, f1, secs, formants, gain = 0.12) {
    if (!actx || muted) return;
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + secs);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.06); g.gain.setValueAtTime(gain, t + secs * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    for (const [f, q] of formants) { const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; o.connect(bp).connect(g); }
    g.connect(master); o.start(t); o.stop(t + secs + 0.05);
  },
  ahh() { SFX.voice(150, 105, 0.9, [[750, 6], [1200, 7]]); burst('bandpass', 1100, 0.05, 0.9, 0.7); },
  burp() { SFX.voice(78, 62, 0.55, [[500, 3], [900, 4]], 0.22); burst('lowpass', 300, 0.1, 0.45, 2); },
  cough() { for (let i = 0; i < 3; i++) setTimeout(() => { burst('bandpass', 480 + Math.random() * 150, 0.32, 0.16, 1.2); SFX.voice(200, 140, 0.12, [[600, 3]], 0.08); }, i * 230 + Math.random() * 40); },
  ash: () => burst('highpass', 3000, 0.02, 0.1),
};

// ---- smoke + clippings ------------------------------------------------------
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const smoke = Array.from({ length: 180 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdedbd6, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; scene.add(s);
  return { s, v: new THREE.Vector3(), life: 0, max: 1, s0: 0.1, s1: 0.5, a: 0.5 };
});
let smokeHead = 0;
function puffSmoke(pos, vel, spread, n, { life = 2.5, s0 = 0.05, s1 = 0.5, a = 0.45 } = {}) {
  for (let i = 0; i < n; i++) {
    const p = smoke[smokeHead++ % smoke.length];
    p.s.position.copy(pos); p.s.visible = true;
    p.v.set(vel.x + (Math.random() - 0.5) * spread, vel.y + (Math.random() - 0.5) * spread, vel.z + (Math.random() - 0.5) * spread);
    p.life = 0; p.max = life * (0.8 + Math.random() * 0.4); p.s0 = s0; p.s1 = s1 * (0.8 + Math.random() * 0.4); p.a = a;
  }
}
function updateSmoke(dt) {
  for (const p of smoke) {
    if (!p.s.visible) continue;
    p.life += dt; const u = p.life / p.max;
    if (u >= 1) { p.s.visible = false; continue; }
    p.v.multiplyScalar(Math.exp(-1.6 * dt)); p.v.y += 0.12 * dt; p.v.x += 0.08 * dt;
    p.s.position.addScaledVector(p.v, dt);
    p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(u));
    p.s.material.opacity = p.a * Math.min(1, u * 8) * (1 - u);
  }
}
const NS = 160;
const sPos = new Float32Array(NS * 3).fill(-999), sVel = new Float32Array(NS * 3), sLife = new Float32Array(NS);
const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
const shards = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x3fae4c, size: 0.03 }));
shards.frustumCulled = false; scene.add(shards);
let sHead = 0;
function spawnShards(pos) {
  const lx = Math.cos(S.th), lz = -Math.sin(S.th);              // out of the chute (driver's right)
  for (let k = 0; k < 50; k++) {
    const i = sHead++ % NS, sp = 2 + Math.random() * 4;
    sPos.set([pos.x, pos.y + 0.05, pos.z], i * 3);
    sVel.set([-lx * sp + (Math.random() - 0.5) * 2, 1 + Math.random() * 2.5, -lz * sp + (Math.random() - 0.5) * 2], i * 3);
    sLife[i] = 2 + Math.random() * 2;
  }
}
function updateShards(dt) {
  for (let i = 0; i < NS; i++) {
    if (sLife[i] <= 0) continue;
    sLife[i] -= dt; if (sLife[i] <= 0) { sPos[i * 3 + 1] = -999; continue; }
    sVel[i * 3 + 1] -= 9.8 * dt;
    for (let a = 0; a < 3; a++) sPos[i * 3 + a] += sVel[i * 3 + a] * dt;
    const g = heightAt(sPos[i * 3], sPos[i * 3 + 2]) + 0.01;
    if (sPos[i * 3 + 1] < g) { sPos[i * 3 + 1] = g; sVel[i * 3] *= 0.3; sVel[i * 3 + 1] = 0; sVel[i * 3 + 2] *= 0.3; }
  }
  sGeo.attributes.position.needsUpdate = true;
}


// ---- driver -----------------------------------------------------------------
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), qTmp = new THREE.Quaternion();
const driver = buildDriver({ ...car, body: car.cabin }, {
  say,
  onSip: (amount) => { SFX.gulp(); S.drunk = Math.min(1.5, S.drunk + amount * 0.6); },
  onAhh: () => { SFX.ahh(); if (Math.random() < 0.15 + S.drunk * 0.3) setTimeout(() => { SFX.burp(); say('*BUUURP*', 1.2); }, 1300); },
  onAshDrop: () => SFX.ash(),
  onAshLand: (pos) => puffSmoke(pos, v3b.set(0, 0.15, 0), 0.15, 3, { life: 1.2, s0: 0.01, s1: 0.08, a: 0.3 }),
  onOpen: (pos) => { SFX.capPop(); SFX.psst(); puffSmoke(pos, v3b.set(0, 0.3, 0), 0.08, 4, { life: 0.8, s0: 0.008, s1: 0.05, a: 0.45 }); say(`Opened a fresh one (${driver.st.beers} left in the carrier)`); },
  onPuff: () => { SFX.puff(); puffSmoke(driver.emberWorld(v3), v3b.set(0, 0.15, 0), 0.08, 3, { life: 1.5, s0: 0.02, s1: 0.15, a: 0.35 }); },
  onExhale: () => {
    SFX.exhale();
    if (Math.random() < 0.2 + S.drunk * 0.1) setTimeout(() => SFX.cough(), 1100);
    const dir = v3b.set(0, -0.1, 1).applyQuaternion(driver.headQuatWorld(qTmp)).multiplyScalar(0.9);
    puffSmoke(driver.mouthWorld(v3), dir, 0.25, 16, { life: 2.8, s0: 0.04, s1: 0.55, a: 0.5 });
  },
  onThrow: () => SFX.whoosh(),
  onLitterHit: (kind, v) => { if (kind === 'bottle') SFX.clonk(v); else if (kind === 'cap') SFX.tink(v * 0.5); },
  onClang: (kind, pos) => { if (kind === 'bottle') { SFX.smash(); S.shake = 0.05; spawnShards(pos); say('SMASH! Mowed over a bottle', 1.5); } else if (kind === 'cap') SFX.tink(2); },
  onLighter: () => SFX.lighter(),
  onWisp: (pos) => puffSmoke(pos, v3b.set(0, 0.2, 0), 0.03, 1, { life: 1.6, s0: 0.01, s1: 0.1, a: 0.22 }),
  carVel: () => new THREE.Vector3(S.vx, 0, S.vz),
}, assets.avatar, scene);
// The shirt's hem hangs ~0.3 m below the hips: on the tractor the tall seat hid it, in the Camaro it pokes
// out under the floor pan. Clip it at the seat cushion (plane follows the car body every frame).
const hemBase = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.42), hem = hemBase.clone();
renderer.localClippingEnabled = true;
car.cabin.traverse((o) => { if (o.name === 'Wolf3D_Outfit_Top') o.material.clippingPlanes = [hem]; });

// ---- state ------------------------------------------------------------------
const S = {};
function resetState() {
  Object.assign(S, { x: 1.7, z: 0, th: 0, vx: 0, vz: 0, steer: 0, yawRate: 0, pitch: 0, roll: 0, camTh: 0, shake: 0, msgT: 0, drunk: 0, yaw: 0, look: -0.34, restock: 0 });
  $('msg').style.opacity = 0;
}
resetState();

// ---- input ------------------------------------------------------------------
const keys = new Set();
let camMode = 0;   // 0 first person, 1 chase
const overlayUp = () => $('overlay').style.display !== 'none';
function lockMouse() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* unsupported */ } }
function startGame() {
  $('overlay').style.display = 'none';
  setTimeout(() => $('hints').classList.add('faded'), 12000);
  if (!actx) startAudio();
  lockMouse();
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (overlayUp()) { startGame(); return; }
  if (e.code === 'KeyC') camMode = (camMode + 1) % 2;
  if (e.code === 'KeyR') resetState();
  if (e.code === 'KeyH') $('hints').classList.toggle('faded');
  if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 1; }
  if (e.code === 'Backquote') driver.start('beer');
  if (e.code === 'KeyQ') driver.start('cigar');
  if (e.code === 'Space' || e.code === 'Backquote') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('overlay').addEventListener('click', startGame);
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) lockMouse(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  S.yaw = Math.max(-2.0, Math.min(2.0, S.yaw - e.movementX * T.sens));
  S.look = Math.max(-1.15, Math.min(0.85, S.look - e.movementY * T.sens));
});
document.addEventListener('pointerlockchange', () => { $('lookHint').style.display = document.pointerLockElement === canvas || overlayUp() ? 'none' : 'block'; });
const down = (...ks) => ks.some((k) => keys.has(k));

// ---- HUD --------------------------------------------------------------------
function hud(vf) {
  const st = driver.st;
  $('beer').textContent = `${st.bottleState === 'none' ? 'no bottle' : `${Math.round(st.fill * 100)}%`} · ${st.beers} in carrier`;
  $('cigars').textContent = `${st.cigState === 'hand' ? `${Math.round((st.cigLen / 0.14) * 100)}%` : 'none lit'} · ${st.cigars} in box`;
  $('buzz').firstElementChild.style.width = Math.min(100, (S.drunk / 1.5) * 100) + '%';
  $('mph').textContent = Math.round(Math.abs(vf) * 2.237);
}

// ---- simulation -------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let last = performance.now(), clock = 0;

function step(dt) {
  const throttle = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
  let steerIn = (down('KeyA', 'ArrowLeft') ? 1 : 0) - (down('KeyD', 'ArrowRight') ? 1 : 0);
  const braking = down('Space');
  if (S.drunk > 0.05) steerIn = clamp(steerIn + S.drunk * 0.25 * Math.sin(clock * 0.6 + Math.sin(clock * 0.23) * 3), -1, 1);
  const dx = Math.sin(S.th), dz = Math.cos(S.th);
  let vf = S.vx * dx + S.vz * dz;
  let latx = S.vx - dx * vf, latz = S.vz - dz * vf;
  const vf0 = vf;

  // longitudinal: power fades toward top speed; coast = rolling + air drag
  if (throttle) {
    const opposing = throttle * vf < -0.05;
    vf += throttle * (opposing ? T.brake : T.accel * Math.max(0.1, 1 - Math.abs(vf) / T.maxFwd)) * dt;
  } else {
    const f = (T.coast + T.drag * vf * vf) * dt;
    vf = Math.abs(vf) <= f ? 0 : vf - Math.sign(vf) * f;
  }
  if (braking) { const f = T.brake * dt; vf = Math.abs(vf) <= f ? 0 : vf - Math.sign(vf) * f; }
  vf = clamp(vf, -T.maxRev, T.maxFwd);

  // steering
  const lock = T.steerMax / (1 + Math.abs(vf) * T.steerFalloff);
  const want = steerIn * lock, dSt = T.steerRate * dt;
  S.steer += clamp(want - S.steer, -dSt, dSt);
  if (!steerIn) S.steer *= Math.exp(-5 * dt);
  const kin = (vf * Math.tan(S.steer)) / T.wheelbase, cap = T.latG / Math.max(1, Math.abs(vf));
  S.yawRate = (S.yawRate || 0) + (clamp(kin, -cap, cap) - (S.yawRate || 0)) * Math.min(1, T.yawResp * dt);
  const omega = S.yawRate;

  const g = Math.exp(-T.grip * dt); latx *= g; latz *= g;

  S.th += omega * dt;
  const nx = Math.sin(S.th), nz = Math.cos(S.th);
  S.vx = nx * vf + latx; S.vz = nz * vf + latz;
  S.x += S.vx * dt; S.z += S.vz * dt;

  // pose + jolt for the cigar ash (hard throttle/brake, cornering, road rumble)
  const accelNow = (vf - vf0) / Math.max(dt, 1e-3);
  S.jolt = Math.abs(accelNow) * 0.5 + Math.abs(omega * vf) * 0.4 + S.shake * 200 + Math.abs(vf) * 0.04;
  S.pitch += (clamp(-accelNow * 0.0025, -0.02, 0.02) - S.pitch) * Math.min(1, 10 * dt);
  S.roll += (clamp(-omega * vf * 0.0018, -0.03, 0.03) - S.roll) * Math.min(1, 10 * dt);
  const rpm = Math.abs(vf) / T.maxFwd;
  const buzz = Math.sin(clock * 70) * 0.0012 * (0.4 + rpm) + Math.sin(clock * 9) * 0.0008 * rpm;
  car.root.position.set(S.x, 0, S.z);
  car.root.rotation.y = S.th;
  car.body.rotation.set(S.pitch + buzz, 0, S.roll);
  car.body.position.y = buzz * 0.5;
  car.body.updateMatrixWorld(); hem.copy(hemBase).applyMatrix4(car.body.matrixWorld);
  for (const w of car.wheels) { w.spin.rotation.x += (vf * dt) / w.r; if (w.front) w.pivot.rotation.y = S.steer; }

  if (actx) {
    const gear = Math.min(4, Math.floor(rpm * 5)), f = 30 + (rpm * 5 - gear) * 45 + gear * 4 + (throttle ? 6 : 0);
    engA.frequency.setTargetAtTime(f, actx.currentTime, 0.1);
    engB.frequency.setTargetAtTime(f / 2, actx.currentTime, 0.1);
    engG.gain.setTargetAtTime(0.05 + rpm * 0.04 + (throttle ? 0.02 : 0), actx.currentTime, 0.1);
    bladeG.gain.setTargetAtTime(rpm * 0.08, actx.currentTime, 0.2);        // wind + tyre roar
  }
  return vf;
}

const tmp = new THREE.Vector3(), look = new THREE.Vector3(), qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const qSway = new THREE.Quaternion(), eSway = new THREE.Euler();
function updateCamera(dt, vf) {
  if (camMode === 0) {
    if (camera.fov !== T.fov) { camera.fov = T.fov; camera.updateProjectionMatrix(); }
    driver.eyeWorld(camera.position);
    driver.headQuatWorld(camera.quaternion).multiply(qFlip);
    const d = S.drunk;
    if (d > 0.02) camera.quaternion.multiply(qSway.setFromEuler(eSway.set(Math.sin(clock * 0.7) * 0.05 * d, Math.sin(clock * 0.53) * 0.07 * d, Math.sin(clock * 0.8) * 0.1 * d)));
  } else {
    S.camTh += angDiff(S.th, S.camTh) * Math.min(1, T.camLag * dt);
    const a = S.camTh + S.yaw, cx = Math.sin(a), cz = Math.cos(a);
    tmp.set(S.x - cx * T.camDist, T.camHeight - S.look * 2, S.z - cz * T.camDist);
    look.set(S.x + Math.sin(S.camTh) * 3, 1.0, S.z + Math.cos(S.camTh) * 3);
    camera.position.lerp(tmp, Math.min(1, 10 * dt));
    camera.up.set(0, 1, 0); camera.lookAt(look);
    const fov = 60 + Math.abs(vf) * 0.5;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt); camera.updateProjectionMatrix(); }
  }
  if (S.shake > 0) { camera.position.x += (Math.random() - 0.5) * S.shake; camera.position.y += (Math.random() - 0.5) * S.shake; S.shake = Math.max(0, S.shake - dt * 0.5); }
  if (debugCam) { camera.position.copy(debugCam.p).applyMatrix4(car.body.matrixWorld); camera.lookAt(debugCam.t.clone().applyMatrix4(car.body.matrixWorld)); }
}
let debugCam = null;   // headless checks: camera placed in car-body coordinates

// Dynamic resolution: drop render scale when frames run long, creep back up when there's headroom.
let resAcc = 0, resN = 0, resGood = 0;
function adaptResolution(dt) {
  resAcc += dt; resN++;
  if (resAcc < 1) return;
  const avg = resAcc / resN; resAcc = 0; resN = 0;
  let next = resScale;
  if (avg > 1 / 50) { next = Math.max(0.5, resScale - 0.1); resGood = -7; }
  else if (avg < 1 / 58 && ++resGood >= 3) { next = Math.min(MAX_RES, resScale + 0.05); resGood = 0; }
  if (next !== resScale) { resScale = next; renderer.setPixelRatio(resScale); composer.setPixelRatio(resScale); composer.setSize(innerWidth, innerHeight); }
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}
function tick(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = Math.max(last, now); clock += dt;
  const vf = step(dt);
  driver.update(dt, { steerAngle: S.steer * 3.2, yaw: S.yaw, pitch: S.look, firstPerson: camMode === 0,
    deck: { on: false }, jolt: S.jolt || 0 });
  if (driver.cigarLit && (S.wisp = (S.wisp ?? 0) - dt) <= 0) {
    S.wisp = 0.3;
    puffSmoke(driver.emberWorld(v3), v3b.set(0, 0.25, 0), 0.03, 1, { life: 1.8, s0: 0.015, s1: 0.12, a: 0.25 });
  }
  S.drunk = Math.max(0, S.drunk - dt * 0.004);
  {  // when both the carrier and the cigar box run dry, the car restocks itself a few seconds later
    const st = driver.st;
    if (!driver.busy && st.beers === 0 && st.bottleState === 'none' && st.cigars === 0 && st.cigState !== 'hand' && (S.restock += dt) > 3) {
      S.restock = 0; for (let i = 0; i < 6; i++) driver.addBeer(); for (let i = 0; i < 3; i++) driver.addCigar();
      say('Restocked: 6 beers, 3 cigars', 2.5);
    }
  }
  // drunk: hiccups, and past ~0.3 the HUD itself starts to lean
  if (S.drunk > 0.3 && (S.hicT = (S.hicT ?? 5) - dt) <= 0) { S.hicT = 3 + Math.random() * 7 / S.drunk; SFX.hic(); S.shake = Math.max(S.shake, 0.02 * S.drunk); say('*hic*', 0.7); }
  $('hud').style.transform = S.drunk > 0.2 ? `rotate(${(Math.sin(clock * 0.9) * S.drunk * 3).toFixed(2)}deg)` : '';
  updateSmoke(dt); updateShards(dt);
  updateCamera(dt, vf);
  world.update(S.x, S.z, camera);
  camera.updateMatrixWorld();
  adaptResolution(dt);
  hud(vf);
  if (S.msgT > 0 && (S.msgT -= dt) <= 0) $('msg').style.opacity = 0;
  const dAmt = Math.min(1, Math.max(0, (S.drunk - 0.12) / 0.9));
  if (dAmt > 0) { drunkPass.uniforms.uAmt.value = dAmt; drunkPass.uniforms.uTime.value = clock; composer.render(); }
  else renderer.render(scene, camera);
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
// Warm-up behind the title screen: draw EVERYTHING once (hidden props, off-screen objects, the drunk
// post chain) so shader compiles and texture uploads don't land as a hitch the first time you smoke or get drunk.
function warmUp() {
  const shown = [], culled = [];
  scene.traverse((o) => { if (!o.visible) { shown.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  renderer.render(scene, camera);
  drunkPass.uniforms.uAmt.value = 1; composer.render();
  for (const o of shown) o.visible = false;
  for (const o of culled) o.frustumCulled = true;
}
warmUp();
requestAnimationFrame(frame);
// debug handle for headless checks; step(n, dt) advances the game when rAF is paused (hidden tab)
window.__car = { S, T, keys, car, driver, world, camera, renderer, setCam: (m) => { camMode = m; },
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(last + dt * 1000); },
  cam: (p, t) => { debugCam = p ? { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) } : null; } };
