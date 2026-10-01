// Loads the downloaded assets (src/assets): the Poly Haven HDRI sky, bark / ground PBR textures,
// photo leaves, the rigged Ready Player Me driver and the Camaro.
// Also derives what the scene needs from them: the sun direction (brightest
// HDR pixel), the horizon colour for fog, and leaf-cluster card textures
// composited from the individual photo leaves.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Every file in src/assets is imported as a URL. In dev these are normal paths; in the single-file
// build (vite.single.config.js) they're inlined as data: URIs, so the game runs from a double-click.
const FILES = import.meta.glob('./assets/*', { query: '?url', import: 'default', eager: true });
const url = (f) => { const u = FILES['./assets/' + f]; if (!u) throw new Error('missing asset ' + f); return u; };

function loadImage(url) {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
}

// Leaf sprites in leaves_diff.jpg (1024², measured from the atlas): [x, y, w, h], stem at the bottom.
const LEAF_RECTS = [[15, 20, 140, 400], [165, 20, 185, 385], [365, 30, 135, 345], [525, 45, 145, 330], [705, 18, 140, 410],
  [15, 640, 175, 384], [218, 590, 150, 434], [430, 615, 150, 409]];

function leafAtlas(diff, alpha) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.drawImage(alpha, 0, 0);
  const a = g.getImageData(0, 0, 1024, 1024).data;
  g.drawImage(diff, 0, 0);
  const img = g.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < a.length; i += 4) img.data[i + 3] = a[i];
  g.putImageData(img, 0, 0);
  return c;
}

// A roughly round cluster of leaves on twigs, drawn into a square card texture.
function leafCluster(atlas, { size = 512, leaves = 60, leafPx = [70, 120], hue = 12, round = true } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), mid = size / 2;
  g.strokeStyle = '#4a3a26'; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * 6.283; g.lineWidth = 3 + Math.random() * 3;
    g.beginPath(); g.moveTo(mid, mid); g.lineTo(mid + Math.cos(a) * size * 0.38, mid + Math.sin(a) * size * 0.38); g.stroke();
  }
  const order = Array.from({ length: leaves }, () => Math.random()).sort();     // inner (dark) leaves first
  for (const r0 of order) {
    const [x, y, w, h] = LEAF_RECTS[(Math.random() * LEAF_RECTS.length) | 0];
    const ang = Math.random() * 6.283, rad = (round ? Math.sqrt(r0) : r0) * size * 0.34;
    const px = round ? mid + Math.cos(ang) * rad : Math.random() * size, py = round ? mid + Math.sin(ang) * rad : Math.random() * size;
    const len = leafPx[0] + Math.random() * (leafPx[1] - leafPx[0]), s = len / h;
    g.save(); g.translate(px, py);
    g.rotate(round ? ang + Math.PI / 2 + (Math.random() - 0.5) * 1.2 : Math.random() * 6.283);
    g.filter = `brightness(${0.55 + r0 * 0.6}) saturate(${0.9 + Math.random() * 0.4}) hue-rotate(${hue + (Math.random() - 0.5) * 16}deg)`;
    g.drawImage(atlas, x, y, w, h, -w * s / 2, -h * s, w * s, h * s);
    g.restore();
  }
  return c;
}
const canvasTexture = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// Find the sun (brightest pixel) and the horizon colour in an equirect float HDR.
function analyseSky(tex) {
  const { data, width: W, height: H } = tex.image;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    if (l > best) { best = l; bx = x; by = y; }
  }
  // flipY: data row 0 is the top of the sky (v = 1). three's equirectUv: u = atan(z,x)/2π + .5, v = asin(y)/π + .5
  const u = (bx + 0.5) / W, v = 1 - (by + 0.5) / H;
  const phi = (u - 0.5) * 2 * Math.PI, el = (v - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)).normalize();
  const horizon = new THREE.Color(0, 0, 0), zenith = new THREE.Color(0, 0, 0);
  const avgRow = (row, out) => {
    for (let x = 0; x < W; x += 4) { const i = (row * W + x) * 4; out.r += data[i]; out.g += data[i + 1]; out.b += data[i + 2]; }
    out.multiplyScalar(4 / W);
  };
  avgRow(Math.floor(H * 0.47), horizon);       // ~5° above the horizon
  avgRow(Math.floor(H * 0.1), zenith);
  return { sunDir, horizon, zenith };
}

export async function loadAssets(renderer, progress = () => {}) {
  let done = 0; const N = 16;
  const tick = (x) => { progress(++done / N); return x; };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tl = new THREE.TextureLoader();
  const tex = (f, srgb) => tl.loadAsync(url(f)).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return tick(t);
  });
  const hdrL = new HDRLoader().setDataType(THREE.FloatType);
  const [hdr, gltf, camaro, barkD, barkN, barkR, grD, grN, grR, leafD, leafA] = await Promise.all([
    hdrL.loadAsync(url('sky_2k.hdr')).then(tick),
    new GLTFLoader().loadAsync(url('readyplayer.me.glb')).then(tick),
    new GLTFLoader().loadAsync(url('camaro.glb')).then(tick),
    tex('bark_diff.jpg', true), tex('bark_nor_gl.jpg'), tex('bark_rough.jpg'),
    tex('ground_diff.jpg', true), tex('ground_nor_gl.jpg'), tex('ground_rough.jpg'),
    loadImage(url('leaves_diff.jpg')).then(tick), loadImage(url('leaves_alpha.png')).then(tick),
  ]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const sky = analyseSky(hdr);
  const atlas = leafAtlas(leafD, leafA);
  // 2x2 atlas of different clusters; each leaf card picks a cell
  const cc = document.createElement('canvas'); cc.width = cc.height = 1024;
  for (let i = 0; i < 4; i++) cc.getContext('2d').drawImage(leafCluster(atlas, { leaves: 75 }), (i % 2) * 512, (i >> 1) * 512);
  const canopy = canvasTexture(cc);
  tick(); tick();
  return { hdr, sky, avatar: gltf, camaro, bark: { map: barkD, normalMap: barkN, roughnessMap: barkR }, ground: { map: grD, normalMap: grN, roughnessMap: grR }, canopy };
}
