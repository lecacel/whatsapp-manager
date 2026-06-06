#!/usr/bin/env node
// Generate a proper multi-size ICO + PNG icon for MS-ALL
// Red background with WhatsApp-style phone icon (white)
// Uses pure Node.js (zlib + raw PNG encoding) - no external dependencies

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Pixel generator ─────────────────────────────────────────────────────────
function generatePixels(SIZE) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const cornerRadius = SIZE * 0.25;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;

      // Red rounded-rect background
      if (isInsideRoundedRect(x, y, 0, 0, SIZE, SIZE, cornerRadius)) {
        pixels[idx]     = 220;  // R  (slightly darker red for better looks)
        pixels[idx + 1] = 20;   // G
        pixels[idx + 2] = 20;   // B
        pixels[idx + 3] = 255;  // A
      }

      // White WhatsApp-style phone in a circle
      if (isInsideRoundedRect(x, y, 0, 0, SIZE, SIZE, cornerRadius)) {
        const scale = SIZE / 256;

        // Outer circle ring
        const r = 80 * scale;
        const ringW = 10 * scale;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= r && dist >= r - ringW) {
          pixels[idx]     = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 255;
        }

        // Tail triangle (bottom-left of circle)
        const tx1 = cx - r * 0.55;
        const ty1 = cy + r * 0.7;
        const tx2 = cx - r * 0.9;
        const ty2 = cy + r * 1.0;
        const tx3 = cx - r * 0.2;
        const ty3 = cy + r * 0.95;
        if (isInsideTriangle(x, y, tx1, ty1, tx2, ty2, tx3, ty3)) {
          pixels[idx]     = 220;
          pixels[idx + 1] = 20;
          pixels[idx + 2] = 20;
          pixels[idx + 3] = 255;
        }
        // Re-draw the outer arc border over where the tail cut it
        // (handled by drawing tail AFTER circle)

        // Phone handset (white) inside the circle
        if (dist < r - ringW && isInsideHandset(x, y, cx, cy, scale)) {
          pixels[idx]     = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 255;
        }
      }
    }
  }

  return pixels;
}

function isInsideHandset(px, py, cx, cy, scale) {
  // Rotate coordinate system -35 degrees around center
  const angle = -35 * Math.PI / 180;
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);

  const s = scale;
  // Main body (thin vertical bar)
  if (rx > -7 * s && rx < 7 * s && ry > -28 * s && ry < 28 * s) return true;

  // Top cap (earpiece)
  if (ry > -36 * s && ry < -22 * s && rx > -18 * s && rx < 8 * s) return true;
  // Bottom cap (mouthpiece)
  if (ry > 22 * s && ry < 36 * s && rx > -18 * s && rx < 8 * s) return true;

  return false;
}

function isInsideTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

function sign(px, py, x1, y1, x2, y2) {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
}

function isInsideRoundedRect(px, py, rx, ry, w, h, r) {
  if (px < rx || px >= rx + w || py < ry || py >= ry + h) return false;
  const corners = [
    { cx: rx + r,     cy: ry + r },
    { cx: rx + w - r, cy: ry + r },
    { cx: rx + r,     cy: ry + h - r },
    { cx: rx + w - r, cy: ry + h - r }
  ];
  for (const corner of corners) {
    const inCornerX = (px < rx + r && corner.cx === rx + r) || (px >= rx + w - r && corner.cx === rx + w - r);
    const inCornerY = (py < ry + r && corner.cy === ry + r) || (py >= ry + h - r && corner.cy === ry + h - r);
    if (inCornerX && inCornerY) {
      const dist = Math.sqrt((px - corner.cx) ** 2 + (py - corner.cy) ** 2);
      if (dist > r) return false;
    }
  }
  return true;
}

// ── PNG encoder ─────────────────────────────────────────────────────────────
function createPNG(width, height, rgbaPixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; // RGBA
  const ihdr = createChunk('IHDR', ihdrData);

  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rgbaPixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = createChunk('IDAT', zlib.deflateSync(rawData, { level: 9 }));
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── ICO builder ─────────────────────────────────────────────────────────────
function createICO(pngBuffers) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let dataOffset = headerSize + dirEntrySize * numImages;

  const entries = pngBuffers.map(img => {
    const entry = { ...img, offset: dataOffset };
    dataOffset += img.png.length;
    return entry;
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);          // ICO type
  header.writeUInt16LE(numImages, 4);

  const dirBuf = Buffer.alloc(dirEntrySize * numImages);
  entries.forEach((e, i) => {
    const off = i * dirEntrySize;
    dirBuf.writeUInt8(e.width >= 256 ? 0 : e.width, off);
    dirBuf.writeUInt8(e.height >= 256 ? 0 : e.height, off + 1);
    dirBuf.writeUInt8(0, off + 2);
    dirBuf.writeUInt8(0, off + 3);
    dirBuf.writeUInt16LE(1, off + 4);
    dirBuf.writeUInt16LE(32, off + 6);
    dirBuf.writeUInt32LE(e.png.length, off + 8);
    dirBuf.writeUInt32LE(e.offset, off + 12);
  });

  return Buffer.concat([header, dirBuf, ...entries.map(e => e.png)]);
}

// ── Main ────────────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

console.log('Generating icons...');

// Sizes needed: 256, 128, 64, 48, 32, 16
const SIZES = [256, 128, 64, 48, 32, 16];
const pngMap = {};
for (const sz of SIZES) {
  console.log(`  Generating ${sz}x${sz}...`);
  const pixels = generatePixels(sz);
  pngMap[sz] = createPNG(sz, sz, pixels);
}

// Save main 256x256 PNG
const iconPngPath = path.join(assetsDir, 'icon.png');
fs.writeFileSync(iconPngPath, pngMap[256]);
console.log(`icon.png saved (${pngMap[256].length} bytes)`);

// Save tray icon (32x32 is good for tray)
const trayPngPath = path.join(assetsDir, 'tray-icon.png');
fs.writeFileSync(trayPngPath, pngMap[32]);
console.log(`tray-icon.png saved (${pngMap[32].length} bytes)`);

// Build ICO with all sizes (256, 128, 64, 48, 32, 16)
const icoPngBuffers = SIZES.map(sz => ({ width: sz, height: sz, png: pngMap[sz] }));
const ico = createICO(icoPngBuffers);
const icoPath = path.join(assetsDir, 'icon.ico');
fs.writeFileSync(icoPath, ico);
console.log(`icon.ico saved (${ico.length} bytes, sizes: ${SIZES.join(', ')})`);

console.log('\nAll icons generated successfully!');
