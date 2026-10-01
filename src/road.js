// The world: HDRI sky + lights, PBR grass, an endless straight road along z (x = 0), and trees +
// roadside furniture generated in 64 m chunks. Chunks are created deterministically (seeded by
// their grid index) when they come within range of the car and dropped when they leave it, so
// driving back to a spot shows exactly what was there before. The road strip and the grass plane
// just follow the car, snapping by whole texture periods so the surface never visibly moves.
import * as THREE from 'three';
import { buildTrees, rng, VARIANTS } from './trees.js';

export const SUN_DIR = new THREE.Vector3(0.4, 0.7, 0.3).normalize();   // replaced from the HDR in buildWorld
export const heightAt = () => 0;                                         // flat; the driver's litter physics asks
export const ROAD_W = 10;                                                // asphalt 8 m + 1 m gravel each side

const PERIOD = 12;                     // road texture period (m) = dash period
const ROAD_LEN = PERIOD * 70;          // 840 m strip
const CH = 64, RANGE = 5;              // chunk size (m); chunks kept within +-RANGE of the car's chunk
const GROUND_TILE = 6;                 // grass texture tile (m)

// ---- procedural road textures: albedo + normal + roughness, tiling along the road ---------------
// 100 px/m: 1000 px across 10 m, 1200 px along 12 m. Value noise wraps vertically so it tiles.
function roadTextures(maxAniso) {
  const W = 1000, H = 1200, PPM = 100;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const vnoise = (x, y, cell) => {
    const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, ny = H / cell;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), y0 = ((iy % ny) + ny) % ny, y1 = (y0 + 1) % ny;
    const a = hash(ix, y0), b = hash(ix + 1, y0), c = hash(ix, y1), d = hash(ix + 1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const hgt = new Float32Array(W * H), alb = new Uint8ClampedArray(W * H * 4), rough = new Uint8ClampedArray(W * H * 4);
  const xm = (px) => px / PPM - 5;                                        // pixel column -> metres from the road centre
  const lane = (x) => Math.max(0, 1 - Math.min(...[-2.6, -0.9, 0.9, 2.6].map((c) => Math.abs(x - c))) / 0.45);   // tyre tracks
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, m = xm(x), ax = Math.abs(m);
    const big = vnoise(x, y, 100), mid = vnoise(x + 31, y, 12), fine = vnoise(x + 77, y, 4), grain = hash(x * 7 + 3, y * 13 + 5);
    let r, g, b, h, ro;
    if (ax > 4) {                                                        // gravel shoulder
      const stone = vnoise(x + 500, y, 4) * 0.6 + grain * 0.4;
      const v = 95 + stone * 70 + big * 25;
      r = v; g = v * 0.95; b = v * 0.86; h = stone * 0.9; ro = 250;
      if (ax > 4.75) { const t = (ax - 4.75) / 0.25, gr = 1 - big * 0.4; r = r * (1 - t) + 70 * gr * t; g = g * (1 - t) + 90 * gr * t; b = b * (1 - t) + 45 * gr * t; }   // grass creeping in
    } else {                                                              // asphalt: aggregate + binder, wear in the tyre tracks
      const agg = grain > 0.86 ? (grain - 0.86) * 6 : 0, wear = lane(m);
      const v = 46 + big * 14 + mid * 10 + fine * 8 + agg * 55 - wear * 7;
      r = v; g = v; b = v * 1.04; h = mid * 0.4 + fine * 0.35 + agg * 0.6; ro = 225 - wear * 40 - agg * 30;
      if (ax > 3.95) { const t = (ax - 3.95) / 0.05; r = r * (1 - t) + 80 * t; g = g * (1 - t) + 78 * t; b = b * (1 - t) + 72 * t; }   // ragged edge
    }
    // paint: white edge lines, dashed yellow centre (3.5 m of every 12 m), worn by noise
    const worn = vnoise(x + 900, y, 4) * 0.5 + big * 0.5 > 0.78;
    const edge = Math.abs(ax - 3.8) < 0.075, centre = ax < 0.06 && y < 3.5 * PPM;
    if ((edge || centre) && !worn) {
      const c = edge ? [222, 220, 210] : [222, 168, 30], k = 0.85 + fine * 0.15;
      r = c[0] * k; g = c[1] * k; b = c[2] * k; h += 0.25; ro = 150;
    }
    hgt[i] = h; alb.set([r, g, b, 255], i * 4); rough.set([ro, ro, ro, 255], i * 4);
  }
  // a few long cracks, sealed with darker tar (kept clear of the wrap seam)
  const crnd = rng(42);
  for (let k = 0; k < 7; k++) {
    let x = 100 + crnd() * 800, y = 120 + crnd() * 900, a = crnd() * 6.28;
    for (let s = 0; s < 260; s++) {
      a += (crnd() - 0.5) * 0.5; x += Math.cos(a) * 1.5; y += Math.sin(a) * 1.5;
      if (x < 2 || x > W - 3 || y < 2 || y > H - 3 || Math.abs(xm(x)) > 3.9) break;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const i = ((y | 0) + dy) * W + (x | 0) + dx; hgt[i] -= 0.5; alb[i * 4] *= 0.55; alb[i * 4 + 1] *= 0.55; alb[i * 4 + 2] *= 0.55; rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = 120;
      }
    }
  }
  // normals from the height field (wraps vertically)
  const nrm = new Uint8ClampedArray(W * H * 4), S = 2.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = (y + H - 1) % H, yd = (y + 1) % H;
    const dx = (hgt[y * W + xr] - hgt[y * W + xl]) * S, dy = (hgt[yd * W + x] - hgt[yu * W + x]) * S, l = Math.hypot(dx, dy, 1);
    nrm.set([(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], (y * W + x) * 4);
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, W, H); t.flipY = false;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, ROAD_LEN / PERIOD);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  };
  return { map: tex(alb, true), normalMap: tex(nrm), roughnessMap: tex(rough) };
}

// smooth 2D value noise over chunk coordinates, for forest density
function patch(x, z) {
  const h = (a, b) => rng(a * 92821 + b * 68917 + 7)();
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// everything in one chunk, decided only by its grid index (i, j)
function generateChunk(i, j) {
  const rnd = rng(i * 7919 + j * 104729 + 13), trees = [], posts = [], poles = [];
  const x0 = i * CH - CH / 2, z0 = j * CH - CH / 2;
  const dens = Math.max(0, patch(i * 0.45, j * 0.45) * 1.6 - 0.35);     // 0 = open field, ~1 = woods
  const n = Math.round(dens * 16 + rnd() * 2);
  for (let k = 0; k < n; k++) {
    const x = x0 + rnd() * CH, z = z0 + rnd() * CH;
    if (Math.abs(x) < 11) continue;                                       // keep the verge clear
    trees.push({ x, z, rot: rnd() * 6.283, s: 0.8 + rnd() * 0.9, v: (rnd() * VARIANTS) | 0 });
  }
  if (x0 <= 0 && x0 + CH > 0) {                                          // the chunk the road runs through
    for (let z = Math.ceil(z0 / 8) * 8; z < z0 + CH; z += 8) posts.push(z);
    for (let z = Math.ceil(z0 / 48) * 48; z < z0 + CH; z += 48) poles.push(z);
  }
  return { trees, posts, poles };
}

export function buildWorld(scene, renderer, assets) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // ---- sky, env, lights ----
  SUN_DIR.copy(assets.sky.sunDir);
  if (SUN_DIR.y < 0.25) SUN_DIR.y = 0.25;
  SUN_DIR.normalize();
  scene.background = assets.hdr;
  scene.backgroundIntensity = 0.55;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(assets.hdr).texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
  scene.fog = new THREE.Fog(assets.sky.horizon.clone().multiplyScalar(0.55), 90, 420);

  const skyTint = assets.sky.zenith.clone(); skyTint.multiplyScalar(1 / Math.max(skyTint.r, skyTint.g, skyTint.b));
  scene.add(new THREE.HemisphereLight(skyTint, 0x4a5a2c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const SH = 16;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 160 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const texel = (2 * SH) / 2048;
  function followSun(x, z) {
    const sx = Math.round(x / texel) * texel, sz = Math.round(z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx, 0, sz).addScaledVector(SUN_DIR, 80);
  }

  // ---- grass: photo ground texture (world-locked tiles) tinted by large-scale noise ----
  const GSIZE = GROUND_TILE * 260;
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  for (const k of ['map', 'normalMap', 'roughnessMap']) { groundMat[k] = assets.ground[k].clone(); groundMat[k].repeat.set(GSIZE / GROUND_TILE, GSIZE / GROUND_TILE); groundMat[k].anisotropy = maxAniso; groundMat[k].needsUpdate = true; }
  groundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vW;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float n = vn(vW * 0.03) * 0.6 + vn(vW * 0.25) * 0.4;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        vec3 grass = mix(vec3(0.05, 0.11, 0.02), vec3(0.13, 0.19, 0.04), n);
        vec3 dry = vec3(0.2, 0.19, 0.08);
        diffuseColor.rgb = mix(grass, dry, smoothstep(0.7, 0.95, vn(vW * 0.011 + 3.0))) * (0.45 + lum * 1.1);`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GSIZE, GSIZE).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -0.04; ground.receiveShadow = true; scene.add(ground);

  // ---- the road ----
  const roadMat = new THREE.MeshStandardMaterial({ ...roadTextures(maxAniso), roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  roadMat.normalScale.set(1, 1);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN).rotateX(-Math.PI / 2), roadMat);
  road.position.y = 0.01; road.receiveShadow = true; scene.add(road);

  // ---- roadside furniture (instanced; filled from the chunks) ----
  const wood = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x8a7458 });
  for (const k of ['map', 'normalMap', 'roughnessMap']) { wood[k] = assets.bark[k].clone(); wood[k].repeat.set(1, 6); wood[k].needsUpdate = true; }
  const POSTS = 2 * (2 * RANGE + 1) * (CH / 8), POLES = (2 * RANGE + 1) * 2;
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.95, 0.12).translate(0, 0.47, 0), new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.55 }), POSTS);
  const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.14, 0.015), new THREE.MeshStandardMaterial({ color: 0xff2a10, emissive: 0x801000, roughness: 0.2, metalness: 0.3 }), POSTS);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.15, 8.5, 10).translate(0, 4.25, 0), wood, POLES);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), wood, POLES);
  const wire = new THREE.MeshBasicMaterial({ color: 0x151515 });
  const wires = [-0.8, 0, 0.8].map((dx) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2 * (RANGE + 0.5) * CH, 4).rotateX(Math.PI / 2), wire); w.position.set(-7 + dx, 8.05, 0); scene.add(w); return w; });
  for (const m of [post, refl, pole, arm]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== refl; m.receiveShadow = true; scene.add(m); }
  const trees = buildTrees(scene, assets);

  // ---- chunks: generate when they come in range, delete when they leave ----
  const chunks = new Map();
  let ci = null, cj = null;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function refresh(x, z) {
    const i0 = Math.round(x / CH), j0 = Math.round(z / CH);
    if (i0 === ci && j0 === cj) return;
    ci = i0; cj = j0;
    for (const key of chunks.keys()) { const [i, j] = key.split(',').map(Number); if (Math.abs(i - i0) > RANGE || Math.abs(j - j0) > RANGE) chunks.delete(key); }
    const allTrees = [];
    let np = 0, nl = 0;
    for (let i = i0 - RANGE; i <= i0 + RANGE; i++) for (let j = j0 - RANGE; j <= j0 + RANGE; j++) {
      const key = i + ',' + j;
      let c = chunks.get(key);
      if (!c) { c = generateChunk(i, j); chunks.set(key, c); }
      for (const t of c.trees) allTrees.push(t);
      for (const pz of c.posts) for (const s of [-1, 1]) {
        if (np >= POSTS) break;
        post.setMatrixAt(np, m4.compose(p.set(s * 5.5, 0, pz), q.identity(), one));
        refl.setMatrixAt(np++, m4.compose(p.set(s * 5.5, 0.78, pz + s * 0.065), q.identity(), one));
      }
      for (const pz of c.poles) if (nl < POLES) { pole.setMatrixAt(nl, m4.compose(p.set(-7, 0, pz), q.identity(), one)); arm.setMatrixAt(nl++, m4.compose(p.set(-7, 7.9, pz), q.identity(), one)); }
    }
    post.count = refl.count = np; pole.count = arm.count = nl;
    for (const m of [post, refl, pole, arm]) m.instanceMatrix.needsUpdate = true;
    trees.set(allTrees, x, z);
    for (const w of wires) w.position.z = j0 * CH;
  }

  function update(x, z, camera) {
    ground.position.set(Math.round(x / GROUND_TILE) * GROUND_TILE, -0.04, Math.round(z / GROUND_TILE) * GROUND_TILE);
    road.position.z = Math.round(z / PERIOD) * PERIOD;
    followSun(x, z);
    refresh(x, z);
    if (camera) trees.update(camera, SUN_DIR);
  }
  update(0, 0);
  return { update, chunks };
}
