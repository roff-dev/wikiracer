// Pool rules and difficulty labels. Pure, so they can be tested on small fixtures.

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const EXCLUDE = [
  /^List_of_/,
  /^Index_of_/,
  /^\d{1,4}(_BC)?$/, // bare years
  /^\d{1,4}(_BC)?_in_/, // "1984 in film"
  new RegExp(`^(${MONTHS})_\\d{1,2}$`), // month-day titles
];

// Whether a title (underscore form) may be a course article. Disambiguation pages are dropped by
// their page_props flag, not by title.
export function isPoolTitle(title, disambiguation = false) {
  return !disambiguation && !EXCLUDE.some((re) => re.test(title));
}

// Starting thresholds. Labels order pairs by distance, then by route
// count (fewer routes is harder): Easy up to (easy.d, k >= easy.k), Hard from (hard.d, k < hard.k).
export const START_THRESHOLDS = { easy: { d: 3, k: 20 }, hard: { d: 4, k: 20 } };

export function labelOf(d, k, th = START_THRESHOLDS) {
  if (d < th.easy.d || (d === th.easy.d && k >= th.easy.k)) return 'easy';
  if (d > th.hard.d || (d === th.hard.d && k < th.hard.k)) return 'hard';
  return 'medium';
}

// Difficulty order: higher d is harder; at equal d, fewer routes is harder.
const harder = (a, b) => a.d - b.d || b.k - a.k;

// Thresholds that cut the measured pairs closest to thirds: the boundary pairs at the 1/3 and 2/3
// points, in difficulty order. Equal (d, k) pairs always share a label, so the split is rough.
export function tuneThresholds(pairs) {
  const sorted = [...pairs].sort(harder);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const e = at(1 / 3), h = at(2 / 3);
  // Easy keeps everything no harder than e: (d < e.d) or (d = e.d and k >= e.k)
  // Hard keeps everything harder than h: (d > h.d) or (d = h.d and k < h.k)
  return { easy: { d: e.d, k: e.k }, hard: { d: h.d, k: h.k } };
}

export function split(pairs, th) {
  const out = { easy: 0, medium: 0, hard: 0 };
  for (const p of pairs) out[labelOf(p.d, p.k, th)]++;
  return out;
}

// Seeded PRNG (mulberry32), so a map version always yields the same pools
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
