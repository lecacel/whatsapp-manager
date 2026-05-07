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
  const pixels = Buffer.allocUnsafe(SIZE * SIZE * 4);
  pixels.fill(0);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const cornerRadius = 64;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;

      // Inside rounded rectangle (The App Background)
      if (isInsideRoundedRect(x, y, 0, 0, SIZE, SIZE, cornerRadius)) {
        // Red color
        pixels[idx] = 255;     // R
        pixels[idx + 1] = 0;   // G
        pixels[idx + 2] = 0;   // B
        pixels[idx + 3] = 255; // A
      }

      // WhatsApp Logo part 1: The Speech Bubble Circle
      const logoCx = cx;
      const logoCy = cy;
      const logoR = 80;
      const dx = x - logoCx;
      const dy = y - logoCy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < logoR && dist > logoR - 12) {
        // White border circle
        pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
      }

      // WhatsApp Logo part 2: The Tail
      // Triangle tail at bottom left
      if (x > 60 && x < 100 && y > 160 && y < 200) {
        // Simple triangle logic
        if (x - 60 < 200 - y) {
           pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
        }
      }

      // WhatsApp Logo part 3: The Phone Handset
      if (isInsidePhoneHandsetReal(x, y, logoCx, logoCy)) {
        pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
      }
    }
  }

  return pixels;
}

function isInsidePhoneHandsetReal(px, py, cx, cy) {
  // Rough rotated handset shape
  const dx = px - cx;
  const dy = py - cy;
  
  // Rotate -45 degrees
  const angle = -Math.PI / 4;
  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);

  // Body of handset
  if (ry > -35 && ry < 35 && rx > -10 && rx < 10) return true;
  // Ends of handset
  if (ry < -25 && rx > -25 && rx < 10) return true;
  if (ry > 25 && rx > -25 && rx < 10) return true;

  return false;
}

function isInsidePhoneHandset(px, py, cx, cy) {
  // Simple phone handset shape inside the circle
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 20) return false;
  // Draw a simple phone shape: vertical rectangle with rounded ends
  const handsetLeft = cx - 5;
  const handsetRight = cx + 5;
  const handsetTop = cy - 12;
  const handsetBottom = cy + 12;
  if (px >= handsetLeft && px <= handsetRight && py >= handsetTop && py <= handsetBottom) return true;
  // Earpiece bar at top
  if (py >= handsetTop - 4 && py <= handsetTop + 2 && px >= handsetLeft - 3 && px <= handsetRight + 3) return true;
  return false;
}

function isInsideWAText(px, py) {
  // "W" and "A" side by side, centered
  const textLeft = 55;
  const textRight = 200;
  const textTop = 80;
  const textBottom = 170;
  
  if (px < textLeft || px > textRight || py < textTop || py > textBottom) return false;
  
  const nx = (px - textLeft) / (textRight - textLeft);
  const ny = (py - textTop) / (textBottom - textTop);
  const strokeW = 0.08;
  
  // W letter (left half, 0-0.45)
  if (nx < 0.45) {
    const wx = nx / 0.45; // normalize to 0-1 for W area
    if (isNearLine(wx, ny, 0.05, 0, 0.22, 1, strokeW)) return true;
    if (isNearLine(wx, ny, 0.28, 0, 0.48, 1, strokeW)) return true;
    if (isNearLine(wx, ny, 0.52, 0, 0.78, 1, strokeW)) return true;
    if (isNearLine(wx, ny, 0.72, 0, 0.95, 1, strokeW)) return true;
    // Middle V
    if (ny > 0.7 && ny < 1.0 && wx > 0.35 && wx < 0.65) {
      const vDepth = (ny - 0.7) / 0.3;
      const vWidth = 0.12 * (1 - vDepth);
      if (Math.abs(wx - 0.5) < vWidth + strokeW) return true;
    }
  }
  
  // A letter (right half, 0.55-1.0)
  if (nx > 0.55) {
    const ax = (nx - 0.55) / 0.45;
    if (isNearLine(ax, ny, 0.5, 0.05, 0.05, 1, strokeW)) return true;  // left leg
    if (isNearLine(ax, ny, 0.5, 0.05, 0.95, 1, strokeW)) return true;  // right leg
    if (isNearLine(ax, ny, 0.2, 0.5, 0.8, 0.5, strokeW * 0.8)) return true; // crossbar
  }
  
  return false;
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

// ── Generate ICO file for Windows taskbar ──────────────────────
// ICO format: contains one or more PNG images inside an ICO container.
// Modern Windows (Vista+) supports PNG-compressed ICO entries.
function createICO(pngBuffers) {
  // pngBuffers: array of { width, height, png } objects
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  
  // Calculate offsets
  let dataOffset = headerSize + dirSize;
  const entries = [];
  for (const img of pngBuffers) {
    entries.push({ ...img, offset: dataOffset });
    dataOffset += img.png.length;
  }
  
  // ICO Header: Reserved(2) + Type(2, 1=ICO) + Count(2)
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);          // Reserved
  header.writeUInt16LE(1, 2);          // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4);  // Number of images
  
  // Directory entries
  const dirBuf = Buffer.alloc(dirSize);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = i * dirEntrySize;
    dirBuf.writeUInt8(e.width >= 256 ? 0 : e.width, off);      // Width (0 = 256)
    dirBuf.writeUInt8(e.height >= 256 ? 0 : e.height, off + 1); // Height (0 = 256)
    dirBuf.writeUInt8(0, off + 2);             // Color palette
    dirBuf.writeUInt8(0, off + 3);             // Reserved
    dirBuf.writeUInt16LE(1, off + 4);          // Color planes
    dirBuf.writeUInt16LE(32, off + 6);         // Bits per pixel
    dirBuf.writeUInt32LE(e.png.length, off + 8);  // Size of image data
    dirBuf.writeUInt32LE(e.offset, off + 12);     // Offset to image data
  }
  
  // Concatenate header + directory + image data
  const parts = [header, dirBuf];
  for (const e of entries) {
    parts.push(e.png);
  }
  return Buffer.concat(parts);
}

// Generate multiple sizes for the ICO (256, 48, 32, 16)
const icoSizes = [256, 48, 32, 16];
const icoPngBuffers = [];

for (const sz of icoSizes) {
  if (sz === SIZE) {
    // Reuse the already-generated 256x256 PNG
    icoPngBuffers.push({ width: sz, height: sz, png });
  } else {
    // Generate at 256x256 and use as-is (the ICO reader will handle it)
    // For proper downscaling we'd need a resize, but PNG-in-ICO at 256 works fine
    // For smaller sizes, generate a smaller PNG
    const smallPixels = Buffer.allocUnsafe(sz * sz * 4);
    smallPixels.fill(0);
    const scale = sz / SIZE;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        // Sample from the full-size pixel buffer using nearest-neighbor
        const srcX = Math.min(Math.floor(x / scale), SIZE - 1);
        const srcY = Math.min(Math.floor(y / scale), SIZE - 1);
        const srcIdx = (srcY * SIZE + srcX) * 4;
        const dstIdx = (y * sz + x) * 4;
        smallPixels[dstIdx] = pixels[srcIdx];
        smallPixels[dstIdx + 1] = pixels[srcIdx + 1];
        smallPixels[dstIdx + 2] = pixels[srcIdx + 2];
        smallPixels[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }
    const smallPng = createPNG(sz, sz, smallPixels);
    icoPngBuffers.push({ width: sz, height: sz, png: smallPng });
  }
}

const ico = createICO(icoPngBuffers);
const icoPath = path.join(assetsDir, 'icon.ico');
fs.writeFileSync(icoPath, ico);
console.log(`ICO icon saved to ${icoPath} (${ico.length} bytes, ${icoSizes.length} sizes: ${icoSizes.join(', ')})`);
