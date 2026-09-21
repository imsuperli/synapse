import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(root, 'assets');

function writePng(filePath, size, renderer) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a = 255] = renderer(x, y, size);
      const idx = (size * y + x) << 2;
      png.data[idx] = clamp(r);
      png.data[idx + 1] = clamp(g);
      png.data[idx + 2] = clamp(b);
      png.data[idx + 3] = clamp(a);
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function roundedRectMask(x, y, size, radius) {
  const px = x + 0.5;
  const py = y + 0.5;
  const cx = Math.max(radius, Math.min(size - radius, px));
  const cy = Math.max(radius, Math.min(size - radius, py));
  const dist = Math.hypot(px - cx, py - cy);
  return 1 - smoothstep(radius - 1.5, radius + 1.5, dist);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function signedDistanceToSynapseMark(nx, ny) {
  const left = distanceToSegment(nx, ny, -0.44, 0.19, -0.16, -0.08);
  const middle = distanceToSegment(nx, ny, -0.16, -0.08, 0.1, 0.21);
  const right = distanceToSegment(nx, ny, 0.1, 0.21, 0.46, -0.24);
  const center = distanceToSegment(nx, ny, -0.26, 0.0, 0.34, 0.0);
  const terminal = distanceToSegment(nx, ny, -0.38, 0.31, -0.21, 0.31);
  return Math.min(left, middle, right, center * 1.2, terminal);
}

function iconPixel(x, y, size, options = {}) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const centeredX = nx * 2 - 1;
  const centeredY = ny * 2 - 1;
  const mask = options.square ? 1 : roundedRectMask(x, y, size, size * 0.22);
  if (mask <= 0) {
    return [0, 0, 0, 0];
  }

  const base = mix([8, 16, 22], [12, 46, 50], Math.max(0, centeredY * 0.5 + 0.5));
  const edgeGlow = Math.max(0, 1 - Math.hypot(centeredX * 0.9, centeredY * 0.9));
  const cyanGlow = Math.max(0, 1 - Math.hypot(centeredX + 0.28, centeredY - 0.22) * 1.55);
  const amberGlow = Math.max(0, 1 - Math.hypot(centeredX - 0.42, centeredY + 0.4) * 1.8);
  let color = [
    base[0] + edgeGlow * 14 + cyanGlow * 26 + amberGlow * 34,
    base[1] + edgeGlow * 16 + cyanGlow * 68 + amberGlow * 24,
    base[2] + edgeGlow * 19 + cyanGlow * 77 + amberGlow * 8,
  ];

  const markDistance = signedDistanceToSynapseMark(centeredX, centeredY);
  const mark = 1 - smoothstep(0.026, 0.047, markDistance);
  const markCore = 1 - smoothstep(0.0, 0.018, markDistance);
  const nodeA = 1 - smoothstep(0.055, 0.085, Math.hypot(centeredX + 0.44, centeredY - 0.19));
  const nodeB = 1 - smoothstep(0.055, 0.085, Math.hypot(centeredX - 0.46, centeredY + 0.24));
  const nodeC = 1 - smoothstep(0.047, 0.073, Math.hypot(centeredX + 0.16, centeredY + 0.08));
  const accent = Math.max(mark, nodeA, nodeB, nodeC);
  const core = Math.max(markCore, nodeA * 0.9, nodeB * 0.9, nodeC * 0.9);

  color = mix(color, [67, 229, 223], accent * 0.92);
  color = mix(color, [236, 252, 255], core * 0.7);

  const border = smoothstep(0.0, 0.05, Math.min(nx, ny, 1 - nx, 1 - ny));
  color = mix([5, 8, 11], color, border);

  return [color[0], color[1], color[2], 255 * mask];
}

function splashPixel(x, y, size) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const bg = mix([10, 15, 19], [17, 38, 40], ny);
  const cx = (nx - 0.5) * 1.35;
  const cy = (ny - 0.45) * 1.35;
  const glow = Math.max(0, 1 - Math.hypot(cx, cy) * 1.9);
  const color = [bg[0] + glow * 22, bg[1] + glow * 78, bg[2] + glow * 83];

  const iconSize = size * 0.46;
  const left = (size - iconSize) / 2;
  const top = size * 0.2;
  if (x >= left && x < left + iconSize && y >= top && y < top + iconSize) {
    const ix = ((x - left) / iconSize) * size;
    const iy = ((y - top) / iconSize) * size;
    const icon = iconPixel(ix, iy, size);
    const alpha = icon[3] / 255;
    return mix(color, icon, alpha);
  }

  const underlineY = 0.74;
  const underlineX = Math.abs(nx - 0.5);
  const underline = (1 - smoothstep(0.003, 0.009, Math.abs(ny - underlineY))) * (1 - smoothstep(0.19, 0.25, underlineX));
  return mix(color, [67, 229, 223], underline * 0.65);
}

fs.mkdirSync(assetsDir, { recursive: true });
writePng(path.join(assetsDir, 'icon.png'), 1024, iconPixel);
writePng(path.join(assetsDir, 'adaptive-icon.png'), 1024, (x, y, size) => iconPixel(x, y, size, { square: true }));
writePng(path.join(assetsDir, 'splash-icon.png'), 1024, splashPixel);
writePng(path.join(assetsDir, 'favicon.png'), 48, iconPixel);
