// A course's rules as pure functions over plain data, so they're tested without the Workers runtime.
// The Course object loads a Room, applies one event, stores the result and broadcasts its state.
// Live phases: lobby → countdown → race → standings, then back to the lobby for the next course.
// Countdown and race are one stored stage ('round'); which one it is follows from startAt.
import { checkName, uniqueName } from './names.ts';
import { LIMITS, MAX_SEATS, type ErrorCode, type Limit, type Mode, type Phase, type PlayerState, type PlayerStatus, type RoomState, type Scoring, type StandingRow } from './protocol.ts';

export { MAX_SEATS };
export const COUNTDOWN_MS = 5000;
// the default time limit, and the limit of rooms stored before the host could pick one
export const DEFAULT_LIMIT: Limit = 30;
export const ROUND_MS = DEFAULT_LIMIT * 60_000;
export const HOST_AWAY_MS = 60_000;
export const EXPIRY_MS = 30 * 86_400_000;
export const RATE = { messages: 20, windowMs: 10_000 };
export const MAX_CLICKS = 10_000;
export const CHALLENGE_TIME_MS = 24 * 3_600_000;

export interface Seat {
  n: number;
  // SHA-256 of the seat token (the token itself is never stored)
  hash: string;
  name: string;
  joined: number;
  connected: boolean;
  awaySince: number | null;
}

export interface Run {
  clicks: number;
  status: 'racing' | 'finished' | 'gaveup' | 'dnf';
  timeMs: number | null;
  route: string[];
  // rate-rule strikes this round; the second one ends the run
  strikes: number;
}

export interface Room {
  mode: Mode;
  from: string;
  to: string;
  created: number;
  lastActivity: number;
  // 0 until the first start
  round: number;
  stage: 'lobby' | 'round' | 'standings';
  startAt: number | null;
  // how a round is won; rooms stored before this existed score by clicks
  scoring?: Scoring;
  // a round's time limit in minutes; rooms stored before this existed have 30
  limit?: Limit;
  // seat number of the host
  host: number;
  // the creator's seat hash: their seat becomes host when they join, even if a friend got in first
  owner?: string | null;
  seats: Seat[];
  // this round's runs, by seat number; a seat without one is watching
  runs: Record<number, Run>;
}

export type Outcome = { ok: true; room: Room } | { ok: false; code: ErrorCode };
const fail = (code: ErrorCode): Outcome => ({ ok: false, code });
const clone = (r: Room): Room => structuredClone(r);

// Titles: 1–255 UTF-8 bytes, no control characters
const bytes = new TextEncoder();
export const validTitle = (t: unknown): t is string => typeof t === 'string' && t.length > 0 && bytes.encode(t).length <= 255 && !/\p{Cc}/u.test(t);
const validClicks = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= MAX_CLICKS;

// A finished route: one more article than clicks, from the start to the finish
export function validFinish(course: { from: string; to: string }, f: { clicks: unknown; timeMs: unknown; route: unknown }, maxMs: number): boolean {
  const { clicks, timeMs, route } = f;
  return (
    validClicks(clicks) &&
    typeof timeMs === 'number' &&
    Number.isFinite(timeMs) &&
    timeMs >= 0 &&
    timeMs <= maxMs &&
    Array.isArray(route) &&
    route.length === clicks + 1 &&
    route.every(validTitle) &&
    route[0] === course.from &&
    route[clicks] === course.to
  );
}

export function createRoom(mode: Mode, from: string, to: string, now: number, owner: string | null = null): Room {
  return { mode, from, to, created: now, lastActivity: now, round: 0, stage: 'lobby', startAt: null, scoring: 'clicks', limit: DEFAULT_LIMIT, host: 0, owner, seats: [], runs: {} };
}

export const scoringOf = (r: Room): Scoring => r.scoring ?? 'clicks';
export const limitOf = (r: Room): Limit => r.limit ?? DEFAULT_LIMIT;
const limitMs = (r: Room) => limitOf(r) * 60_000;

export function phaseAt(room: Room, now: number): Phase {
  if (room.stage === 'round') return now < room.startAt! ? 'countdown' : 'race';
  return room.stage;
}

// Lazy host hand-over: a host away for over 60 s passes to the next connected seat in join order
function resolveHost(r: Room, now: number) {
  const host = r.seats.find((s) => s.n === r.host);
  const gone = !host || (!host.connected && host.awaySince !== null && now - host.awaySince > HOST_AWAY_MS);
  if (!gone) return;
  const next = [...r.seats].sort((a, b) => a.joined - b.joined).find((s) => s.connected);
  if (next) r.host = next.n;
  else if (!host) r.host = r.seats[0]?.n ?? 0;
}

// Every event: activity noted, host checked
function touch(room: Room, now: number): Room {
  const r = clone(room);
  r.lastActivity = now;
  resolveHost(r, now);
  return r;
}

export function hostAt(room: Room, now: number): number {
  const r = clone(room);
  resolveHost(r, now);
  return r.host;
}

// Join, or return to a seat with the same token
export function join(room: Room, hash: string, rawName: string, now: number): { ok: true; room: Room; n: number } | { ok: false; code: ErrorCode } {
  const r = touch(room, now);
  const mine = r.seats.find((s) => s.hash === hash);
  if (mine) {
    mine.connected = true;
    mine.awaySince = null;
    resolveHost(r, now);
    return { ok: true, room: r, n: mine.n };
  }
  if (r.seats.length >= MAX_SEATS) return { ok: false, code: 'full' };
  const name = checkName(rawName);
  if (!name.ok) return { ok: false, code: 'name' };
  let n = 1;
  while (r.seats.some((s) => s.n === n)) n++;
  r.seats.push({ n, hash, name: uniqueName(name.name, r.seats.map((s) => s.name)), joined: now, connected: true, awaySince: null });
  if (hash === r.owner || !r.seats.some((s) => s.n === r.host)) r.host = n;
  return { ok: true, room: r, n };
}

export function disconnect(room: Room, n: number, now: number): Room {
  const r = clone(room);
  const seat = r.seats.find((s) => s.n === n);
  if (seat) {
    seat.connected = false;
    seat.awaySince = now;
  }
  return r;
}

// Leave: frees the seat outside a round; during one it counts as giving up
export function leave(room: Room, n: number, now: number): Room {
  let r = touch(room, now);
  if (r.stage === 'round') {
    const run = r.runs[n];
    if (run?.status === 'racing') run.status = 'gaveup';
    r = disconnect(r, n, now);
    return settle(r);
  }
  r.seats = r.seats.filter((s) => s.n !== n);
  delete r.runs[n];
  if (r.host === n) {
    r.host = 0;
    resolveHost(r, now);
  }
  return r;
}

// The host sets the course, in the lobby or after a round (which returns everyone to the lobby)
export function setCourse(room: Room, n: number, from: unknown, to: unknown, now: number): Outcome {
  const r = touch(room, now);
  if (r.host !== n) return fail('bad');
  if (r.stage === 'round') return fail('started');
  if (!validTitle(from) || !validTitle(to) || from === to) return fail('bad');
  r.from = from;
  r.to = to;
  r.stage = 'lobby';
  r.startAt = null;
  r.runs = {};
  return { ok: true, room: r };
}

// The host picks how rounds are won, between rounds; the standings stay up
export function setScoring(room: Room, n: number, scoring: unknown, now: number): Outcome {
  const r = touch(room, now);
  if (r.host !== n) return fail('bad');
  if (r.stage === 'round') return fail('started');
  if (scoring !== 'clicks' && scoring !== 'time') return fail('bad');
  r.scoring = scoring;
  return { ok: true, room: r };
}

// The host picks the time limit, between rounds
export function setLimit(room: Room, n: number, minutes: unknown, now: number): Outcome {
  const r = touch(room, now);
  if (r.host !== n) return fail('bad');
  if (r.stage === 'round') return fail('started');
  if (!LIMITS.includes(minutes as Limit)) return fail('bad');
  r.limit = minutes as Limit;
  return { ok: true, room: r };
}

// The host starts from the lobby with at least 2 players connected; everyone connected races
export function start(room: Room, n: number, now: number): Outcome {
  const r = touch(room, now);
  if (r.host !== n) return fail('bad');
  if (r.stage === 'round') return fail('started');
  if (r.stage !== 'lobby') return fail('bad');
  const racing = r.seats.filter((s) => s.connected);
  if (racing.length < 2) return fail('bad');
  r.round++;
  r.stage = 'round';
  r.startAt = now + COUNTDOWN_MS;
  r.runs = Object.fromEntries(racing.map((s) => [s.n, { clicks: 0, status: 'racing', timeMs: null, route: [], strikes: 0 } satisfies Run]));
  return { ok: true, room: r };
}

// Nothing counts once the time is up, even before the alarm has run
function racingRun(r: Room, n: number, now: number): Run | null {
  if (phaseAt(r, now) !== 'race' || now >= r.startAt! + limitMs(r)) return null;
  const run = r.runs[n];
  return run?.status === 'racing' ? run : null;
}

// A move: counts only go up; a lower one (resent after a reconnect) changes nothing
export function move(room: Room, n: number, click: unknown, title: unknown, now: number): Outcome {
  const r = touch(room, now);
  const run = racingRun(r, n, now);
  if (!run || !validClicks(click) || !validTitle(title)) return fail('bad');
  run.clicks = Math.max(run.clicks, click);
  return { ok: true, room: r };
}

export function finish(room: Room, n: number, f: { clicks: unknown; timeMs: unknown; route: unknown }, now: number): Outcome {
  const r = touch(room, now);
  const run = racingRun(r, n, now);
  if (!run || !validFinish(r, f, limitMs(r)) || (f.clicks as number) < run.clicks) return fail('bad');
  run.status = 'finished';
  run.clicks = f.clicks as number;
  // a timed round counts real time from the start, loading included, on the room's clock
  run.timeMs = scoringOf(r) === 'time' ? Math.max(0, now - r.startAt!) : (f.timeMs as number);
  run.route = f.route as string[];
  return { ok: true, room: settle(r) };
}

export function giveUp(room: Room, n: number, clicks: unknown, now: number): Outcome {
  const r = touch(room, now);
  const run = racingRun(r, n, now);
  if (!run || !validClicks(clicks)) return fail('bad');
  run.status = 'gaveup';
  run.clicks = Math.max(run.clicks, clicks);
  return { ok: true, room: settle(r) };
}

// The round ends when nobody is still racing
function settle(r: Room): Room {
  if (r.stage === 'round' && Object.values(r.runs).every((run) => run.status !== 'racing')) r.stage = 'standings';
  return r;
}

// The alarm at the time limit: anyone still racing didn't finish
export function endRound(room: Room, now: number): Room {
  const r = clone(room);
  if (r.stage !== 'round' || now < r.startAt! + limitMs(r)) return r;
  for (const run of Object.values(r.runs)) if (run.status === 'racing') run.status = 'dnf';
  r.stage = 'standings';
  return r;
}

// The one alarm: the round's end while one runs, else expiry 30 days after the last activity
export const nextAlarm = (r: Room) => (r.stage === 'round' ? r.startAt! + limitMs(r) : r.lastActivity + EXPIRY_MS);
export const expired = (r: Room, now: number) => now >= r.lastActivity + EXPIRY_MS;

// The rate rule: more than 20 messages in a 10 s window closes the socket
export interface RateWindow {
  since: number;
  count: number;
}

export function countMessage(w: RateWindow | null, now: number): { window: RateWindow; over: boolean } {
  const window = !w || now - w.since >= RATE.windowMs ? { since: now, count: 1 } : { since: w.since, count: w.count + 1 };
  return { window, over: window.count > RATE.messages };
}

// A strike for seat n; the second in a round gives 'rate' and the run counts as given up
export function strike(room: Room, n: number): { room: Room; code: ErrorCode | null } {
  const r = clone(room);
  const run = r.runs[n];
  if (!run || r.stage !== 'round') return { room: r, code: null };
  run.strikes++;
  if (run.strikes < 2) return { room: r, code: null };
  if (run.status === 'racing') run.status = 'gaveup';
  return { room: settle(r), code: 'rate' };
}

function statusOf(r: Room, s: Seat): PlayerStatus {
  const run = r.runs[s.n];
  if (r.stage === 'lobby') return s.connected ? 'waiting' : 'away';
  if (!run) return 'watching';
  if (run.status === 'racing' && !s.connected) return 'away';
  return run.status;
}

// What everyone is sent on every change: counts and statuses, never a title but the course's ends
export function stateOf(room: Room, now: number): RoomState {
  const players: PlayerState[] = [...room.seats]
    .sort((a, b) => a.n - b.n)
    .map((s) => {
      const run = room.runs[s.n];
      const p: PlayerState = { n: s.n, name: s.name, clicks: run?.clicks ?? 0, status: statusOf(room, s) };
      if (run?.status === 'finished' && run.timeMs !== null) p.timeMs = run.timeMs;
      return p;
    });
  return {
    now,
    phase: phaseAt(room, now),
    round: room.round,
    from: room.from,
    to: room.to,
    ...(room.stage === 'round' ? { startAt: room.startAt! } : {}),
    scoring: scoringOf(room),
    limit: limitOf(room),
    host: hostAt(room, now),
    players,
  };
}

// Standings and challenge tables: finished first, then fewest clicks, then the lower time (a timed
// room's finishers: the lower time, then fewest clicks); equal clicks and time share a place.
interface Rankable {
  status: string;
  clicks: number;
  timeMs: number | null;
}

const comparer = (scoring: Scoring) => (a: Rankable, b: Rankable): number => {
  const fa = a.status === 'finished' ? 0 : 1, fb = b.status === 'finished' ? 0 : 1;
  if (fa !== fb) return fa - fb;
  const time = (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity);
  if (scoring === 'time' && fa === 0 && time !== 0) return time;
  if (a.clicks !== b.clicks) return a.clicks - b.clicks;
  return time || 0;
};

export function rank<T extends Rankable>(rows: T[], scoring: Scoring = 'clicks'): (T & { place: number })[] {
  const better = comparer(scoring);
  const sorted = [...rows].sort(better);
  return sorted.map((row) => ({ ...row, place: 1 + sorted.filter((o) => better(o, row) < 0).length }));
}

// `routeOf` gives a given-up run's route from the stored moves (a finish carries its own)
export function standings(room: Room, routeOf: (n: number) => string[] = () => []): StandingRow[] {
  const rows = room.seats
    .filter((s) => room.runs[s.n])
    .map((s) => {
      const run = room.runs[s.n]!;
      return { n: s.n, name: s.name, status: run.status as PlayerStatus, clicks: run.clicks, timeMs: run.status === 'finished' ? run.timeMs : null, route: run.status === 'finished' ? run.route : routeOf(s.n) };
    });
  return rank(rows, scoringOf(room));
}

// Challenges: up to MAX_SEATS results, one per seat token, the first one kept
export interface ChallengeResult {
  hash: string;
  name: string;
  status: 'finished' | 'gaveup';
  clicks: number;
  timeMs: number;
  route: string[];
  at: number;
}

export function addResult(
  course: { from: string; to: string },
  results: ChallengeResult[],
  entry: { hash: string; name: unknown; status: unknown; clicks: unknown; timeMs: unknown; route: unknown },
  now: number,
): { ok: true; results: ChallengeResult[] } | { ok: false; code: ErrorCode } {
  if (results.some((r) => r.hash === entry.hash)) return { ok: false, code: 'exists' };
  if (results.length >= MAX_SEATS) return { ok: false, code: 'full' };
  const name = typeof entry.name === 'string' ? checkName(entry.name) : null;
  if (!name?.ok) return { ok: false, code: 'name' };
  const { status, clicks, timeMs, route } = entry;
  const ok =
    status === 'finished'
      ? validFinish(course, { clicks, timeMs, route }, CHALLENGE_TIME_MS)
      : status === 'gaveup' &&
        validClicks(clicks) &&
        typeof timeMs === 'number' &&
        timeMs >= 0 &&
        timeMs <= CHALLENGE_TIME_MS &&
        Array.isArray(route) &&
        route.length === clicks + 1 &&
        route.every(validTitle) &&
        route[0] === course.from;
  if (!ok) return { ok: false, code: 'bad' };
  const row: ChallengeResult = {
    hash: entry.hash,
    name: uniqueName(name.name, results.map((r) => r.name)),
    status: status as ChallengeResult['status'],
    clicks: clicks as number,
    timeMs: timeMs as number,
    route: route as string[],
    at: now,
  };
  return { ok: true, results: [...results, row] };
}

// The table a visitor sees: routes only once they have a result of their own
export function challengeTable(results: ChallengeResult[], viewerHash: string | null) {
  const mine = results.some((r) => r.hash === viewerHash);
  return {
    full: results.length >= MAX_SEATS,
    played: mine,
    rows: rank(results.map((r) => ({ name: r.name, status: r.status, clicks: r.clicks, timeMs: r.timeMs, at: r.at, you: r.hash === viewerHash, ...(mine ? { route: r.route } : {}) }))),
  };
}
