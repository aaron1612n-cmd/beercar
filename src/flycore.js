// Whole-brain fruit fly: every neuron of the FlyWire connectome as a leaky integrate-and-fire cell,
// with the parameters of Shiu et al. 2024 (Nature, "A Drosophila computational brain model reveals
// sensorimotor processing"). Synapse weight = signed synapse count x W_SYN; the sign comes from the
// presynaptic cell's predicted neurotransmitter (in the data). The wiring never changes here.
//   dv/dt = (V0 - v + g) / T_MBR      dg/dt = -g / TAU      spike at V_TH -> v = V_RST, g = 0, refractory
// Shared by the game's Web Worker (flybrain.worker.js) and the Node checks (tools/flycheck.mjs).
export const P = { V0: -52, V_RST: -52, V_TH: -45, T_MBR: 20, TAU: 5, T_RFC: 2.2, T_DLY: 1.8, W_SYN: 0.275 };

export function parseBrain(buf) {
  const head = new Uint32Array(buf, 0, 2), N = head[0], E = head[1];
  const rowptr = new Uint32Array(buf, 8, N + 1);
  const edge = new Uint32Array(buf, 8 + (N + 1) * 4, E);
  const pix = new Uint16Array(buf, 8 + (N + 1 + E) * 4, N);
  return { N, E, rowptr, edge, pix };
}

// dt in ms. gain rescales every weight: the packed file keeps only >= 5-synapse edges (63% of the
// total weight), so the default 1.6 puts the summed drive back where the full connectome had it.
// Cells at rest are skipped cheaply. On a 2017 laptop CPU this runs ~0.4x real time at dt = 1 ms.
// ponytail: single thread; split across workers (needs SharedArrayBuffer + COOP/COEP) if it must go faster.
// tone (mV) lifts resting potentials toward threshold, like the background activity a living brain has;
// toneCells = which cells get it (all if omitted). 0 = Shiu's silent-at-rest model. The game tones only
// the visual system: toning everything quiets the taste -> MN9 feeding pathway (56 Hz -> 6 Hz).
export function makeBrain({ N, rowptr, edge }, { dt = 0.5, gain = 1.6, tone = 0, toneCells = null } = {}) {
  const VTH = P.V_TH, R = new Float32Array(N).fill(P.V0);       // R = each cell's resting potential
  if (toneCells) for (const i of toneCells) R[i] += tone; else R.fill(P.V0 + tone);
  const v = Float32Array.from(R), g = new Float32Array(N), ref = new Float32Array(N);
  const D = Math.max(1, Math.round(P.T_DLY / dt));               // synaptic delay in steps
  const pend = Array.from({ length: D }, () => new Float32Array(N));   // ring of delayed g increments
  const w = new Float32Array(edge.length), post = new Uint32Array(edge.length);
  for (let e = 0; e < edge.length; e++) { post[e] = edge[e] & 0x3ffff; w[e] = (edge[e] >> 18) * P.W_SYN * gain; }
  const dv = Math.exp(-dt / P.T_MBR), dg = Math.exp(-dt / P.TAU), EPS = 0.02;
  const spikes = new Uint32Array(N);                             // spikes per neuron, caller zeroes
  const fired = new Uint32Array(N);
  let slot = 0, t = 0, scale = 1;                                // scale: every synapse at once (alcohol)

  // inIdx = driven cells, inP = their spike probability this step (Shiu drives inputs with a Poisson
  // train strong enough that every input event is a spike).
  function step(inIdx, inP) {
    const arrive = pend[slot];
    let nf = 0;
    for (let k = 0; k < inIdx.length; k++) {
      const i = inIdx[k];
      if (ref[i] <= 0 && Math.random() < inP[k]) v[i] = VTH + 1;
    }
    for (let i = 0; i < N; i++) {
      const a = arrive[i], gi0 = g[i], vi0 = v[i];
      const V0 = R[i];
      if (a === 0 && gi0 === 0 && vi0 === V0 && ref[i] === 0) continue;         // at rest: nothing to do (most cells, most steps)
      arrive[i] = 0;
      if (ref[i] > 0) { if ((ref[i] -= dt) <= 0) ref[i] = 0; continue; }   // "unless refractory": input lost
      const gi = gi0 + a;
      const vi = vi0 > VTH ? vi0 : V0 + gi + (vi0 - V0 - gi) * dv;
      if (vi > VTH) { v[i] = V0; g[i] = 0; ref[i] = P.T_RFC; fired[nf++] = i; continue; }
      if (vi - V0 < EPS && V0 - vi < EPS && gi < EPS && -gi < EPS) { v[i] = V0; g[i] = 0; }   // snap back to rest
      else { v[i] = vi; g[i] = gi * dg; }
    }
    for (let f = 0; f < nf; f++) {                                // this slot was just emptied: lands D steps from now
      const i = fired[f]; spikes[i]++;
      for (let e = rowptr[i], e1 = rowptr[i + 1]; e < e1; e++) arrive[post[e]] += w[e] * scale;
    }
    slot = (slot + 1) % D; t += dt;
    return nf;
  }
  return { N, dt, v, g, spikes, step, get t() { return t; }, set scale(k) { scale = k; } };
}
