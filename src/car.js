// Beercar: a 1967 Camaro SS 350; the driver sits in the left-hand seat, beer on the console, cigars on the door.
// Model: "1967 Chevrolet Camaro SS 350 Coupe" by Ddiaz Design, CC-BY-NC-SA 4.0
// (https://sketchfab.com/3d-models/1967-chevrolet-camaro-ss-350-coupe-37ecedd9b5284cbfae74956eea2ad3fd).
// Origin = ground under the middle of the car, +Z = forward, +X = the driver's LEFT. `cabin` is the frame
// the driver is authored in (hips, wheel, anchors); it is offset into the Camaro's left-hand seat.
import * as THREE from 'three';
import { Kit, T, M, rbox, cyl, lathe, tube, kitMaterial } from './kit.js';

export { rbox };
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const C = { red: 0xa6191c, cream: 0xe9dfc4, black: 0x151617, chrome: 0xe9ebec, steel: 0x6d7074, rubber: 0x1b1b1b, vinyl: 0x2a1a12, lensW: 0xfff1d0, lensR: 0xc01010, wall: 0xe8e6de };
const paint = (color = C.red, extra = {}) => ({ color, rough: 0.35, metal: 0.25, coat: 1, type: T.PAINT, ...extra });
const chrome = { color: C.chrome, rough: 0.08, metal: 1, type: T.CHROME };
const blackPlain = { color: C.black, rough: 0.6, metal: 0.2, type: T.PLAIN };
const steel = { color: C.steel, rough: 0.45, metal: 0.8, type: T.STEEL };
const vinyl = { color: C.vinyl, rough: 0.55, type: T.VINYL };

const S = 100;                        // the glb's nodes carry a 0.01 scale; undo it so 1 unit = 1 m
const CORNERS = [[0.78, 1.415], [-0.78, 1.415], [0.78, -1.345], [-0.78, -1.345]];   // wheel centres (x, z); y = WR
const WR = 0.33;
// Where the driver's frame sits in the car (left-hand drive): hips (0, .99, -.43) land on the seat cushion
// (world y .47) and the eyes (~1.1) stay under the roof. Measured off the mesh: seat cushion top ~.45 at
// z -.15, console top .5, floor .18, toe board ~.28 at z .5.
const CAB = new THREE.Vector3(0.385, -0.56, 0.21);
// The model's own steering wheel (ring fitted to the Interior mesh): centre, face normal, rim radius.
const WHEEL_C = new THREE.Vector3(0.385, 0.791, 0.198), WHEEL_TILT = -1.282, RIM_R = 0.191;

export function buildCar(gltf) {
  const root = new THREE.Group();          // world position + heading
  const body = new THREE.Group();          // pitch/roll + wobble
  root.add(body);
  const cabin = new THREE.Group(); cabin.position.copy(CAB); body.add(cabin);   // driver-frame (tractor-era coordinates)
  const mat = kitMaterial(); mat.side = THREE.DoubleSide;

  // ---- the Camaro ----
  const model = gltf.scene; model.scale.setScalar(S); model.position.y = 0.02; body.add(model);
  const wheelParts = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (/Rim_Main|RimBadge|TYRE|ROTOR/i.test(o.parent.name + o.name)) wheelParts.push(o.parent === model ? o : o.parent);
  });
  // wheels: pivot (steers) > spin (rolls) at each corner, then reparent the matching tyre/rim/rotor pieces
  const wheels = CORNERS.map(([x, z]) => {
    const pivot = new THREE.Group(); pivot.position.set(x, WR, z); body.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    return { pivot, spin, r: WR, front: z > 0, x, z };
  });
  const c = new THREE.Vector3();
  body.updateMatrixWorld(true);
  for (const p of new Set(wheelParts)) {
    p.updateWorldMatrix(true, true);
    new THREE.Box3().setFromObject(p).getCenter(c); body.worldToLocal(c);
    let best = wheels[0], bd = 1e9;
    for (const w of wheels) { const d = Math.hypot(c.x - w.x, c.z - w.z); if (d < bd) { bd = d; best = w; } }
    best.spin.attach(p);
  }

  // ---- driver-frame anchors (cabin coords): console (beer), door armrest (cigars), feet on the toe board ----
  const w2c = (x, y, z) => new THREE.Vector3(x, y, z).sub(CAB);
  const cupholder = w2c(0, 0.5, -0.05);
  const sixPack = w2c(0, 0.5, -0.36);
  const cigarBox = w2c(0.7, 0.62, -0.1);
  const feet = { x: 0.17, ankle: w2c(0, 0.31, 0.42), toe: w2c(0, 0.36, 0.6) };

  // ---- steering: column (static) + wheel (spins) ----
  const wheelGroup = new THREE.Group(); wheelGroup.position.copy(WHEEL_C).sub(CAB); wheelGroup.rotation.x = WHEEL_TILT;   // sits on the model's wheel and covers it cabin.add(wheelGroup);
  const kc = new Kit(); kc.add(cyl(0.022, 0.03, 0.42, 12), { m: M(0, -0.21, 0), ...blackPlain });
  kc.add(cyl(0.036, 0.04, 0.05, 16), { m: M(0, -0.045, 0), ...blackPlain });
  wheelGroup.add(kc.build(mat));
  const spinner = new THREE.Group(); wheelGroup.add(spinner);
  const RIM = RIM_R, ks = new Kit();
  ks.add(new THREE.TorusGeometry(RIM, 0.02, 12, 48), { m: M(0, 0, 0, Math.PI / 2, 0, 0), color: 0x151515, rough: 0.5, type: T.VINYL });
  for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) ks.add(rbox(0.024, 0.01, RIM, 0.004), { m: M(Math.cos(a) * RIM / 2, 0, Math.sin(a) * RIM / 2, 0, -a + Math.PI / 2, 0), ...steel });
  ks.add(lathe([[0.05, -0.01], [0.05, 0.012], [0.04, 0.022], [0.02, 0.027], [0, 0.028]], 32), blackPlain);
  ks.add(cyl(0.022, 0.022, 0.004, 24), { m: M(0, 0.029, 0), ...chrome });
  spinner.add(ks.build(mat));

  // ---- floor shifter on the console, ahead of the cupholder: pivots at the boot; set(gx, gz) tilts it
  // into a gate (gx +1 = toward the driver, gz +1 = forward). `knob` is what the right hand grabs.
  const shifter = new THREE.Group(); shifter.position.set(0, 0.5, 0.1); body.add(shifter);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.045, 0.06, 16).translate(0, 0.03, 0), rubber); body.add(boot); boot.position.copy(shifter.position);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.2, 10).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: C.chrome, roughness: 0.12, metalness: 1 }));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 14), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.25 }));
  knob.position.y = 0.21; knob.userData.r = 0.026;
  for (const m of [boot, stick, knob]) m.castShadow = true;
  shifter.add(stick, knob);
  shifter.knob = knob;
  shifter.set = (gx, gz) => shifter.rotation.set(gz * 0.28, 0, -gx * 0.13);

  return { root, body, cabin, wheels, spinner, wheelGroup, RIM, cupholder, sixPack, cigarBox, feet, shifter, maxDrinkTilt: 1.85 };
}
