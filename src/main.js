import * as THREE from 'three';
import { heightAt, buildWorld } from './road.js';
import { buildCar } from './car.js';
import { buildDriver } from './driver.js';
import { loadAssets } from './assets.js';
import { buildGod } from './god.js';
import { buildHitchhikers } from './hitchhikers.js';
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

// ---- drunk vision (buzz 0..4) ----------------------------------------------------------------
// uAmt (buzz ~0.1-1): wobble, double vision, edge smear, tunnel vignette.
// uTrip (buzz 1.5-3): stronger warp, breathing zoom, colour fringes, hue cycling.
// uKal: mirror-world episodes, uBlack: blackouts (both buzz 2.5+, driven by drunkEpisodes()).
const DRUNK_MAX = 4;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const drunkPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 }, uTime: { value: 0 }, uTrip: { value: 0 }, uKal: { value: 0 }, uBlack: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmt, uTime, uTrip, uKal, uBlack; varying vec2 vUv;
    vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
    void main() {
      float a = uAmt, t = uTrip;
      vec2 uv = vUv;
      if (uKal > 0.5) uv.x = 0.5 + abs(uv.x - 0.5);                                     // the world folds in half
      uv = (uv - 0.5) * (1.0 - 0.05 * t * sin(uTime * 2.1)) + 0.5;                      // breathing
      uv += vec2(sin(uv.y * 7.0 + uTime * 1.3), cos(uv.x * 5.0 + uTime * 1.1)) * (0.009 * a + 0.025 * t);
      vec2 off = vec2(sin(uTime * 0.7), cos(uTime * 0.93) * 0.4) * (0.035 * a + 0.05 * t);   // the world splits in two
      vec4 c = mix(texture2D(tDiffuse, uv), texture2D(tDiffuse, uv + off), 0.45 * clamp(a * 1.6, 0.0, 1.0));
      vec2 d = vUv - 0.5;
      c = mix(c, (texture2D(tDiffuse, uv - d * 0.03 * a) + texture2D(tDiffuse, uv - d * 0.06 * a)) * 0.5, 0.5 * a);   // smear toward the edges
      c.r = mix(c.r, texture2D(tDiffuse, uv + d * 0.03).r, t);                          // colour fringes
      c.b = mix(c.b, texture2D(tDiffuse, uv - d * 0.03).b, t);
      c.rgb = mix(c.rgb, hue(c.rgb, uTime * 1.7 + length(d) * 7.0), 0.65 * t);           // everything goes rainbow
      c.rgb *= 1.0 - smoothstep(0.2, 0.85 - 0.25 * t, length(d)) * 0.75 * a;           // tunnel vision
      c.rgb *= 1.0 - uBlack;
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
let actx, master, engA, engB, engG, bladeG, noiseBuf, squealG, squealBP, squealOsc, muted = false;
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
    // tyre squeal: narrow-band noise plus a thin whistle, both swept by how hard the tyres are sliding
    squealG = actx.createGain(); squealG.gain.value = 0; squealG.connect(master);
    squealBP = actx.createBiquadFilter(); squealBP.type = 'bandpass'; squealBP.frequency.value = 1900; squealBP.Q.value = 9;
    const sn = actx.createBufferSource(); sn.buffer = noiseBuf; sn.loop = true;
    const snG = actx.createGain(); snG.gain.value = 3;
    sn.connect(squealBP).connect(snG).connect(squealG); sn.start();
    squealOsc = actx.createOscillator(); squealOsc.type = 'triangle'; squealOsc.frequency.value = 1850;
    const soG = actx.createGain(); soG.gain.value = 0.12; squealOsc.connect(soG).connect(squealG); squealOsc.start();
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
  chirp: (v) => { tone(2300 + Math.random() * 500, 1850, 0.012 + v * 0.03, 0.09); burst('bandpass', 2300, 0.015 + v * 0.04, 0.12, 5); },
  gear: () => { tone(150, 95, 0.14, 0.09); burst('lowpass', 500, 0.12, 0.08, 2); setTimeout(() => tone(230, 170, 0.06, 0.05), 70); },
  boom: () => { burst('lowpass', 160, 0.9, 1.8, 0.7); tone(80, 28, 0.6, 1.4); burst('bandpass', 900, 0.35, 0.7, 0.6); setTimeout(() => burst('lowpass', 400, 0.25, 2.5, 0.5), 150); },
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
function puffSmoke(pos, vel, spread, n, { life = 2.5, s0 = 0.05, s1 = 0.5, a = 0.45, color = 0xdedbd6 } = {}) {
  for (let i = 0; i < n; i++) {
    const p = smoke[smokeHead++ % smoke.length];
    p.s.position.copy(pos); p.s.visible = true; p.s.material.color.set(color);
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
  onSip: (amount) => { SFX.gulp(); S.drunk = Math.min(DRUNK_MAX, S.drunk + amount * 0.6); },
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

// ---- hitchhikers on the shoulder (cloned from the driver's avatar before the hem clip is put on it) ----
const HIT_LINES = ['THUNK!', 'Going his way!', 'He wanted a lift...', 'Airmail!', 'Sorry, full up!'];
const hikers = buildHitchhikers(scene, assets.avatar, world.track, {
  onHit: (pos, speed) => {
    SFX.thump(speed); burst('lowpass', 260, 0.5, 0.35, 1.5);
    SFX.voice(240, 480, 0.35, [[750, 5], [1150, 6]], 0.14); setTimeout(() => SFX.voice(520, 180, 0.7, [[700, 5], [1100, 6]], 0.12), 330);
    S.shake = Math.max(S.shake, 0.08); say(HIT_LINES[(Math.random() * HIT_LINES.length) | 0], 1.4);
  },
  onBounce: (pos, v) => { SFX.thump(v * 1.5); puffSmoke(pos.clone().setY(0.1), v3b.set(0, 0.3, 0), 0.6, 4, { life: 1.2, s0: 0.15, s1: 0.8, a: 0.35, color: 0x9a8a70 }); },
});

// ---- God: Alt+F+4 summons Him; He keeps pace in front of the car and restocks you through the roof ----
const holyLight = new THREE.PointLight(0xfff4dc, 0, 45, 1.2); scene.add(holyLight);    // added up-front so no shader recompiles later
const god = buildGod(scene, assets.avatar, holyLight, {
  say: (t, s) => say(t, s),
  onSummon: () => { SFX.choir(); S.shake = 0.03; },
  onLeave: () => { const st = driver.st; if (st.bottleState !== 'none') st.fill = 1; if (st.cigState === 'hand') { st.cigLen = 0.14; st.ash = 0.004; } },
  onThrow: () => SFX.whoosh(),
  onLand: () => SFX.clonk(2),
  makeBottle: () => driver.makeBottle(),
  makeCigar: () => driver.makeCigar(),
  beerSlot: (i) => driver.beerSlot(i),
  cigarSlot: (i) => driver.cigarSlot(i),
  beerSlotsFilled: () => driver.st.beers,
  cigarSlotsFilled: () => driver.st.cigars,
  addBeer: () => driver.addBeer(),
  addCigar: () => driver.addCigar(),
});
let flashAmt = 0;
const flash = (a) => { flashAmt = a; };
const summonGod = () => god.summon(new THREE.Vector3(S.x, 0, S.z), S.th, heightAt, () => S);
// The shirt's hem hangs ~0.3 m below the hips: on the tractor the tall seat hid it, in the Camaro it pokes
// out under the floor pan. Clip it at the seat cushion (plane follows the car body every frame).
const hemBase = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.42), hem = hemBase.clone();
renderer.localClippingEnabled = true;
car.cabin.traverse((o) => { if (o.name === 'Wolf3D_Outfit_Top') o.material.clippingPlanes = [hem]; });

// ---- state ------------------------------------------------------------------
const S = {};
function resetState() {
  Object.assign(S, { dist: 0, beatBest: false, crashT: 0, x: 1.7, z: 0, th: 0, vx: 0, vz: 0, steer: 0, yawRate: 0, pitch: 0, roll: 0, camTh: 0, shake: 0, msgT: 0, drunk: 0, yaw: 0, look: -0.34, restock: 0,
    s: 0, lat: 1.7, ri: undefined, sPrev: undefined, drift: 0, gear: 1, shiftFrom: 1, shiftT: 0, rpm: 800, lurch: 0, chirpT: 0, tyreT: 0 });
  $('msg').style.opacity = 0;
}
resetState();

// ---- the goal: miles down the road without crashing; best run kept in the browser ----
// (v2: v1 bests were set on the old straight road)
const BEST_KEY = 'beercar.best.v2';
let best = 0;
try { best = Number(JSON.parse(localStorage.getItem(BEST_KEY))) || 0; } catch { /* private mode */ }
const saveBest = () => { try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* storage blocked */ } };
const miles = (m) => (m / 1609.34).toFixed(2);
function endRun() {
  if (S.dist > 50) say(S.beatBest ? `NEW BEST: ${miles(S.dist)} mi!` : `Run over: ${miles(S.dist)} mi (best ${miles(best)})`, 3);
  saveBest(); S.dist = 0; S.beatBest = false;
}
function goal() {
  if (S.dist > best) {
    if (!S.beatBest && best > 50) say('NEW BEST!', 2);
    best = S.dist; S.beatBest = true;
  }
  $('goalRun').textContent = miles(S.dist); $('goalBest').textContent = miles(best);
}
addEventListener('pagehide', saveBest);

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
function showMenu() {
  $('overlay').style.display = 'grid'; saveBest();
  if (document.pointerLockElement) document.exitPointerLock();
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (overlayUp()) {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Digit1' || e.code === 'Numpad1') startGame();
    return;
  }
  if (e.code === 'Escape') { showMenu(); return; }
  if (e.altKey && e.code === 'KeyF') e.preventDefault();          // don't open the browser menu
  if (e.altKey && e.code === 'Digit4' && keys.has('KeyF')) { e.preventDefault(); summonGod(); }   // Alt+F+4: God on demand
  if (e.code === 'KeyC') camMode = (camMode + 1) % 2;
  if (e.code === 'KeyG') { S.auto = !S.auto; say(S.auto ? 'Autopilot ON: it drives, you drink (W A S D takes over)' : 'Autopilot off', 2); }
  if (e.code === 'KeyT') setTimeScale(timeScale >= 8 ? 1 : timeScale * 2);
  if (e.code === 'KeyR') { endRun(); resetState(); }
  if (e.code === 'KeyH') $('hints').classList.toggle('faded');
  if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 1; }
  if (e.code === 'Backquote') driver.start('beer');
  if (e.code === 'KeyQ') driver.start('cigar');
  if (e.code === 'Space' || e.code === 'Backquote') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('speedBtn').addEventListener('click', () => setTimeScale(timeScale >= 8 ? 1 : timeScale * 2));
$('playYou').addEventListener('click', () => startGame());
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
  $('buzz').firstElementChild.style.width = Math.min(100, (S.drunk / DRUNK_MAX) * 100) + '%';
  $('gear').textContent = S.gear === 0 ? 'R' : S.gear;
  $('mph').textContent = S.drunk > 2.5 && Math.sin(clock * 3.1) > 0.4 ? '??' : Math.round(Math.abs(vf) * 2.237 * (1 + (S.drunk > 1.5 ? Math.sin(clock * 5) * 0.3 : 0)));
}

// ---- simulation -------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let last = performance.now(), clock = 0;

// crashing: anything solid -> fireball, the car's gone for a moment, then it respawns in the lane
function crash(what) {
  S.crashT = 1.8; S.shake = 0.35;
  SFX.boom();
  for (let k = 0; k < 14; k++) {                                            // fireball: hot core, flames thrown out
    const p = v3.set(S.x + (Math.random() - 0.5) * 2.5, 0.4 + Math.random() * 1.6, S.z + (Math.random() - 0.5) * 3.5);
    puffSmoke(p, v3b.set(0, 1.5, 0), 4, 2, { life: 0.35 + Math.random() * 0.3, s0: 0.4, s1: 2.2, a: 1, color: 0xffe070 });
    puffSmoke(p, v3b.set(0, 3, 0), 11, 3, { life: 0.7 + Math.random() * 0.6, s0: 0.3, s1: 2.6, a: 0.95, color: k % 2 ? 0xff5a10 : 0xff9a20 });
  }
  puffSmoke(v3.set(S.x, 1.2, S.z), v3b.set(0, 3.5, 0), 3.5, 40, { life: 4, s0: 0.8, s1: 5, a: 0.7, color: 0x2a2522 });   // black smoke
  car.root.visible = false;
  say(`BOOM! Hit a ${what}`, 2);
  setTimeout(endRun, 0);
}
function respawn() {                                                        // back in the lane where it happened; keeps the buzz and the distance
  const p = world.track.at(S.s || 0), lat = 1.7;
  Object.assign(S, { crashT: 0, x: p.x + Math.cos(p.h) * lat, z: p.z - Math.sin(p.h) * lat, th: p.h, vx: 0, vz: 0, steer: 0, yawRate: 0, camTh: p.h, drift: 0, ri: undefined, sPrev: undefined });
  car.root.visible = true;
}

// ---- gearbox: an automatic 4-speed you can see and hear (the stick moves, the driver's hand works it) ----
const GEARS = [12, 21, 30, 40];                                              // top speed (m/s) in 1st..4th
const GATE = [[1.7, 1], [1, 1], [1, -1], [-1, 1], [-1, -1]];                // shifter gate (left, forward) for R, 1..4
const SHIFT_T = 0.4;
const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
function shift(to) {
  S.shiftFrom = S.gear; S.gear = to; S.shiftT = SHIFT_T;
  SFX.gear();
  driver.shift();
  if (to > S.shiftFrom && S.shiftFrom > 0) S.lurch = 0.02;                  // the car sits back as the next gear bites
}
function gearbox(dt, vf, throttle) {
  const v = Math.abs(vf);
  if (S.shiftT > 0) S.shiftT = Math.max(0, S.shiftT - dt);
  else if (vf < -0.3 && throttle < 0 && S.gear !== 0) shift(0);           // only when you're backing up, not bounced back
  else if (S.gear === 0 && vf > -0.1 && throttle > 0) shift(1);
  else if (S.gear > 0) {
    const r = 800 + (v / GEARS[S.gear - 1]) * 5200;
    if (r > 5400 && S.gear < 4 && throttle > 0) shift(S.gear + 1);
    else if (r < 2000 && S.gear > 1) shift(S.gear - 1);
  }
  let rpm = Math.min(6300, 800 + (v / (S.gear === 0 ? 8 : GEARS[S.gear - 1])) * 5200);
  if (S.gear === 1 && throttle > 0 && v < 4) rpm = Math.max(rpm, 2600);     // slipping the clutch off the line
  if (S.drift > 0.3 && throttle > 0) rpm = Math.min(6300, rpm + 1200 * S.drift);   // wheelspin
  if (S.shiftT > 0) rpm *= 0.78;
  S.rpm += (rpm - S.rpm) * Math.min(1, 12 * dt);
  // the stick: out of the old gate to neutral, across, into the new gate
  const u = 1 - S.shiftT / SHIFT_T, a = GATE[S.shiftFrom], b = GATE[S.gear];
  car.shifter.set(a[0] + (b[0] - a[0]) * smooth01((u - 0.35) / 0.25), a[1] * (1 - smooth01(u / 0.35)) + b[1] * smooth01((u - 0.6) / 0.4));
}

// G: the car drives itself (sober, whatever you've had): holds the lane 1.7 m left of the centre by aiming
// at a point on it a little way ahead, and slows for the tightest bend coming up. Touch W/A/S/D to take over.
function autopilot(f, vf) {
  // Stanley lane-keeping (the classic self-driving-car controller): the bend's own steering angle, minus the
  // heading error, plus the lane offset scaled down with speed
  const tr = world.track, v = Math.abs(vf), sF = f.s + 1.4;                 // measured at the front axle
  const kRoad = (tr.at(sF + v * 0.15 + 2).h - tr.at(sF + v * 0.15 - 2).h) / 4;   // signed curvature, + = bends left
  const front = tr.at(sF), psi = angDiff(S.th, front.h);
  const delta = Math.atan(T.wheelbase * kRoad) - psi + Math.atan((1.5 * (1.7 - f.lat)) / (v + 1));
  const steer = clamp(delta / (T.steerMax / (1 + v * T.steerFalloff)), -1, 1);
  let k = 0;                                                                // sharpest curvature (1/radius) in the next few seconds
  for (let d = 0; d < 30 + v * 3; d += 4) k = Math.max(k, Math.abs(tr.at(f.s + d + 4).h - tr.at(f.s + d).h) / 4);
  const vWant = Math.min(T.maxFwd * 0.9, Math.sqrt((T.latG * 0.7) / Math.max(k, 1e-4)));
  return [clamp((vWant - vf) * 0.5, -1, 1), steer];
}

function step(dt) {
  if (S.crashT > 0) { if ((S.crashT -= dt) <= 0) respawn(); return 0; }
  let throttle = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
  let steerIn = (down('KeyA', 'ArrowLeft') ? 1 : 0) - (down('KeyD', 'ArrowRight') ? 1 : 0);
  const handbrake = down('Space');                                          // locks the rears
  let vf = S.vx * Math.sin(S.th) + S.vz * Math.cos(S.th);                   // forward speed coming into this step
  // where the car is on the road: s along it, lat metres left of the centre
  const f = world.track.frame(S.x, S.z, S.ri);
  S.ri = f.i; S.s = f.s; S.lat = f.lat;
  if (S.auto && (throttle || steerIn)) { S.auto = false; say('You have control', 1.5); }
  if (S.auto) [throttle, steerIn] = autopilot(f, vf);
  if (S.invT > 0 && !S.auto) steerIn = -steerIn;                            // which way is left?
  if (S.drunk > 0.05 && !S.auto) steerIn = clamp(steerIn + Math.min(0.7, S.drunk * 0.22) * Math.sin(clock * 0.6 + Math.sin(clock * 0.23) * 3), -1, 1);

  // drift (arcade): the handbrake, or stamping on the brake into a bend, lets the back end go; it then
  // holds for as long as you stay on the gas and keep steering, and tidies itself up when you stop
  let dWant = 0;
  if (handbrake && Math.abs(vf) > 6) dWant = 1;
  else if (!S.auto && throttle < 0 && vf > 12 && Math.abs(steerIn) > 0.5) dWant = 0.8;
  else if (S.drift > 0.15 && throttle > 0 && steerIn && Math.abs(vf) > 6) dWant = 0.7;
  const drift0 = S.drift;
  S.drift += (dWant - S.drift) * Math.min(1, (dWant > S.drift ? 6 : 1.8) * dt);
  if (drift0 < 0.4 && S.drift >= 0.4) SFX.chirp(1);

  // steering: the body yaws first, then the tyres drag the velocity round after it (less so in a drift)
  const lock = T.steerMax / (1 + Math.abs(vf) * T.steerFalloff);
  const want = steerIn * lock, dSt = T.steerRate * dt;
  S.steer += clamp(want - S.steer, -dSt, dSt);
  if (!steerIn) S.steer *= Math.exp(-5 * dt);
  const kick = handbrake ? steerIn * 1.3 * Math.sign(vf) : 0;               // a yanked handbrake swings the tail
  const kin = ((vf * Math.tan(S.steer)) / T.wheelbase) * (1 + 1.7 * S.drift) + kick;
  const cap = (T.latG * (1 + 2.2 * S.drift)) / Math.max(1, Math.abs(vf)) + Math.abs(kick);
  S.yawRate = (S.yawRate || 0) + (clamp(kin, -cap, cap) - (S.yawRate || 0)) * Math.min(1, T.yawResp * dt);
  S.th += S.yawRate * dt;
  const nx = Math.sin(S.th), nz = Math.cos(S.th);
  vf = S.vx * nx + S.vz * nz;
  let latx = S.vx - nx * vf, latz = S.vz - nz * vf;
  const vf0 = vf, slip = Math.atan2(Math.hypot(latx, latz), Math.abs(vf) + 0.01);
  if (slip > 0.96) S.yawRate *= Math.exp(-6 * dt);                          // ~55 deg is as sideways as it gets

  // longitudinal: power fades toward top speed; coast = rolling + air drag; no drive while a gear goes in
  const power = S.shiftT > 0 && S.gear > S.shiftFrom ? 0 : 1;
  if (throttle) {
    const opposing = throttle * vf < -0.05;
    vf += throttle * (opposing ? T.brake : T.accel * power * Math.max(0.1, 1 - Math.abs(vf) / T.maxFwd)) * dt;
  } else {
    const f2 = (T.coast + T.drag * vf * vf) * dt;
    vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2;
  }
  if (handbrake) { const f2 = 7 * dt; vf = Math.abs(vf) <= f2 ? 0 : vf - Math.sign(vf) * f2; }
  // lateral grip; in a drift most of the sideways speed the tyres scrub off is handed back as forward speed
  const lat0 = Math.hypot(latx, latz), g = Math.exp(-T.grip * (1 - 0.85 * S.drift) * dt);
  latx *= g; latz *= g;
  if (S.drift > 0 && vf) vf += Math.sign(vf) * lat0 * (1 - g) * 0.7 * S.drift;
  vf = clamp(vf, -T.maxRev, T.maxFwd);
  gearbox(dt, vf, throttle);

  S.vx = nx * vf + latx; S.vz = nz * vf + latz;
  S.x += S.vx * dt; S.z += S.vz * dt;
  const ds = f.s - (S.sPrev ?? f.s); S.sPrev = f.s;                         // progress along the road
  if (ds > 0 && ds < 10 && Math.abs(f.lat) < 15) S.dist += ds;
  for (const d of [1.3, -1.2]) {                                            // nose and tail circles vs trees / posts / poles / signs
    const hit = world.obstacleAt(S.x + nx * d, S.z + nz * d, 0.8);
    if (!hit) continue;
    if (Math.hypot(S.vx, S.vz) > 4.47) { crash(hit); return 0; }            // over 10 mph: fireball
    // a nudge: back out of it and bounce off, no explosion
    S.x -= S.vx * dt; S.z -= S.vz * dt; S.vx *= -0.3; S.vz *= -0.3; vf *= -0.3;
    if (!(S.bumpT > 0)) { S.bumpT = 0.5; SFX.thump(4); S.shake = Math.max(S.shake, 0.04); say(`Bumped a ${hit}`, 1); }
    break;
  }
  S.bumpT = (S.bumpT || 0) - dt;
  if (hikers.hit([[S.x + nx * 1.3, S.z + nz * 1.3, 0.8], [S.x, S.z, 0.8]], S.vx, S.vz)) { S.vx *= 0.9; S.vz *= 0.9; }
  const omega = S.yawRate;

  // pose + jolt for the cigar ash (hard throttle/brake, cornering, road rumble)
  const accelNow = (vf - vf0) / Math.max(dt, 1e-3);
  S.jolt = Math.abs(accelNow) * 0.5 + Math.abs(omega * vf) * 0.4 + S.shake * 200 + Math.abs(vf) * 0.04;
  S.pitch += (clamp(-accelNow * 0.0025, -0.02, 0.02) - S.pitch) * Math.min(1, 10 * dt);
  S.roll += (clamp(-omega * vf * 0.0018, -0.03, 0.03) - S.roll) * Math.min(1, 10 * dt);
  const rpm = Math.abs(vf) / T.maxFwd;
  const buzz = Math.sin(clock * 70) * 0.0012 * (0.4 + rpm) + Math.sin(clock * 9) * 0.0008 * rpm;
  car.root.position.set(S.x, 0, S.z);
  car.root.rotation.y = S.th;
  S.lurch *= Math.exp(-6 * dt);
  car.body.rotation.set(S.pitch + buzz - S.lurch, 0, S.roll);
  car.body.position.y = buzz * 0.5;
  car.body.updateMatrixWorld(); hem.copy(hemBase).applyMatrix4(car.body.matrixWorld);
  for (const w of car.wheels) { w.spin.rotation.x += (vf * dt) / w.r; if (w.front) w.pivot.rotation.y = S.steer; }

  // tyres: squeal with the slide (or a locked handbrake), little chirps on top, smoke off the rear wheels
  const squeal = Math.max(Math.abs(vf) > 4 ? clamp((slip - 0.1) / 0.5, 0, 1) : 0, handbrake && Math.abs(vf) > 3 ? 0.6 : 0);
  if (squeal > 0.15 && (S.chirpT -= dt) <= 0) { S.chirpT = 0.12 + Math.random() * 0.3; SFX.chirp(squeal * 0.5); }
  if (squeal > 0.25 && (S.tyreT -= dt) <= 0) {
    S.tyreT = 0.07;
    for (const w of car.wheels) if (!w.front) {
      w.pivot.getWorldPosition(v3); v3.y = 0.2;
      puffSmoke(v3, v3b.set(S.vx * 0.15, 0.4, S.vz * 0.15), 0.8, 1, { life: 1.8, s0: 0.25, s1: 1.6 + squeal, a: 0.22 + squeal * 0.15, color: 0xd8d4ce });
    }
  }
  if (actx) {
    const t = actx.currentTime, f = 22 + (S.rpm / 6000) * 88;
    engA.frequency.setTargetAtTime(f, t, 0.05);
    engB.frequency.setTargetAtTime(f / 2, t, 0.05);
    engG.gain.setTargetAtTime(0.04 + (S.rpm / 6000) * 0.05 + (throttle > 0 && power ? 0.025 : 0), t, 0.08);
    bladeG.gain.setTargetAtTime(rpm * 0.08, t, 0.2);                       // wind + tyre roar
    squealG.gain.setTargetAtTime(squeal * 0.07, t, 0.05);
    squealBP.frequency.setTargetAtTime(1600 + squeal * 900 + Math.sin(clock * 23) * 60, t, 0.05);
    squealOsc.frequency.setTargetAtTime(1750 + squeal * 700 + Math.sin(clock * 31) * 40, t, 0.05);
  }
  return vf;
}

const tmp = new THREE.Vector3(), look = new THREE.Vector3(), qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const qSway = new THREE.Quaternion(), eSway = new THREE.Euler();
function updateCamera(dt, vf) {
  if (camMode === 0) {
    if (camera.fov !== T.fov) { camera.fov = T.fov; camera.updateProjectionMatrix(); }
    driver.eyeWorld(camera.position); driver.headQuatWorld(camera.quaternion).multiply(qFlip);
    const d = Math.min(S.drunk, 2.6);
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

// The really drunk stuff, past a buzz of ~2: blackouts, mirror-world, steering that swaps sides, throwing up.
function drunkEpisodes(dt) {
  const d = S.drunk;
  S.kalT = Math.max(0, (S.kalT || 0) - dt); S.invT = Math.max(0, (S.invT || 0) - dt);
  if (S.blackT > 0) { S.blackT -= dt; S.black = Math.sqrt(Math.sin(Math.min(1, Math.max(0, 1 - S.blackT / 1.4)) * Math.PI)); } else S.black = 0;
  if (d < 2) return;
  const roll = (rate) => Math.random() < rate * dt * (d - 1.8);
  if (d > 2.5 && !(S.blackT > 0) && roll(0.05)) { S.blackT = 1.4; say('...', 1); }
  if (d > 3 && !(S.kalT > 0) && roll(0.04)) { S.kalT = 2 + Math.random() * 2; say('Is that... two roads?', 2); }
  if (d > 2.2 && !(S.invT > 0) && roll(0.03)) { S.invT = 2.5 + Math.random() * 2.5; say('WHICH WAY IS LEFT?!', 2); }
  if (d > 3.2 && roll(0.025)) {                                             // chunder: sobers you up a little
    SFX.burp(); setTimeout(() => SFX.cough(), 400); say('*BLEURGH*', 1.5); S.shake = 0.06; S.drunk -= 0.4;
    const dir = v3b.set(-0.6, -0.2, 1).applyQuaternion(driver.headQuatWorld(qTmp)).multiplyScalar(2);
    puffSmoke(driver.mouthWorld(v3), dir, 0.4, 24, { life: 1.6, s0: 0.03, s1: 0.25, a: 0.85, color: 0x9bb83a });
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}
let timeScale = 1;                                                          // G: 1x / 2x / 4x / 8x game speed
function setTimeScale(k) {
  timeScale = k; $('speedBtn').textContent = `▶ ${k}x`;
  say(k > 1 ? `Speed ${k}x` : 'Normal speed', 2);
}
function tick(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = Math.max(last, now);
  let vf = 0;
  for (let k = 0; k < timeScale; k++) { clock += dt; vf = sim(dt); }
  render(dt, vf);
}
function sim(dt) {
  const vf = overlayUp() ? 0 : step(dt);
  driver.update(dt, { steerAngle: S.steer * 3.2, yaw: S.yaw, pitch: S.look, firstPerson: camMode === 0,
    deck: { on: false }, jolt: S.jolt || 0 });
  if (driver.cigarLit && (S.wisp = (S.wisp ?? 0) - dt) <= 0) {
    S.wisp = 0.3;
    puffSmoke(driver.emberWorld(v3), v3b.set(0, 0.25, 0), 0.03, 1, { life: 1.8, s0: 0.015, s1: 0.12, a: 0.25 });
  }
  S.drunk = Math.max(0, S.drunk - dt * 0.006);
  drunkEpisodes(dt);
  god.update(dt, flash);
  $('holy').style.opacity = flashAmt.toFixed(3);
  renderer.toneMappingExposure = 1 + flashAmt * 2.5;
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
  hikers.update(dt, S.s);
  updateSmoke(dt); updateShards(dt);
  return vf;
}
function render(dt, vf) {
  updateCamera(dt, vf);
  world.update(S.x, S.z, camera);
  camera.updateMatrixWorld();
  adaptResolution(dt);
  hud(vf); goal();
  if (S.msgT > 0 && (S.msgT -= dt) <= 0) $('msg').style.opacity = 0;
  const U = drunkPass.uniforms, dAmt = Math.min(1, Math.max(0, (S.drunk - 0.12) / 0.9));
  U.uTrip.value = Math.min(1, Math.max(0, (S.drunk - 1.5) / 1.5)); U.uKal.value = S.kalT > 0 ? 1 : 0; U.uBlack.value = S.black || 0;
  if (dAmt > 0 || U.uBlack.value > 0) { U.uAmt.value = dAmt; U.uTime.value = clock; composer.render(); }
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
window.__car = { S, T, keys, car, driver, world, god, hikers, summonGod, camera, renderer, startGame, showMenu, setTimeScale, setCam: (m) => { camMode = m; },
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(last + dt * 1000); },
  cam: (p, t) => { debugCam = p ? { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) } : null; } };
