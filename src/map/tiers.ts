// Capability tiers (spec §10.3): how many nodes the reveal draws, whether it draws parent edges,
// and the DPR cap. The renderer starts at the remembered or detected tier and steps down for the
// rest of the visit if frames run long; it never steps up during a visit.

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  drawBudget: number;
  edges: boolean;
  dprCap: number;
}

export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', drawBudget: 50_000, edges: true, dprCap: 2 },
  medium: { name: 'medium', drawBudget: 20_000, edges: true, dprCap: 2 },
  low: { name: 'low', drawBudget: 5_000, edges: false, dprCap: 1 },
};

const ORDER: TierName[] = ['high', 'medium', 'low'];
const STORE_KEY = 'wikiracer.tier';

export const lowerTier = (t: TierName): TierName | null => ORDER[ORDER.indexOf(t) + 1] ?? null;

interface NavigatorHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

// The starting rule of §10.3, then the remembered tier if it's lower.
export function startTier(nav: NavigatorHints = navigator as NavigatorHints, finePointer = matchMedia('(pointer: fine)').matches): Tier {
  const cores = nav.hardwareConcurrency ?? 4;
  let name: TierName = 'medium';
  if ((nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || cores <= 4 || nav.connection?.saveData) name = 'low';
  else if (finePointer && cores >= 8) name = 'high';
  const saved = readSaved();
  if (saved && ORDER.indexOf(saved) > ORDER.indexOf(name)) name = saved;
  return TIERS[name];
}

function readSaved(): TierName | null {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === 'high' || v === 'medium' || v === 'low' ? v : null;
  } catch {
    return null;
  }
}

export function saveTier(t: TierName): void {
  try {
    localStorage.setItem(STORE_KEY, t);
  } catch {
    // storage blocked: the tier is detected again next visit
  }
}

// Records frame gaps while the map animates. Over each 2-second window, a p90 past 20 ms asks for
// one tier down.
export class FrameProbe {
  private gaps: number[] = [];
  private windowStart = 0;

  constructor(private readonly onSlow: () => void) {}

  // Call once per animated frame with the gap since the previous one.
  record(now: number, gap: number): void {
    if (!this.windowStart) this.windowStart = now;
    this.gaps.push(gap);
    if (now - this.windowStart < 2000) return;
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))] ?? 0;
    this.gaps = [];
    this.windowStart = now;
    if (p90 > 20) this.onSlow();
  }

  // A pause in animation starts a fresh window, so idle time doesn't count as a slow frame.
  pause(): void {
    this.gaps = [];
    this.windowStart = 0;
  }
}
