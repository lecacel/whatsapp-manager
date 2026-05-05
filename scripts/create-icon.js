#!/usr/bin/env node
// Generate a proper 256x256 PNG icon for WA Manager
// Uses pure Node.js (zlib + raw PNG encoding) - no external dependencies

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Generate raw RGBA pixel data for a 256x256 icon
// Design: Dark rounded rectangle with a white "W" and green circle
function generatePixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 0); // RGBA, transparent

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const cornerRadius = 64;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;

      // Check if inside rounded rectangle
      const insideRect = isInsideRoundedRect(x, y, 0, 0, SIZE, SIZE, cornerRadius);

      if (insideRect) {
        // Background: #061014 (dark)
        pixels[idx] = 6;     // R
        pixels[idx + 1] = 16; // G
        pixels[idx + 2] = 20; // B
        pixels[idx + 3] = 255; // A
      }

      // Draw green circle (top-right)
      const circleCx = 196;
      const circleCy = 62;
      const circleR = 24;
      const distCircle = Math.sqrt((x - circleCx) ** 2 + (y - circleCy) ** 2);
      if (distCircle <= circleR) {
        pixels[idx] = 37;     // R (#25)
        pixels[idx + 1] = 211; // G (#D3)
        pixels[idx + 2] = 102; // B (#66)
        pixels[idx + 3] = 255; // A
      }

      // Draw "W" letter
      if (isInsideW(x, y)) {
        pixels[idx] = 255;    // R
        pixels[idx + 1] = 255; // G
        pixels[idx + 2] = 255; // B
        pixels[idx + 3] = 255; // A
      }
    }
  }

  return pixels;
}

function isInsideRoundedRect(px, py, rx, ry, w, h, r) {
  // Check if point is inside rounded rectangle
  if (px < rx || px >= rx + w || py < ry || py >= ry + h) return false;

  // Check corners
  const corners = [
    { cx: rx + r, cy: ry + r },
    { cx: rx + w - r, cy: ry + r },
    { cx: rx + r, cy: ry + h - r },
    { cx: rx + w - r, cy: ry + h - r }
  ];

  for (const corner of corners) {
    const inCornerX = (px < rx + r && corner.cx === rx + r) || (px > rx + w - r - 1 && corner.cx === rx + w - r);
    const inCornerY = (py < ry + r && corner.cy === ry + r) || (py > ry + h - r - 1 && corner.cy === ry + h - r);

    if (inCornerX && inCornerY) {
      const dist = Math.sqrt((px - corner.cx) ** 2 + (py - corner.cy) ** 2);
      if (dist > r) return false;
    }
  }

  return true;
}

function isInsideW(px, py) {
  // "W" letter bounds - centered in the icon
  const letterLeft = 45;
  const letterRight = 215;
  const letterTop = 60;
  const letterBottom = 180;

  if (px < letterLeft || px > letterRight || py < letterTop || py > letterBottom) return false;

  // Normalize to 0-1 range within letter bounds
  const nx = (px - letterLeft) / (letterRight - letterLeft);
  const ny = (py - letterTop) / (letterBottom - letterTop);

  // Stroke width
  const strokeW = 0.09;

  // "W" consists of 4 diagonal strokes
  // Left outer: from (0, 0) to (0.2, 1)
  if (isNearLine(nx, ny, 0.05, 0, 0.22, 1, strokeW)) return true;
  // Left inner: from (0.25, 0) to (0.5, 1)
  if (isNearLine(nx, ny, 0.28, 0, 0.48, 1, strokeW)) return true;
  // Right inner: from (0.52, 0) to (0.75, 1)
  if (isNearLine(nx, ny, 0.52, 0, 0.78, 1, strokeW)) return true;
  // Right outer: from (0.8, 0) to (0.95, 1)
  if (isNearLine(nx, ny, 0.72, 0, 0.95, 1, strokeW)) return true;

  // Middle V bottom connector
  if (ny > 0.7 && ny < 1.0) {
    const midLeft = 0.35;
    const midRight = 0.65;
    if (nx > midLeft && nx < midRight) {
      // V shape
      const vDepth = (ny - 0.7) / 0.3;
      const vCenter = 0.5;
      const vWidth = 0.15 * (1 - vDepth);
      if (Math.abs(nx - vCenter) < vWidth + strokeW) return true;
    }
  }

  return false;
}

function isNearLine(px, py, x1, y1, x2, y2, thickness) {
  // Distance from point to line segment
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  const dist = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  return dist < thickness;
}

// Encode PNG file
function createPNG(width, height, rgbaPixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    rgbaPixels.copy(
      rawData,
      y * (1 + width * 4) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
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

// CRC32 implementation for PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Main
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

console.log('Generating 256x256 PNG icon...');
const pixels = generatePixels();
const png = createPNG(SIZE, SIZE, pixels);

const iconPath = path.join(assetsDir, 'icon.png');
fs.writeFileSync(iconPath, png);
console.log(`Icon saved to ${iconPath} (${png.length} bytes)`);

// Also create a 16x16 version for tray
const trayPixels = generatePixels();
const trayPng = createPNG(SIZE, SIZE, trayPixels);
const trayPath = path.join(assetsDir, 'tray-icon.png');
fs.writeFileSync(trayPath, trayPng);
console.log(`Tray icon saved to ${trayPath}`);