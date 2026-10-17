/**
 * Small, dependency-free mask toolkit for the studio canvas.
 *
 * Masks are a single alpha channel (0 = outside, 255 = inside) at the photo's
 * natural resolution. Everything here is synchronous and operates on typed
 * arrays so strokes stay smooth on a 2 MP photo.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function createMask(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Magic-wand region grow. `tolerance` is 0–100; the seed colour is compared with
 * squared RGB distance so JPEG grain doesn't need a perfect match.
 */
export function wandSelect(
  mask: Uint8Array,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
  value: 0 | 255,
): boolean {
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return false;

  const start = seedY * width + seedX;
  const seed = start * 4;
  const sr = pixels[seed] ?? 0;
  const sg = pixels[seed + 1] ?? 0;
  const sb = pixels[seed + 2] ?? 0;

  const limit = tolerance * tolerance * 3;
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let cursor = 0;
  let changed = false;

  visited[start] = 1;
  stack[cursor++] = start;

  while (cursor > 0) {
    const index = stack[--cursor]!;
    const p = index * 4;
    const dr = (pixels[p] ?? 0) - sr;
    const dg = (pixels[p + 1] ?? 0) - sg;
    const db = (pixels[p + 2] ?? 0) - sb;
    if (dr * dr + dg * dg + db * db > limit) continue;

    if (mask[index] !== value) {
      mask[index] = value;
      changed = true;
    }

    const x = index % width;
    const y = (index - x) / width;
    if (x > 0 && !visited[index - 1]) {
      visited[index - 1] = 1;
      stack[cursor++] = index - 1;
    }
    if (x < width - 1 && !visited[index + 1]) {
      visited[index + 1] = 1;
      stack[cursor++] = index + 1;
    }
    if (y > 0 && !visited[index - width]) {
      visited[index - width] = 1;
      stack[cursor++] = index - width;
    }
    if (y < height - 1 && !visited[index + width]) {
      visited[index + width] = 1;
      stack[cursor++] = index + width;
    }
  }

  return changed;
}

/**
 * Paint a soft round stroke segment into the mask. Returns the affected box so
 * the caller can blit only that region.
 */
export function paintSegment(
  mask: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  value: 0 | 255,
): Rect | null {
  const minX = clamp(Math.floor(Math.min(fromX, toX) - radius - 1), 0, width - 1);
  const maxX = clamp(Math.ceil(Math.max(fromX, toX) + radius + 1), 0, width - 1);
  const minY = clamp(Math.floor(Math.min(fromY, toY) - radius - 1), 0, height - 1);
  const maxY = clamp(Math.ceil(Math.max(fromY, toY) + radius + 1), 0, height - 1);
  if (minX > maxX || minY > maxY) return null;

  const vx = toX - fromX;
  const vy = toY - fromY;
  const lengthSq = vx * vx + vy * vy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x - fromX;
      const py = y - fromY;
      let t = lengthSq === 0 ? 0 : (px * vx + py * vy) / lengthSq;
      t = clamp(t, 0, 1);
      const dx = px - vx * t;
      const dy = py - vy * t;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const coverage = clamp(radius + 0.5 - distance, 0, 1);
      if (coverage <= 0) continue;

      const index = y * width + x;
      const next = coverage * 255;
      const current = mask[index] ?? 0;
      mask[index] = value === 255 ? Math.max(current, next) : Math.min(current, 255 - next);
    }
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function invertMask(mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = 255 - (mask[i] ?? 0);
  }
}

export function countMask(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if ((mask[i] ?? 0) > 127) count += 1;
  }
  return count;
}

export function maskCoverage(mask: Uint8Array): number {
  if (mask.length === 0) return 0;
  return (countMask(mask) / mask.length) * 100;
}

/**
 * Boundary pixel indices, used for the marching-ants overlay. Computed once per
 * mask change, not per animation frame.
 */
export function maskEdges(mask: Uint8Array, width: number, height: number): Int32Array {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((mask[index] ?? 0) <= 127) continue;
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        (mask[index - 1] ?? 0) <= 127 ||
        (mask[index + 1] ?? 0) <= 127 ||
        (mask[index - width] ?? 0) <= 127 ||
        (mask[index + width] ?? 0) <= 127
      ) {
        count += 1;
      }
    }
  }

  const edges = new Int32Array(count);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((mask[index] ?? 0) <= 127) continue;
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        (mask[index - 1] ?? 0) <= 127 ||
        (mask[index + 1] ?? 0) <= 127 ||
        (mask[index - width] ?? 0) <= 127 ||
        (mask[index + width] ?? 0) <= 127
      ) {
        edges[cursor++] = index;
      }
    }
  }
  return edges;
}
