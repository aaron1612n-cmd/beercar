// Runs the fly's whole brain off the main thread, flat out, in 25 ms (brain-time) windows. After each
// window it posts spike counts for the readout pool, MN9 (proboscis), and a heat map for the HUD.
import { parseBrain, makeBrain } from './flycore.js';

const WIN = 25, DT = 1;
let brain, B, meta, inIdx, inP, nEye, pool, heat, running = false;
let tasteHz = 0;

onmessage = ({ data: m }) => {
  if (m.type === 'init') {
    B = parseBrain(m.buf); meta = m.meta;
    brain = makeBrain(B, { dt: DT, tone: m.tone || 0, toneCells: meta.toneCells });
    nEye = meta.eyeIdx.length;                                  // driven cells: the eyes, then the sugar GRNs
    inIdx = Uint32Array.from([...meta.eyeIdx, ...meta.sugar]); inP = new Float32Array(inIdx.length);
    pool = Uint32Array.from(meta.pool);
    heat = new Float32Array(meta.pixW * meta.pixH);
    running = true; loop();
  } else if (m.type === 'eyes') {
    for (let k = 0; k < nEye; k++) inP[k] = m.rates[k] * (DT / 1000);
  } else if (m.type === 'taste') tasteHz = m.hz;
  else if (m.type === 'drunk') brain.scale = m.scale;
  else if (m.type === 'pause') { const was = running; running = !m.on; if (running && !was) loop(); }
};

function loop() {
  if (!running) return;
  const t0 = performance.now();
  inP.fill(tasteHz * (DT / 1000), nEye);
  const sp = brain.spikes;
  for (let s = 0; s < WIN / DT; s++) brain.step(inIdx, inP);
  const counts = new Uint16Array(pool.length);
  for (let k = 0; k < pool.length; k++) counts[k] = sp[pool[k]];
  const mn9 = sp[meta.mn9];
  const pix = B.pix;
  for (let i = 0; i < sp.length; i++) if (sp[i]) { heat[pix[i]] += sp[i]; sp[i] = 0; }
  const img = new Uint8Array(heat.length);
  for (let k = 0; k < heat.length; k++) { img[k] = Math.min(255, heat[k] * 6); heat[k] *= 0.8; }
  postMessage({ type: 'tick', ms: WIN, wall: performance.now() - t0, counts, mn9, img }, [counts.buffer, img.buffer]);
  setTimeout(loop, 0);
}
