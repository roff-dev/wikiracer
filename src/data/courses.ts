// The par of a known course from the course files (spec §3.8, §7 "Map unavailable"): daily, pool
// and classic courses carry d and k, so the result can still show the shortest route's length
// when the map can't be reached.

interface Known {
  start: string;
  finish: string;
  d: number;
  k: number;
}

export async function knownPar(from: string, to: string): Promise<{ d: number; k: number } | null> {
  const files = ['/classics.json', '/daily.json', '/pools.json'];
  for (const f of files) {
    try {
      const j = (await (await fetch(f)).json()) as Record<string, unknown>;
      const lists = Object.values(j).filter(Array.isArray) as Known[][];
      const nested = Object.values(j).flatMap((v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).filter(Array.isArray) : [])) as Known[][];
      for (const c of [...lists, ...nested].flat()) if (c?.start === from && c.finish === to) return { d: c.d, k: c.k };
    } catch {
      // a missing file just means no par from it
    }
  }
  return null;
}
