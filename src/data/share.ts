// Result URLs and the words around a score (spec §3.7, §4.7). A shared result is rebuilt from its
// URL: from, to, via (the stops between them, joined with |) and t (seconds, one decimal).

export interface SharedResult {
  from: string;
  to: string;
  via: string[];
  seconds: number;
}

// Wikipedia's underscore form, with the first letter upper-cased as Wikipedia does
export function normaliseTitle(t: string): string {
  const s = t.trim().replace(/ /g, '_');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const displayTitle = (t: string) => t.replace(/_/g, ' ');

export function resultUrl(r: SharedResult, base: string): string {
  const q = new URLSearchParams({ from: r.from, to: r.to, via: r.via.join('|'), t: r.seconds.toFixed(1) });
  return `${base.replace(/\/$/, '')}/race/result/?${q}`;
}

// null when the URL doesn't describe a result
export function parseResult(search: string): SharedResult | null {
  const q = new URLSearchParams(search);
  const from = q.get('from'), to = q.get('to'), t = q.get('t');
  if (!from?.trim() || !to?.trim() || t === null) return null;
  const seconds = Number(t);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const via = (q.get('via') ?? '').split('|').filter((s) => s.trim()).map(normaliseTitle);
  if (via.length > 200) return null;
  return { from: normaliseTitle(from), to: normaliseTitle(to), via, seconds };
}

export const clicksOf = (r: SharedResult) => r.via.length + 1;

// Clock time as m:ss (the minutes keep counting past an hour)
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

// §3.7 score words
// (a shared result speaks about the race, not to you: 'It beat my map')
export function scoreWords(clicks: number, shortest: number, shared = false): string {
  const over = clicks - shortest;
  if (over < 0) return shared ? 'It beat my map' : 'You beat my map';
  if (over === 0) return 'Perfect route';
  if (over === 1) return 'One off the shortest';
  return `${over} more than the shortest`;
}
