# Packs the FlyWire whole-brain connectome (v783) into src/assets/flybrain.bin + flybrain.json.
#
# Sources (download into the folder given as argv[1]):
#   Connectivity_783.parquet, Completeness_783.csv   github.com/philshiu/Drosophila_brain_model (MIT)
#   ann.tsv = Supplemental_file1_neuron_annotations.tsv   github.com/flyconnectome/flywire_annotations
#
# Edges are kept only at >= 5 synapses (FlyWire's usual "real connection" threshold): 2.7M of 15.1M
# edges, 63% of the total synaptic weight. ponytail: the browser sim scales weights back up by a gain.
#
# flybrain.bin (little-endian): u32 N, u32 E, u32 rowptr[N+1], u32 edge[E], u16 pix[N]
#   edge = post index (low 18 bits) | signed synapse count (high 14 bits), sorted by pre (CSR)
#   pix  = pixel of the neuron in a front-view brain map (PIX_W x PIX_H), for the activity display
import json, sys
import numpy as np, pandas as pd

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'src/assets'
MIN_SYN, PIX_W, PIX_H = 5, 192, 92

c = pd.read_parquet(f'{src}/Connectivity_783.parquet')
ids = pd.read_csv(f'{src}/Completeness_783.csv', index_col=0).index.to_numpy()
N = len(ids)
c = c[c.Connectivity >= MIN_SYN].sort_values(['Presynaptic_Index', 'Postsynaptic_Index'])
pre, post = c.Presynaptic_Index.to_numpy(), c.Postsynaptic_Index.to_numpy()
w = c['Excitatory x Connectivity'].to_numpy()
assert N < (1 << 18) and np.abs(w).max() < (1 << 13)
rowptr = np.zeros(N + 1, np.uint32); np.add.at(rowptr, pre + 1, 1); rowptr = np.cumsum(rowptr).astype(np.uint32)
edge = (post.astype(np.uint32) | (w.astype(np.int32).astype(np.uint32) << 18)).astype(np.uint32)

a = pd.read_csv(f'{src}/ann.tsv', sep='\t', low_memory=False).drop_duplicates('root_id').set_index('root_id')
a = a.reindex(ids)                                         # row i = model neuron i (14 neurons unannotated)
x, y, z = a.pos_x.to_numpy() * 0.004, a.pos_y.to_numpy() * 0.004, a.pos_z.to_numpy() * 0.04   # voxels -> um
ok = ~np.isnan(x)
px = np.where(ok, (x - np.nanmin(x)) / (np.nanmax(x) - np.nanmin(x)) * (PIX_W - 1), 0).round().astype(int)
py = np.where(ok, (y - np.nanmin(y)) / (np.nanmax(y) - np.nanmin(y)) * (PIX_H - 1), 0).round().astype(int)
pix = (py * PIX_W + px).astype(np.uint16)

# Eyes: the lamina monopolar cells L1-L3, one of each per ommatidium column. Not the photoreceptors:
# those release histamine (inhibitory), so in a spiking model light on them only silences the lamina.
# Real L1-L3 depolarise when the light dims, so the game drives them with darkness.
# Each eye's cells are flattened onto their two main axes (PCA), oriented so
# v = up (FlyWire y runs dorsal -> ventral) and u = front -> side (z runs anterior -> posterior).
# ponytail: approximate retinotopy from cell positions, not measured ommatidial viewing angles.
eyes = {}
for side in ('left', 'right'):
    idx = np.flatnonzero(a.cell_type.isin(['L1', 'L2', 'L3']).to_numpy() & (a.side == side).to_numpy())
    P = np.c_[x[idx], y[idx], z[idx]]; P -= P.mean(0)
    _, _, vt = np.linalg.svd(P, full_matrices=False)
    ax = vt[:2]
    up = ax[np.argmax(np.abs(ax[:, 1]))]; up = -up if up[1] > 0 else up            # dorsal = -y
    rest = ax[np.argmin(np.abs(ax[:, 1]))]; rest = rest if rest[2] > 0 else -rest  # posterior = +z
    norm = lambda s: np.clip((s - np.percentile(s, 1)) / (np.percentile(s, 99) - np.percentile(s, 1)), 0, 1)
    eyes[side] = {'idx': idx.tolist(), 'u': np.round(norm(P @ rest), 3).tolist(), 'v': np.round(norm(P @ up), 3).tolist()}

dn = np.flatnonzero((a.super_class == 'descending').to_numpy())
# Taste -> feeding, straight from Shiu et al.'s example.ipynb: their 21 sugar GRNs, and MN9, the motor
# neuron that extends the proboscis (the paper's headline result: sugar alone drives MN9).
SUGAR = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768,
         720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691,
         720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543,
         720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
         720575940611875570]
MN9 = 720575940660219265
pos = {r: i for i, r in enumerate(ids)}
SUGAR = [s for s in SUGAR if s in pos]           # the list is from FlyWire v630: 20 of 21 ids survive in v783
assert len(SUGAR) == 20 and MN9 in pos
# readout pool for the wheel: the visual projection neurons, which carry vision from the optic lobes into
# the central brain. (Measured with tools/flyprobe.mjs: lane position decodes from them at R2 ~0.8, but
# barely from the descending neurons, so in this spiking model the road doesn't make it to the motor side.)
vpn = np.flatnonzero((a.super_class == 'visual_projection').to_numpy())
visual = np.flatnonzero(a.super_class.isin(['optic', 'visual_projection']).to_numpy())   # whole visual system (~2/3 of the brain)
meta = {
    'N': int(N), 'E': int(len(edge)), 'pixW': PIX_W, 'pixH': PIX_H, 'minSyn': MIN_SYN,
    'eyes': eyes,
    'sugar': [pos[s] for s in SUGAR], 'mn9': pos[MN9], 'vpn': vpn.tolist(), 'visual': visual.tolist(),
    'dn': {'idx': dn.tolist(), 'side': a.side.to_numpy()[dn].tolist(), 'type': a.cell_type.fillna('?').to_numpy()[dn].tolist()},
    'source': 'FlyWire v783 (Dorkenwald et al. 2024, Schlegel et al. 2024); LIF model after Shiu et al. 2024',
}
with open(f'{out}/flybrain.bin', 'wb') as f:
    np.array([N, len(edge)], np.uint32).tofile(f); rowptr.tofile(f); edge.tofile(f); pix.tofile(f)
with open(f'{out}/flybrain.json', 'w') as f:
    json.dump(meta, f, separators=(',', ':'))
print(N, 'neurons', len(edge), 'edges', len(dn), 'DNs', {s: len(e['idx']) for s, e in eyes.items()}, 'lamina cells')
