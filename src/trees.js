// Photo-leaf trees (the BEERMOWER ones), rebuilt for an endless world: a handful of tree VARIANTS
// are each merged into one bark geometry + one leaf-card geometry at load, then every tree in the
// world is just an instance (matrix) of a variant. Three levels of detail per variant: near trees
// get branches, ~420 cards and cast shadows; mid trees ~100 bigger cards; far trees ~30 huge cards.
// set(trees, x, z) re-fills the instance buffers; the world calls it when the car enters a new chunk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
export const VARIANTS = 4;
const LODS = [
  { cards: 420, size: [0.9, 1.5], branches: true, shadows: true, cap: 160, dist: 90 },
  { cards: 100, size: [1.5, 2.4], branches: false, shadows: false, cap: 500, dist: 210 },
  { cards: 30, size: [2.6, 3.6], branches: false, shadows: false, cap: 1400, dist: Infinity },
];

// Leaf-card material: each card samples one cell of a 2x2 leaf-cluster atlas (aCell), shades with a
// canopy-shaped normal (aNrm, tree space) instead of the flat card normal, and glows when backlit.
function leafMaterial(map, U) {
  const cellUV = /* glsl */ `
    #ifdef USE_MAP
      vMapUv = vMapUv * 0.5 + vec2(mod(aCell, 2.0), floor(aCell / 2.0)) * 0.5;
    #endif`;
  const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSunView = U.uSunView; sh.uniforms.uSunCol = U.uSunCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell; attribute vec3 aNrm;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + cellUV)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vec3 kn = aNrm;
        #ifdef USE_INSTANCING
          kn = mat3(instanceMatrix) * kn;
        #endif
        transformedNormal = normalize(normalMatrix * kn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView, uSunCol;')
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <opaque_fragment>', `
        float backlit = pow(max(dot(normalize(-vViewPosition), uSunView), 0.0), 4.0);
        outgoingLight += diffuseColor.rgb * uSunCol * backlit * 0.9;
        #include <opaque_fragment>`);
  };
  // shadows must use the same atlas cell, or the dapples won't match the leaves
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + cellUV);
  };
  return { mat, depth };
}

export const rng = (seed) => { let s = ((seed >>> 0) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

// one tree's skeleton: branch segments and the leaf blobs at their tips (tree space, ground = 0)
function treeShape(rnd) {
  const blobs = [{ c: new THREE.Vector3(0, 4.9, 0), rx: 1.9, ry: 1.4, rz: 1.9 }], branches = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283 + rnd() * 0.6, up = 2.3 + rnd() * 1.1, len = 1.5 + rnd() * 0.8;
    const from = new THREE.Vector3(0, up, 0), to = new THREE.Vector3(Math.cos(a) * len, up + 1.0 + rnd() * 0.8, Math.sin(a) * len);
    branches.push([from, to]); blobs.push({ c: to, rx: 1.3, ry: 1.0, rz: 1.3 });
  }
  return { blobs, branches };
}

function barkGeometry(shape, branches) {
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, 3.4, branches ? 14 : 7, branches ? 4 : 1);
  const tp = trunk.attributes.position;                                   // a little wobble so it isn't a perfect cylinder
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 2.3) * 0.05); tp.setZ(i, tp.getZ(i) + Math.cos(y * 1.7) * 0.04); }
  trunk.translate(0, 1.65, 0); trunk.computeVertexNormals();
  const parts = [trunk];
  if (branches) for (const [from, to] of shape.branches) {
    const d = to.clone().sub(from), b = new THREE.CylinderGeometry(0.045, 0.12, 1, 8).translate(0, 0.5, 0);
    b.applyMatrix4(new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new THREE.Vector3(1, d.length(), 1)));
    parts.push(b);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// all cards of one tree as a single geometry; aCell / aNrm are per-vertex (constant per card)
function leafGeometry(shape, count, size, rnd) {
  const pos = new Float32Array(count * 12), uv = new Float32Array(count * 8), nrm = new Float32Array(count * 12);
  const cell = new Float32Array(count * 4), an = new Float32Array(count * 12), idx = new Uint32Array(count * 6);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], cuv = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let i = 0; i < count; i++) {
    const b = shape.blobs[i % shape.blobs.length];
    const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(), r = Math.cbrt(rnd());
    p.set(dir.x * b.rx * r, dir.y * b.ry * r, dir.z * b.rz * r).add(b.c);
    q.setFromEuler(e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
    const k = size[0] + rnd() * (size[1] - size[0]);
    n.copy(p).sub(b.c).divide(new THREE.Vector3(b.rx, b.ry, b.rz)).add(new THREE.Vector3(0, 0.35, 0)).normalize();
    const c = (rnd() * 4) | 0;
    for (let j = 0; j < 4; j++) {
      v.set(corners[j][0] * k, corners[j][1] * k, 0).applyQuaternion(q).add(p);
      pos.set([v.x, v.y, v.z], (i * 4 + j) * 3); an.set([n.x, n.y, n.z], (i * 4 + j) * 3); nrm.set([n.x, n.y, n.z], (i * 4 + j) * 3);
      uv.set(cuv[j], (i * 4 + j) * 2); cell[i * 4 + j] = c;
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCell', new THREE.BufferAttribute(cell, 1));
  g.setAttribute('aNrm', new THREE.BufferAttribute(an, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export function buildTrees(scene, assets) {
  const U = { uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.93, 0.8) } };
  const leaf = leafMaterial(assets.canopy, U);
  const bark = new THREE.MeshStandardMaterial({ roughness: 1 });
  for (const k of ['map', 'normalMap', 'roughnessMap']) { bark[k] = assets.bark[k].clone(); bark[k].repeat.set(2, 3); bark[k].needsUpdate = true; }

  // meshes[variant][lod] = { bark, leaves }
  const meshes = [];
  for (let v = 0; v < VARIANTS; v++) {
    const rnd = rng(1000 + v * 77), shape = treeShape(rnd);
    meshes.push(LODS.map((L) => {
      const b = new THREE.InstancedMesh(barkGeometry(shape, L.branches), bark, L.cap);
      const l = new THREE.InstancedMesh(leafGeometry(shape, L.cards, L.size, rng(5000 + v * 31 + L.cards)), leaf.mat, L.cap);
      l.customDepthMaterial = leaf.depth;
      for (const m of [b, l]) { m.count = 0; m.frustumCulled = false; m.castShadow = L.shadows; m.receiveShadow = true; scene.add(m); }
      return { bark: b, leaves: l };
    }));
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // trees: [{x, z, rot, s, v}]; LOD picked by distance to (cx, cz)
  function set(trees, cx, cz) {
    for (const row of meshes) for (const lm of row) { lm.bark.count = 0; lm.leaves.count = 0; }
    for (const t of trees) {
      const d = Math.hypot(t.x - cx, t.z - cz), lod = LODS.findIndex((L) => d < L.dist), lm = meshes[t.v][lod];
      const i = lm.bark.count; if (i >= LODS[lod].cap) continue;
      m4.compose(p.set(t.x, -0.05, t.z), q.setFromAxisAngle(UP, t.rot), s.setScalar(t.s));
      lm.bark.setMatrixAt(i, m4); lm.leaves.setMatrixAt(i, m4);
      lm.bark.count = lm.leaves.count = i + 1;
    }
    for (const row of meshes) for (const lm of row) { lm.bark.instanceMatrix.needsUpdate = true; lm.leaves.instanceMatrix.needsUpdate = true; }
  }
  const update = (camera, sunDir) => U.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  return { set, update };
}
