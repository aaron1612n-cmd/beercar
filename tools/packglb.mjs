// node tools/packglb.mjs <scene.gltf> <out.glb>: packs a .gltf, its one .bin and its texture files into a
// single .glb (the single-file build inlines assets as data: URIs, so relative uris would break).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.log('usage: node tools/packglb.mjs <scene.gltf> <out.glb>'); process.exit(1); }
const dir = dirname(src), g = JSON.parse(readFileSync(src, 'utf8'));
if (g.buffers.length !== 1) throw new Error(`expected 1 buffer, found ${g.buffers.length}`);
const parts = [readFileSync(join(dir, decodeURIComponent(g.buffers[0].uri)))];
let len = parts[0].length;
const pad4 = () => { const p = (4 - (len % 4)) % 4; if (p) { parts.push(Buffer.alloc(p)); len += p; } };
let packed = 0;
for (const img of g.images || []) {
  if (!img.uri) continue;
  pad4();
  const data = readFileSync(join(dir, decodeURIComponent(img.uri)));
  g.bufferViews.push({ buffer: 0, byteOffset: len, byteLength: data.length });
  img.bufferView = g.bufferViews.length - 1;
  img.mimeType = /\.png$/i.test(img.uri) ? 'image/png' : 'image/jpeg';
  delete img.uri; parts.push(data); len += data.length; packed++;
}
pad4();
g.buffers = [{ byteLength: len }];
let json = Buffer.from(JSON.stringify(g));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(parts);
const chunk = (n, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(type, 4); return b; };
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
writeFileSync(out, Buffer.concat([head, chunk(json.length, 0x4e4f534a), json, chunk(bin.length, 0x004e4942), bin]));
console.log(`${out}: ${12 + 16 + json.length + bin.length} bytes, ${packed} images packed`);
