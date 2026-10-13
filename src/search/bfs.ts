// Which discovered articles the reveal draws, and where (spec §5.4 "Drawn nodes"). The pipeline
// uses the same functions to record the home page's demo, so the demo is drawn like a live search.

// murmur3's 32-bit finaliser: a fixed hash of a map id
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const ANGLE_SALT = 0x9e3779b9;

// How many of a level's `n` new articles to draw: 60% of the remaining budget, or all of what's
// left if the fronts met in this level.
export function drawCount(n: number, remaining: number, met: boolean): number {
  return Math.min(n, met ? remaining : Math.floor(0.6 * remaining));
}

// The same pair always draws the same picture: article `id` is drawn if its hash falls under k / n.
export function isDrawn(id: number, k: number, n: number): boolean {
  return fmix32(id) / 2 ** 32 < k / n;
}

// Polar position: the start's children spread over the full circle; deeper articles stay in
// their parent's sector, which halves with each level.
export function childAngle(id: number, depth: number, parentAngle: number): number {
  const h = fmix32((id ^ ANGLE_SALT) >>> 0) / 2 ** 32;
  if (depth === 1) return h * 2 * Math.PI;
  return parentAngle + ((h - 0.5) * Math.PI) / 2 ** (depth - 1);
}
