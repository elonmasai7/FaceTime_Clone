const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const OUT_DIR = path.join(__dirname, '..', 'build', 'icons');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function insideRoundedRect(x, y, rx, ry, rw, rh, rr) {
  const cx = clamp(x, rx + rr, rx + rw - rr);
  const cy = clamp(y, ry + rr, ry + rh - rr);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rr * rr;
}

function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const area = (x1, y1, x2, y2, x3, y3) => Math.abs((x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)) / 2);
  const a = area(ax, ay, bx, by, cx, cy);
  const a1 = area(px, py, bx, by, cx, cy);
  const a2 = area(ax, ay, px, py, cx, cy);
  const a3 = area(ax, ay, bx, by, px, py);
  return Math.abs(a - (a1 + a2 + a3)) < 0.5;
}

function pixelColor(x, y, w, h) {
  const nx = (x + 0.5) / w;
  const ny = (y + 0.5) / h;

  const dx = nx - 0.5;
  const dy = ny - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy);

  const top = { r: 245, g: 252, b: 247 };
  const bottom = { r: 193, g: 237, b: 206 };
  const t = clamp(ny * 1.2 + d * 0.35, 0, 1);

  let r = mix(top.r, bottom.r, t);
  let g = mix(top.g, bottom.g, t);
  let b = mix(top.b, bottom.b, t);

  const ringR = 0.36;
  const ring = d < ringR;
  if (ring) {
    const ct = clamp(d / ringR, 0, 1);
    r = mix(46, 28, ct);
    g = mix(198, 146, ct);
    b = mix(99, 74, ct);
  }

  const bodyW = 0.33;
  const bodyH = 0.20;
  const bodyX = 0.5 - bodyW / 2;
  const bodyY = 0.5 - bodyH / 2;
  const rr = 0.035;
  const lensInset = 0.016;

  const inBody = insideRoundedRect(nx, ny, bodyX, bodyY, bodyW, bodyH, rr);
  if (inBody) {
    r = 245;
    g = 252;
    b = 247;
  }

  const inLens = insideRoundedRect(
    nx,
    ny,
    bodyX + lensInset,
    bodyY + lensInset,
    bodyW - lensInset * 2,
    bodyH - lensInset * 2,
    rr * 0.8
  );
  if (inLens) {
    r = 226;
    g = 245;
    b = 234;
  }

  const tx1 = bodyX + bodyW;
  const ty1 = 0.5;
  const tx2 = tx1 + 0.11;
  const ty2 = 0.5 - 0.075;
  const tx3 = tx2;
  const ty3 = 0.5 + 0.075;
  if (insideTriangle(nx, ny, tx1, ty1, tx2, ty2, tx3, ty3)) {
    r = 245;
    g = 252;
    b = 247;
  }

  const sparkleDx = nx - 0.73;
  const sparkleDy = ny - 0.29;
  if (sparkleDx * sparkleDx + sparkleDy * sparkleDy < 0.006) {
    r = 255;
    g = 255;
    b = 255;
  }

  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

function makePng(size) {
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelColor(x, y, size, size);
      const p = rowStart + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    pngSig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const file = path.join(OUT_DIR, `${size}x${size}.png`);
    fs.writeFileSync(file, makePng(size));
  }

  fs.copyFileSync(path.join(OUT_DIR, '512x512.png'), path.join(OUT_DIR, 'icon.png'));
  console.log(`Generated icons in ${OUT_DIR}`);
}

main();
