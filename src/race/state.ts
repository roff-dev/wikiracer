// A race's state: the route so far, the time spent on each article and how it ended. Kept in
// sessionStorage after every move, so a reload resumes on the same article with the same clicks
// (and can't be used to step back). The clock runs only while an article is on screen.
import { normaliseTitle } from '../search/titles.ts';

export interface RaceState {
  v: 1;
  from: string;
  to: string;
  // the articles reached, in URL form; route[0] is the start
  route: string[];
  // ms on screen per article in `route`
  legs: number[];
  status: 'racing' | 'finished' | 'gaveUp';
  // the daily course's date or the challenge code, when the race is one
  daily?: string;
  ch?: string;
}

export const clicks = (s: RaceState) => s.route.length - 1;
export const elapsedMs = (s: RaceState) => s.legs.reduce((a, b) => a + b, 0);
export const current = (s: RaceState) => s.route.at(-1)!;
export const sameTitle = (a: string, b: string) => normaliseTitle(a) === normaliseTitle(b);

export function newRace(from: string, to: string, extra: { daily?: string; ch?: string } = {}): RaceState {
  return { v: 1, from, to, route: [], legs: [], status: 'racing', ...extra };
}

// A move to `title`: one click, a new article with no time yet
export function move(s: RaceState, title: string): RaceState {
  return { ...s, route: [...s.route, title], legs: [...s.legs, 0] };
}

// The article actually landed on (after Wikipedia's redirects) replaces the link's title. The
// start article is added here too, as the race's first stop. Arriving at the finish ends it.
export function land(s: RaceState, title: string): RaceState {
  const route = s.route.length ? [...s.route.slice(0, -1), title] : [title];
  const legs = s.legs.length ? s.legs : [0];
  return { ...s, route, legs, status: route.length > 1 && sameTitle(title, s.to) ? 'finished' : s.status };
}

// Time on the current article, added when it leaves the screen
export function addTime(s: RaceState, ms: number): RaceState {
  if (!s.legs.length || ms <= 0) return s;
  const legs = [...s.legs];
  legs[legs.length - 1]! += ms;
  return { ...s, legs };
}

export const giveUp = (s: RaceState): RaceState => ({ ...s, status: 'gaveUp' });

// Running clock: holds when the current leg went on screen, or null while paused
export class Clock {
  private since: number | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}
  get running(): boolean {
    return this.since !== null;
  }
  start(): void {
    this.since ??= this.now();
  }
  // Stops and returns the ms since start (0 when already paused)
  stop(): number {
    if (this.since === null) return 0;
    const ms = this.now() - this.since;
    this.since = null;
    return ms;
  }
  // ms in the current, unfinished leg
  peek(): number {
    return this.since === null ? 0 : this.now() - this.since;
  }
}

const KEY = 'wikiracer.race';

export function saveRace(s: RaceState, store: Pick<Storage, 'setItem'> | null = sessionStore(), key = KEY): boolean {
  try {
    store?.setItem(key, JSON.stringify(s));
    return !!store;
  } catch {
    return false;
  }
}

// The saved race for this course, if the tab has one
// (a room's round has its own key, so a course raced twice in one room starts fresh)
export function loadRace(from: string, to: string, store: Pick<Storage, 'getItem'> | null = sessionStore(), key = KEY): RaceState | null {
  try {
    const s = JSON.parse(store?.getItem(key) ?? 'null') as RaceState | null;
    if (!s || s.v !== 1 || s.from !== from || s.to !== to || !Array.isArray(s.route) || s.route.length !== s.legs.length) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearRace(store: Pick<Storage, 'removeItem'> | null = sessionStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

function sessionStore(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}
