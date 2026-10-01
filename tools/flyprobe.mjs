// Dumps (lane offset, heading, DN spike counts) for random static road views to a CSV, so a regression
// can say whether the descending neurons encode where the car is. node tools/flyprobe.mjs [samples] [out.csv]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBrain, makeBrain } from '../src/flycore.js';
import { eyeDir } from '../src/flypilot.js';

const NS = +(process.argv[2] || 300), OUT = process.argv[3] || 'probe.csv', POP = process.env.POP || 'dn';
const file = readFileSync(new URL('../src/assets/flybrain.bin', import.meta.url));
const B = parseBrain(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const meta = JSON.parse(readFileSync(new URL('../src/assets/flybrain.json', import.meta.url), 'utf8'));
const cells = [];
for (const side of ['left', 'right']) { const e = meta.eyes[side]; e.idx.forEach((i, k) => cells.push({ i, ...eyeDir(side, e.u[k], e.v[k]) })); }
const inIdx = Uint32Array.from(cells, (c) => c.i), inP = new Float32Array(cells.length);
const H = 1.1;
function dark(x, th, az, el) {
  if (el >= -0.002) return 0.15;
  const d = H / Math.tan(-el), a = th + az;
  if (Math.cos(a) * d > 300 || Math.cos(a) <= 0 && d > 30) return 0.45;
  const X = Math.abs(x + Math.sin(a) * d);
  return X < 0.06 ? 0.3 : X < 3.75 ? 0.82 : X < 3.85 ? 0.1 : X < 4.75 ? 0.55 : 0.68;
}
const pop = POP === 'dn' ? meta.dn.idx : null;
const brain = makeBrain(B, { dt: 1, tone: +(process.env.TONE || 0) });
const rows = [], all = [];
for (let s = 0; s < NS; s++) {
  const x = -1 + Math.random() * 5.5, th = (Math.random() - 0.5) * 0.6;
  const dk = cells.map((c) => dark(x, th, c.az, c.el));
  if (process.env.MODE === 'contrast') {                        // adapt to the mean, respond to contrast
    const m = dk.reduce((a, b) => a + b, 0) / dk.length, sd = Math.sqrt(dk.reduce((a, b) => a + (b - m) ** 2, 0) / dk.length) || 1;
    for (let k = 0; k < cells.length; k++) inP[k] = Math.max(0, Math.min(250, 40 + 80 * (dk[k] - m) / sd)) / 1000;
  } else for (let k = 0; k < cells.length; k++) inP[k] = (5 + 120 * dk[k]) / 1000;
  for (let k = 0; k < 40; k++) brain.step(inIdx, inP);
  if (pop) for (const i of pop) brain.spikes[i] = 0; else brain.spikes.fill(0);
  for (let k = 0; k < +(process.env.WIN || 100); k++) brain.step(inIdx, inP);
  if (pop) rows.push([x.toFixed(3), th.toFixed(4), ...pop.map((i) => brain.spikes[i])].join(','));
  else { rows.push(`${x.toFixed(3)},${th.toFixed(4)}`); all.push(Uint16Array.from(brain.spikes)); }
  if (s % 50 === 0) process.stderr.write(`${s} `);
}
writeFileSync(OUT, rows.join('\n'));
if (!pop) {                                                      // whole brain: + raw u16 spikes per sample
  writeFileSync(OUT + '.u16', Buffer.concat(all.map((a) => Buffer.from(a.buffer))));
}
