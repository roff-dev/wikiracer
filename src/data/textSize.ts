// The article's text size, picked in the race menu and kept on this device. Pinching to zoom on a
// phone risks tapping a link, so this is the way to make the text bigger.
import { readJson, writeJson } from './storage';

export const TEXT_SIZES = [0.9, 1, 1.15, 1.3, 1.5];
const KEY = 'wikiracer.textSize';

export function readTextSize(): number {
  const v = readJson<number>(KEY, 1);
  return TEXT_SIZES.includes(v) ? v : 1;
}

// One step smaller (-1) or bigger (+1), saved; the ends stay put
export function stepTextSize(now: number, by: -1 | 1): number {
  const i = Math.max(0, TEXT_SIZES.indexOf(now));
  const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + by))]!;
  writeJson(KEY, next);
  return next;
}
