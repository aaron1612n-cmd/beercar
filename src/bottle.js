// A 650 ml green longneck: lathed glass, label + neck band, crown cap, and
// beer inside whose surface stays level in the world as the bottle tips
// (the liquid shader discards above a world-space plane; the plane height is
// found by filling the bottle's slices from the lowest up). Origin = base
// centre, +Y = up the bottle.
import * as THREE from 'three';
import { canvasTex } from './car.js';

// outer profile: [radius, y] in metres
const PROFILE = [[0.0, 0.0], [0.029, 0.0], [0.0355, 0.004], [0.0365, 0.012], [0.0365, 0.165], [0.0355, 0.178], [0.031, 0.194],
  [0.024, 0.207], [0.0185, 0.218], [0.016, 0.228], [0.0148, 0.255], [0.0138, 0.274], [0.0146, 0.277], [0.0146, 0.283], [0.0128, 0.287]];
export const BOTTLE_H = 0.287, NECK_Y = 0.236;
export function bottleRadius(y) {
  if (y < 0 || y > BOTTLE_H) return -1;
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, y1] = PROFILE[i];
    if (y <= y1) { const [r0, y0] = PROFILE[i - 1]; return r0 + (r1 - r0) * ((y - y0) / Math.max(1e-6, y1 - y0)); }
  }
  return 0.0128;
}

const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const label = canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#0e5e2c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8e4d6'; c.lineWidth = 5; c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.44, h * 0.44, 0, 0, 6.283); c.stroke();
    c.fillStyle = '#e8e4d6'; c.font = 'bold 22px Arial'; c.textAlign = 'center'; c.fillText('HEINEKEN ORIGINAL', w / 2, 52);
    // red star
    c.fillStyle = '#d6202a'; c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 11 : 26; c.lineTo(w / 2 + Math.cos(a) * r, 92 + Math.sin(a) * r); }
    c.closePath(); c.fill();
    // white banner with the name
    c.fillStyle = '#f4f2ea'; c.fillRect(w * 0.14, 122, w * 0.72, 62);
    c.fillStyle = '#0e5e2c'; c.font = 'bold italic 54px Georgia, serif'; c.fillText('Heineken', w / 2, 170);
    c.fillStyle = '#e8e4d6'; c.font = 'bold 20px Arial'; c.fillText('PURE MALT LAGER', w / 2, 214);
  });
  const neck = canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = '#0b0c0b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.font = 'bold 34px Arial'; c.textAlign = 'center'; c.fillText('650ml', w / 2, 44);
  });
  shared = {
    glassGeo: lathe(PROFILE, 48),
    liquidGeo: lathe(PROFILE.filter(([, y]) => y <= 0.272).map(([r, y]) => [Math.max(0, r - 0.0028), Math.max(0.004, y)]), 40),
    labelGeo: new THREE.CylinderGeometry(0.0371, 0.0371, 0.088, 48, 1, true, -1.35, 2.7),
    neckGeo: new THREE.CylinderGeometry(0.0166, 0.0172, 0.03, 32, 1, true, -1.2, 2.4),
    capGeo: new THREE.CylinderGeometry(0.0151, 0.0155, 0.007, 20),
    labelMat: new THREE.MeshStandardMaterial({ map: label, roughness: 0.45 }),
    neckMat: new THREE.MeshStandardMaterial({ map: neck, roughness: 0.4 }),
    capMat: new THREE.MeshStandardMaterial({ color: 0x1c6b35, roughness: 0.25, metalness: 0.85 }),
    glassMat: new THREE.MeshPhysicalMaterial({ color: 0x0e5a22, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.4 }),
  };
  // slices for the fill-level search: local centre heights + volumes
  shared.slices = [];
  for (let i = 0; i < 36; i++) {
    const y = 0.004 + ((i + 0.5) / 36) * 0.268, r = Math.max(0, bottleRadius(y) - 0.0028);
    shared.slices.push({ y, v: Math.PI * r * r });
  }
  shared.vol = shared.slices.reduce((a, s) => a + s.v, 0);
  return shared;
}

export function makeBottle() {
  const A = sharedAssets();
  const g = new THREE.Group();
  const mk = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // beer: amber, discarded above the world-space liquid plane; the inside faces show as the foamy surface
  const plane = { value: new THREE.Vector4(0, 1, 0, 0) }, foamU = { value: 0.004 };
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0x7a5410, roughness: 0.2, side: THREE.DoubleSide });
  liquidMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPlane = plane; sh.uniforms.uFoam = foamU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec4 uPlane; uniform float uFoam;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(uPlane.xyz, vWP) > uPlane.w) discard;')
      // foam: the top uFoam metres of beer (seen through the glass) and the surface itself
      .replace('#include <color_fragment>', `#include <color_fragment>
        float below = uPlane.w - dot(uPlane.xyz, vWP);
        float foam = gl_FrontFacing ? 1.0 - smoothstep(uFoam * 0.6, uFoam, below) : clamp(uFoam * 120.0, 0.55, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.94, 0.84), foam);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, foam);');
  };
  liquidMat.customProgramCacheKey = () => 'beer-liquid';
  const liquid = mk(A.liquidGeo, liquidMat);
  liquid.castShadow = false;
  const glass = mk(A.glassGeo, A.glassMat); glass.renderOrder = 2; glass.castShadow = true;
  mk(A.labelGeo, A.labelMat, 0.098);
  mk(A.neckGeo, A.neckMat, 0.24);
  const cap = mk(A.capGeo, A.capMat, BOTTLE_H - 0.001);

  const b = {
    group: g, cap, fill: 1, foam: 0.004, levelAboveLip: -1, slosh: new THREE.Vector2(), sloshV: new THREE.Vector2(),
    // keep the beer surface level (plus a little slosh) given the bottle's current world transform
    update(dt, accel) {
      g.updateWorldMatrix(true, false);
      const m = g.matrixWorld, e = m.elements;
      if (accel) {                                      // damped spring driven by the tractor's acceleration
        this.sloshV.x += (-40 * this.slosh.x - accel.x * 0.02) * dt; this.sloshV.y += (-40 * this.slosh.y - accel.z * 0.02) * dt;
        this.sloshV.multiplyScalar(Math.exp(-3 * dt)); this.slosh.addScaledVector(this.sloshV, dt);
      }
      // the head settles back to a thin film; sloshing whips a bit back up
      this.foam += (0.003 - this.foam) * (1 - Math.exp(-dt / 12)) + Math.min(0.02, this.sloshV.length() * 0.03) * dt;
      foamU.value = Math.min(0.02, this.foam) * Math.min(1, this.fill * 6);
      const n = new THREE.Vector3(this.slosh.x, 1, this.slosh.y).normalize();
      if (this.fill <= 0.001) { plane.value.set(n.x, n.y, n.z, -1e3); this.levelAboveLip = -1; return; }
      // heights of each slice along the plane normal, lowest first, filled until the volume runs out
      const target = this.fill * A.vol, hs = A.slices.map((s) => ({ h: n.x * (e[4] * s.y + e[12]) + n.y * (e[5] * s.y + e[13]) + n.z * (e[6] * s.y + e[14]), v: s.v }));
      hs.sort((p, q) => p.h - q.h);
      let acc = 0, level = hs[hs.length - 1].h;
      for (const s of hs) { acc += s.v; if (acc >= target) { level = s.h; break; } }
      plane.value.set(n.x, n.y, n.z, level);
      this.levelAboveLip = level - (n.x * (e[4] * BOTTLE_H + e[12]) + n.y * (e[5] * BOTTLE_H + e[13]) + n.z * (e[6] * BOTTLE_H + e[14]));
    },
    surfaceDist(worldPoint) {                           // for finger contact
      const l = g.worldToLocal(worldPoint.clone()), r = bottleRadius(l.y);
      return r < 0 ? 1 : Math.hypot(l.x, l.z) - r;
    },
  };
  return b;
}

// a bare bottle mesh (no liquid logic) for crates and litter
export function bottleMesh(withCap = true, fill = 1) {
  const b = makeBottle(); b.fill = fill; b.cap.visible = withCap; return b;
}
