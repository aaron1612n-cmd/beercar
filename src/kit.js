// Vehicle kit: build a machine out of ordinary three.js geometries, each tagged with a surface TYPE
// plus colour / roughness / metalness / clearcoat, then merge everything into ONE mesh. The kit
// material paints the wear per type procedurally in the shader (paint chipped to primer with rust
// halos, sun-faded dusty tops, mud + grass splashed up low, hairline scratches, pitted chrome,
// dusty rubber, cracked vinyl) and bumps the surface to match, so no textures are needed.
// Technique after Max Blade's "The Duke's Lawn" mower kit; this is our own implementation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const T = { PLAIN: 0, PAINT: 1, CHROME: 2, RUBBER: 3, VINYL: 4, STEEL: 5, LAMP: 6, MAT: 7, DECK: 8, TRIM: 9 };
export const kitUniforms = { uHeadGlow: { value: 0.6 }, uTailGlow: { value: 0.4 } };

const col = new THREE.Color();
export class Kit {
  constructor() { this.geos = []; }
  // o: { m: Matrix4, color, rough, metal, coat, type }
  add(geo, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (o.m) g.applyMatrix4(o.m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    col.set(o.color ?? 0x888888);
    const c = new Float32Array(n * 3), p = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
      p[i * 4] = o.rough ?? 0.5; p[i * 4 + 1] = o.metal ?? 0; p[i * 4 + 2] = o.coat ?? 0; p[i * 4 + 3] = o.type ?? T.PLAIN;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aPBR', new THREE.BufferAttribute(p, 4));
    g.groups = [];
    this.geos.push(g);
    return g;
  }
  build(mat) {
    const m = new THREE.Mesh(mergeGeometries(this.geos, false), mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

// ---- geometry helpers -----------------------------------------------------------------------
export const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
export const rbox = (w, h, d, r = 0.01, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
export const cyl = (rt, rb, h, seg = 24, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
// lathe around Y from [radius, y] pairs
export const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), seg);
export const tube = (pts, r, seg = 48, rseg = 10, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5), seg, r, rseg, closed);

// a quad surface through a grid of points: rows[i][j] (Vector3); uv = (row t, arc length across)
export function surface(rows) {
  const nr = rows.length, nc = rows[0].length, pos = [], uv = [], idx = [];
  rows.forEach((row, i) => {
    let len = 0; const acc = [0];
    for (let j = 1; j < nc; j++) acc.push(len += row[j].distanceTo(row[j - 1]));
    row.forEach((p, j) => { pos.push(p.x, p.y, p.z); uv.push(i / (nr - 1), acc[j] / (len || 1)); });
  });
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// loft 2D cross-sections section(t) = [[x, y], ...] (same count every t) along z(t)
export const loft = (n, section, z) =>
  surface(Array.from({ length: n + 1 }, (_, i) => section(i / n).map(([x, y]) => new THREE.Vector3(x, y, z(i / n)))));
// sweep a profile [[x, r], ...] round the X axis (centre cy, cz) from angle a0 to a1 (0 = +Z, up = +pi/2)
export const sweepArc = (profile, cy, cz, a0, a1, n = 40) =>
  surface(Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (a1 - a0) * (i / n);
    return profile.map(([x, r]) => new THREE.Vector3(x, cy + Math.sin(a) * r, cz + Math.cos(a) * r));
  }));

// ---- material ---------------------------------------------------------------------------------
export function kitMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 });
  mat.customProgramCacheKey = () => 'lawn-kit-v1';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, kitUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPBR;
        varying vec4 vPBR; varying vec3 vKP; varying vec3 vKN; varying vec2 vKUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPBR = aPBR; vKP = position; vKN = normal; vKUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vPBR; varying vec3 vKP; varying vec3 vKN; varying vec2 vKUv;
        uniform float uHeadGlow, uTailGlow;
        float kType, kRough, kMetal, kCoat, kH, kHS; vec3 kEmit;
        float kHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float kNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(kHash(i), kHash(i + vec3(1, 0, 0)), f.x), mix(kHash(i + vec3(0, 1, 0)), kHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(kHash(i + vec3(0, 0, 1)), kHash(i + vec3(1, 0, 1)), f.x), mix(kHash(i + vec3(0, 1, 1)), kHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float kFbm(vec3 p) { return kNoise(p) * 0.55 + kNoise(p * 2.13 + 7.1) * 0.3 + kNoise(p * 4.7 + 1.3) * 0.15; }
        // bump from a height field via screen-space derivatives (surface gradient)
        vec3 kBump(vec3 sX, vec3 sY, vec3 n, vec2 dH, float fd) {
          vec3 r1 = cross(sY, n), r2 = cross(n, sX);
          float det = dot(sX, r1) * fd;
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          return normalize(abs(det) * n - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          kType = floor(vPBR.w + 0.5); kRough = vPBR.x; kMetal = vPBR.y; kCoat = vPBR.z;
          kH = 0.0; kHS = 0.0; kEmit = vec3(0.0);
          vec3 P = vKP, N = normalize(vKN), alb = diffuseColor.rgb;
          float low = 1.0 - smoothstep(0.15, 0.6, P.y);                 // near the ground: mud + grass
          if (kType == 1.0 || kType == 8.0 || kType == 9.0) {
            // ---- painted steel ----
            float n = kFbm(P * 16.0), n2 = kNoise(P * 55.0), big = kFbm(P * 2.5);
            float bias = kType == 8.0 ? 0.04 : low * 0.03;
            float cn = n * 0.75 + n2 * 0.25;
            float chip = smoothstep(0.7 - bias, 0.707 - bias, cn);
            float halo = smoothstep(0.65 - bias, 0.705 - bias, cn) * (1.0 - chip);
            float deep = smoothstep(0.72 - bias, 0.76 - bias, cn);
            vec3 rust = mix(vec3(0.085, 0.04, 0.018), vec3(0.2, 0.09, 0.035), n2);
            alb = mix(alb, mix(alb, rust, 0.55), halo * 0.35);
            alb = mix(alb, mix(vec3(0.22, 0.21, 0.19), rust, deep), chip);
            kRough = mix(kRough, 0.85, chip); kCoat *= 1.0 - chip;
            float up = smoothstep(0.55, 0.95, N.y);                       // sun-faded, dusty tops
            alb = mix(alb, alb * 1.18 + vec3(0.004, 0.005, 0.003), up * 0.3 * big);
            float dust = up * smoothstep(0.5, 0.85, kFbm(P * 6.0 + 3.0)) * 0.5;
            alb = mix(alb, vec3(0.2, 0.18, 0.13), dust * 0.22); kCoat *= 1.0 - dust * 0.5; kRough = mix(kRough, 0.6, dust * 0.5);
            float splat = smoothstep(0.5, 0.75, kFbm(P * vec3(7.0, 3.0, 7.0) + 11.0) + kNoise(P * 40.0) * 0.15);
            float zone = kType == 8.0 ? 0.6 : low;
            float mud = splat * zone;
            alb = mix(alb, mix(vec3(0.09, 0.07, 0.045), vec3(0.2, 0.16, 0.1), n2), mud * 0.85);
            kRough = mix(kRough, 0.95, mud); kCoat *= 1.0 - mud;
            float grass = smoothstep(0.55, 0.8, kFbm(P * vec3(10.0, 22.0, 10.0) + 5.0)) * zone * (kType == 8.0 ? 1.0 : 0.5);
            alb = mix(alb, vec3(0.05, 0.1, 0.02), grass * 0.8);
            if (kType == 8.0) {                                           // clippings caked along the deck skirt
              float cake = smoothstep(0.17, 0.12, P.y) * smoothstep(0.35, 0.6, kFbm(P * 30.0));
              alb = mix(alb, mix(vec3(0.12, 0.17, 0.04), vec3(0.28, 0.3, 0.1), n2), cake);
              kRough = mix(kRough, 1.0, cake); kCoat *= 1.0 - cake; kH += cake * 0.5;
            }
            if (kType == 9.0) {                                           // cream coach lines along the hood (uv.y = across)
              float v = vKUv.y;
              float l = max(1.0 - smoothstep(0.0022, 0.0034, abs(v - 0.285)), 1.0 - smoothstep(0.0022, 0.0034, abs(v - 0.715)));
              l = max(l, max(1.0 - smoothstep(0.0008, 0.0016, abs(v - 0.297)), 1.0 - smoothstep(0.0008, 0.0016, abs(v - 0.703))));
              l *= smoothstep(0.03, 0.06, vKUv.x) * smoothstep(0.97, 0.94, vKUv.x) * (1.0 - chip);
              alb = mix(alb, vec3(0.78, 0.66, 0.42), l);
            }
            float scr = smoothstep(0.93, 1.0, kNoise(vec3(dot(P, vec3(1.0, 0.3, -0.6)) * 420.0, dot(P, vec3(0.2, 1.0, 0.4)) * 6.0, 0.5)));
            alb = mix(alb, alb * 1.6 + 0.02, scr * 0.3 * (1.0 - chip));
            kH += -chip * 0.6 + n2 * 0.04 + mud * 0.3; kHS = 0.0035;
          } else if (kType == 2.0) {
            // ---- chrome: pitting + grime ----
            float pit = smoothstep(0.78, 0.83, kNoise(P * 160.0)) * (0.4 + low);
            float grime = smoothstep(0.5, 0.8, kFbm(P * 9.0)) * (0.3 + low * 0.7);
            alb = mix(alb, vec3(0.25, 0.22, 0.18), pit * 0.8);
            alb = mix(alb, alb * vec3(0.55, 0.5, 0.42), grime * 0.6);
            kRough = clamp(kRough + grime * 0.25 + pit * 0.3 + kNoise(P * 30.0) * 0.05, 0.03, 1.0);
            kH -= pit * 0.5; kHS = 0.0012;
          } else if (kType == 3.0) {
            // ---- tyre rubber ----
            float n = kFbm(P * 30.0);
            alb = mix(alb, vec3(0.16, 0.13, 0.09), smoothstep(0.35, 0.8, kFbm(P * 5.0 + 2.0)) * 0.35);
            float mud = smoothstep(0.6, 0.8, kFbm(P * 11.0 + 9.0));
            alb = mix(alb, vec3(0.1, 0.075, 0.045), mud * 0.7);
            alb = mix(alb, vec3(0.08, 0.16, 0.03), smoothstep(0.86, 0.9, kNoise(P * 90.0)) * 0.8);
            kRough = clamp(0.82 + n * 0.12 + mud * 0.1, 0.0, 1.0);
            kH += n * 0.3 + mud * 0.4; kHS = 0.002;
          } else if (kType == 4.0) {
            // ---- vinyl seat: grain, pleats, sun fade, a split seam ----
            float grain = kNoise(P * 260.0) * 0.6 + kNoise(P * 610.0) * 0.4;
            float pleat = smoothstep(0.0, 0.1, abs(fract(P.x / 0.07) - 0.5) * 2.0);
            float n = kFbm(P * 8.0), up = smoothstep(0.4, 0.9, N.y + N.z * 0.3);
            alb = mix(alb, alb * vec3(1.6, 1.45, 1.35) + vec3(0.02, 0.015, 0.01), up * 0.45 * n);
            float crack = smoothstep(0.82, 0.86, kNoise(vec3(P.x * 90.0, P.z * 14.0, P.y * 40.0))) * smoothstep(0.55, 0.75, kFbm(P * 5.0 + 4.0));
            alb = mix(alb, vec3(0.62, 0.48, 0.2), crack * 0.85);             // yellowed foam showing
            kRough = clamp(0.42 + grain * 0.25 + up * n * 0.25 + crack * 0.5, 0.0, 1.0);
            kH += grain * 0.25 - (1.0 - pleat) * 1.2 - crack * 0.8; kHS = 0.0012;
          } else if (kType == 5.0) {
            // ---- raw / rusting steel ----
            float n = kFbm(P * 14.0), r = smoothstep(0.45, 0.75, n + kNoise(P * 60.0) * 0.2);
            alb = mix(alb, mix(vec3(0.14, 0.05, 0.015), vec3(0.28, 0.11, 0.03), n), r);
            kMetal = mix(kMetal, 0.1, r); kRough = mix(kRough, 0.95, r);
            kH += r * 0.5 + n * 0.2; kHS = 0.002;
          } else if (kType == 6.0) {
            // ---- lamp lenses (front = head glow, rear = tail glow) ----
            float g = P.z > 0.0 ? uHeadGlow : uTailGlow;
            kEmit = alb * g * (0.9 + 0.2 * kNoise(P * 400.0)) * 4.0;
            alb *= 0.35; kRough = 0.12; kCoat = 1.0;
          } else if (kType == 7.0) {
            // ---- ribbed rubber mat ----
            float rib = smoothstep(0.35, 0.5, abs(fract(P.z / 0.022) - 0.5) * 2.0);
            float mud = smoothstep(0.5, 0.8, kFbm(P * 9.0));
            alb *= 0.8 + 0.3 * rib;
            alb = mix(alb, vec3(0.13, 0.1, 0.07), mud * 0.7);
            alb = mix(alb, alb * 2.2, smoothstep(0.7, 0.9, kFbm(P * 20.0)) * (1.0 - rib) * 0.4);   // boot scuffs
            kRough = 0.9; kH += rib * 1.0 - mud * 0.3; kHS = 0.0018;
          } else {
            // ---- plain: a little dust on top ----
            float up = smoothstep(0.6, 0.95, N.y);
            alb = mix(alb, vec3(0.28, 0.25, 0.2), up * smoothstep(0.5, 0.8, kFbm(P * 6.0)) * 0.3);
          }
          diffuseColor.rgb = alb;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = clamp(kRough, 0.03, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n        metalnessFactor = kMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (kHS > 0.0) {
          float h = kH * kHS;
          normal = kBump(dFdx(-vViewPosition), dFdy(-vViewPosition), normal, vec2(dFdx(h), dFdy(h)), faceDirection);
        }`)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n        material.clearcoat = saturate(kCoat);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += kEmit;');
  };
  return mat;
}
