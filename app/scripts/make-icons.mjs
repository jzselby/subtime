/**
 * Generate the PWA icons as real PNGs at build time.
 *
 * Hand-rolled rather than pulling in an image library: the icon is flat colour
 * and a couple of shapes, so a minimal PNG encoder (zlib + CRC32, both in Node
 * core) is far less weight than a dependency. Output is deterministic, so the
 * committed icons never churn.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** @param {(x:number,y:number)=>[number,number,number]} shade */
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [15, 23, 32];
const RING = [56, 189, 138];
const DIAL = [232, 240, 245];

/**
 * A stopwatch: outer ring, a hand pointing to two o'clock, and a crown.
 * Drawn with 3× supersampling so the curves are not jagged.
 */
const icon = (size) => (px, py) => {
  const S = 3;
  let acc = [0, 0, 0];
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const x = ((px + (sx + 0.5) / S) / size) * 2 - 1;
      const y = ((py + (sy + 0.5) / S) / size) * 2 - 1;
      acc = add(acc, sample(x, y));
    }
  }
  return acc.map((v) => Math.round(v / (S * S)));
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function sample(x, y) {
  const cy = y + 0.06; // shift the dial down to leave room for the crown
  const r = Math.hypot(x, cy);

  // Crown: a small stem on top.
  if (Math.abs(x) < 0.1 && cy > -0.92 && cy < -0.66) return RING;

  if (r > 0.78) return BG;
  if (r > 0.62) return RING; // outer ring
  if (r > 0.58) return BG; // gap inside the ring

  // Hand: a wedge from the centre toward two o'clock.
  const angle = Math.atan2(cy, x);
  const target = -Math.PI / 3.4;
  let delta = Math.abs(angle - target);
  if (delta > Math.PI) delta = 2 * Math.PI - delta;
  if (r < 0.46 && delta < 0.13) return DIAL;
  if (r < 0.07) return DIAL; // centre pin

  return BG;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT, name), png(size, icon(size)));
}
console.log(`icons written to ${OUT}`);
