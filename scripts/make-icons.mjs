/**
 * Minimal dependency-free PNG encoder used to generate the extension icons at
 * build time. Draws a rounded square with a check mark - deterministic output,
 * so no binary assets need to live in the repo.
 */
import { deflateSync } from 'node:zlib';

const BG = [37, 99, 235]; // blue
const FG = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size */
export function makeIcon(size) {
  const px = (x, y) => {
    const r = size / 2;
    const dx = Math.abs(x - r + 0.5);
    const dy = Math.abs(y - r + 0.5);
    const corner = r * 0.62;
    // Rounded-square mask.
    const outside =
      dx > corner && dy > corner
        ? Math.hypot(dx - corner, dy - corner) > r - corner
        : dx > r || dy > r;
    if (outside) return [0, 0, 0, 0];

    // Check mark: two strokes in normalised coordinates.
    const nx = x / size;
    const ny = y / size;
    const w = 0.075;
    const onStroke =
      (ny > 0.42 && ny < 0.78 && Math.abs(nx - (0.14 + (ny - 0.42) * 0.62)) < w) ||
      (ny > 0.3 && ny < 0.78 && Math.abs(nx - (0.83 - (0.78 - ny) * 0.9)) < w);
    return onStroke ? [...FG, 255] : [...BG, 255];
  };

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
