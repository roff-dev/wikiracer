// Result URLs, share text, splits and the words around a score. A shared result is rebuilt from
// its URL: from, to, r (the stops between them, joined with | and base64url-encoded, so a glance
// at the link doesn't give the route away) and t (seconds, one decimal).

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

const utf8 = new TextEncoder();

export function encodeRoute(via: string[]): string {
  let bin = '';
  for (const b of utf8.encode(via.join('|'))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// null when it isn't a route this site encoded
export function decodeRoute(r: string): string[] | null {
  try {
    const bin = atob(r.replace(/-/g, '+').replace(/_/g, '/'));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return text.split('|').filter((t) => t.trim());
  } catch {
    return null;
  }
}

export function resultUrl(r: SharedResult, base: string): string {
  const q = new URLSearchParams({ from: r.from, to: r.to, r: encodeRoute(r.via), t: r.seconds.toFixed(1) });
  return `${base.replace(/\/$/, '')}/race/result/?${q}`;
}

// null when the URL doesn't describe a result
export function parseResult(search: string): SharedResult | null {
  const q = new URLSearchParams(search);
  const from = q.get('from'), to = q.get('to'), t = q.get('t');
  if (!from?.trim() || !to?.trim() || t === null) return null;
  const seconds = Number(t);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const raw = q.get('r');
  const stops = raw ? decodeRoute(raw) : [];
  if (!stops || stops.length > 200) return null;
  const via = stops.map(normaliseTitle);
  return { from: normaliseTitle(from), to: normaliseTitle(to), via, seconds };
}

export const clicksOf = (r: SharedResult) => r.via.length + 1;

// Clock time as m:ss (the minutes keep counting past an hour)
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

// a room's time limit, in minutes, as words
export const limitWords = (minutes: number) => (minutes === 60 ? '1 hour' : plural(minutes, 'minute'));

// score words
// (a shared result speaks about the race, not to you: 'It beat my map')
export function scoreWords(clicks: number, shortest: number, shared = false): string {
  const over = clicks - shortest;
  if (over < 0) return shared ? 'It beat my map' : 'You beat my map';
  if (over === 0) return 'Perfect route';
  if (over === 1) return 'One off the shortest';
  return `${over} more than the shortest`;
}

// The route as squares, one per click, ten to a row: green up to the shortest route's length,
// yellow for each click past it, blue for every click while the shortest isn't known
export function stepSquares(clicks: number, shortest: number | null): string {
  const squares = Array.from({ length: clicks }, (_, i) => (shortest === null ? '🟦' : i < shortest ? '🟩' : '🟨'));
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 10) rows.push(squares.slice(i, i + 10).join(''));
  return rows.join('\n');
}

// How the route compares with the shortest
export function shortestWords(clicks: number, shortest: number): string {
  const over = clicks - shortest;
  if (over < 0) return `${-over} fewer than my map's shortest (${shortest})`;
  if (over === 0) return `Perfect: the shortest route is ${shortest}`;
  return `${over} more than the shortest (${shortest})`;
}

// The share card: the route as squares and how close it came to the shortest, but no article
// between the start and the finish, so it can't spoil the course for the people it's sent to.
// The first line carries the daily course's number when the race was the daily.
export function shareText(r: SharedResult, opts: { url: string; daily?: number; shortest?: number | null }): string {
  const n = clicksOf(r);
  const shortest = opts.shortest ?? null;
  return [
    opts.daily ? `Wikiracer #${opts.daily}` : 'Wikiracer',
    `${displayTitle(r.from)} to ${displayTitle(r.to)}`,
    stepSquares(n, shortest),
    `${n.toLocaleString('en-GB')} ${n === 1 ? 'click' : 'clicks'} in ${clock(r.seconds)}`,
    ...(shortest === null ? [] : [shortestWords(n, shortest)]),
    opts.url,
  ].join('\n');
}

export interface Split {
  from: string;
  to: string;
  ms: number;
}

// One row per leg: the time spent on an article before leaving it for the next
export function splits(route: string[], legs: number[]): Split[] {
  return route.slice(1).map((to, i) => ({ from: route[i]!, to, ms: legs[i] ?? 0 }));
}
